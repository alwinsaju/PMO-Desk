"""Building the next cycle from a NEXT-YEAR roster file.

A next-year file starts part-way through the Dec-Jan cycle (e.g. Sat 2027-01-02) and only holds
the remainder of that cycle, so the earlier weeks of the previous cycle live in the previous
year's file. The availability rule, the derived shifts, the ask-me list and the plan must all work
from the weeks that ARE in the file. Synthetic data only (the real-file test asserts counts)."""

from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

import pytest
from cycle_testkit import (ANSWERS, DEC, INDIA, SPECS, FakeRoster, daterange, fill, make_config,
                           make_roster)
from roster_testkit import label_derived_matrix, matrix_of

from roster_lib.codes import counts_as_code
from roster_lib.cycle_builder import (
    analyze_cycle,
    build_plan,
    holiday_roster_warnings,
)
from roster_lib.cycles import cycle_availability, cycle_for, previous_cycle, weeks
from roster_lib.roster_changes import ask_me_list
from roster_lib.rotation import derive_state

FIRST, LAST = date(2027, 1, 2), date(2028, 1, 1)  # a next-year file: Sat 2 Jan 2027 + 365 days
FEB = cycle_for(2027, 2)  # 2027-01-31 .. 2027-04-03
NAMES = [s.name for s in SPECS]


def next_year_roster(*, blank_people=()):
    """A 2027 file: dates FIRST..LAST, only the Dec-Jan cycle remainder (Jan 2-30) filled."""
    schedule = {}
    for s in SPECS:
        cells = {d: "" for d in daterange(FIRST, LAST)}
        if s.name not in blank_people:
            part: dict = {}
            fill(part, s, DEC, 2)
            cells.update({d: t for d, t in part.items() if FIRST <= d <= LAST})
        schedule[s.name] = cells
    return FakeRoster(SPECS, schedule, FIRST, LAST, {})


def matrix_2027(n_extra=2):
    rows = [("New Year", date(2027, 1, 1), INDIA), ("Republic", date(2027, 1, 26), INDIA)]
    rows += [("Spring", date(2027, 3, 10), INDIA), ("Late", date(2027, 3, 24), INDIA)][:n_extra]
    return matrix_of(rows)


def availability(schedule, rng, **kw):
    return cycle_availability(FEB, schedule, NAMES, counts_as_code, 0.95, data_range=rng, **kw)


# ---- the failure that was reported, and the fix ---------------------------------------

def test_the_old_rule_wrongly_disables_the_cycle_after_a_next_year_file():
    roster = next_year_roster()
    sched = {n: dict(c) for n, c in roster._schedule.items()}
    old = cycle_availability(FEB, sched, NAMES, counts_as_code, 0.95)  # no data_range: old rule
    assert not old.enabled and old.coverage == pytest.approx(4 / 9)


def test_availability_judges_only_the_previous_cycle_weeks_inside_the_file():
    roster = next_year_roster()
    sched = {n: dict(c) for n, c in roster._schedule.items()}
    av = availability(sched, (FIRST, LAST))
    assert av.enabled and av.coverage == 1.0
    assert (av.weeks_checked, av.weeks_total) == (4, 9)  # Jan 3, 10, 17, 24 of 9 weeks
    assert ("Checked 4 of 9 weeks of the previous cycle that are inside this file "
            "(the rest are in the previous year's file)") in av.reason


def test_a_person_missing_codes_in_the_in_file_weeks_still_fails():
    roster = next_year_roster(blank_people={"Dep Person 0"})
    sched = {n: dict(c) for n, c in roster._schedule.items()}
    av = availability(sched, (FIRST, LAST))
    assert not av.enabled and av.failing_people == ("Dep Person 0",)
    assert "Checked 4 of 9 weeks" in av.reason
    # one in-file week of four is 25%: below the threshold
    for d in daterange(date(2027, 1, 3), date(2027, 1, 9)):
        sched["Dep Person 0"][d] = "Shift-1"
    assert not availability(sched, (FIRST, LAST)).enabled
    for d in daterange(date(2027, 1, 3), date(2027, 1, 30)):
        sched["Dep Person 0"][d] = "Shift-1"
    assert availability(sched, (FIRST, LAST)).enabled


def test_at_least_one_week_must_be_inside_the_file():
    sched = {n: {} for n in NAMES}
    # file starts on 2027-01-31: every week of the Dec-Jan cycle starts before it
    av = availability(sched, (date(2027, 1, 31), LAST))
    assert not av.enabled and av.weeks_checked == 0
    assert "none of its weeks is inside this file" in av.reason
    assert availability(sched, (date(2027, 1, 31), LAST), bootstrap=True).enabled


def test_weeks_that_run_past_the_end_of_the_file_count_as_missing():
    """The OLD year's file (ends Fri 2027-01-01) must not enable Feb 2027: the last weeks of the
    Dec-Jan cycle are in the next-year file, so building from the old file would ignore them."""
    sched = {n: {d: "Shift-1" for d in daterange(date(2026, 11, 29), date(2027, 1, 1))}
             for n in NAMES}
    av = availability(sched, (date(2026, 1, 2), date(2027, 1, 1)))
    assert not av.enabled and av.coverage == pytest.approx(5 / 9)  # 5 of 9 weeks have a code
    assert "run past the end of this file" in av.reason


