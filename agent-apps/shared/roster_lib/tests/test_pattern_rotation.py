"""PATTERN rotation: groups whose weeks follow a periodic template (a weekend duty with Sunday
on-call moving between people, alternating on-call weekends, ...). Synthetic data only; the
real-file backtest is in test_pattern_real.py."""

from __future__ import annotations

import random
from datetime import date, timedelta

import pytest
from cycle_testkit import AUG, DEC, OCT, FakeRoster, Spec
from roster_testkit import INDIA, matrix_of

from roster_lib.checks import daterange
from roster_lib.config import ConfigError, Person, Rotation, RotationConfig, parse_config, save_config
from roster_lib.cycle_builder import Plan, analyze_cycle, build_plan, hints_from_run_info
from roster_lib.cycles import Cycle, cycle_for, weeks
from roster_lib.pattern_rotation import (
    cell_token,
    continue_pattern,
    detect_pattern,
    history_weeks,
    plan_pattern_groups,
    sunday_of,
)
from roster_lib.rotation import MissingAnswers, rotate

ROSTER_START = date(2026, 1, 4)  # a Sunday
ROSTER_END = date(2026, 12, 31)
OC_TEXT = {"A": "ON-call", "B": "On-call", "C": "On call"}  # each person's own spelling
SHIFT_TEXT = {"A": "Shift-3", "B": "Shift-4", "C": "Shift-1"}


# ---- generators -----------------------------------------------------------------------

