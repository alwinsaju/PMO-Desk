import copy
import logging
import random
from datetime import date
from pathlib import Path
from types import SimpleNamespace

import pytest

from roster_lib.checks import FindingKind, hol_check, staffing_check
from roster_lib.holiday_engine import (
    OffCounter,
    apply_edits,
    assign_holidays,
    build_counters,
    build_counters_from_schedule,
)
from roster_lib.roster_io import load_roster
from roster_testkit import (
    END,
    INDIA,
    MEX,
    START,
    build,
    config,
    days,
    label_derived_matrix,
    matrix_of,
    person,
    row_for,
)

COMMON = date(2026, 11, 4)  # Wed
COMMON2 = date(2026, 11, 11)  # Wed
BLR_ONLY = date(2026, 11, 5)  # Thu
MEX_ONLY = date(2026, 11, 12)  # Thu
SAT = date(2026, 11, 7)
MON = date(2026, 11, 2)

MATRIX = matrix_of([
    ("Common", COMMON, INDIA),
    ("Blr Day", BLR_ONLY, ["Blr"]),
    ("Common With Mex", COMMON2, INDIA + [MEX]),
    ("Mex Day", MEX_ONLY, [MEX]),
])
ONLY_COMMON = matrix_of([("Common", COMMON, INDIA)])
C = OffCounter


def run(specs, counters=None, matrix=ONLY_COMMON, cfg=None, edit=None, **kw):
    people, sched = build(specs)
    if edit:
        edit(sched)
    counters = {} if counters is None else counters
    res = assign_holidays(sched, people, matrix, counters, cfg or config(), START, END,
                          seed=kw.pop("seed", 1), **kw)
    return people, sched, res


def off_names(res, d):
    return sorted(n for (n, x) in res.edits if x == d)


# A "Lab" team has a minimum of 2; the Mexico person always works a common India-only day,
# so one India person has to cover (need = 2 - 1 = 1).
LAB3 = [("A", "Blr", "Lab", "S1"), ("B", "Hyd", "Lab", "S1"), ("X", "Mex", "Lab", "S1")]


def test_fewest_offs_gets_the_next_off():
    _, _, res = run(LAB3, {"A": C(4, date(2026, 5, 1)), "B": C(3, date(2026, 6, 1))})
    assert off_names(res, COMMON) == ["B"]  # A has more offs and covers
    assert res.edits == {("B", COMMON): "HOL"}
    assert res.counters_before["B"] == C(3, date(2026, 6, 1))
    assert res.counters_after["B"] == C(4, COMMON) and res.counters_after["A"] == C(4, date(2026, 5, 1))
    assert res.coverage == {("A", COMMON)}


def test_tie_on_count_the_most_recent_off_covers():
    _, _, res = run(LAB3, {"A": C(3, date(2026, 9, 1)), "B": C(3, date(2026, 10, 1))})
    assert off_names(res, COMMON) == ["A"]  # B was off most recently, so B covers
    # never-off (None) counts as the oldest
    _, _, res = run(LAB3, {"A": C(0, None), "B": C(0, date(2026, 1, 2))})
    assert off_names(res, COMMON) == ["A"]


def test_seeded_tie_break_is_reproducible_and_seed_dependent():
    specs = [(f"P{i}", INDIA[i % 6], "Lab", "S1") for i in range(8)]
    counters = {f"P{i}": C(2, date(2026, 3, 3)) for i in range(8)}
    covers = {}
    for seed in range(12):
        _, _, a = run(specs, counters, seed=seed)
        _, _, b = run(specs, counters, seed=seed)
        assert a.edits == b.edits and a.assignments == b.assignments
        assert a.seed == seed
        covers[seed] = frozenset(a.coverage)
    assert len(set(covers.values())) > 1  # a different seed can give a different outcome


def test_result_does_not_depend_on_people_order():
    specs = [(f"P{i}", INDIA[i % 6], "Lab", "S1") for i in range(8)]
    counters = {f"P{i}": C(2, None) for i in range(8)}
    _, _, a = run(specs, counters, seed=5)
    shuffled = specs[:]
    random.Random(3).shuffle(shuffled)
    _, _, b = run(shuffled, counters, seed=5)
    assert a.edits == b.edits


