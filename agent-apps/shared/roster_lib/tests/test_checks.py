import copy
from datetime import date, timedelta
from pathlib import Path

import pytest

from roster_lib.checks import (
    ALL_SHIFTS,
    Finding,
    FindingKind,
    PersonCells,
    Severity,
    Shortage,
    canonical_of,
    effective_min,
    hol_check,
    pattern_on,
    resolve_location,
    schedule_from_roster,
    scheduled_on,
    staffing_check,
    week_pattern,
)
from roster_lib.codes import Pattern
from roster_lib.holiday_matrix import HolidayMatrixError, load_holiday_matrix
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
    per_shift_config,
    person,
    row_for,
)

WED = date(2026, 10, 28)
SAT = date(2026, 11, 7)
MON = date(2026, 11, 2)
COMMON = date(2026, 11, 4)  # Wed
BLR_ONLY = date(2026, 11, 5)  # Thu
COMMON_MEX = date(2026, 11, 11)  # Wed
MEX_ONLY = date(2026, 11, 12)  # Thu


def kinds(findings):
    return [(f.kind, f.date, f.person) for f in findings]


# ---- helpers ------------------------------------------------------------------------


def test_resolve_location_by_name_or_code():
    codes = {"Pune": "Pun", "Mexico": "Mex"}
    assert resolve_location(" pune ", codes) == "Pun"
    assert resolve_location("PUN", codes) == "Pun"
    assert resolve_location("US", codes) is None and resolve_location("", codes) is None
    assert resolve_location(None, codes) is None


def test_canonical_of_flags_unknown_text():
    assert canonical_of("shift 2") == "S2" and canonical_of("") == "BLANK"
    assert canonical_of("???") == "UNKNOWN"


def test_week_pattern_votes_and_neighbouring_weeks():
    mon_fri = row_for("S1")
    wed_sun = row_for("S1", pattern=Pattern.WED_SUN)
    assert week_pattern(mon_fri, date(2026, 11, 4)) is Pattern.MON_FRI
    assert week_pattern(wed_sun, date(2026, 11, 4)) is Pattern.WED_SUN
    # a whole week of leave carries no votes: the neighbouring weeks decide
    cells = dict(wed_sun)
    for d in days(date(2026, 11, 8), date(2026, 11, 14)):
        cells[d] = "P"
    assert week_pattern(cells, date(2026, 11, 10)) is Pattern.WED_SUN
    # nothing to go on
    assert week_pattern({date(2026, 11, 4): "S1"}, date(2026, 11, 4)) is None


def test_pattern_on_forces_s2_s4_and_defaults_by_code():
    assert pattern_on(row_for("S2"), MON) is Pattern.WED_SUN
    cells = {d: "P" for d in days(START, date(2026, 11, 7))}
    cells[date(2026, 11, 6)] = "S4"  # a Friday: no pattern vote, only the code
    assert pattern_on(cells, WED) is Pattern.WED_SUN  # nearest shift is S4
    cells[date(2026, 11, 6)] = "S1"
    assert pattern_on(cells, WED) is Pattern.MON_FRI  # no votes: default of the code
    assert pattern_on({WED: "P"}, WED) is None


def test_nearest_shift_code_prefers_earlier_on_tie_and_respects_reach():
    cells = {WED: "P", WED - timedelta(days=3): "S1", WED + timedelta(days=3): "S3"}
    assert PersonCells(cells).nearest_shift_code(WED) == "S1"
    assert PersonCells(cells).nearest_shift_code(WED + timedelta(days=40)) is None


# ---- staffing check -------------------------------------------------------------------


def test_no_shortage_when_minimum_met_and_nothing_is_fixed():
    people, sched = build([(f"P{i}", "Blr", "L2", "S1") for i in range(3)])
    before = copy.deepcopy(sched)
    assert staffing_check(sched, people, config(), START, END) == []
    assert sched == before


def test_shortage_when_one_person_on_pto():
    people, sched = build([(f"P{i}", "Blr", "L2", "S1") for i in range(3)])
    sched["P0"][WED] = "P"
    out = staffing_check(sched, people, config(), START, END)
    assert out == [Shortage("DIS", "S1", WED, 2, 3)]
    assert out[0].severity == "WARNING" and "DIS S1" in out[0].message


