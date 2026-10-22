from datetime import date, timedelta

import pytest

from roster_lib.codes import Pattern, parse_code, works_on
from roster_lib.config import Person, Rotation, RotationConfig
from roster_lib.cycles import cycle_for, previous_cycle
from roster_lib.roster_io import Person as RosterPerson
from roster_lib.rotation import (
    InvalidAnswers,
    MissingAnswers,
    canonical_text,
    choose_text,
    derive_state,
    headcount_by_shift,
    parse_pattern,
    rotate,
)

AUG = cycle_for(2026, 8)  # Sun 2 Aug 2026 .. Sat 3 Oct 2026
PREV = previous_cycle(AUG)  # Sun 31 May .. Sat 1 Aug 2026
MF, WS = Pattern.MON_FRI, Pattern.WED_SUN


def fill(cycle, pattern, text, overrides=None):
    cells = {}
    d = cycle.start
    while d <= cycle.end:
        cells[d] = text if works_on(pattern, d) else ""
        d += timedelta(days=1)
    cells.update(overrides or {})
    return cells


def cfg(*people):
    c = RotationConfig()
    for name, rotation, shift, subteam in people:
        c.add_person(Person(name, "Operate", "Blr", rotation, subteam=subteam, shift=shift))
    return c


def rp(name, team="T1"):
    return RosterPerson(name, "Bengaluru", team, "L2", 1)


# ---- deriving the current state -------------------------------------------------

def test_derive_modal_string_and_pattern_ignoring_leave_and_partial_weeks():
    cells = fill(PREV, MF, "Shift-1")
    cells[date(2026, 6, 8)] = "P"  # leave on a working day
    cells[date(2026, 6, 9)] = "HOL"
    cells[date(2026, 7, 1)] = "shift 1"  # a rare variant
    for d in (date(2026, 6, 15), date(2026, 6, 16)):  # a partial week: person absent
        cells[d] = ""
    st = derive_state(cells, PREV)
    assert (st.code, st.text, st.pattern) == ("S1", "Shift-1", MF)
    assert st.pattern_from_weeks


def test_derive_wed_sun_exception_on_a_mon_fri_code():
    st = derive_state(fill(PREV, WS, "Shift-1"), PREV)
    assert (st.code, st.pattern) == ("S1", WS)


def test_derive_last_full_week_after_mid_cycle_change():
    cells = fill(PREV, MF, "Shift-1")
    switch = date(2026, 7, 5)
    for d in list(cells):
        if d >= switch and cells[d]:
            cells[d] = "Shift-3"
    st = derive_state(cells, PREV)
    assert (st.code, st.text) == ("S3", "Shift-3")
    assert st.weeks_used == 4  # only the trailing run counts


def test_derive_custom_text_verbatim_and_unparseable_counted():
    cells = fill(PREV, MF, "IST 6:00-3:00AM")
    cells[date(2026, 6, 3)] = "Shift Swap\nNS"
    st = derive_state(cells, PREV)
    assert (st.code, st.text) == ("CUSTOM", "IST 6:00-3:00AM")
    assert st.unparseable == 1


def test_derive_no_data_is_none():
    assert derive_state({}, PREV) is None
    assert derive_state({d: "" for d in fill(PREV, MF, "x")}, PREV) is None


def test_derive_pattern_from_days_when_no_week_fits():
    cells = fill(PREV, WS, "Shift-2")
    for d in cells:  # HOL on a weekly-off Monday and a Saturday: no week fits one pattern
        if d.weekday() in (0, 5):
            cells[d] = "HOL"
    st = derive_state(cells, PREV)
    assert st.pattern is WS and not st.pattern_from_weeks


# ---- categories -----------------------------------------------------------------

def test_permanent_copies_string_and_pattern_forward():
    config = cfg(("Perm One", Rotation.PERMANENT, "S1", "DIS"))
    prev = {"Perm One": fill(PREV, WS, "shift-1")}  # S1 with the Wed-Sun exception
    res = rotate(prev, config, AUG)
    row = res.schedule["Perm One"]
    assert set(row) == set(d for d in row if AUG.contains(d)) and len(row) == AUG.days
    assert all(t in ("shift-1", "") for t in row.values())
    assert [works_on(WS, d) for d in row] == [bool(t) for t in row.values()]
    assert res.changes == []