def test_seed_defaults_to_config_and_is_logged(caplog):
    cfg = config()
    cfg.seed = 987654
    with caplog.at_level(logging.INFO, logger="roster_lib.holiday_engine"):
        people, sched = build(LAB3)
        res = assign_holidays(sched, people, ONLY_COMMON, {}, cfg, START, END)
    assert res.seed == 987654 and "987654" in caplog.text


def test_counters_carry_across_holidays_in_date_order():
    matrix = matrix_of([("First", COMMON, INDIA), ("Second", COMMON2, INDIA)])
    specs = [("A", "Blr", "Lab", "S1"), ("B", "Hyd", "Lab", "S1"), ("C", "Pun", "Lab", "S1"),
             ("X", "Mex", "Lab", "S1")]
    # min 2, outside 1 (Mexico works) -> 1 covers, 2 are off, every time
    _, _, res = run(specs, matrix=matrix, seed=7)
    first, second = res.assignments
    assert first.date == COMMON and second.date == COMMON2
    assert len(first.off) == 2 and len(first.covering) == 1
    # on the second holiday the one who covered first has the fewest offs and gets one now
    assert first.covering[0] in second.off
    assert set(second.covering) <= set(first.off)
    assert sorted(res.counters_after.values(), key=lambda c: c.offs_taken)[0].offs_taken == 1
    assert sum(c.offs_taken for c in res.counters_after.values()) == 4
    assert second.counters_before["A"] == first.counters_after["A"]


@pytest.mark.parametrize("section,pool,expected_off", [
    ("L2", 5, 3),  # DIS: min 3, outside 1 -> need 2 -> 3 of 5 off
    ("DEP", 5, 3), ("L3", 5, 3),
    ("Lab", 5, 4),  # others: min 2, outside 1 -> need 1 -> 4 of 5 off
    ("Device Support", 5, 4),
])
def test_minimum_staffing_by_team(section, pool, expected_off):
    specs = [(f"P{i}", "Blr", section, "S1") for i in range(pool)] + [("X", "Mex", section, "S1")]
    _, _, res = run(specs)
    assert len(res.edits) == expected_off
    assert not res.flags


def test_group_at_or_below_minimum_nobody_off_and_flagged():
    # pool of 2 with min 2 and nobody outside: everybody works
    specs = [("A", "Blr", "Lab", "S1"), ("B", "Hyd", "Lab", "S1")]
    _, _, res = run(specs)
    assert res.edits == {}
    assert [f.kind for f in res.flags] == ["NO_OFF_AT_MINIMUM"]
    assert res.flags[0].have == 2 and res.flags[0].need == 2
    assert res.counters_after == res.counters_before | {} and res.counters_after["A"].offs_taken == 0
    # pool of 1: cannot even meet the minimum
    _, _, res = run([("A", "Blr", "Lab", "S1")])
    assert res.edits == {}
    assert [f.kind for f in res.flags] == ["CANNOT_MEET_MINIMUM"]
    assert res.flags[0].have == 1 and res.flags[0].need == 2
    assert "cannot meet" in res.flags[0].message
    assert res.assignments[0].shortage == 1


def test_groups_are_per_team_and_per_shift():
    specs = [("A", "Blr", "Lab", "S1"), ("B", "Hyd", "Lab", "S1"), ("C", "Pun", "Lab", "S1"),
             ("D", "Blr", "Lab", "S3"), ("E", "Hyd", "Lab", "S3")]
    _, _, res = run(specs)
    by = {(a.team, a.shift): a for a in res.assignments}
    assert len(by[("Lab", "S1")].off) == 1 and len(by[("Lab", "S1")].covering) == 2
    assert by[("Lab", "S3")].off == () and len(by[("Lab", "S3")].covering) == 2


def test_mexico_is_never_in_the_pool_and_has_no_counter_on_common_india_day():
    specs = LAB3 + [("C", "Pun", "Lab", "S1")]
    _, _, res = run(specs)  # ONLY_COMMON: Mexico is not off
    assert "X" not in res.counters_before and "X" not in res.counters_after
    assert all(n != "X" for n, _ in res.edits)
    assert "X" in res.assignments[0].outside
    assert all("X" not in c for a in res.assignments for c in (a.covering,))