@pytest.mark.parametrize("section,need", [("L2", 3), ("DEP", 3), ("L3", 3)])
def test_minimum_by_team(section, need):
    # one fewer than the minimum working every day: every weekday is short by one
    people, sched = build([(f"P{i}", "Blr", section, "S1") for i in range(need - 1)])
    out = staffing_check(sched, people, config(), date(2026, 10, 26), date(2026, 10, 30))
    assert len(out) == 5 and {(s.have, s.need) for s in out} == {(need - 1, need)}
    assert {s.team for s in out} == {"DIS" if section == "L2" else section}


def test_aliased_sections_share_one_team_group():
    # "L2" is team DIS; a person typed with section DIS joins the same group
    people, sched = build([("A", "Blr", "L2", "S1"), ("B", "Hyd", "DIS", "S1"),
                           ("C", "Pun", "L2", "S1")])
    assert staffing_check(sched, people, config(), START, END) == []


def test_s2_s4_inactive_mon_tue_but_short_on_wednesday_when_all_absent():
    people, sched = build([(f"P{i}", "Blr", "L2", "S2") for i in range(3)])
    assert staffing_check(sched, people, config(), START, END) == []  # Mon/Tue silent
    for name in sched:
        sched[name][WED] = "P"
    out = staffing_check(sched, people, config(), START, END)
    assert out == [Shortage("DIS", "S2", WED, 0, 3)]
    assert out[0].severity == "ERROR"


def test_leave_on_a_weekly_off_does_not_create_a_shortage():
    people, sched = build([(f"P{i}", "Blr", "L2", "S2") for i in range(3)])
    sched["P0"][date(2026, 10, 26)] = "P"  # Monday: weekly off of Wed-Sun
    sched["P1"][date(2026, 10, 26)] = "HOL"
    assert staffing_check(sched, people, config(), START, END) == []


def test_hol_counts_as_not_working():
    people, sched = build([(f"P{i}", "Blr", "L2", "S1") for i in range(3)])
    sched["P0"][date(2026, 11, 9)] = "HOL"
    out = staffing_check(sched, people, config(), START, END)
    assert out == [Shortage("DIS", "S1", date(2026, 11, 9), 2, 3)]


def test_mexico_people_count_when_working():
    people, sched = build([("A", "Blr", "L2", "S1"), ("B", "Blr", "L2", "S1"),
                           ("M", "Mex", "L2", "S1")])
    assert staffing_check(sched, people, config(), START, END) == []
    sched["M"][WED] = "HOL"
    assert staffing_check(sched, people, config(), START, END) == [
        Shortage("DIS", "S1", WED, 2, 3)]


def test_groups_are_per_shift_code_and_oc_custom_are_not_counted():
    people, sched = build([("A", "Blr", "Lab", "S1"), ("B", "Blr", "Lab", "S1"),
                           ("C", "Blr", "Lab", "S3")])
    cfg = per_shift_config()
    out = staffing_check(sched, people, cfg, date(2026, 10, 26), date(2026, 10, 26))
    assert out == [Shortage("Lab", "S3", date(2026, 10, 26), 1, 2)]
    sched["C"][date(2026, 10, 26)] = "IST 6:00-3:00AM"  # custom hours: not a shift group
    assert staffing_check(sched, people, cfg, date(2026, 10, 26), date(2026, 10, 26)) == []


def test_missing_dates_are_no_data_not_blank_and_unknown_people_ignored():
    people, sched = build([(f"P{i}", "Blr", "L2", "S1") for i in range(3)])
    del sched["P0"][WED]
    out = staffing_check(sched, people, config(), START, END)
    assert out == [Shortage("DIS", "S1", WED, 2, 3)]
    people.append(person("Not In Schedule"))
    assert staffing_check(sched, people, config(), START, END) == out


def test_custom_team_function_and_config_min_staff():
    people, sched = build([("A", "Blr", "Whatever", "S1")])
    out = staffing_check(sched, people, config(), WED, WED, team_of=lambda p: "L3")
    assert out == [Shortage("L3", "S1", WED, 1, 3)]
    assert staffing_check(sched, people, config(Whatever=1), WED, WED) == []