def test_permanent_custom_string_copied_verbatim():
    config = cfg(("Cust", Rotation.PERMANENT, None, None))
    res = rotate({"Cust": fill(PREV, MF, " IST 6:00-3:00AM")}, config, AUG)
    assert {t for t in res.schedule["Cust"].values() if t} == {" IST 6:00-3:00AM"}


def test_auto_swap_flips_and_pattern_follows_new_code():
    config = cfg(("Ann", Rotation.AUTO_SWAP, "S1", "DIS"), ("Ben", Rotation.AUTO_SWAP, "S2", "DIS"),
                 ("Cal", Rotation.AUTO_SWAP, "S3", "DIS"), ("Dee", Rotation.AUTO_SWAP, "S4", "DIS"))
    prev = {
        "Ann": fill(PREV, MF, "Shift-1"), "Ben": fill(PREV, WS, "Shift-2"),
        "Cal": fill(PREV, MF, "Shift-3"), "Dee": fill(PREV, WS, "Shift-4"),
    }
    res = rotate(prev, config, AUG)
    expect = {"Ann": ("Shift-2", WS), "Ben": ("Shift-1", MF), "Cal": ("Shift-4", WS),
              "Dee": ("Shift-3", MF)}
    for name, (text, pattern) in expect.items():
        row = res.schedule[name]
        assert {t for t in row.values() if t} == {text}
        assert all(bool(t) == works_on(pattern, d) for d, t in row.items())
    assert {(c.person, c.old_shift, c.new_shift) for c in res.changes} == {
        ("Ann", "S1", "S2"), ("Ben", "S2", "S1"), ("Cal", "S3", "S4"), ("Dee", "S4", "S3")}
    assert res.warnings == []


def test_auto_swap_with_wed_sun_exception_s1_goes_to_s2_wed_sun_then_back_to_mon_fri():
    config = cfg(("Exc", Rotation.AUTO_SWAP, "S1", None))
    res = rotate({"Exc": fill(PREV, WS, "Shift-1")}, config, AUG)  # S1 on Wed-Sun by exception
    assert res.schedule["Exc"][AUG.start] == "Shift-2"
    ch = res.changes[0]
    assert (ch.old_pattern, ch.new_pattern) == (WS, WS)


# ---- swap Sunday ----------------------------------------------------------------

def test_swap_sunday_vectors_no_overlap_no_gap():
    config = cfg(("Xavier", Rotation.AUTO_SWAP, "S1", None),
                 ("Yara", Rotation.AUTO_SWAP, "S2", None),
                 ("Stay", Rotation.PERMANENT, "S5", None))
    prev = {"Xavier": fill(PREV, MF, "Shift-1"), "Yara": fill(PREV, WS, "Shift-2"),
            "Stay": fill(PREV, MF, "Shift-5")}
    assert prev["Xavier"][date(2026, 7, 31)] == "Shift-1" and prev["Xavier"][date(2026, 8, 1)] == ""
    assert prev["Yara"][date(2026, 8, 1)] == "Shift-2"
    new = rotate(prev, config, AUG).schedule

    x = new["Xavier"]
    assert AUG.start == date(2026, 8, 2)
    assert x[date(2026, 8, 2)] == "Shift-2"  # works the swap Sunday as the new code
    assert x[date(2026, 8, 3)] == x[date(2026, 8, 4)] == ""  # off Mon-Tue
    assert all(x[date(2026, 8, 5) + timedelta(days=i)] == "Shift-2" for i in range(5))  # Wed-Sun
    y = new["Yara"]
    assert y[date(2026, 8, 2)] == ""  # takes the swap Sunday off
    assert y[date(2026, 8, 3)] == "Shift-1"  # starts Monday
    assert all(y[date(2026, 8, 3) + timedelta(days=i)] == "Shift-1" for i in range(5))
    assert y[date(2026, 8, 8)] == y[date(2026, 8, 9)] == ""  # Sat/Sun off
    s = new["Stay"]
    assert s[date(2026, 8, 2)] == "" and s[date(2026, 8, 3)] == "Shift-5"  # continues Mon-Fri

    # across the boundary: never two shifts the same day, never more than 6 days in a row
    for name in ("Xavier", "Yara", "Stay"):
        both = {**prev[name], **new[name]}
        run = longest = 0
        d = PREV.start
        while d <= AUG.end:
            run = run + 1 if both[d] else 0
            longest = max(longest, run)
            d += timedelta(days=1)
        assert longest <= 6
        assert set(prev[name]).isdisjoint(new[name])