def test_common_india_mexico_flags_because_mexico_staff_are_off():
    matrix = matrix_of([("Christmas", COMMON2, INDIA + [MEX])])
    specs = ([(f"P{i}", INDIA[i], "L2", "S1") for i in range(4)]
             + [("M1", "Mex", "L2", "S1"), ("M2", "Mexico", "L2", "S1")])
    _, _, res = run(specs, matrix=matrix, seed=2)
    assert ("M1", COMMON2) in res.edits and ("M2", COMMON2) in res.edits  # Mexico always off
    assert all(n not in res.counters_after for n in ("M1", "M2"))
    assert res.assignments[0].kind == "COMMON_INDIA_MEXICO"
    assert set(res.assignments[0].straight_off) == {"M1", "M2"}
    # DIS needs 3, nobody is outside -> need 3 of 4: one India person off
    assert len([k for k in res.edits if k[0].startswith("P")]) == 1
    assert (set(res.coverage) == {(n, COMMON2) for n in ("P0", "P1", "P2", "P3")}
            - {k for k in res.edits})
    assert res.flags == []  # exactly 3 India people work: minimum met


def test_common_india_mexico_flags_many_shifts_when_group_is_small():
    matrix = matrix_of([("Christmas", COMMON2, INDIA + [MEX])])
    specs = [("P0", "Blr", "L2", "S1"), ("P1", "Hyd", "L2", "S1"), ("M1", "Mex", "L2", "S1"),
             ("M2", "Mex", "L2", "S1"), ("Q0", "Blr", "Lab", "S3"), ("M3", "Mex", "Lab", "S3")]
    _, _, res = run(specs, matrix=matrix)
    kinds = {(f.team, f.shift, f.kind) for f in res.flags}
    assert ("DIS", "S1", "CANNOT_MEET_MINIMUM") in kinds
    assert ("Lab", "S3", "CANNOT_MEET_MINIMUM") in kinds
    assert res.edits.keys() == {("M1", COMMON2), ("M2", COMMON2), ("M3", COMMON2)}


def test_location_specific_hol_without_fairness_or_counters():
    specs = [("A", "Blr", "L2", "S1"), ("B", "Blr", "L2", "S1"), ("C", "Hyd", "L2", "S1"),
             ("D", "Pun", "L2", "S1"), ("E", "Mex", "L2", "S1")]
    counters = {n: C(2, date(2026, 3, 3)) for n in "ABCD"}
    _, sched, res = run(specs, counters, matrix=matrix_of([("Blr Day", BLR_ONLY, ["Blr"])]))
    assert res.edits == {("A", BLR_ONLY): "HOL", ("B", BLR_ONLY): "HOL"}
    assert res.counters_after == res.counters_before  # no fairness counters touched
    assert res.assignments[0].fairness is False and res.assignments[0].kind == "LOCATION_SPECIFIC"
    assert res.coverage == frozenset()
    # no auto-fix: the shortage is only flagged (3 needed, 3 work: C, D, E -> fine here);
    assert res.flags == []


def test_location_specific_shortage_is_flagged_never_fixed():
    specs = [("A", "Gur", "Lab", "S1"), ("B", "Gur", "Lab", "S1"), ("C", "Hyd", "Lab", "S1")]
    matrix = matrix_of([("Gur Day", BLR_ONLY, ["Gur"])])
    _, sched, res = run(specs, matrix=matrix)
    assert res.edits == {("A", BLR_ONLY): "HOL", ("B", BLR_ONLY): "HOL"}  # C is NOT pulled in
    assert [(f.kind, f.team, f.shift, f.have, f.need) for f in res.flags] == [
        ("STAFFING_SHORTAGE", "Lab", "S1", 1, 2)]
    assert sched["C"][BLR_ONLY] == "S1"  # input untouched too


def test_mexico_only_holiday_gives_mexico_hol_without_counters():
    specs = [("A", "Blr", "L2", "S1"), ("M", "Mex", "L2", "S1"), ("N", "Mex", "L2", "S1")]
    _, _, res = run(specs, {"A": C(1, None)},
                    matrix=matrix_of([("Mex Day", MEX_ONLY, [MEX])]))
    assert res.edits == {("M", MEX_ONLY): "HOL", ("N", MEX_ONLY): "HOL"}
    assert res.counters_after == {"A": C(1, None)}
    assert res.assignments[0].kind == "MEXICO_ONLY"


def test_mexico_staff_always_get_their_own_holidays_on_common_rows_too():
    # Mexico ticked on a COMMON row (Common India-Mexico) -> HOL even if they are the only ones
    matrix = matrix_of([("New Year", COMMON2, INDIA + [MEX])])
    _, _, res = run([("M", "Mex", "Lab", "S1")], matrix=matrix)
    assert res.edits == {("M", COMMON2): "HOL"}