# ---- staffing check: per_team_day teams (minimum "Option B") ---------------------------


def test_effective_min_per_mode():
    cfg = config()
    assert effective_min(cfg, "L2", 1) == 3 and effective_min(cfg, "DEP", 0) == 3  # per_shift
    assert effective_min(cfg, "Lab", 5) == 2 and effective_min(cfg, "Lab", 1) == 1
    assert effective_min(cfg, "Lab", 0) == 0  # nobody scheduled: nothing needed
    assert effective_min(config(Lab=0), "Lab", 4) == 0
    assert effective_min(per_shift_config(), "Lab", 1) == 2


def test_scheduled_on_counts_leave_on_pattern_days_only():
    cells = row_for("S2")  # Wed-Sun
    cells[date(2026, 10, 28)] = "P"  # a Wednesday: scheduled, on leave
    cells[date(2026, 10, 26)] = "P"  # a Monday: a weekly off, so not scheduled
    cells[date(2026, 10, 29)] = "SL"
    pc = PersonCells(cells)
    assert scheduled_on(pc, date(2026, 10, 28)) and scheduled_on(pc, date(2026, 10, 29))
    assert not scheduled_on(pc, date(2026, 10, 26)) and not scheduled_on(pc, date(2026, 10, 27))
    assert scheduled_on(pc, date(2026, 10, 30))  # a working cell
    assert not scheduled_on(pc, date(2030, 1, 1))  # no data


def test_per_team_day_counts_the_team_across_shifts():
    # 3 people on two shifts: per shift S3 would be short (1 < 2), per team day 3 >= 2
    specs = [("A", "Blr", "Lab", "S1"), ("B", "Hyd", "Lab", "S1"), ("C", "Pun", "Lab", "S3")]
    people, sched = build(specs)
    assert staffing_check(sched, people, config(), START, END) == []
    assert staffing_check(sched, people, per_shift_config(), START, END)  # the old rule
    # one person on leave: 2 left >= 2, fine; two on leave: 1 < 2, flagged for the TEAM
    sched["A"][WED] = "P"
    assert staffing_check(sched, people, config(), START, END) == []
    sched["B"][WED] = "HOL"
    out = staffing_check(sched, people, config(), START, END)
    assert out == [Shortage("Lab", ALL_SHIFTS, WED, 1, 2)]
    assert out[0].severity == "WARNING" and out[0].message == "Lab on 2026-10-28: 1 working, minimum 2"


def test_per_team_day_single_person_team_never_gets_an_impossible_shortage():
    people, sched = build([("Solo", "Blr", "EKS", "S1")])
    assert staffing_check(sched, people, config(), START, END) == []  # min(2, 1) = 1
    sched["Solo"][WED] = "P"  # absent on a day they were scheduled: that IS a shortage
    out = staffing_check(sched, people, config(), START, END)
    assert out == [Shortage("EKS", ALL_SHIFTS, WED, 0, 1)] and out[0].severity == "ERROR"


def test_per_team_day_small_team_on_offset_patterns():
    # Mon-Fri + Wed-Sun: only one is scheduled on Mon, Tue (S1 person) and Sat, Sun (S2 person)
    people, sched = build([("A", "Blr", "CMS 2.0", "S1"), ("B", "Hyd", "CMS 2.0", "S2")])
    assert staffing_check(sched, people, config(), START, END) == []
    sat = date(2026, 11, 7)
    sched["B"][sat] = "P"  # the only person scheduled that Saturday is away
    assert staffing_check(sched, people, config(), START, END) == [
        Shortage("CMS 2.0", ALL_SHIFTS, sat, 0, 1)]


def test_per_team_day_a_day_nobody_is_scheduled_is_not_active():
    people, sched = build([(f"P{i}", "Blr", "Lab", "S2") for i in range(2)])
    mon = date(2026, 10, 26)
    assert staffing_check(sched, people, config(), mon, mon + timedelta(days=1)) == []
    # leave on a weekly off does not make the team "scheduled" either
    sched["P0"][mon] = "P"
    assert staffing_check(sched, people, config(), mon, mon) == []