def test_without_a_data_range_nothing_changes():
    av = cycle_availability(FEB, {n: {} for n in NAMES}, NAMES, counts_as_code)
    assert not av.enabled and av.weeks_checked == 9 and "no roster data" in av.reason


# ---- every consumer of the previous cycle ---------------------------------------------

def test_derive_state_uses_the_full_in_file_weeks_only():
    prev = previous_cycle(FEB)
    # a Wed-Sun person (S2): the file's first day (Sat Jan 2) is a working Saturday of a week
    # that starts before the file; it is partial evidence and must not count as a week
    cells = {d: "Shift-2" if d.weekday() in (2, 3, 4, 5, 6) else "" for d in daterange(FIRST, date(2027, 1, 30))}
    st = derive_state(cells, prev)
    assert st.code == "S2" and st.weeks_used == 4 and st.pattern.name == "WED_SUN"
    assert st.pattern_from_weeks
    # all-blank earlier weeks are never evidence either
    assert derive_state({d: "" for d in daterange(FIRST, date(2027, 1, 30))}, prev) is None


def test_ask_me_and_changes_use_the_in_file_weeks():
    roster = next_year_roster()
    cfg = make_config(2)
    schedule = {n: dict(c) for n, c in roster._schedule.items()}
    prev = previous_cycle(FEB)
    prev_sched = {n: {d: t for d, t in c.items() if prev.contains(d)} for n, c in schedule.items()}
    items = ask_me_list(cfg, roster.people, prev_sched, FEB)
    # exactly the people the config says must be asked (ASK_ME / UNCLASSIFIED), nobody "NEW_SEAT"
    assert sorted(i.category for i in items) == ["ASK_ME", "UNCLASSIFIED"]
    assert not any(i.category == "NEW_SEAT" for i in items)


def test_analysis_and_plan_for_the_cycle_after_a_next_year_file():
    roster = next_year_roster()
    cfg = make_config(2)
    matrix = matrix_2027()
    analysis = analyze_cycle(roster, cfg, FEB, holiday_matrix=matrix, answers=ANSWERS)
    assert analysis.ready, analysis.blockers
    d = analysis.to_dict()
    assert d["previous_cycle"] == "Dec 2026"
    assert (d["availability"]["weeks_checked"], d["availability"]["weeks_total"]) == (4, 9)
    assert d["year_boundary"]["crosses"] is False and d["year_boundary"]["in_file"]["start"] == "2027-01-31"
    assert d["changes"]["new"] == []

    plan = build_plan(roster, cfg, FEB, ANSWERS, holiday_matrix=matrix)
    assert plan.remainder_edits == {} and plan.next_year_counters is None
    assert min(dt for _, dt in plan.edits) == FEB.start and max(dt for _, dt in plan.edits) == FEB.end
    # AUTO_SWAP people flip from the observed Dec-Jan shift: S1 -> S2 (Wed-Sun) on the swap Sunday
    morning = [plan.edits[("Dis Morning 01", dt)] for dt in daterange(FEB.start, FEB.start + timedelta(6))]
    assert morning == ["Shift-2", "", "", "Shift-2", "Shift-2", "Shift-2", "Shift-2"]
    changes = {c["person"]: c for c in plan.shift_changes}
    assert (changes["Dis Morning 01"]["old_shift"], changes["Dis Morning 01"]["new_shift"]) == ("S1", "S2")
    assert changes["Dis Evening 01"]["old_shift"] == "S3" and changes["Dis Evening 01"]["new_shift"] == "S4"
    # the previous cycle id and the checked weeks are recorded in the plan's run info
    assert plan.run_info["previous_cycle"] == "Dec 2026"
    assert plan.run_info["availability"]["weeks_checked"] == 4
    # the holiday rows of the cycle (Mar 10) are used: someone is given HOL, nobody off on Jan 26
    assert any(a["date"] == "2027-03-10" for a in plan.holiday_assignments)
    assert "HOLIDAY_ROSTER_MAY_BE_INCOMPLETE" not in plan.flags_by_kind()
    assert plan.to_json() == build_plan(roster, cfg, FEB, ANSWERS, holiday_matrix=matrix).to_json()


def test_the_previous_year_file_does_not_enable_the_cycle_after_the_boundary():
    """Same people, the OLD file ending 2027-01-01 with Dec filled to the end of the file."""
    roster = make_roster(filled=(DEC,), last_date=date(2027, 1, 1))
    analysis = analyze_cycle(roster, make_config(2), FEB, holiday_matrix=matrix_2027(), answers=ANSWERS)
    assert not analysis.availability.enabled and not analysis.ready


# ---- holiday roster completeness warning ----------------------------------------------