def test_pto_beats_hol_and_is_not_counted():
    def pto(s):
        s["A"][COMMON] = "P"

    specs = [("A", "Blr", "Lab", "S1"), ("B", "Hyd", "Lab", "S1"), ("C", "Pun", "Lab", "S1"),
             ("D", "Che", "Lab", "S1")]
    _, sched, res = run(specs, {n: C(0, None) for n in "ABCD"}, edit=pto)
    assert ("A", COMMON) not in res.edits
    assert res.counters_after["A"] == C(0, None)
    a = res.assignments[0]
    assert "A" not in a.off + a.covering + a.outside
    assert len(a.off) == 1 and len(a.covering) == 2  # pool of 3, min 2


def test_other_leave_codes_also_win():
    def leave(s):
        s["A"][COMMON], s["B"][COMMON] = "SL", "T"

    specs = [("A", "Blr", "Lab", "S1"), ("B", "Hyd", "Lab", "S1"), ("C", "Pun", "Lab", "S1")]
    _, _, res = run(specs, edit=leave)
    assert res.edits == {} and [f.kind for f in res.flags] == ["CANNOT_MEET_MINIMUM"]


def test_hol_only_on_working_days():
    matrix = matrix_of([("Sat Day", SAT, INDIA), ("Mon Day", MON, INDIA), ("Wed Day", COMMON, INDIA)])
    specs = [("A", "Blr", "Lab", "S1"), ("B", "Hyd", "Lab", "S2"), ("C", "Pun", "Lab", "S2"),
             ("D", "Che", "Lab", "S2"), ("E", "Gur", "Lab", "S1"), ("F", "Kol", "Lab", "S1")]
    _, sched, res = run(specs, matrix=matrix)
    sat = {n for n, d in res.edits if d == SAT}
    mon = {n for n, d in res.edits if d == MON}
    # Saturday is a weekly off for Mon-Fri people, Monday for Wed-Sun people (S2)
    assert sat <= {"B", "C", "D"} and mon <= {"A", "E", "F"}
    assert sat and mon
    for a in res.assignments:
        eligible = {"B", "C", "D"} if a.date == SAT else {"A", "E", "F"} if a.date == MON else None
        if eligible:
            assert set(a.off) | set(a.covering) | set(a.outside) <= eligible
    assert all(sched[n][d] not in ("", "HOL") for n, d in res.edits)  # all were working
    assert sum(c.offs_taken for c in res.counters_after.values()) == len(res.edits)


def test_weekly_off_only_holiday_changes_nothing():
    matrix = matrix_of([("Sat Day", SAT, INDIA)])
    specs = [("A", "Blr", "Lab", "S1"), ("B", "Hyd", "Lab", "S1"), ("C", "Pun", "Lab", "S1")]
    _, _, res = run(specs, {"A": C(1, None)}, matrix=matrix)
    assert res.edits == {} and res.assignments == [] and res.flags == []
    assert res.counters_after == res.counters_before


def test_holidays_outside_the_cycle_are_ignored():
    matrix = matrix_of([("Early", date(2026, 10, 20), INDIA), ("Late", date(2026, 12, 1), INDIA),
                        ("In", COMMON, INDIA)])
    _, _, res = run(LAB3, matrix=matrix)
    assert {d for _, d in res.edits} == {COMMON}


def test_two_holidays_on_one_date_are_one_event():
    matrix = matrix_of([("Common", COMMON, INDIA), ("Local", COMMON, ["Blr"])])
    _, _, res = run(LAB3, matrix=matrix)
    assert len(res.assignments) == 1 and res.assignments[0].holidays == ("Common", "Local")
    assert sum(c.offs_taken for c in res.counters_after.values()) == len(res.edits) == 1


def test_non_india_non_mexico_staff_just_work():
    specs = [("A", "Blr", "Lab", "S1"), ("B", "Hyd", "Lab", "S1"), ("G", "US", "Lab", "S1")]
    _, _, res = run(specs, {"A": C(0, None), "B": C(0, None)})
    assert "G" in res.assignments[0].outside and "G" not in res.counters_after
    assert len(res.edits) == 1  # need = 2 - 1 = 1: one of A/B covers