def test_mode_override_and_aliases_pick_the_counting_rule():
    people, sched = build([("A", "Blr", "L2", "S1"), ("B", "Hyd", "L2", "S1"),
                           ("C", "Pun", "L2", "S3")])
    assert {s.shift for s in staffing_check(sched, people, config(), START, END)} == {"S1", "S3"}
    cfg = config()
    cfg.min_staff_mode["DIS"] = "per_team_day"  # L2 -> DIS: now counted for the whole team
    cfg.min_staff["DIS"] = 2
    assert staffing_check(sched, people, cfg, START, END) == []


def test_per_team_day_counts_custom_hours_and_mexico_but_not_blank():
    people, sched = build([("A", "Blr", "Lab", "S1"), ("B", "Mex", "Lab", "S1")])
    sched["B"][WED] = "IST 6:00-3:00AM"  # custom hours: working
    assert staffing_check(sched, people, config(), START, END) == []
    sched["B"][WED] = ""  # blank: not scheduled either, so the minimum drops to 1
    assert staffing_check(sched, people, config(), START, END) == []
    sched["A"][WED] = "P"
    assert staffing_check(sched, people, config(), START, END) == [
        Shortage("Lab", ALL_SHIFTS, WED, 0, 1)]


# ---- HOL check --------------------------------------------------------------------------

MATRIX = matrix_of([
    ("Common Day", COMMON, INDIA),
    ("Blr Day", BLR_ONLY, ["Blr"]),
    ("Common With Mex", COMMON_MEX, INDIA + [MEX]),
    ("Mex Day", MEX_ONLY, [MEX]),
])
LABELS = {COMMON: "Common Day", BLR_ONLY: "Blr Day", COMMON_MEX: "Common With Mex",
          MEX_ONLY: "Mex Day"}


def check(people, sched, **kw):
    return hol_check(sched, people, MATRIX, kw.pop("labels", LABELS), START, END, **kw)


def test_clean_roster_has_no_findings():
    people, sched = build([("A", "Blr", "L2", "S1"), ("B", "Pun", "L2", "S1")])
    sched["A"][COMMON] = "HOL"
    sched["B"][COMMON] = "HOL"
    sched["A"][BLR_ONLY] = "HOL"
    sched["A"][COMMON_MEX] = "HOL"
    sched["B"][COMMON_MEX] = "HOL"
    assert check(people, sched, coverage_ok=set()) == []


def test_stray_hol_where_location_not_ticked():
    people, sched = build([("A", "Blr", "L2", "S1"), ("B", "Pun", "L2", "S1")])
    sched["B"][BLR_ONLY] = "HOL"  # Pune is not off on a Blr-only day
    sched["A"][date(2026, 11, 17)] = "HOL"  # no holiday at all
    found = check(people, sched)
    assert [(f.kind, f.date, f.person, f.location) for f in found
            if f.kind is FindingKind.STRAY] == [
        (FindingKind.STRAY, BLR_ONLY, "B", "Pun"),
        (FindingKind.STRAY, date(2026, 11, 17), "A", "Blr")]
    stray = next(f for f in found if f.kind is FindingKind.STRAY)
    assert stray.severity is Severity.ERROR and "B" in stray.message and "Pun" in stray.message
    assert stray.kind.group == "STRAY"


def test_stray_wins_over_weekly_off_on_the_same_cell():
    people, sched = build([("A", "Pun", "L2", "S1")])
    sched["A"][SAT] = "HOL"  # not a holiday and a weekly off
    assert [f.kind for f in check(people, sched) if f.date == SAT] == [FindingKind.STRAY]


def test_mexico_hol_stray_when_mexico_not_ticked():
    people, sched = build([("M", "Mexico", "L2", "S1")])
    sched["M"][COMMON] = "HOL"  # common India day: Mexico is not off
    sched["M"][MEX_ONLY] = "HOL"
    found = [f for f in check(people, sched) if f.kind is FindingKind.STRAY]
    assert kinds(found) == [(FindingKind.STRAY, COMMON, "M")]