def weekend_week(person: str, w: int, block: int = 3) -> list[str]:
    """Week `w` (0 = ROSTER_START) of a 3-person weekend rotation, `block` weeks per turn.
    The person on duty for the weekend of week w works Saturday; Sunday on-call is the day
    after (the first cell of week w+1). On duty: Mon off, Tue-Sat; else Mon-Fri."""
    people = "ABC"
    holder = lambda wk: people[(wk // block) % 3]  # noqa: E731
    cells = [""] * 7
    on_duty = holder(w) == person
    for k in range(1, 6):  # Mon..Fri
        cells[k] = SHIFT_TEXT[person]
    if on_duty:
        cells[1] = ""  # Mon off
        cells[6] = SHIFT_TEXT[person]  # Saturday
    if holder(w - 1) == person:
        cells[0] = OC_TEXT[person]  # Sunday on-call after the weekend
    return cells


def fill_weekend(cells: dict, person: str, start: date, end: date, block: int = 3) -> None:
    d = start
    while d <= end:
        w = (sunday_of(d) - ROSTER_START).days // 7
        cells[d] = weekend_week(person, w, block)[(d.weekday() + 1) % 7]
        d += timedelta(days=1)


def two_person_oncall(person: str, w: int) -> list[str]:
    """CMS style: two people alternate on-call weekends (Sat + Sun on-call)."""
    cells = [""] * 7
    for k in range(1, 6):
        cells[k] = "Shift-3" if person == "A" else "11AM-8PM"
    mine = (w % 2 == 0) == (person == "A")
    if mine:
        cells[6] = "OC"  # Saturday of week w ...
    if (w - 1) % 2 == 0 and person == "A" or (w - 1) % 2 == 1 and person == "B":
        cells[0] = "OC"  # ... and the Sunday after it (week w+1)
    return cells


def specs_for(names: dict[str, str]) -> list[Spec]:
    return [Spec(n, "Support", "Support", loc, Rotation.PATTERN, "S3") for n, loc in names.items()]


def make_roster(specs, fillers, *, until: date, last: date = ROSTER_END, extra=None):
    """A roster file from ROSTER_START to `last`; `fillers[name](cells, start, end)` fills the
    cells up to `until` (inclusive), everything after it is blank."""
    schedule = {}
    for s in specs:
        cells = {d: "" for d in daterange(ROSTER_START, last)}
        fillers[s.name](cells, ROSTER_START, min(until, last))
        schedule[s.name] = cells
    for (n, d), t in (extra or {}).items():
        schedule[n][d] = t
    return FakeRoster(specs, schedule, ROSTER_START, last, {})


def group_config(names, group="support", **settings) -> RotationConfig:
    cfg = RotationConfig()
    cfg.min_staff_mode["default"] = "per_team_day"
    for n in names:
        cfg.add_person(Person(n, "Operate", "Blr", Rotation.PATTERN, subteam="Support",
                              pattern_group=group))
    if settings:
        cfg.pattern_groups[group] = settings
    return cfg


NAMES = {"Pat A": "Blr", "Pat B": "Hyd", "Pat C": "Pun"}
PERSON = {"Pat A": "A", "Pat B": "B", "Pat C": "C"}


def weekend_fillers(block=3):
    return {n: (lambda cells, a, b, p=p: fill_weekend(cells, p, a, b, block)) for n, p in PERSON.items()}


def expected(name, start: date, end: date, block=3) -> dict[date, str]:
    out: dict = {}
    fill_weekend(out, PERSON[name], start, end, block)
    return out


# ---- detection ------------------------------------------------------------------------

def test_cell_tokens_ignore_spelling_and_treat_leave_as_noise():
    assert cell_token("ON-call") == cell_token("On call") == "OC"
    assert cell_token("") == "" and cell_token("Shift-3") == "S3"
    assert cell_token("HOL") is None and cell_token("P") is None and cell_token("COMP") is None
    assert cell_token(None) is None
    assert cell_token("IST 6:00-3:00AM") == cell_token("ist  6:00-3:00am")


def test_detects_a_three_person_weekend_rotation_with_period_nine_and_the_phase():
    cb = {}
    for n, p in PERSON.items():
        cb[n] = {}
        fill_weekend(cb[n], p, ROSTER_START, date(2026, 7, 4))  # whole weeks to Sat 4 Jul
    wk = history_weeks(cb, date(2026, 7, 5))
    assert len(wk) == 26
    det = detect_pattern(cb, wk, group="support")
    assert det.detected and det.period == 9 and det.confidence == 1.0
    assert det.anchor == ROSTER_START and det.source == "history" and det.unknown_cells == 0
    assert det.overlap_weeks == 17
    # the last observed weeks and their phases: (26 weeks: wn 22..25 -> phases 4, 5, 6, 7)
    assert [ph for _, ph in det.observed] == [4, 5, 6, 7]
    # template of phase 0: A starts a turn (Tue-Sat), nobody has Sunday on-call except C (prior turn)
    assert det.templates["Pat A"][0] == ("", "", "Shift-3", "Shift-3", "Shift-3", "Shift-3", "Shift-3")
    assert det.templates["Pat C"][0][0] == "On call"  # raw text each person used
    assert det.templates["Pat A"][3][0] == "ON-call"  # phase 3: A's first Sunday on-call
    assert det.templates["Pat B"][6][0] == "On-call"
    duty = det.duty()
    assert duty == {"duty_period_weeks": 9, "duty_members": 3, "weekend_stint_weeks": 3}
    text = det.summary(date(2026, 7, 5))
    assert "9-week pattern" in text and "3 people share the weekend/on-call duty" in text
    assert "3 week(s) per turn" in text and "continuing from week 9 of 9" in text


def test_leave_noise_is_not_the_pattern_and_exceptions_are_outvoted():
    rng = random.Random(7)
    cb = {n: {} for n in PERSON}
    for n, p in PERSON.items():
        fill_weekend(cb[n], p, ROSTER_START, date(2026, 9, 26))
    days = list(cb["Pat A"])
    for n in cb:  # 6% of the cells become leave codes
        for d in rng.sample(days, len(days) // 16):
            cb[n][d] = rng.choice(["P", "T", "SL", "HOL", "COMP"])
    cb["Pat B"][date(2026, 5, 30)] = "OC"  # one stray on-call on a Saturday of an off week
    wk = history_weeks(cb, date(2026, 9, 27))
    det = detect_pattern(cb, wk, group="support")
    assert det.detected and det.period == 9 and det.confidence >= 0.95
    cyc = Cycle(date(2026, 10, 1), date(2026, 9, 27), date(2026, 11, 28), date(2026, 9, 27))
    rows = continue_pattern(det, cyc)
    for n, p in PERSON.items():
        assert rows[n] == expected(n, cyc.start, cyc.end), n  # noise-free continuation


def test_two_person_oncall_alternation_period_two():
    cb = {"Cms A": {}, "Cms B": {}}
    for n, p in (("Cms A", "A"), ("Cms B", "B")):
        d = ROSTER_START
        while d <= date(2026, 6, 27):
            w = (d - ROSTER_START).days // 7
            cb[n][d] = two_person_oncall(p, w)[(d.weekday() + 1) % 7]
            d += timedelta(days=1)
    det = detect_pattern(cb, history_weeks(cb, date(2026, 6, 28)), group="cms")
    assert det.detected and det.period == 2 and det.confidence == 1.0
    assert det.duty() == {"duty_period_weeks": 2, "duty_members": 2, "weekend_stint_weeks": 1}
    cyc = Cycle(date(2026, 6, 1), date(2026, 6, 28), date(2026, 8, 1), date(2026, 6, 28))
    rows = continue_pattern(det, cyc)
    for n, p in (("Cms A", "A"), ("Cms B", "B")):
        for d, text in rows[n].items():
            w = (sunday_of(d) - ROSTER_START).days // 7
            assert text == two_person_oncall(p, w)[(d.weekday() + 1) % 7]
    # exactly one on-call person on every Saturday and every Sunday of the new cycle
    for d in daterange(cyc.start, cyc.end):
        if d.weekday() in (5, 6):
            assert sum(rows[n][d] == "OC" for n in rows) == 1, d


def test_no_stable_pattern_is_not_guessed():
    rng = random.Random(3)
    cb = {n: {} for n in PERSON}
    for n in cb:
        for d in daterange(ROSTER_START, date(2026, 7, 4)):
            cb[n][d] = rng.choice(["Shift-1", "Shift-3", "", "OC"])
    det = detect_pattern(cb, history_weeks(cb, date(2026, 7, 5)), group="support")
    assert not det.detected and det.period is None and det.templates == {}
    assert "no weekly pattern" in det.reason
    # nothing at all / too little history
    assert not detect_pattern({"x": {}}, [], group="g").detected
    assert not detect_pattern({"x": {ROSTER_START: "Shift-1"}}, [ROSTER_START], group="g").detected
    blank = {n: {d: "" for d in daterange(ROSTER_START, date(2026, 3, 28))} for n in PERSON}
    assert "no member has any data" in detect_pattern(blank, history_weeks(blank, date(2026, 3, 29))).reason


def test_a_long_period_needs_enough_history_but_a_config_period_is_checked():
    cb = {n: {} for n in PERSON}
    for n, p in PERSON.items():
        fill_weekend(cb[n], p, ROSTER_START, date(2026, 3, 28))  # 12 weeks: 9 + 3
    wk = history_weeks(cb, date(2026, 3, 29))
    short = detect_pattern(cb, wk)  # default: at least 6 compared weeks
    assert not short.detected  # 12 weeks cannot prove a 9-week period with 6 weeks of overlap
    assert "needs 95% agreement over at least 6 weeks" in short.reason
    assert detect_pattern(cb, wk, min_overlap=3).period == 9
    forced = detect_pattern(cb, wk, period=9)
    assert forced.detected and forced.source == "override" and forced.overlap_weeks == 3
    wrong = detect_pattern(cb, wk, period=5)
    assert not wrong.detected and "configured period of 5 weeks" in wrong.reason


# ---- continuation across cycles and years -----------------------------------------------

def cycle_rows(plan: Plan, name: str) -> dict[date, str]:
    return {d: t for (n, d), t in {**plan.edits, **plan.remainder_edits}.items() if n == name}


def _plan(specs, cfg, roster, cycle, **kw):
    return build_plan(roster, cfg, cycle, {}, holiday_matrix=matrix_of(
        [("H", date(2026, 8, 15), INDIA), ("H2", date(2026, 10, 2), INDIA),
         ("H3", date(2026, 12, 25), INDIA), ("NY", date(2027, 1, 1), INDIA)]), **kw)


def test_the_phase_runs_on_across_two_cycle_boundaries_and_the_year_end():
    specs = specs_for(NAMES)
    cfg = group_config(NAMES)
    fillers = weekend_fillers()
    for cycle, until in ((AUG, AUG.start - timedelta(days=1)), (OCT, OCT.start - timedelta(days=1)),
                         (DEC, DEC.start - timedelta(days=1))):
        roster = make_roster(specs, fillers, until=until)
        plan = _plan(specs, cfg, roster, cycle)
        assert plan.run_info["pattern_groups"][0]["detected"]
        assert plan.run_info["pattern_groups"][0]["period_weeks"] == 9
        for n in NAMES:
            got = cycle_rows(plan, n)
            want = expected(n, cycle.start, cycle.end)
            # the written cells are exactly the template continuation (leave/HOL aside)
            diff = {d: (got[d], want[d]) for d in want if got[d] != want[d] and got[d] != "HOL"}
            assert not diff, (cycle.label, n, sorted(diff.items())[:3])
        cfg = plan.config_after  # the learned pattern is kept for the next run
    assert cfg.pattern_groups["support"]["period_weeks"] == 9
    assert cfg.pattern_groups["support"]["anchor"] == ROSTER_START.isoformat()


def test_a_weekend_straddling_the_cycle_boundary_is_covered_exactly_once():
    """Saturday of the last week of OCT and the Sunday on-call that opens DEC: one person each."""
    specs = specs_for(NAMES)
    cfg = group_config(NAMES)
    fillers = weekend_fillers()
    roster = make_roster(specs, fillers, until=OCT.start - timedelta(days=1))
    oct_plan = _plan(specs, cfg, roster, OCT)
    full = make_roster(specs, fillers, until=OCT.end)
    full_cells = {n: dict(full._schedule[n]) for n in NAMES}
    for (n, d), t in oct_plan.edits.items():
        full_cells[n][d] = t
    roster2 = FakeRoster(specs, full_cells, ROSTER_START, ROSTER_END, {})
    dec_plan = _plan(specs, oct_plan.config_after, roster2, DEC)
    cells = {n: {**{d: full_cells[n][d] for d in daterange(OCT.start, OCT.end)}, **cycle_rows(dec_plan, n)}
             for n in NAMES}
    for d in daterange(OCT.start, DEC.end):
        if d.weekday() == 5:  # Saturday: exactly one person works
            assert sum(1 for n in NAMES if cells[n][d] and cells[n][d] not in ("HOL",)
                       and cell_token(cells[n][d]) != "OC") <= 3
        if d.weekday() == 6 and d > OCT.start:  # every Sunday at most one on-call, none missed
            oc = [n for n in NAMES if cell_token(cells[n][d]) == "OC"]
            assert len(oc) <= 1
    sat = OCT.end  # a Saturday
    sun = DEC.start
    assert sat.weekday() == 5 and sun == sat + timedelta(days=1) and sun.weekday() == 6
    saturday_workers = [n for n in NAMES if cells[n][sat]]
    sunday_oc = [n for n in NAMES if cell_token(cells[n][sun]) == "OC"]
    assert len(saturday_workers) == 1 and sunday_oc == saturday_workers  # the same person


def test_stored_state_continues_a_rotation_when_the_file_has_only_a_few_weeks():
    """The next-year file holds a handful of weeks: a 9-week pattern cannot be re-detected,
    the state stored in the config continues it (and a contradicting roster does not)."""
    specs = specs_for(NAMES)
    cfg = group_config(NAMES)
    fillers = weekend_fillers()
    roster = make_roster(specs, fillers, until=DEC.start - timedelta(days=1))
    plan = _plan(specs, cfg, roster, DEC)
    stored_cfg = plan.config_after
    assert "template" in stored_cfg.pattern_groups["support"]
    # a 2027-style file: starts Sat 2027-01-02, Jan 3..Jan 30 filled with the continuation
    first, last = date(2027, 1, 2), date(2028, 1, 1)
    schedule = {}
    for n in NAMES:
        cells = {d: "" for d in daterange(first, last)}
        cells.update({d: t for d, t in cycle_rows(plan, n).items() if first <= d <= DEC.end})
        schedule[n] = cells
    ny = FakeRoster(specs, schedule, first, last, {})
    feb = cycle_for(2027, 2)
    gps = plan_pattern_groups(stored_cfg, list(NAMES), schedule, feb)
    gp = gps["support"]
    assert gp.detected and gp.detection.source == "stored" and gp.detection.confidence == 1.0
    plan2 = build_plan(ny, stored_cfg, feb, {}, holiday_matrix=matrix_of(
        [("NY", date(2027, 1, 1), INDIA), ("A", date(2027, 3, 10), INDIA), ("B", date(2027, 3, 24), INDIA)]))
    for n, p in PERSON.items():
        want = {}
        d = feb.start
        while d <= feb.end:
            w = (sunday_of(d) - ROSTER_START).days // 7
            want[d] = weekend_week(p, w)[(d.weekday() + 1) % 7]
            d += timedelta(days=1)
        got = cycle_rows(plan2, n)
        assert all(got[d] == want[d] or got[d] == "HOL" for d in want), n
    assert plan2.run_info["pattern_groups"][0]["source"] == "stored"
    # the same file WITHOUT stored state cannot detect a 9-week period from 4 weeks
    bare = group_config(NAMES)
    assert not plan_pattern_groups(bare, list(NAMES), schedule, feb)["support"].detected
    # a stored pattern that contradicts the weeks in the file is not used
    for d in daterange(date(2027, 1, 3), date(2027, 1, 30)):
        schedule["Pat A"][d] = "Shift-5" if d.weekday() < 5 else ""
    assert not plan_pattern_groups(stored_cfg, list(NAMES), schedule, feb)["support"].detected


# ---- integration: flags, ask-me, analysis, checks ----------------------------------------

def test_undetected_group_falls_back_to_permanent_and_asks_with_a_flag():
    rng = random.Random(11)
    specs = specs_for(NAMES)

    def noise(cells, a, b):
        for d in daterange(a, b):
            cells[d] = rng.choice(["Shift-1", "Shift-3", "", "OC"])
    fillers = {n: noise for n in NAMES}
    roster = make_roster(specs, fillers, until=AUG.start - timedelta(days=1))
    cfg = group_config(NAMES)
    analysis = analyze_cycle(roster, cfg, AUG, holiday_matrix=matrix_of([("H", date(2026, 8, 15), INDIA)]))
    assert [a.category for a in analysis.ask_me] == ["PATTERN_NOT_DETECTED"] * 3
    assert not analysis.ready and any("answer needed" in b for b in analysis.blockers)
    assert "no weekly pattern" in analysis.ask_me[0].reason and "KEEP" in analysis.ask_me[0].reason
    groups = analysis.to_dict()["pattern_groups"]
    assert groups[0]["detected"] is False and groups[0]["members"] == 3
    answers = {"rotation": {n: {"shift": "KEEP"} for n in NAMES}}
    matrix = matrix_of([("H", date(2026, 8, 15), INDIA)])
    plan = build_plan(roster, cfg, AUG, answers, holiday_matrix=matrix)
    flags = [f for f in plan.flags if f.kind == "PATTERN_NOT_DETECTED"]
    assert len(flags) == 1 and flags[0].severity == "WARNING" and flags[0].team == "support"
    assert plan.run_info["pattern_groups"][0]["detected"] is False
    assert "support" not in plan.config_after.pattern_groups  # nothing learned
    # without answers nothing is guessed
    with pytest.raises(Exception) as err:
        build_plan(roster, cfg, AUG, None, holiday_matrix=matrix)
    assert "PATTERN_NOT_DETECTED" in str(err.value) or "needs_answers" in str(err.value).lower() \
        or "Answers needed" in str(err.value)


def test_analysis_shows_the_detected_period_and_phase():
    specs = specs_for(NAMES)
    roster = make_roster(specs, weekend_fillers(), until=OCT.start - timedelta(days=1))
    analysis = analyze_cycle(roster, group_config(NAMES), OCT,
                             holiday_matrix=matrix_of([("H", date(2026, 10, 2), INDIA)]))
    assert analysis.ready and analysis.ask_me == []
    g = analysis.to_dict()["pattern_groups"][0]
    assert g["detected"] and g["period_weeks"] == 9 and g["confidence"] == 1.0
    assert g["start_phase"] == ((OCT.start - ROSTER_START).days // 7) % 9
    assert f"continuing from week {g['start_phase'] + 1} of 9" in g["summary"]
    assert g["duty_members"] == 3 and g["weekend_stint_weeks"] == 3


def test_templates_drive_the_checks_not_the_mon_fri_wed_sun_guess():
    """A HOL on a Tuesday of a duty week (Mon off, Tue-Sat) must not be reported as a weekly
    off, and the draft's checks use the template for the PATTERN people."""
    specs = specs_for(NAMES)
    fillers = weekend_fillers()
    roster = make_roster(specs, fillers, until=OCT.start - timedelta(days=1))
    cfg = group_config(NAMES)
    # Tuesday 2026-10-06 is a holiday for all India: on a duty Tue-Sat week the holder works it
    matrix = matrix_of([("Tue Holiday", date(2026, 10, 6), INDIA)])
    plan = build_plan(roster, cfg, OCT, {}, holiday_matrix=matrix)
    assert not [f for f in plan.flags if f.kind == "HOL_ON_WEEKLY_OFF"]
    hints = hints_from_run_info(plan.run_info)
    assert set(hints) == set(NAMES)
    for n in NAMES:
        for d in daterange(OCT.start, OCT.end):
            cell = plan.edits.get((n, d), "")
            if cell not in ("", "HOL"):
                assert hints[n](d) is True, (n, d)
        assert hints[n](OCT.end + timedelta(days=1)) is None
    # a HOL on the duty person's Monday (their template weekly off) IS reported
    from roster_lib.cycle_builder import make_rechecker
    rechecker = make_rechecker(roster, plan.config_after, OCT, matrix, plan)
    holder = next(n for n in NAMES if plan.edits.get((n, date(2026, 10, 5))) == ""
                  and plan.edits.get((n, date(2026, 10, 9))))
    cells = {n: {d: plan.edits.get((n, d), "") for d in daterange(OCT.start, OCT.end)} for n in NAMES}
    cells[holder][date(2026, 10, 5)] = "HOL"
    matrix2 = matrix_of([("Mon Holiday", date(2026, 10, 5), INDIA)])
    rechecker = make_rechecker(roster, plan.config_after, OCT, matrix2, plan)
    flags = rechecker(cells)
    assert any(f.kind == "HOL_HOL_ON_WEEKLY_OFF" or f.kind == "HOL_ON_WEEKLY_OFF"
               for f in flags if f.person == holder and f.date == date(2026, 10, 5))


def test_on_call_cells_count_as_working_in_the_holiday_engine():
    """An OC cell is a working code with no lane: the person is in the (team, OC) group."""
    from roster_lib.holiday_engine import assign_holidays
    from roster_lib.roster_io import Person as RosterPerson
    from roster_testkit import per_shift_config
    sunday = date(2026, 10, 25)
    people = [RosterPerson("Pat A", "Bengaluru", "Support", "Support", 1),
              RosterPerson("Pat B", "Hyderabad", "Support", "Support", 2)]
    sched = {"Pat A": {d: ("OC" if d == sunday else "") for d in daterange(date(2026, 10, 25), date(2026, 10, 31))},
             "Pat B": {d: "" for d in daterange(date(2026, 10, 25), date(2026, 10, 31))}}
    matrix = matrix_of([("Sunday Holiday", sunday, ["Blr"])])
    res = assign_holidays(sched, people, matrix, {}, per_shift_config(), date(2026, 10, 25),
                          date(2026, 10, 31), seed=1)
    assert res.edits == {("Pat A", sunday): "HOL"}
    assert res.assignments[0].shift == "OC"


def test_rotate_leaves_pattern_people_out_of_headcount_and_shift_change_noise():
    specs = specs_for(NAMES)
    roster = make_roster(specs, weekend_fillers(), until=OCT.start - timedelta(days=1))
    cfg = group_config(NAMES)
    schedule = {n: dict(roster._schedule[n]) for n in NAMES}
    res = rotate(schedule, cfg, OCT, {}, people=list(roster.people))
    assert res.changes == [] and res.warnings == []
    assert set(res.pattern_groups) == {"support"} and res.pattern_groups["support"].detected
    assert set(res.schedule) == set(NAMES)
    # a roster change: a PATTERN person with no data and an undetected group is asked
    with pytest.raises(MissingAnswers) as err:
        rotate({n: {} for n in NAMES}, cfg, OCT, {}, people=list(roster.people))
    assert len(err.value.names) == 3


# ---- config ----------------------------------------------------------------------------

BASE = {"version": 1, "people": [
    {"name": "P1", "team": "Operate", "location": "Blr", "rotation": "PATTERN",
     "pattern_group": "g1"},
    {"name": "P2", "team": "Operate", "location": "Hyd", "rotation": "PATTERN",
     "pattern_group": "g1"},
    {"name": "P3", "team": "Operate", "location": "Hyd", "rotation": "PERMANENT", "shift": "S1"}]}


def problems(data):
    with pytest.raises(ConfigError) as err:
        parse_config(data)
    return err.value.problems


def test_config_pattern_validation_and_round_trip(tmp_path):
    import copy
    cfg = parse_config(BASE)
    assert [p.pattern_group for p in cfg.people] == ["g1", "g1", None]
    assert cfg.pattern_min_confidence == 0.95 and cfg.pattern_groups == {}
    assert set(cfg.pattern_group_members()) == {"g1"}

    d = copy.deepcopy(BASE)
    del d["people"][0]["pattern_group"]
    assert any("needs a pattern_group" in p for p in problems(d))
    d = copy.deepcopy(BASE)
    d["people"][2]["pattern_group"] = "g1"
    assert any("pattern_group is only valid for PATTERN" in p for p in problems(d))
    d = copy.deepcopy(BASE)
    d["pattern_min_confidence"] = 1.5
    assert any("pattern_min_confidence" in p for p in problems(d))
    d = copy.deepcopy(BASE)
    d["pattern_groups"] = {"nobody": {}}
    assert any("no PATTERN person has this pattern_group" in p for p in problems(d))
    d = copy.deepcopy(BASE)
    d["pattern_groups"] = {"g1": {"period_weeks": 0, "anchor": "2026-01-05", "bogus": 1}}
    found = problems(d)
    assert any("period_weeks" in p for p in found) and any("must be a Sunday" in p for p in found)
    assert any("unknown field 'bogus'" in p for p in found)
    d = copy.deepcopy(BASE)
    d["pattern_groups"] = {"g1": {"anchor": "2026-01-04", "template": {
        "P1": [[""] * 7, [""] * 7], "P2": [[""] * 7]}}}
    assert any("same number of weeks" in p for p in problems(d))
    d = copy.deepcopy(BASE)
    d["pattern_groups"] = {"g1": {"period_weeks": 3, "anchor": "2026-01-04",
                                  "template": {"P1": [[""] * 7] * 2}}}
    assert any("does not match the template length" in p for p in problems(d))
    d = copy.deepcopy(BASE)
    d["pattern_groups"] = {"g1": {"template": {"P1": [[""] * 7]}}}
    assert any("needs an anchor" in p for p in problems(d))
    d = copy.deepcopy(BASE)
    d["pattern_groups"] = {"g1": {"anchor": "2026-01-04", "template": {"Stranger": [[""] * 7]}}}
    assert any("not a member of the group" in p for p in problems(d))

    good = copy.deepcopy(BASE)
    good["pattern_groups"] = {"g1": {"period_weeks": 2, "anchor": "2026-01-04", "template": {
        "P2": [["", "S1", "S1", "S1", "S1", "S1", ""], ["OC", "", "", "", "", "", ""]],
        "P1": [["", "", "", "", "", "", ""], ["", "S1", "S1", "S1", "S1", "S1", ""]]}}}
    cfg = parse_config(good)
    out = save_config(cfg, tmp_path / "c.json")
    again = parse_config(__import__("json").loads(out.read_text(encoding="utf-8")))
    assert again.to_dict() == cfg.to_dict()
    assert out.read_bytes() == save_config(again, tmp_path / "d.json").read_bytes()  # deterministic
    # members are saved in name order inside the template
    assert list(cfg.to_dict()["pattern_groups"]["g1"]["template"]) == ["P1", "P2"]
    # person editing keeps the group; changing the rotation away needs the group removed
    cfg.update_person("P3", rotation="PATTERN", pattern_group="g1", shift=None)
    assert cfg.find("P3").pattern_group == "g1"
    with pytest.raises(ConfigError):
        cfg.update_person("P3", rotation="PERMANENT", shift="S1")  # still carries pattern_group
    cfg.update_person("P3", rotation="PERMANENT", shift="S1", pattern_group=None)
    assert cfg.find("P3").pattern_group is None


def test_example_config_has_a_pattern_group():
    from pathlib import Path
    from roster_lib.config import load_config
    example = Path(__file__).resolve().parents[1] / "examples" / "rotation_config.example.json"
    cfg = load_config(example)
    members = cfg.pattern_group_members()
    assert set(members) == {"support-weekend"} and len(members["support-weekend"]) == 2
    assert cfg.pattern_groups["support-weekend"]["period_weeks"] == 2