def test_custom_and_oc_cells_are_grouped_by_their_text():
    def custom(s):
        s["A"][COMMON] = "IST 6:00-3:00AM"
        s["B"][COMMON] = "OC"

    specs = [("A", "Blr", "Lab", "S1"), ("B", "Hyd", "Lab", "S1"), ("C", "Pun", "Lab", "S1")]
    _, _, res = run(specs, edit=custom)
    shifts = {a.shift for a in res.assignments}
    assert shifts == {"IST 6:00-3:00AM", "OC", "S1"}
    assert res.edits == {}  # three groups of one: nobody can be spared


def test_engine_never_mutates_the_input_and_edits_are_hol_only():
    people, sched = build(LAB3)
    before = copy.deepcopy(sched)
    counters = {"A": C(1, None), "B": C(1, None)}
    cbefore = dict(counters)
    res = assign_holidays(sched, people, ONLY_COMMON, counters, config(), START, END, seed=0)
    assert sched == before and counters == cbefore
    assert set(res.edits.values()) == {"HOL"}
    applied = apply_edits(sched, res.edits)
    assert applied != sched and sched == before
    assert all(applied[n][d] == "HOL" for n, d in res.edits)


def test_staffing_check_after_engine_matches_the_flags():
    specs = [("A", "Gur", "Lab", "S1"), ("B", "Gur", "Lab", "S1"), ("C", "Hyd", "Lab", "S1")]
    people, sched, res = run(specs, matrix=matrix_of([("Gur Day", BLR_ONLY, ["Gur"])]))
    after = apply_edits(sched, res.edits)
    short = staffing_check(after, people, config(), START, END)
    assert [(s.team, s.shift, s.date) for s in short] == [("Lab", "S1", BLR_ONLY)]


def test_engine_output_passes_hol_check_with_coverage():
    people, sched, res = run(LAB3 + [("C", "Pun", "Lab", "S1")], seed=4)
    after = apply_edits(sched, res.edits)
    found = hol_check(after, people, ONLY_COMMON, {COMMON: "Common"}, START, END,
                      coverage_ok=res.coverage)
    assert found == []
    # without coverage info the covering people are only "unverified"
    found = hol_check(after, people, ONLY_COMMON, {COMMON: "Common"}, START, END)
    assert {f.kind for f in found} == {FindingKind.MISSING_UNVERIFIED}
    assert {f.person for f in found} == {n for n, _ in res.coverage}


# ---- counters inheritance and pool average ----------------------------------------------------


def test_replacement_inherits_the_leavers_counter_and_new_seats_get_the_pool_average():
    specs = [("New1", "Blr", "Lab", "S1"), ("New2", "Hyd", "Lab", "S1"),
             ("Old3", "Pun", "Lab", "S1"), ("Old4", "Che", "Lab", "S1"),
             ("Stranger", "Kol", "Lab", "S1"), ("X", "Mex", "Lab", "S1")]
    counters = {"Old1": C(5, date(2026, 8, 18)), "Old3": C(2, date(2026, 5, 1)),
                "Old4": C(3, date(2026, 6, 1)), "Gone": C(9, date(2026, 9, 9))}
    people, sched = build(specs)
    res = assign_holidays(sched, people, ONLY_COMMON, counters, config(), START, END, seed=1,
                          inherited_counters={"New1": "Old1"}, pool_average_seats={"New2"})
    b = res.counters_before
    assert b["New1"] == C(5, date(2026, 8, 18))  # inherited, both fields
    # average of people who already had a counter (Old3 = 2, Old4 = 3): floor(2.5) = 2
    assert res.pool_average == 2
    assert b["New2"] == C(2, None)  # a pool-average seat
    assert b["Stranger"] == C(2, None)  # absent from counters, not inherited: also the average
    assert b["Old3"] == counters["Old3"] and b["Gone"] == C(9, date(2026, 9, 9))  # untouched
    assert "X" not in b  # Mexico: no counter
    assert counters["Old3"] == C(2, date(2026, 5, 1))  # input mapping not modified
    # the inherited counter takes part: New1 (5 offs) is first to cover, never first to go off
    assert ("New1", COMMON) not in res.edits