def test_missing_for_location_specific_holiday_is_certain():
    people, sched = build([("A", "Blr", "L2", "S1"), ("B", "Pun", "L2", "S1")])
    found = check(people, sched, coverage_ok=None)
    missing = [f for f in found if f.date == BLR_ONLY]
    assert kinds(missing) == [(FindingKind.MISSING, BLR_ONLY, "A")]  # B's Pune is working
    assert missing[0].severity is Severity.ERROR and "Blr Day" in missing[0].message


def test_missing_for_mexico_staff_on_common_india_mexico_holiday():
    people, sched = build([("M", "Mex", "L2", "S1"), ("A", "Blr", "L2", "S1")])
    sched["A"][COMMON_MEX] = "HOL"
    found = [f for f in check(people, sched, coverage_ok=set()) if f.date == COMMON_MEX]
    assert kinds(found) == [(FindingKind.MISSING, COMMON_MEX, "M")]
    # Mexico people are never in the coverage set: coverage cannot excuse them
    found = [f for f in check(people, sched, coverage_ok={("M", COMMON_MEX)})
             if f.date == COMMON_MEX]
    assert kinds(found) == [(FindingKind.MISSING, COMMON_MEX, "M")]


def test_common_holiday_without_hol_is_unverified_when_no_coverage_info():
    people, sched = build([("A", "Blr", "L2", "S1")])
    found = [f for f in check(people, sched) if f.date == COMMON]
    assert kinds(found) == [(FindingKind.MISSING_UNVERIFIED, COMMON, "A")]
    assert found[0].severity is Severity.WARNING
    assert found[0].kind.value == "MISSING (unverified coverage)"
    assert found[0].kind.group == "MISSING"


def test_coverage_set_and_predicate_semantics():
    people, sched = build([("A", "Blr", "L2", "S1"), ("B", "Pun", "L2", "S1")])
    sched["A"][BLR_ONLY] = "HOL"
    only_common = lambda f: f.date == COMMON  # noqa: E731
    covered = {("A", COMMON)}
    found = [f for f in check(people, sched, coverage_ok=covered) if only_common(f)]
    assert kinds(found) == [(FindingKind.MISSING, COMMON, "B")]  # B is not covered
    found = [f for f in check(people, sched, coverage_ok=lambda n, d: n == "B")
             if only_common(f)]
    assert kinds(found) == [(FindingKind.MISSING, COMMON, "A")]
    both = {("A", COMMON), ("B", COMMON)}
    assert [f for f in check(people, sched, coverage_ok=both) if only_common(f)] == []


def test_leave_and_weekly_off_are_never_reported_missing():
    people, sched = build([("A", "Blr", "L2", "S1"), ("B", "Blr", "L2", "S3")])
    sched["A"][COMMON] = "P"
    sched["A"][BLR_ONLY] = "T"
    sched["B"][COMMON] = ""  # weekly off
    sched["B"][BLR_ONLY] = "SL"
    assert [f for f in check(people, sched) if f.date in (COMMON, BLR_ONLY)] == []


def test_hol_on_weekly_off_uses_the_inferred_pattern():
    sat_matrix = matrix_of([("Sat Day", SAT, INDIA), ("Mon Day", MON, INDIA)])
    labels = {SAT: "x", MON: "y"}
    people, sched = build([("A", "Blr", "L2", "S1"), ("B", "Blr", "L2", "S2")])
    sched["A"][SAT] = "HOL"  # Mon-Fri person: Saturday is a weekly off
    sched["A"][MON] = "HOL"  # fine: a working day
    sched["B"][MON] = "HOL"  # Wed-Sun person: Monday is a weekly off
    sched["B"][SAT] = "HOL"  # fine
    found = hol_check(sched, people, sat_matrix, labels, START, END, coverage_ok=set())
    assert kinds(found) == [(FindingKind.HOL_ON_WEEKLY_OFF, MON, "B"),
                            (FindingKind.HOL_ON_WEEKLY_OFF, SAT, "A")]
    assert found[0].severity is Severity.WARNING and "Wed-Sun" in found[0].message
    assert "Mon-Fri" in found[1].message