def test_holiday_roster_warning_for_a_year_with_only_the_assumed_row():
    only_assumed = matrix_of([("New Year", date(2027, 1, 1), INDIA), ("Old", date(2026, 12, 25), INDIA)])
    (first, message), = holiday_roster_warnings(only_assumed, FEB)
    assert first == date(2027, 1, 31) and "only 1 row(s) for 2027" in message
    roster = next_year_roster()
    plan = build_plan(roster, make_config(2), FEB, ANSWERS, holiday_matrix=only_assumed)
    flags = [f for f in plan.flags if f.kind == "HOLIDAY_ROSTER_MAY_BE_INCOMPLETE"]
    assert len(flags) == 1 and flags[0].severity == "WARNING" and flags[0].date == date(2027, 1, 31)
    assert not any(f.kind == "HOLIDAY_MATRIX_NO_ROWS" for f in plan.flags)  # the year has a row
    analysis = analyze_cycle(roster, make_config(2), FEB, holiday_matrix=only_assumed, answers=ANSWERS)
    assert analysis.ready  # non-blocking
    assert analysis.to_dict()["holiday_matrix"]["may_be_incomplete"] == [message]


def test_holiday_roster_warning_rules():
    ny = ("New Year", date(2027, 1, 1), INDIA)
    # three rows in the year but none inside the cycle: still suspicious
    m = matrix_of([ny, ("A", date(2027, 6, 1), INDIA), ("B", date(2027, 7, 1), INDIA)])
    assert len(holiday_roster_warnings(m, FEB)) == 1
    # two rows in the year, one in the cycle: fewer than 3 rows in the year
    m = matrix_of([ny, ("A", date(2027, 3, 10), INDIA)])
    assert len(holiday_roster_warnings(m, FEB)) == 1
    # three rows incl. one in the cycle: fine
    m = matrix_of([ny, ("A", date(2027, 3, 10), INDIA), ("B", date(2027, 8, 10), INDIA)])
    assert holiday_roster_warnings(m, FEB) == []
    # no rows for the year at all: that is HOLIDAY_MATRIX_NO_ROWS' job, not this warning's
    assert holiday_roster_warnings(matrix_of([("Old", date(2026, 12, 25), INDIA)]), FEB) == []
    assert holiday_roster_warnings(None, FEB) == []


def test_holiday_roster_warning_covers_the_january_part_of_the_dec_cycle():
    only_assumed = matrix_of([("Xmas", date(2026, 12, 25), INDIA), ("Dwali", date(2026, 11, 8), INDIA),
                              ("Third", date(2026, 10, 2), INDIA), ("NY", date(2027, 1, 1), INDIA)])
    found = holiday_roster_warnings(only_assumed, DEC)
    assert [f for f, _ in found] == [date(2027, 1, 1)]  # the 2026 piece is fine, 2027 is not
    assert "2027-01-01..2027-01-30" in found[0][1]


# ---- real files (counts only; skipped when the gitignored reference files are absent) ----

REAL = Path(__file__).resolve().parents[2] / "roster-reference" / "Shiftroster_Takeda_Redesigned_v2.xlsx"
needs_real = pytest.mark.skipif(not REAL.exists(), reason="real roster reference file not present")


@needs_real
def test_real_next_year_file_keeps_the_next_cycle_selectable(tmp_path):
    from roster_lib.checks import schedule_from_roster
    from roster_lib.cycle_builder import active_people
    from roster_lib.next_year_file import build_next_year_file
    from roster_lib.roster_io import load_roster
    from roster_lib.seed_config import parse_seed_names, seed_config

    roster = load_roster(REAL)
    config = seed_config(roster, parse_seed_names({})).config
    matrix = label_derived_matrix(roster.holiday_labels(expand_merges=True))
    dec = cycle_for(2026, 12)
    answers = {"rotation": {r.name: {"shift": "KEEP"}
                            for r in analyze_cycle(roster, config, dec, holiday_matrix=matrix
                                                   ).required_answers}}
    plan = build_plan(roster, config, dec, answers, holiday_matrix=matrix)
    assert len(plan.remainder_edits) == 47 * 29

    nxt = tmp_path / "next.xlsx"
    res = build_next_year_file(REAL, nxt, plan.remainder_edits)
    assert (res.start, res.end) == (date(2027, 1, 2), date(2028, 1, 1))
    nroster = load_roster(nxt)
    active = active_people(nroster.people, config)
    names = [p.name for p in active]
    full = schedule_from_roster(nroster)
    sub = {n: full[n] for n in names}
    rng = (nroster.first_date, nroster.last_date)
    old_rule = cycle_availability(FEB, sub, names, counts_as_code, 0.95)
    new_rule = cycle_availability(FEB, sub, names, counts_as_code, 0.95, data_range=rng)
    assert not old_rule.enabled  # the reported failure
    assert new_rule.enabled and (new_rule.weeks_checked, new_rule.weeks_total) == (4, 9)
    # and the cycle after it is still waiting for Feb-Mar
    assert not cycle_availability(cycle_for(2027, 4), sub, names, counts_as_code, 0.95,
                                  data_range=rng).enabled

    analysis = analyze_cycle(nroster, plan.config_after, FEB, holiday_matrix=matrix)
    assert analysis.availability.enabled and analysis.previous_cycle == "Dec 2026"
    assert analysis.changes.new == [] and analysis.changes.removed == []