def test_inheritance_is_name_insensitive_and_missing_old_falls_back_to_average():
    specs = [("Newbie  One", "Blr", "Lab", "S1"), ("Newbie Two", "Hyd", "Lab", "S1"),
             ("Old3", "Pun", "Lab", "S1")]
    counters = {"old one": C(4, date(2026, 2, 2)), "Old3": C(6, None)}
    people, sched = build(specs)
    res = assign_holidays(sched, people, ONLY_COMMON, counters, config(), START, END, seed=1,
                          inherited_counters={"newbie one": "OLD  ONE", "Newbie Two": "Nobody"})
    assert res.counters_before["Newbie  One"] == C(4, date(2026, 2, 2))
    assert res.counters_before["Newbie Two"] == C(6, None)  # leaver unknown: average of Old3


def test_pool_average_with_no_established_counters_is_zero():
    people, sched = build(LAB3)
    res = assign_holidays(sched, people, ONLY_COMMON, {}, config(), START, END, seed=1,
                          pool_average_seats={"A"})
    assert res.pool_average == 0 and res.counters_before["A"] == C(0, None)


# ---- build_counters ---------------------------------------------------------------------------


YEAR_MATRIX = matrix_of([
    ("Common 1", date(2026, 1, 15), INDIA),
    ("Common 2", date(2026, 3, 3), INDIA),
    ("Common 3 (Sat)", date(2026, 3, 7), INDIA),
    ("Common 4", date(2026, 5, 1), INDIA + [MEX]),
    ("Common 5", date(2026, 9, 14), INDIA),
    ("Pune Local", date(2026, 6, 2), ["Pun"]),
    ("Common Last Year", date(2025, 12, 25), INDIA),
    ("Common After", date(2026, 11, 4), INDIA),
])
CYCLE_START = date(2026, 10, 25)


def counter_schedule(rows):
    people = [person("P1", "Pune", "L2", 16), person("M1", "Mexico", "L2", 17),
              person("U1", "US", "Governance", 18)]
    first, last = date(2025, 12, 1), date(2026, 12, 31)
    sched = {p.name: row_for("S1", first, last) for p in people}
    for (name, d), text in rows.items():
        sched[name][d] = text
    return people, sched


def test_build_counters_counts_common_working_day_hols_before_the_cycle():
    people, sched = counter_schedule({
        ("P1", date(2026, 1, 15)): "HOL", ("P1", date(2026, 3, 3)): "HOL",
        ("P1", date(2026, 5, 1)): "HOL", ("P1", date(2026, 9, 14)): "HOL",
        ("P1", date(2025, 12, 25)): "HOL",  # previous calendar year
        ("P1", date(2026, 11, 4)): "HOL",  # in/after the new cycle
    })
    got = build_counters_from_schedule(sched, people, YEAR_MATRIX, 2026, config(), CYCLE_START)
    assert got == {"P1": C(4, date(2026, 9, 14))}  # Mexico and US people have no counter


def test_build_counters_ignores_pto_disconnect_stray_nonworking_and_location_specific():
    d_pto, d_disc, d_stray, d_sat = date(2026, 1, 15), date(2026, 3, 3), date(2026, 8, 18), date(2026, 3, 7)
    people, sched = counter_schedule({
        ("P1", d_pto): "P",  # PTO instead of HOL
        ("P1", d_disc): "HOL",  # a December Disconnect day (configured)
        ("P1", d_stray): "HOL",  # stray: no holiday that day
        ("P1", d_sat): "HOL",  # HOL on a weekly off
        ("P1", date(2026, 6, 2)): "HOL",  # location-specific (not Common): not counted
        ("P1", date(2026, 5, 1)): "HOL",  # the one that counts
    })
    got = build_counters_from_schedule(sched, people, YEAR_MATRIX, 2026, config(), CYCLE_START,
                                       disconnect_dates={d_disc})
    assert got["P1"] == C(1, date(2026, 5, 1))
    # without telling it about the disconnect day, that HOL is counted (it is a real common day)
    got = build_counters_from_schedule(sched, people, YEAR_MATRIX, 2026, config(), CYCLE_START)
    assert got["P1"].offs_taken == 2


def test_build_counters_stray_hol_on_a_day_the_location_is_not_ticked():
    matrix = matrix_of([("Not Pune", date(2026, 4, 14), ["Che", "Gur"]),
                        ("Common", date(2026, 5, 1), INDIA)])
    people, sched = counter_schedule({("P1", date(2026, 4, 14)): "HOL",
                                      ("P1", date(2026, 5, 1)): "HOL"})
    got = build_counters_from_schedule(sched, people, matrix, 2026, config(), CYCLE_START)
    assert got["P1"] == C(1, date(2026, 5, 1))