def test_mismatch_both_directions_and_non_holiday_labels_ignored():
    people, _ = build([])
    labels = dict(LABELS)
    del labels[MEX_ONLY]  # matrix holiday with no label
    labels[date(2026, 11, 20)] = "Mystery Day"  # label with no matrix entry
    labels[date(2026, 11, 22)] = "Shift Swap"
    labels[date(2026, 11, 23)] = "Winter\nDisconnect"
    found = hol_check({}, people, MATRIX, labels, START, END)
    assert kinds(found) == [(FindingKind.MISMATCH_NO_LABEL, MEX_ONLY, None),
                            (FindingKind.MISMATCH_NO_MATRIX, date(2026, 11, 20), None)]
    assert "Mex Day" in found[0].message and "Mystery Day" in found[1].message
    assert {f.kind.group for f in found} == {"MISMATCH"}
    # the ignore pattern can be replaced or switched off
    found = hol_check({}, people, MATRIX, labels, START, END, ignore_label_pattern=None)
    assert len([f for f in found if f.kind is FindingKind.MISMATCH_NO_MATRIX]) == 3
    found = hol_check({}, people, MATRIX, labels, START, END, ignore_label_pattern="mystery")
    assert date(2026, 11, 20) not in {f.date for f in found}


def test_unknown_location_reported_once_and_not_checked():
    people, sched = build([("U", "US", "Governance", "S1")])
    sched["U"][COMMON] = "HOL"
    sched["U"][BLR_ONLY] = "HOL"
    found = check(people, sched)
    assert kinds(found) == [(FindingKind.UNKNOWN_LOCATION, None, "U")]
    assert found[0].severity is Severity.INFO


def test_ignore_dates_and_window():
    people, sched = build([("A", "Pun", "L2", "S1")])
    sched["A"][BLR_ONLY] = "HOL"
    assert [f for f in check(people, sched) if f.kind is FindingKind.STRAY]
    assert not [f for f in check(people, sched, ignore_dates={BLR_ONLY})
                if f.kind is FindingKind.STRAY]
    # the window limits the label comparison too: nothing is due before Nov 4
    assert hol_check(sched, people, MATRIX, {}, START, date(2026, 11, 3)) == []
    assert hol_check(sched, people, MATRIX, {}, START, COMMON) != []
    only = hol_check(sched, people, MATRIX, {}, START, BLR_ONLY - timedelta(days=1))
    assert all(f.kind is not FindingKind.STRAY for f in only)


def test_checks_do_not_modify_the_schedule():
    people, sched = build([("A", "Blr", "L2", "S1"), ("B", "Pun", "L2", "S1")])
    sched["B"][BLR_ONLY] = "HOL"
    before = copy.deepcopy(sched)
    check(people, sched)
    staffing_check(sched, people, config(), START, END)
    assert sched == before


def test_synthetic_pune_strays_have_the_real_files_shape():
    # Fake Pune HOLs on seven dates with no Pune holiday; legitimate ones are untouched.
    start, end = date(2026, 6, 1), date(2026, 12, 31)
    stray_dates = [date(2026, 6, 23), date(2026, 7, 9), date(2026, 8, 18), date(2026, 10, 13),
                   date(2026, 10, 29), date(2026, 12, 8), date(2026, 12, 24)]
    matrix = matrix_of([
        ("Common A", date(2026, 9, 14), INDIA),
        ("Common B", date(2026, 11, 9), INDIA),
        ("Not Pune", date(2026, 10, 21), ["Blr", "Kol"]),
        ("Pune Local", date(2026, 9, 3), ["Pun"]),
    ])
    people, sched = build([("P1", "Pune", "L2", "S1"), ("P2", "Pune", "L2", "S1"),
                           ("B1", "Bengaluru", "L2", "S1")], start, end)
    for d in stray_dates + [date(2026, 9, 14), date(2026, 11, 9), date(2026, 9, 3)]:
        for n in ("P1", "P2"):
            if sched[n][d] != "":
                sched[n][d] = "HOL"
    sched["B1"][date(2026, 10, 21)] = "HOL"
    found = hol_check(sched, people, matrix, {}, start, end, coverage_ok=set(),
                      ignore_label_pattern=None)
    strays = {f.date for f in found if f.kind is FindingKind.STRAY}
    assert strays == set(stray_dates)
    assert {f.location for f in found if f.kind is FindingKind.STRAY} == {"Pun"}
    assert {f.person for f in found if f.kind is FindingKind.STRAY} == {"P1", "P2"}