# ---- string selection order -----------------------------------------------------

def test_choose_text_order():
    cur = derive_state(fill(PREV, MF, "shift 1"), PREV)
    own = {date(2026, 3, 2): "Shift-2", date(2026, 5, 20): "S2 "}
    team = {"Shift-2": 3, "S2": 5}
    # 1 person's own most recent use (the later date wins)
    assert choose_text("S2", own, team, cur) == "S2 "
    # ignores dates on/after `before`
    assert choose_text("S2", own, team, cur, before=date(2026, 5, 20)) == "Shift-2"
    # 2 team's most common
    assert choose_text("S2", {}, team, cur) == "S2"
    assert choose_text("S2", {}, {"b": 2, "a": 2}, cur) == "a"  # alphabetical tie-break
    # 3 restyle the person's own string
    assert choose_text("S2", {}, {}, cur) == "shift 2"
    # 4 canonical
    assert choose_text("S2", {}, {}, None) == "Shift-2"
    assert choose_text("NS", {}, {}, cur) == "NS"
    # unchanged code keeps the exact current string
    assert choose_text("S1", own, team, cur) == "shift 1"


def test_canonical_text_round_trips():
    for code in ("S1", "S2", "S3", "S4", "S5", "NS", "US-CST", "US-PST", "11AM-8PM", "MX-8-5"):
        assert parse_code(canonical_text(code)).canonical == code


def test_auto_swap_string_from_history_then_team_then_style():
    config = cfg(("Hist", Rotation.AUTO_SWAP, "S1", None), ("Team", Rotation.AUTO_SWAP, "S1", None),
                 ("Mate", Rotation.AUTO_SWAP, "S2", None), ("Solo", Rotation.AUTO_SWAP, "S1", None))
    older = {"Hist": {date(2026, 2, 3): "S2 (old)"}}  # unparseable: must not be used
    older["Hist"][date(2026, 3, 3)] = "S2"
    prev = {
        "Hist": fill(PREV, MF, "Shift-1"),
        "Team": fill(PREV, MF, "Shift-1"),
        "Mate": fill(PREV, WS, "Shift 2"),  # team's string for S2
        "Solo": fill(PREV, MF, "s1"),
    }
    people = [rp("Hist", "A"), rp("Team", "B"), rp("Mate", "B"), rp("Solo", "C")]
    res = rotate(prev, config, AUG, people=people, history=older)
    text = lambda n: next(t for t in res.schedule[n].values() if t)
    assert text("Hist") == "S2"  # own history beats the team
    assert text("Team") == "Shift 2"  # team's most common for S2
    assert text("Solo") == "s2"  # restyled own string, team has no S2
    assert text("Mate") == "Shift-1"  # team B's S1 string (Team's)


def test_own_previous_cycle_use_wins_over_team():
    config = cfg(("Own", Rotation.AUTO_SWAP, "S2", None), ("Other", Rotation.PERMANENT, "S1", None))
    own = fill(PREV, WS, "Shift-2")
    for d in (date(2026, 6, 3), date(2026, 6, 4)):  # earlier in the cycle they worked S1
        own[d] = "SHIFT 1"
    prev = {"Own": own, "Other": fill(PREV, MF, "Shift-1")}
    res = rotate(prev, config, AUG, people=[rp("Own"), rp("Other")])
    assert {t for t in res.schedule["Own"].values() if t} == {"SHIFT 1"}


# ---- ask me / new seats / replaces ----------------------------------------------