def test_build_counters_wed_sun_person_off_on_monday_is_not_counted():
    matrix = matrix_of([("Mon Common", date(2026, 3, 2), INDIA),
                        ("Wed Common", date(2026, 3, 4), INDIA)])
    people = [person("W1", "Blr")]
    sched = {"W1": row_for("S2", date(2026, 2, 1), date(2026, 5, 30))}
    sched["W1"][date(2026, 3, 2)] = "HOL"  # weekly off for Wed-Sun
    sched["W1"][date(2026, 3, 4)] = "HOL"
    assert build_counters_from_schedule(sched, people, matrix, 2026, config(), CYCLE_START) == {
        "W1": C(1, date(2026, 3, 4))}


def test_build_counters_covers_every_india_person_even_with_zero():
    people = [person("A", "Blr"), person("B", "Gurgaon")]
    sched = {"A": row_for("S1", date(2026, 1, 1), date(2026, 10, 24))}
    assert build_counters_from_schedule(sched, people, YEAR_MATRIX, 2026, config(),
                                        CYCLE_START) == {"A": C(0, None), "B": C(0, None)}


def test_build_counters_from_a_roster_object():
    people, sched = counter_schedule({("P1", date(2026, 3, 3)): "HOL"})
    all_days = days(date(2025, 12, 1), date(2026, 12, 31))
    roster = SimpleNamespace(
        people=people, first_date=all_days[0], last_date=all_days[-1],
        row_texts=lambda p, s, e: [sched[p.name][d] for d in days(s, e)])
    assert build_counters(roster, YEAR_MATRIX, 2026, config(), CYCLE_START) == {
        "P1": C(1, date(2026, 3, 3))}


def test_counters_built_then_used_by_the_engine_follow_the_acceptance_rule():
    # A took 4 common offs, B took 3: B gets the next one.
    wednesdays = [date(2026, 1, 7), date(2026, 2, 4), date(2026, 3, 4), date(2026, 4, 1)]
    matrix = matrix_of([(f"C{i}", d, INDIA) for i, d in enumerate(wednesdays)]
                       + [("Next", COMMON, INDIA)])
    people = [person("A", "Blr", "Lab"), person("B", "Hyd", "Lab"), person("X", "Mex", "Lab")]
    first, last = date(2026, 1, 1), END
    sched = {p.name: row_for("S1", first, last) for p in people}
    for d in wednesdays:
        sched["A"][d] = "HOL"
    for d in wednesdays[:3]:
        sched["B"][d] = "HOL"
    counters = build_counters_from_schedule(sched, people, matrix, 2026, config(), START)
    assert counters["A"].offs_taken == 4 and counters["B"].offs_taken == 3
    cycle = {n: {d: t for d, t in cells.items() if d >= START} for n, cells in sched.items()}
    res = assign_holidays(cycle, people, matrix, counters, config(), START, END, seed=0)
    assert res.edits == {("B", COMMON): "HOL"}


# ---- real file (structure only) -----------------------------------------------------------------

REAL = (Path(__file__).resolve().parents[2] / "roster-reference"
        / "Shiftroster_Takeda_Redesigned_v2.xlsx")
needs_real = pytest.mark.skipif(not REAL.exists(), reason="real roster reference file not present")


@needs_real
def test_real_roster_counters_cover_exactly_the_india_people():
    roster = load_roster(REAL)
    matrix = label_derived_matrix(roster.holiday_labels(expand_merges=True))
    counters = build_counters(roster, matrix, 2026, config(), date(2026, 10, 25),
                              disconnect_dates=set(days(date(2026, 12, 26), date(2027, 1, 1))))
    india_people = [p for p in roster.people if p.location_code not in ("Mexico", "US")]
    assert set(counters) == {p.name for p in india_people}
    common_before = [h for h in matrix.holidays
                     if h.date < date(2026, 10, 25) and len(h.off_locations & set(INDIA)) == 6]
    assert all(0 <= c.offs_taken <= len(common_before) for c in counters.values())
    assert all(c.last_off_date is None or c.last_off_date < date(2026, 10, 25)
               for c in counters.values())
    assert sum(c.offs_taken for c in counters.values()) > 0