def test_findings_are_sorted_by_date_then_kind_then_person():
    people, sched = build([("B", "Pun", "L2", "S1"), ("A", "Pun", "L2", "S1")])
    sched["A"][BLR_ONLY] = "HOL"
    sched["B"][BLR_ONLY] = "HOL"
    stray = [f for f in check(people, sched) if f.kind is FindingKind.STRAY]
    assert [f.person for f in stray] == ["A", "B"]
    assert all(isinstance(f, Finding) and f.message for f in stray)


# ---- roster / real file ----------------------------------------------------------------

REAL = (Path(__file__).resolve().parents[2] / "roster-reference"
        / "Shiftroster_Takeda_Redesigned_v2.xlsx")
needs_real = pytest.mark.skipif(not REAL.exists(), reason="real roster reference file not present")

# The seven Pune dates the PMO says carry a HOL added by mistake in 2026.
REAL_STRAYS = [date(2026, 6, 23), date(2026, 7, 9), date(2026, 8, 18), date(2026, 10, 13),
               date(2026, 10, 29), date(2026, 12, 8), date(2026, 12, 24)]
# Pune HOL dates that have no row-12 label either, but are probably genuine Pune-only
# holidays that live in the real Holiday Roster (which is not machine-readable).
REAL_UNLABELLED_PUNE = [date(2026, 4, 28), date(2026, 4, 29), date(2026, 5, 14),
                        date(2026, 9, 3)]


@needs_real
def test_real_roster_pune_strays_include_the_seven_known_dates():
    roster = load_roster(REAL)
    labels = roster.holiday_labels(expand_merges=True)
    matrix = label_derived_matrix(labels)
    pune = [p for p in roster.people if p.location_code == "Pune"]
    assert len(pune) == 5
    sched = schedule_from_roster(roster)
    disconnect = set(days(date(2026, 12, 26), date(2027, 1, 1)))
    found = hol_check(sched, pune, matrix, {}, roster.first_date, roster.last_date,
                      ignore_dates=disconnect, ignore_label_pattern=None)
    strays = {f.date for f in found if f.kind is FindingKind.STRAY}
    assert set(REAL_STRAYS) <= strays
    # the only other Pune HOLs with no label are the probable genuine Pune-only holidays
    assert strays - set(REAL_STRAYS) <= set(REAL_UNLABELLED_PUNE)
    assert {f.location for f in found if f.kind is FindingKind.STRAY} == {"Pun"}


@needs_real
@pytest.mark.xfail(raises=HolidayMatrixError, strict=True, reason=(
    "The real 'Holiday Roster 2026' sheet is a March coverage plan with pictures, not the "
    "Holiday name/Date/location matrix layout, so load_holiday_matrix cannot read it. "
    "Supply the real 2026 matrix (an xlsx in the matrix layout) to turn this into the "
    "exact-seven acceptance check."))
def test_real_roster_pune_strays_are_exactly_the_seven_dates_with_the_real_matrix():
    matrix = load_holiday_matrix(REAL, "Holiday Roster 2026")
    roster = load_roster(REAL)
    pune = [p for p in roster.people if p.location_code == "Pune"]
    found = hol_check(schedule_from_roster(roster), pune, matrix, {}, roster.first_date,
                      roster.last_date, ignore_label_pattern=None)
    assert sorted(f.date for f in found if f.kind is FindingKind.STRAY) == REAL_STRAYS
    assert {f.location for f in found if f.kind is FindingKind.STRAY} == {"Pun"}


@needs_real
def test_real_roster_staffing_check_runs_and_is_pure():
    roster = load_roster(REAL)
    sched = schedule_from_roster(roster, date(2026, 10, 25), date(2026, 12, 19))
    before = copy.deepcopy(sched)
    out = staffing_check(sched, roster.people, config(), date(2026, 10, 25), date(2026, 12, 19))
    assert sched == before
    assert all(s.have < s.need for s in out)
    assert {s.team for s in out} <= {"DIS", "DEP", "L3", "Device Support", "Lab", "CMS 2.0", "EKS",
                                     "LNS 2.0", "Governance", "Device Support L3"}