def test_ask_me_uses_answers_and_missing_raises():
    config = cfg(("Ask Me", Rotation.ASK_ME, None, None), ("Unc", Rotation.UNCLASSIFIED, None, None))
    prev = {"Ask Me": fill(PREV, MF, "Shift-1"), "Unc": fill(PREV, WS, "Shift-2")}
    with pytest.raises(MissingAnswers) as err:
        rotate(prev, config, AUG, {"Ask Me": {"shift": "S3", "pattern": "MON_FRI"}})
    assert err.value.names == ["Unc"]
    res = rotate(prev, config, AUG, {"ask me": {"shift": "S3", "pattern": "MON_FRI"},
                                     "Unc": {"shift": "KEEP"}})
    row = res.schedule["Ask Me"]
    assert {t for t in row.values() if t} == {"Shift-3"}
    assert all(bool(t) == works_on(MF, d) for d, t in row.items())
    unc = res.schedule["Unc"]
    assert {t for t in unc.values() if t} == {"Shift-2"}
    assert all(bool(t) == works_on(WS, d) for d, t in unc.items())
    assert [(c.person, c.old_shift, c.new_shift) for c in res.changes] == [("Ask Me", "S1", "S3")]


def test_answer_exact_text_and_invalid_answers():
    config = cfg(("Ask Me", Rotation.ASK_ME, None, None))
    prev = {"Ask Me": fill(PREV, MF, "Shift-1")}
    res = rotate(prev, config, AUG, {"Ask Me": {"shift": "S3", "text": "shift 3"}})
    assert {t for t in res.schedule["Ask Me"].values() if t} == {"shift 3"}
    for bad in ({"shift": "S2", "pattern": "MON_FRI"}, {"shift": "banana"}, {"pattern": "WED_SUN"},
                {"shift": "S3", "text": "NS"}, {"shift": "S3", "pattern": "Sat-Wed"}):
        with pytest.raises(InvalidAnswers):
            rotate(prev, config, AUG, {"Ask Me": bad})


def test_new_seat_needs_answer_and_has_no_shift_change():
    config = cfg(("Newbie", Rotation.PERMANENT, "S3", None), ("Old", Rotation.PERMANENT, "S3", None))
    prev = {"Old": fill(PREV, MF, "Shift-3")}
    with pytest.raises(MissingAnswers) as err:
        rotate(prev, config, AUG)
    assert err.value.names == ["Newbie"]
    res = rotate(prev, config, AUG, {"Newbie": {"shift": "S3", "pattern": "MON_FRI"}})
    assert {t for t in res.schedule["Newbie"].values() if t} == {"Shift-3"}
    assert res.changes == []
    assert res.warnings == []  # new seat is excluded from the headcount comparison


def test_person_not_in_config_is_reported():
    config = cfg(("Known", Rotation.PERMANENT, "S1", None))
    prev = {"Known": fill(PREV, MF, "Shift-1"), "Stranger": fill(PREV, MF, "Shift-1")}
    with pytest.raises(MissingAnswers) as err:
        rotate(prev, config, AUG, people=[rp("Known"), rp("Stranger")])
    assert err.value.names == ["Stranger"]


def test_replacement_takes_the_seat_from_the_replaced_person():
    config = cfg(("Newcomer", Rotation.AUTO_SWAP, "S1", None))
    prev = {"Departed": fill(PREV, MF, "Shift-1")}
    res = rotate(prev, config, AUG, replaces={"Newcomer": "Departed"})
    row = res.schedule["Newcomer"]
    assert {t for t in row.values() if t} == {"Shift-2"}  # the seat's next assignment
    assert all(bool(t) == works_on(WS, d) for d, t in row.items())


def test_auto_swap_without_partner_needs_answer_and_config_mismatch_warns():
    config = cfg(("Nine", Rotation.AUTO_SWAP, "S1", None))
    prev = {"Nine": fill(PREV, MF, "Shift-5")}
    with pytest.raises(MissingAnswers):
        rotate(prev, config, AUG)
    res = rotate(prev, config, AUG, {"Nine": {"shift": "S1"}})
    assert {t for t in res.schedule["Nine"].values() if t} == {"Shift-1"}
    assert any("differs from the observed" in w for w in res.warnings)


def test_answer_ignored_for_permanent_warns():
    config = cfg(("Perm", Rotation.PERMANENT, "S1", None))
    res = rotate({"Perm": fill(PREV, MF, "Shift-1")}, config, AUG, {"Perm": {"shift": "S3"}})
    assert {t for t in res.schedule["Perm"].values() if t} == {"Shift-1"}
    assert any("answer ignored" in w for w in res.warnings)


# ---- headcount ------------------------------------------------------------------

def test_headcount_warning_when_swap_is_unbalanced():
    config = cfg(("A", Rotation.AUTO_SWAP, "S1", None), ("B", Rotation.AUTO_SWAP, "S1", None),
                 ("C", Rotation.AUTO_SWAP, "S2", None))
    prev = {"A": fill(PREV, MF, "Shift-1"), "B": fill(PREV, MF, "Shift-1"),
            "C": fill(PREV, WS, "Shift-2")}
    people = [rp("A"), rp("B"), rp("C")]
    res = rotate(prev, config, AUG, people=people)
    assert res.warnings == ["Headcount changed for team T1: S1 2 -> 1",
                            "Headcount changed for team T1: S2 1 -> 2"]


def test_headcount_balanced_swap_has_no_warning():
    config = cfg(("A", Rotation.AUTO_SWAP, "S1", None), ("B", Rotation.AUTO_SWAP, "S2", None))
    prev = {"A": fill(PREV, MF, "Shift-1"), "B": fill(PREV, WS, "Shift-2")}
    assert rotate(prev, config, AUG, people=[rp("A"), rp("B")]).warnings == []


def test_headcount_by_shift():
    sched = {"A": {date(2026, 8, 5): "Shift-1"}, "B": {date(2026, 8, 5): "shift 1"},
             "C": {date(2026, 8, 5): "P"}, "D": {date(2026, 8, 5): "IST 6:00-3:00AM"},
             "E": {date(2026, 8, 5): ""}, "F": {date(2026, 8, 5): "Shift-2"}}
    people = [rp("A"), rp("B"), rp("C"), rp("D"), rp("E"), rp("F", "T2")]
    assert headcount_by_shift(sched, people, date(2026, 8, 5)) == {
        "T1": {"CUSTOM": 1, "S1": 2}, "T2": {"S2": 1}}


# ---- determinism and calendar edges ---------------------------------------------

def test_idempotent():
    config = cfg(("A", Rotation.AUTO_SWAP, "S1", None), ("B", Rotation.PERMANENT, "S3", None),
                 ("C", Rotation.ASK_ME, None, None))
    prev = {"A": fill(PREV, MF, "Shift-1"), "B": fill(PREV, MF, "Shift-3"),
            "C": fill(PREV, WS, "Shift-4")}
    answers = {"C": {"shift": "S2"}}
    one = rotate(prev, config, AUG, answers)
    two = rotate(prev, config, AUG, answers)
    assert one.schedule == two.schedule and one.changes == two.changes
    assert one.warnings == two.warnings


def test_cycle_spanning_year_boundary():
    dec = cycle_for(2026, 12)  # Sun 29 Nov 2026 .. Sat 30 Jan 2027
    prev_c = previous_cycle(dec)
    config = cfg(("A", Rotation.AUTO_SWAP, "S1", None))
    res = rotate({"A": fill(prev_c, MF, "Shift-1")}, config, dec)
    row = res.schedule["A"]
    assert min(row) == date(2026, 11, 29) and max(row) == date(2027, 1, 30)
    assert row[date(2026, 12, 31)] == "Shift-2" and row[date(2027, 1, 1)] == "Shift-2"
    assert row[date(2026, 11, 29)] == "Shift-2"  # Wed-Sun: works the swap Sunday
    assert res.changes[0].effective == date(2026, 11, 29)
    assert res.changes[0].first_worked == date(2026, 11, 29)


def test_edits_cover_every_cell():
    config = cfg(("A", Rotation.PERMANENT, "S1", None))
    res = rotate({"A": fill(PREV, MF, "Shift-1")}, config, AUG)
    assert len(res.edits) == AUG.days
    assert res.edits[("A", AUG.start)] == ""


def test_parse_pattern():
    assert parse_pattern("mon-fri") is MF and parse_pattern("WED_SUN") is WS
    assert parse_pattern("Wed-Sun") is WS
    with pytest.raises(ValueError):
        parse_pattern("x")
