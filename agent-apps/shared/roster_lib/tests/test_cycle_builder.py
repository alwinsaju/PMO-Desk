"""Cycle builder: analyze -> build_plan on a synthetic multi-team roster (no real data)."""

from __future__ import annotations

import copy
import json
from datetime import date, timedelta

import pytest
from cycle_testkit import (
    ANSWERS,
    AUG,
    DEC,
    EXCLUDED,
    OCT,
    SPECS,
    Spec,
    code_text,
    make_config,
    make_roster,
    pattern_of,
    shift_in_cycle,
)
from roster_testkit import INDIA, matrix_of

from roster_lib.checks import staffing_check
from roster_lib.codes import Pattern, try_parse_code, works_on
from roster_lib.config import DateWindow, Rotation
from roster_lib.cycle_builder import (
    Analysis,
    CycleUnavailable,
    MissingInput,
    NeedsAnswers,
    Plan,
    active_people,
    analyze_cycle,
    build_plan,
    headcount_table,
)
from roster_lib.pto import PtoEntry, apply_pto, shift_group_rule

LOW = dict(DIS=2, DEP=2, L3=2, default=1)  # minimums low enough for fairness to bite

HOLIDAYS_OCT = [("Aug Common", date(2026, 8, 17), INDIA),
                ("Oct Common", date(2026, 10, 20), INDIA),
                ("Kol Only", date(2026, 11, 9), ["Kol"]),
                ("Mex Day", date(2026, 11, 16), ["Mex"])]
HOLIDAYS_DEC = [("Oct Common", date(2026, 10, 20), INDIA),
                ("Xmas", date(2026, 12, 25), INDIA + ["Mex"]),
                ("New Year", date(2027, 1, 1), INDIA),
                ("Mid Jan", date(2027, 1, 14), INDIA)]


def labels_of(rows, last=date(2026, 12, 31), skip=()):
    return {d: n for n, d, _ in rows if d <= last and d not in skip}


@pytest.fixture
def oct_world():
    """Aug filled, Oct cycle to build; roster file ends 31 Dec 2026."""
    return (make_roster(labels=labels_of(HOLIDAYS_OCT)), make_config(0, **LOW),
            matrix_of(HOLIDAYS_OCT))


@pytest.fixture
def dec_world():
    """Aug + Oct filled, Dec cycle to build; roster file ends 1 Jan 2027 (year boundary)."""
    last = date(2027, 1, 1)
    return (make_roster(filled=(AUG, OCT), last_date=last,
                        labels=labels_of(HOLIDAYS_DEC, last)),
            make_config(1, **LOW), matrix_of(HOLIDAYS_DEC))


def pto(name, start, end=None, code="P", row=2):
    return PtoEntry(name, start, end or start, code, row)


# ---- analyze -------------------------------------------------------------------------

def test_active_people_skips_excluded_sections(oct_world):
    roster, cfg, _ = oct_world
    names = {p.name for p in active_people(roster.people, cfg)}
    assert names.isdisjoint(EXCLUDED) and len(names) == len(SPECS) - len(EXCLUDED)
    cfg.excluded_sections = []
    cfg.excluded_section_patterns = ["Lab"]
    assert {p.name for p in roster.people} - {p.name for p in active_people(roster.people, cfg)} \
        == {"Lab Person 0", "Lab Person 1"}


def test_analyze_lists_what_the_form_must_ask(oct_world):
    roster, cfg, matrix = oct_world
    a = analyze_cycle(roster, cfg, OCT, holiday_matrix=matrix)
    assert isinstance(a, Analysis)
    assert a.availability.enabled and a.availability.coverage == 1.0
    assert a.previous_cycle == "Aug 2026"
    assert {(r.stage, r.name, r.kind) for r in a.required_answers} == {
        ("rotation", "Dis Us", "ASK_ME"), ("rotation", "Dis New Hire", "UNCLASSIFIED")}
    assert {i.name for i in a.ask_me} == {"Dis Us", "Dis New Hire"}
    assert a.unclassified == ["Dis New Hire"]
    assert set(a.excluded_people) == EXCLUDED and a.active_count == len(SPECS) - len(EXCLUDED)
    assert not a.ready and a.changes.is_empty
    assert a.year_boundary["crosses"] is False
    assert a.holiday_matrix["present"] and a.holiday_matrix["rows_in_cycle"] == 3
    assert a.pto["provided"] is False


def test_analyze_with_answers_is_ready_and_json_roundtrips(oct_world):
    roster, cfg, matrix = oct_world
    a = analyze_cycle(roster, cfg, OCT, holiday_matrix=matrix, answers=ANSWERS)
    assert a.ready and a.required_answers == [] and a.blockers == []
    data = json.loads(a.to_json())
    assert data["ready"] is True and data["cycle"]["label"] == "Oct 2026"
    assert a.to_json() == analyze_cycle(roster, cfg, OCT, holiday_matrix=matrix,
                                        answers=ANSWERS).to_json()


def test_analyze_reports_missing_matrix_and_unavailable_cycle():
    roster = make_roster(filled=())  # nothing in the previous cycle
    a = analyze_cycle(roster, make_config(0), OCT, holiday_matrix=None,
                      holiday_matrix_errors=["row 3: bad date"])
    assert not a.availability.enabled and not a.ready
    assert any("no roster data" in b for b in a.blockers)
    assert any("holiday matrix is missing: row 3: bad date" in b for b in a.blockers)
    assert a.holiday_matrix == {"present": False, "errors": ["row 3: bad date"]}


def test_analyze_year_boundary_info(dec_world):
    roster, cfg, matrix = dec_world
    yb = analyze_cycle(roster, cfg, DEC, holiday_matrix=matrix).year_boundary
    assert yb["crosses"] and not yb["wholly_beyond"]
    assert yb["in_file"] == {"start": "2026-11-29", "end": "2027-01-01"}
    assert yb["remainder"] == {"start": "2027-01-02", "end": "2027-01-30"}


def test_analyze_pto_name_report_and_excluded_names(oct_world):
    roster, cfg, matrix = oct_world
    entries = [pto("Dis Morning 01", date(2026, 10, 12)),
               pto("Dis Morning 2", date(2026, 10, 13)),  # one digit off: needs confirmation
               pto("Nobody Atall", date(2026, 10, 14)),
               pto("Gov Person 0", date(2026, 10, 15))]  # excluded section
    a = analyze_cycle(roster, cfg, OCT, holiday_matrix=matrix, pto_entries=entries,
                      answers=ANSWERS)
    assert a.pto["exact"] == {"Dis Morning 01": "Dis Morning 01"}
    assert list(a.pto["needs_confirmation"]) == ["Dis Morning 2"]
    assert a.pto["unmatched"] == ["Nobody Atall"] and a.pto["dropped_excluded"] == ["Gov Person 0"]
    assert [(r.stage, r.kind) for r in a.required_answers] == [("pto", "PTO_NAME")]
    a2 = analyze_cycle(roster, cfg, OCT, holiday_matrix=matrix, pto_entries=entries,
                       answers=ANSWERS, confirmed_pto={"Dis Morning 2": "Dis Morning 02"})
    assert a2.required_answers == [] and a2.pto["exact"]["Dis Morning 2"] == "Dis Morning 02"


def test_analyze_new_person_requires_changes_answer():
    specs = SPECS + [Spec("Newcomer", "DEP", "DEP USI", "Hyd", Rotation.PERMANENT, "S1")]
    roster = make_roster(specs=specs)
    a = analyze_cycle(roster, make_config(0), OCT, holiday_matrix=None)
    new = [r for r in a.required_answers if r.stage == "changes"]
    assert [(r.name, r.kind) for r in new] == [("Newcomer", "NEW_PERSON")]
    assert new[0].details["replaces_options"] == []
    assert [n.name for n in a.changes.new] == ["Newcomer"]


def test_analyze_pto_file_errors_are_reported_not_raised(oct_world, tmp_path):
    import openpyxl
    roster, cfg, matrix = oct_world
    path = tmp_path / "pto.xlsx"
    wb = openpyxl.Workbook()
    wb.active.append(["Name", "From", "To", "Code"])
    wb.active.append(["Dis Morning 01", "not a date", "2026-10-13", "P"])
    wb.save(path)
    a = analyze_cycle(roster, cfg, OCT, holiday_matrix=matrix, pto_path=path, answers=ANSWERS)
    assert a.pto["error"] and not a.ready
    wb = openpyxl.Workbook()
    wb.active.append(["Name", "From", "To", "Code"])
    wb.active.append(["Dis Morning 01", "2026-10-12", "2026-10-13", "P"])
    wb.save(path)
    a = analyze_cycle(roster, cfg, OCT, holiday_matrix=matrix, pto_path=path, answers=ANSWERS)
    assert a.pto["error"] is None and a.pto["entries"] == 1 and a.ready


# ---- needs_answers / typed errors ---------------------------------------------------------

def test_build_plan_without_answers_raises_structured_needs_answers(oct_world):
    roster, cfg, matrix = oct_world
    with pytest.raises(NeedsAnswers) as err:
        build_plan(roster, cfg, OCT, None, holiday_matrix=matrix)
    assert {(m.stage, m.name) for m in err.value.missing} == {
        ("rotation", "Dis Us"), ("rotation", "Dis New Hire")}
    data = err.value.to_dict()
    assert data["status"] == "needs_answers" and len(data["missing"]) == 2 and data["invalid"] == []


def test_invalid_and_unknown_answers_are_reported(oct_world):
    roster, cfg, matrix = oct_world
    bad = {"rotation": {"Dis Us": {"shift": "HOL"}, "Dis New Hire": {"shift": "S2",
                                                                    "pattern": "MON_FRI"}}}
    with pytest.raises(NeedsAnswers) as err:
        build_plan(roster, cfg, OCT, bad, holiday_matrix=matrix)
    text = " ".join(err.value.invalid)
    assert "unusable shift" in text and "always Wed-Sun" in text and not err.value.missing
    with pytest.raises(NeedsAnswers, match="bogus") as err:
        build_plan(roster, cfg, OCT, {**ANSWERS, "bogus": {}}, holiday_matrix=matrix)
    assert err.value.to_dict()["status"] == "needs_answers"


def test_matrix_is_required(oct_world):
    roster, cfg, _ = oct_world
    with pytest.raises(MissingInput):
        build_plan(roster, cfg, OCT, ANSWERS, holiday_matrix=None)


def test_unavailable_cycle_raises_with_reason_unless_bootstrap():
    roster = make_roster(filled=())
    cfg = make_config(0)
    matrix = matrix_of(HOLIDAYS_OCT)
    with pytest.raises(CycleUnavailable, match="no roster data"):
        build_plan(roster, cfg, OCT, ANSWERS, holiday_matrix=matrix)
    # bootstrap lets it through, but then nobody has a previous shift: everyone must answer
    with pytest.raises(NeedsAnswers) as err:
        build_plan(roster, cfg, OCT, ANSWERS, holiday_matrix=matrix, bootstrap=True)
    assert len(err.value.missing) >= 20


def test_new_person_and_replacement_answers():
    specs = SPECS + [Spec("Newcomer", "DEP", "DEP USI", "Hyd", Rotation.PERMANENT, "S1")]
    roster = make_roster(specs=specs)
    cfg = make_config(0, **LOW)
    matrix = matrix_of(HOLIDAYS_OCT)
    with pytest.raises(NeedsAnswers) as err:
        build_plan(roster, cfg, OCT, ANSWERS, holiday_matrix=matrix)
    assert [(m.stage, m.name) for m in err.value.missing] == [("changes", "Newcomer")]
    answers = {**ANSWERS, "changes": {"Newcomer": {"new_seat": {
        "rotation": "PERMANENT", "shift": "S1", "team": "Operate", "subteam": "DEP"}}}}
    plan = build_plan(roster, cfg, OCT, answers, holiday_matrix=matrix)
    assert ("Newcomer", OCT.start + timedelta(days=1)) in plan.edits  # Monday
    assert plan.edits[("Newcomer", OCT.start + timedelta(days=1))] == "Shift-1"
    assert plan.config_after.find("Newcomer") is not None and cfg.find("Newcomer") is None
    assert any(f.kind == "CHANGE_NOTE" for f in plan.flags)


def test_leaver_replaced_by_newcomer_inherits_the_seat():
    leaver = "Dep Person 3"
    specs = [s for s in SPECS if s.name != leaver] \
        + [Spec("Replacement", "DEP", "DEP USI", "Pun", Rotation.PERMANENT, "S1")]
    roster = make_roster(specs=specs)
    # the replacement has no data of their own and the leaver is gone from the file
    cfg = make_config(0, **LOW)
    matrix = matrix_of(HOLIDAYS_OCT)
    a = analyze_cycle(roster, cfg, OCT, holiday_matrix=matrix, answers=ANSWERS)
    assert [n.name for n in a.changes.removed] == [leaver]
    assert [(r.stage, r.name) for r in a.required_answers] == [("changes", "Replacement")]
    assert a.required_answers[0].details["replaces_options"] == [leaver]
    answers = {**ANSWERS, "changes": {"Replacement": {"replaces": leaver}}}
    plan = build_plan(roster, cfg, OCT, answers, holiday_matrix=matrix)
    assert plan.config_after.find(leaver) is None
    assert plan.config_after.find("Replacement").rotation is Rotation.PERMANENT


# ---- a normal cycle -------------------------------------------------------------------------

def test_normal_cycle_scope_and_swap_sunday(oct_world):
    roster, cfg, matrix = oct_world
    plan = build_plan(roster, cfg, OCT, ANSWERS, holiday_matrix=matrix)
    assert plan.remainder_edits == {}
    active = {p.name for p in roster.people} - EXCLUDED
    cycle_days = {OCT.start + timedelta(days=i) for i in range(OCT.days)}
    assert {n for n, _ in plan.edits} == active  # excluded people are never edited
    assert {d for _, d in plan.edits} == cycle_days
    assert len(plan.edits) == len(active) * OCT.days  # every new-cycle cell, nothing else
    swap_sunday = OCT.rotation_sunday
    assert swap_sunday.weekday() == 6
    to_s2 = [s.name for s in SPECS if s.name.startswith("Dis Morning") and s.shift == "S1"]
    to_s1 = [s.name for s in SPECS if s.name.startswith("Dis Morning") and s.shift == "S2"]
    for name in to_s2:  # Mon-Fri -> Wed-Sun: works the swap Sunday, off Mon-Tue
        assert plan.edits[(name, swap_sunday)] == "Shift-2"
        assert plan.edits[(name, swap_sunday + timedelta(days=1))] == ""
        assert plan.edits[(name, swap_sunday + timedelta(days=2))] == ""
        assert plan.edits[(name, swap_sunday + timedelta(days=3))] == "Shift-2"
    for name in to_s1:  # Wed-Sun -> Mon-Fri: swap Sunday off, starts Monday
        assert plan.edits[(name, swap_sunday)] == ""
        assert plan.edits[(name, swap_sunday + timedelta(days=1))] == "Shift-1"
    changed = {c["person"] for c in plan.shift_changes}
    assert changed == {s.name for s in SPECS if s.name.startswith(("Dis Morning", "Dis Evening"))}
    first = {c["person"]: c for c in plan.shift_changes}[to_s2[0]]
    assert (first["old_shift"], first["new_shift"], first["effective"]) == (
        "S1", "S2", swap_sunday.isoformat())


def test_permanent_and_answered_people_follow_their_rules(oct_world):
    roster, cfg, matrix = oct_world
    plan = build_plan(roster, cfg, OCT, ANSWERS, holiday_matrix=matrix)
    monday = OCT.start + timedelta(days=1)
    assert plan.edits[("Dep Person 0", monday)] == "Shift-1"
    assert plan.edits[("Dep Person 0", OCT.start)] == ""  # Sunday off, Mon-Fri
    assert plan.edits[("Lead Three 0", monday)] == "Shift-5"
    assert plan.edits[("Dis Us", monday)] == "US-CST"  # KEEP
    assert plan.edits[("Dis New Hire", monday)] == "Shift-3"  # answered S3 / MON_FRI
    cfg_after = plan.config_after
    assert cfg_after.find("Dis Morning 01").shift == "S2"  # config follows the new cycle
    assert cfg_after.find("Dis Morning 01").partner == "S1"
    assert cfg.find("Dis Morning 01").shift == "S1"  # the input config is untouched
    assert cfg_after.find("Dis New Hire").shift == "S3"


def test_edits_only_write_leave_on_working_days(oct_world):
    """HOL/PTO may replace a working cell but never fill a weekly off."""
    roster, cfg, matrix = oct_world
    entries = [pto("Dis Evening 01", date(2026, 10, 7), date(2026, 10, 12)),  # Wed..Mon
               pto("Dep Person 0", date(2026, 10, 9), date(2026, 10, 12))]  # Fri..Mon
    plan = build_plan(roster, cfg, OCT, ANSWERS, holiday_matrix=matrix, pto_entries=entries)
    by_name = {s.name: s for s in SPECS}
    leave = {"HOL", "P", "T", "SL"}
    n_leave = 0
    for (name, d), text in plan.edits.items():
        if text not in leave:
            continue
        n_leave += 1
        spec = by_name[name]
        code = plan.config_after.find(name).shift
        assert works_on(pattern_of(code), d), (name, d, text)
    assert n_leave >= 4
    # the PTO range touching a weekend only writes P on the weekdays/working days
    assert plan.edits[("Dep Person 0", date(2026, 10, 10))] == ""  # Saturday stays blank
    assert plan.edits[("Dep Person 0", date(2026, 10, 9))] == "P"
    assert plan.edits[("Dep Person 0", date(2026, 10, 12))] == "P"


def test_deterministic_json_and_roundtrip(oct_world):
    roster, cfg, matrix = oct_world
    entries = [pto("Dis Morning 03", date(2026, 10, 20))]
    kwargs = dict(holiday_matrix=matrix, pto_entries=entries, seed=7)
    a = build_plan(roster, cfg, OCT, ANSWERS, **kwargs).to_json()
    b = build_plan(roster, copy.deepcopy(cfg), OCT, copy.deepcopy(ANSWERS), **kwargs).to_json()
    assert a == b
    plan = Plan.from_json(a)
    assert plan.to_json() == a
    assert plan.cycle == OCT and plan.run_info["seed_used"] == 7
    assert plan.run_info["seed_source"] == "parameter"
    assert build_plan(roster, cfg, OCT, ANSWERS, holiday_matrix=matrix
                      ).run_info["seed_source"] == "config"


def test_plan_does_not_mutate_inputs(oct_world):
    roster, cfg, matrix = oct_world
    before_cfg, before_sched = copy.deepcopy(cfg.to_dict()), copy.deepcopy(roster._schedule)
    answers = copy.deepcopy(ANSWERS)
    build_plan(roster, cfg, OCT, answers, holiday_matrix=matrix)
    assert cfg.to_dict() == before_cfg and roster._schedule == before_sched
    assert answers == ANSWERS


# ---- holidays and PTO precedence -------------------------------------------------------------

def test_holiday_assignment_and_fairness(oct_world):
    roster, cfg, matrix = oct_world
    plan = build_plan(roster, cfg, OCT, ANSWERS, holiday_matrix=matrix)
    common = date(2026, 10, 20)
    hols = {n for (n, d), t in plan.edits.items() if d == common and t == "HOL"}
    # DIS S1 has 3 people and a minimum of 2: exactly one is off; S1 group is Mon-Fri on Tuesday
    s1_group = [n for n in (s.name for s in SPECS if s.name.startswith("Dis Morning"))
                if plan.config_after.find(n).shift == "S1"]
    assert len([n for n in s1_group if n in hols]) == 1
    # Kolkata-only holiday: everyone working in Kolkata gets HOL, nobody else
    kol = date(2026, 11, 9)
    kol_people = {p.name for p in roster.people if p.location_code == "Kolkata"} - EXCLUDED
    got = {n for (n, d), t in plan.edits.items() if d == kol and t == "HOL"}
    assert got and got <= kol_people
    # Mexico-only: the Mexico person gets HOL
    assert plan.edits[("Dis Us", date(2026, 11, 16))] == "HOL"
    assert plan.holiday_assignments and plan.counters_before and plan.counters_after
    off_total = sum(c["offs_taken"] for c in plan.counters_after.values())
    fair_offs = sum(len(a["off"]) - len(a["straight_off"]) for a in plan.holiday_assignments
                    if a["fairness"])
    assert off_total == sum(c["offs_taken"] for c in plan.counters_before.values()) + fair_offs


def test_counters_come_from_the_roster_history():
    hist = {("Dis Morning 01", date(2026, 8, 17)): "HOL"}  # an existing common-holiday off
    roster = make_roster(labels=labels_of(HOLIDAYS_OCT), hol_cells=hist)
    plan = build_plan(roster, make_config(0, **LOW), OCT, ANSWERS,
                      holiday_matrix=matrix_of(HOLIDAYS_OCT))
    assert plan.counters_before["Dis Morning 01"] == {"offs_taken": 1,
                                                      "last_off_date": "2026-08-17"}
    assert plan.counters_before["Dis Morning 02"]["offs_taken"] == 0


def test_pto_wins_over_hol_and_is_not_counted(oct_world):
    roster, cfg, matrix = oct_world
    common = date(2026, 10, 20)
    base = build_plan(roster, cfg, OCT, ANSWERS, holiday_matrix=matrix)
    off = sorted(n for (n, d), t in base.edits.items() if d == common and t == "HOL")
    victim = off[0]
    plan = build_plan(roster, cfg, OCT, ANSWERS, holiday_matrix=matrix,
                      pto_entries=[pto(victim, common)])
    assert plan.edits[(victim, common)] == "P"  # PTO, not HOL
    assert plan.counters_after[victim]["offs_taken"] == plan.counters_before[victim]["offs_taken"]
    assert not any(f.kind == "HOL_MISSING" and f.person == victim for f in plan.flags)
    # the PTO'd person is not in anyone's off list
    for a in plan.holiday_assignments:
        if a["date"] == common.isoformat():
            assert victim not in a["off"] and victim not in a["covering"]


def test_flags_are_reported_and_never_auto_fixed(oct_world):
    roster, cfg, matrix = oct_world
    cfg.min_staff.update({"DIS": 3, "Lab": 2})
    # Both Lab people on PTO the same day: below minimum; the program flags it, never fixes it
    entries = [pto("Lab Person 0", date(2026, 10, 14)), pto("Lab Person 1", date(2026, 10, 14))]
    plan = build_plan(roster, cfg, OCT, ANSWERS, holiday_matrix=matrix, pto_entries=entries)
    d = date(2026, 10, 14)
    assert plan.edits[("Lab Person 0", d)] == "P" and plan.edits[("Lab Person 1", d)] == "P"
    kinds = {(f.kind, f.person) for f in plan.flags if f.date == d}
    assert ("PTO_BELOW_MIN", "Lab Person 0") in kinds
    short = [f for f in plan.flags if f.kind == "STAFFING_SHORTAGE" and f.date == d
             and f.team == "Lab"]
    assert short and short[0].severity == "ERROR"  # nobody working
    # holiday groups at their minimum are flagged, and everyone keeps working
    at_min = [f for f in plan.flags if f.kind == "NO_OFF_AT_MINIMUM"]
    assert at_min
    for f in at_min:
        group = [a for a in plan.holiday_assignments if a["date"] == f.date.isoformat()
                 and (a["team"], a["shift"]) == (f.team, f.shift)]
        assert group and all(a["off"] == [] and a["covering"] for a in group)  # nobody off
    assert [f.severity for f in plan.flags] == sorted(
        (f.severity for f in plan.flags), key={"ERROR": 0, "WARNING": 1, "INFO": 2}.get)


def test_flag_kinds_for_unclassified_labels_and_headcount(oct_world):
    roster, cfg, matrix = oct_world
    roster._labels.pop(date(2026, 11, 16), None)  # the Mexico holiday has no roster label
    cfg.min_staff["Lab"] = 3  # two people can never meet this
    plan = build_plan(roster, cfg, OCT, ANSWERS, holiday_matrix=matrix)
    kinds = plan.flags_by_kind()
    assert kinds["UNCLASSIFIED_PERSON"] == 1
    assert kinds["HOL_MISMATCH_NO_LABEL"] >= 1
    assert any(f.kind == "HEADCOUNT_BELOW_MIN" and f.team == "Lab" and f.shift == "S1"
               for f in plan.flags)
    people_flags = [f for f in plan.flags if f.kind == "UNCLASSIFIED_PERSON"]
    assert people_flags[0].person == "Dis New Hire"


def test_min_staff_zero_means_unchecked_and_everyone_off(oct_world):
    roster, cfg, matrix = oct_world
    cfg.min_staff.update({"Lab": 0})
    entries = [pto("Lab Person 0", date(2026, 10, 14)), pto("Lab Person 1", date(2026, 10, 14))]
    plan = build_plan(roster, cfg, OCT, ANSWERS, holiday_matrix=matrix, pto_entries=entries)
    assert not any(f.team == "Lab" for f in plan.flags if f.kind in (
        "STAFFING_SHORTAGE", "HEADCOUNT_BELOW_MIN", "NO_OFF_AT_MINIMUM", "CANNOT_MEET_MINIMUM"))
    assert not any(f.kind == "PTO_BELOW_MIN" for f in plan.flags)
    hols = {n for (n, d), t in plan.edits.items() if d == date(2026, 10, 20) and t == "HOL"}
    assert {"Lab Person 0", "Lab Person 1"} <= hols  # no minimum: everyone may be off


def test_excluded_sections_are_untouched_everywhere(oct_world):
    roster, cfg, matrix = oct_world
    plan = build_plan(roster, cfg, OCT, ANSWERS, holiday_matrix=matrix,
                      pto_entries=[pto("Gov Person 0", date(2026, 10, 14))])
    text = plan.to_json()
    # excluded people never appear in edits, assignments, counters or flags (config_after keeps
    # the people the user listed there)
    data = json.loads(text)
    for key in ("edits", "remainder_edits"):
        assert not any(row[0] in EXCLUDED for row in data[key])
    for a in data["holiday_assignments"]:
        assert not (set(a["off"]) | set(a["covering"]) | set(a["outside"])) & EXCLUDED
    assert not EXCLUDED & set(data["counters_before"])
    assert not any(f["person"] in EXCLUDED for f in data["flags"] if f["kind"] != "PTO_SKIPPED")
    assert any(f.kind == "PTO_SKIPPED" for f in plan.flags)
    assert plan.run_info["roster"]["excluded"] == 2
    # a config without them and a roster with them: they are not "new"
    cfg2 = make_config(0, specs=[s for s in SPECS if s.name not in EXCLUDED], **LOW)
    a = analyze_cycle(roster, cfg2, OCT, holiday_matrix=matrix, answers=ANSWERS)
    assert a.changes.is_empty


def test_excluded_people_are_not_removed_even_if_in_config(oct_world):
    roster, cfg, matrix = oct_world
    plan = build_plan(roster, cfg, OCT, ANSWERS, holiday_matrix=matrix)
    assert plan.config_after.find("Gov Person 0") is not None


def test_pto_name_confirmation_flow(oct_world):
    roster, cfg, matrix = oct_world
    entries = [pto("Dis Morning 2", date(2026, 10, 15)), pto("Nobody Atall", date(2026, 10, 14))]
    with pytest.raises(NeedsAnswers) as err:
        build_plan(roster, cfg, OCT, ANSWERS, holiday_matrix=matrix, pto_entries=entries)
    assert [(m.stage, m.name) for m in err.value.missing] == [("pto", "Dis Morning 2")]
    plan = build_plan(roster, cfg, OCT, ANSWERS, holiday_matrix=matrix, pto_entries=entries,
                      confirmed_pto={"Dis Morning 2": "Dis Morning 02"})
    assert plan.edits[("Dis Morning 02", date(2026, 10, 15))] == "P"  # Thu, Wed-Sun worker
    unmatched = [f for f in plan.flags if f.kind == "PTO_UNMATCHED"]
    assert [f.severity for f in unmatched] == ["ERROR"] and unmatched[0].person == "Nobody Atall"


def test_disconnect_window_days_are_skipped(dec_world):
    roster, cfg, matrix = dec_world
    plan0 = build_plan(roster, cfg, DEC, ANSWERS, holiday_matrix=matrix)
    xmas = date(2026, 12, 25)
    assert any(t == "HOL" for (n, d), t in plan0.edits.items() if d == xmas)
    cfg.disconnect_windows = [DateWindow(date(2026, 12, 24), date(2027, 1, 1))]
    plan = build_plan(roster, cfg, DEC, ANSWERS, holiday_matrix=matrix)
    assert not any(t == "HOL" for (n, d), t in plan.edits.items()
                   if date(2026, 12, 24) <= d <= date(2027, 1, 1))
    skipped = [f.date for f in plan.flags if f.kind == "DISCONNECT_HOLIDAY_SKIPPED"]
    assert skipped == [xmas, date(2027, 1, 1)]
    assert not any(f.kind.startswith("HOL_MISSING") and f.date in skipped for f in plan.flags)
    assert plan.run_info["disconnect_days"] == 9


# ---- the year boundary -------------------------------------------------------------------------

def test_year_boundary_splits_edits_and_remainder(dec_world):
    roster, cfg, matrix = dec_world
    plan = build_plan(roster, cfg, DEC, ANSWERS, holiday_matrix=matrix)
    last = date(2027, 1, 1)
    active = len(SPECS) - len(EXCLUDED)
    assert all(d <= last for _, d in plan.edits) and all(d > last for _, d in plan.remainder_edits)
    assert len(plan.edits) == active * ((last - DEC.start).days + 1)
    assert len(plan.remainder_edits) == active * ((DEC.end - last).days)
    # the remainder is produced by the same logic: a Mid-Jan holiday sits in it
    assert any(t == "HOL" for (n, d), t in plan.remainder_edits.items()
               if d == date(2027, 1, 14))
    assert [f for f in plan.flags if f.kind == "YEAR_BOUNDARY"]
    assert plan.run_info["segments"] == [{"start": "2026-11-29", "end": "2026-12-31"},
                                         {"start": "2027-01-01", "end": "2027-01-30"}]
    # fairness counters restart on 1 January
    assert plan.next_year_counters is not None
    assert all(c["offs_taken"] <= 1 for c in plan.next_year_counters.values())
    assert plan.to_json() == build_plan(roster, cfg, DEC, ANSWERS, holiday_matrix=matrix).to_json()
    assert Plan.from_json(plan.to_json()).remainder_edits == plan.remainder_edits


def test_year_boundary_swap_sunday_and_patterns_continue(dec_world):
    roster, cfg, matrix = dec_world
    plan = build_plan(roster, cfg, DEC, ANSWERS, holiday_matrix=matrix)
    sunday = DEC.rotation_sunday
    s2_people = [s.name for s in SPECS if s.name.startswith("Dis Morning") and s.shift == "S1"]
    # in AUG they were S1, in OCT S2, so DEC swaps them back to S1 (Mon-Fri)
    for name in s2_people:
        assert plan.edits[(name, sunday)] == ""
        assert plan.edits[(name, sunday + timedelta(days=1))] == "Shift-1"
    # remainder dates follow the same weekly pattern (a Saturday is blank, Monday works)
    assert plan.remainder_edits[(s2_people[0], date(2027, 1, 2))] == ""  # Saturday
    monday = date(2027, 1, 4)
    assert plan.remainder_edits[(s2_people[0], monday)] in ("Shift-1", "HOL", "P")


def test_missing_matrix_year_is_flagged(dec_world):
    roster, cfg, _ = dec_world
    no_2027 = matrix_of([r for r in HOLIDAYS_DEC if r[1].year == 2026])
    plan = build_plan(roster, cfg, DEC, ANSWERS, holiday_matrix=no_2027)
    flag = [f for f in plan.flags if f.kind == "HOLIDAY_MATRIX_NO_ROWS"]
    assert len(flag) == 1 and flag[0].severity == "ERROR"  # 1 Jan 2027 is inside the file
    assert not any(t == "HOL" for (n, d), t in plan.remainder_edits.items())
    # last file date at 31 Dec: the whole next-year part is beyond the file -> a warning
    last = date(2026, 12, 31)
    roster2 = make_roster(filled=(AUG, OCT), last_date=last, labels=labels_of(HOLIDAYS_DEC, last))
    plan2 = build_plan(roster2, cfg, DEC, ANSWERS, holiday_matrix=no_2027)
    flag2 = [f for f in plan2.flags if f.kind == "HOLIDAY_MATRIX_NO_ROWS"]
    assert [f.severity for f in flag2] == ["WARNING"]
    assert all(d <= last for _, d in plan2.edits) and plan2.remainder_edits


def test_cycle_wholly_beyond_the_file_is_all_remainder():
    last = date(2026, 12, 31)
    roster = make_roster(filled=(AUG, OCT), last_date=last)
    cfg = make_config(2, **LOW)
    # FEB 2027's previous cycle (Dec) is not in the file: unavailable
    from roster_lib.cycles import cycle_for
    feb = cycle_for(2027, 2)
    with pytest.raises(CycleUnavailable):
        build_plan(roster, cfg, feb, ANSWERS, holiday_matrix=matrix_of(HOLIDAYS_DEC))


# ---- existing roster findings, headcount, PTO rule agreement ------------------------------------

def test_existing_roster_findings_for_the_cycle_year(oct_world):
    roster, cfg, matrix = oct_world
    plan = build_plan(roster, cfg, OCT, ANSWERS, holiday_matrix=matrix)
    ex = plan.existing_roster_findings
    assert ex["year"] == 2026 and ex["start"] == "2026-08-02" and ex["end"] == "2026-12-31"
    assert set(ex) >= {"hol", "staffing", "hol_by_kind", "staffing_count"}
    # the existing roster has no HOL cells at all, so common-holiday workers are unverified
    assert "MISSING_UNVERIFIED" in ex["hol_by_kind"] or "MISSING" in ex["hol_by_kind"]


def test_headcount_table_counts_people_per_shift(oct_world):
    roster, cfg, _ = oct_world
    sched = {n: {d: t for d, t in c.items()} for n, c in roster._schedule.items()}
    table = headcount_table(sched, active_people(roster.people, cfg), cfg, AUG)
    assert table["DIS"]["headcount"] == 14
    assert table["DIS"]["per_shift"] == {"S1": 3, "S2": 3, "S3": 4, "S4": 3, "US-CST": 1}
    assert table["DIS"]["spec_min"] == 2  # LOW overrides applied in the fixture config
    assert table["DIS"]["attainable"]["US-CST"] is False
    assert table["Lab"]["attainable"] == {"S1": True}
    assert table["L3"]["lowest_shift_headcount"] == 3


def test_pto_group_rule_agrees_with_config_and_staffing_check(oct_world):
    """`shift_group_rule` driven by config.team_of / min_staff_for_team reports BELOW_MIN
    on exactly the (team, shift, day) that `staffing_check` reports as a shortage."""
    roster, cfg, _ = oct_world
    cfg.min_staff["DEP"] = 4
    active = active_people(roster.people, cfg)
    sched = {p.name: dict(roster._schedule[p.name]) for p in active}
    team_of = {p.name: cfg.team_of(p) for p in active}
    rule = shift_group_rule(sched, lambda n: team_of[n],
                            lambda n: cfg.min_staff_for_team(team_of[n]))
    day = date(2026, 8, 12)  # a Wednesday in AUG
    res = apply_pto(sched, [pto("Dep Person 0", day)], AUG, None, min_staff_for=rule)
    below = [c for c in res.clashes if c.kind == "BELOW_MIN"]
    assert [c.person for c in below] == ["Dep Person 0"]
    from roster_lib.holiday_engine import apply_edits
    after = apply_edits(sched, res.edits)
    short = [s for s in staffing_check(after, active, cfg, day, day)
             if (s.team, s.shift) == ("DEP", "S1")]
    assert len(short) == 1 and short[0].have == 3 and short[0].need == 4
    assert team_of["Dep Person 0"] == "DEP"


def test_library_covers_every_shift_code_text():
    # the testkit's text for a code parses back to that code
    for code in ("S1", "S2", "S3", "S4", "S5", "US-CST"):
        assert try_parse_code(code_text(code)).canonical == code
    assert shift_in_cycle(SPECS[0], 1) == "S2" and Pattern.WED_SUN is pattern_of("S2")


# ---- per_team_day teams (minimum "Option B") ---------------------------------------------

def team_day_world():
    """The Oct world with the real mode defaults: DIS/DEP/L3 per shift, Lab per team per day."""
    roster = make_roster(labels=labels_of(HOLIDAYS_OCT))
    cfg = make_config(0, per_shift=False, **LOW)
    cfg.min_staff["Lab"] = 3  # two people: the effective minimum is min(3, 2) = 2
    return roster, cfg, matrix_of(HOLIDAYS_OCT)


def test_per_team_day_headcount_flags_and_table():
    roster, cfg, matrix = team_day_world()
    plan = build_plan(roster, cfg, OCT, ANSWERS, holiday_matrix=matrix)
    # the legacy per-shift rule flagged Lab (2 people < 3); the effective-minimum rule does not
    assert not any(f.kind == "HEADCOUNT_BELOW_MIN" and f.team == "Lab" for f in plan.flags)
    sched = {n: dict(c) for n, c in roster._schedule.items()}
    table = headcount_table(sched, active_people(roster.people, cfg), cfg, AUG)
    assert table["Lab"]["mode"] == "per_team_day" and table["Lab"]["spec_min"] == 3
    assert table["Lab"]["attainable"] == {"ALL": False}  # 2 people can never reach 3
    assert table["DIS"]["mode"] == "per_shift" and "US-CST" in table["DIS"]["attainable"]


def test_per_team_day_holiday_group_is_the_whole_team():
    roster, cfg, matrix = team_day_world()
    plan = build_plan(roster, cfg, OCT, ANSWERS, holiday_matrix=matrix)
    lab = [a for a in plan.holiday_assignments if a["team"] == "Lab"]
    assert lab and {a["shift"] for a in lab} == {"ALL"}
    common = next(a for a in lab if a["date"] == "2026-10-20")
    assert common["min_staff"] == 2 and common["off"] == [] and len(common["covering"]) == 2
    assert any(f.kind == "NO_OFF_AT_MINIMUM" and (f.team, f.shift) == ("Lab", "ALL")
               for f in plan.flags)
    dis = [a for a in plan.holiday_assignments if a["team"] == "DIS"]
    assert {a["shift"] for a in dis} >= {"S1", "S3"}  # per_shift teams unchanged


def test_per_team_day_leave_below_the_effective_minimum_flags_staffing_and_pto():
    roster, cfg, matrix = team_day_world()
    day = date(2026, 10, 14)  # a Wednesday: both Lab people are scheduled
    entries = [pto("Lab Person 0", day), pto("Lab Person 1", day)]
    plan = build_plan(roster, cfg, OCT, ANSWERS, holiday_matrix=matrix, pto_entries=entries)
    kinds = {(f.kind, f.person) for f in plan.flags}
    assert ("PTO_BELOW_MIN", "Lab Person 0") in kinds and ("PTO_BELOW_MIN", "Lab Person 1") in kinds
    short = [f for f in plan.flags if f.kind == "STAFFING_SHORTAGE" and f.team == "Lab"]
    assert [(f.date, f.shift) for f in short] == [(day, "ALL")] and short[0].severity == "ERROR"
    assert "Lab on 2026-10-14: 0 working, minimum 2" in short[0].message
    # one person away: 1 working < effective minimum 2 -> flagged too (but not an ERROR)
    plan = build_plan(roster, cfg, OCT, ANSWERS, holiday_matrix=matrix,
                      pto_entries=[pto("Lab Person 0", day)])
    short = [f for f in plan.flags if f.kind == "STAFFING_SHORTAGE" and f.team == "Lab"]
    assert [(f.date, f.severity) for f in short] == [(day, "WARNING")]


def test_per_team_day_removes_the_phantom_shortages_of_small_teams():
    roster, cfg, matrix = team_day_world()
    cfg.min_staff["Lab"] = 2
    legacy = make_config(0, per_shift=True, **LOW)
    legacy.min_staff["Lab"] = 2
    legacy_plan = build_plan(roster, legacy, OCT, ANSWERS, holiday_matrix=matrix)
    plan = build_plan(roster, cfg, OCT, ANSWERS, holiday_matrix=matrix)
    lab = [f for f in plan.flags if f.kind == "STAFFING_SHORTAGE" and f.team == "Lab"]
    assert lab == []  # nobody is away on a working day
    assert plan.to_json() == build_plan(roster, cfg, OCT, ANSWERS, holiday_matrix=matrix).to_json()
    assert len(legacy_plan.flags) >= len(plan.flags)


# ---- existing leave codes are preserved ---------------------------------------------------

D_TUE = date(2026, 10, 20)  # "Oct Common": a Tuesday, all India off
D_WED = date(2026, 10, 14)  # a plain Wednesday in OCT


def build_oct(world, existing=None, **kw):
    roster, cfg, matrix = world
    for (name, d), text in (existing or {}).items():
        roster._schedule[name][d] = text
    return build_plan(roster, cfg, OCT, ANSWERS, holiday_matrix=matrix, **kw)


def test_existing_leave_codes_are_preserved_not_overwritten(oct_world):
    existing = {("Dis Morning 01", date(2026, 10, 7)): "P", ("Dis Morning 02", date(2026, 10, 8)): "T",
                ("Dis Morning 03", date(2026, 10, 9)): "SL", ("Dep Person 0", D_WED): "COMP",
                ("Dep Person 1", date(2026, 10, 15)): "HOL"}  # a HOL typed on a non-holiday
    plan = build_oct(oct_world, existing)
    assert not set(existing) & set(plan.edits)  # no edit touches them
    assert plan.preserved == existing
    flags = [f for f in plan.flags if f.kind == "PRESERVED_LEAVE"]
    assert sorted((f.person, f.date) for f in flags) == sorted(existing)
    assert all(f.severity == "INFO" and repr(existing[(f.person, f.date)]) in f.message
               for f in flags)
    assert plan.run_info["counts"]["preserved_leave"] == 5
    # other cells of the same people are still rewritten
    assert plan.edits[("Dis Morning 01", date(2026, 10, 8))].strip()  # a Thursday (S2)
    # the preserved cells are part of the plan's JSON and survive a round trip
    again = Plan.from_json(plan.to_json())
    assert again.preserved == existing and again.to_json() == plan.to_json()


def test_only_shift_blank_and_custom_cells_are_rewritten_and_overwrites_are_counted(oct_world):
    existing = {("Lab Person 0", D_WED): "Shift-3", ("Lab Person 0", date(2026, 10, 15)): "OC",
                ("Lab Person 1", D_WED): "11AM-8PM", ("Lab Person 1", date(2026, 10, 15)): "P",
                ("Lab Person 1", date(2026, 10, 16)): "IST 6:00-3:00AM"}
    plan = build_oct(oct_world, existing)
    assert plan.edits[("Lab Person 0", D_WED)] == "Shift-1"  # rewritten from the rotation
    assert plan.edits[("Lab Person 0", date(2026, 10, 15))] == "Shift-1"
    assert ("Lab Person 1", date(2026, 10, 15)) not in plan.edits  # leave: kept
    (overw,) = [f for f in plan.flags if f.kind == "OVERWRITES_EXISTING"]
    assert "4 non-blank, non-leave cell(s)" in overw.message
    assert "OC: 1" in overw.message and "S3: 1" in overw.message and "custom hours: 1" in overw.message
    assert "11AM-8PM: 1" in overw.message
    assert "P" not in overw.message.split("(")[1]


def test_no_overwrite_flag_when_only_leave_exists(oct_world):
    plan = build_oct(oct_world, {("Lab Person 0", D_WED): "P"})
    assert not [f for f in plan.flags if f.kind == "OVERWRITES_EXISTING"]


def test_preserved_leave_makes_the_person_unavailable_for_holidays(oct_world):
    existing = {("Dep Person 0", D_TUE): "P"}  # on leave on the common holiday
    plan = build_oct(oct_world, existing)
    (grp,) = [a for a in plan.holiday_assignments
              if a["date"] == D_TUE.isoformat() and a["team"] == "DEP"]
    everyone = grp["off"] + grp["covering"] + grp["outside"]
    assert "Dep Person 0" not in everyone  # PTO wins: no HOL, not in the pool
    assert plan.counters_after["Dep Person 0"] == plan.counters_before["Dep Person 0"]
    assert ("Dep Person 0", D_TUE) not in plan.edits


def test_preserved_manual_hol_on_a_common_holiday_counts_as_an_off_taken(oct_world):
    base = build_oct(oct_world)
    (b,) = [a for a in base.holiday_assignments if a["date"] == D_TUE.isoformat()
            and a["team"] == "DEP"]
    assert len(b["off"]) == 2 and len(b["covering"]) == 2  # 4 people, min 2
    plan = build_oct(oct_world, {("Dep Person 2", D_TUE): "HOL"})
    (a,) = [a for a in plan.holiday_assignments if a["date"] == D_TUE.isoformat()
            and a["team"] == "DEP"]
    assert a["preserved_off"] == ["Dep Person 2"]
    assert "Dep Person 2" not in a["off"] + a["covering"]  # not in the pool any more
    assert len(a["covering"]) == 2 and len(a["off"]) == 1  # need stays 2, one fewer to be off
    assert a["counters_after"]["Dep Person 2"]["offs_taken"] == (
        a["counters_before"]["Dep Person 2"]["offs_taken"] + 1)
    assert plan.counters_after["Dep Person 2"]["last_off_date"] == D_TUE.isoformat()
    assert ("Dep Person 2", D_TUE) not in plan.edits and plan.preserved[("Dep Person 2", D_TUE)] == "HOL"
    # total HOL that day for the team is unchanged: one preserved + one generated
    generated = [n for (n, d), t in plan.edits.items() if d == D_TUE and t == "HOL"
                 and n.startswith("Dep Person")]
    assert len(generated) == 1
    assert not [f for f in plan.flags if f.kind == "HOL_STRAY"]


def test_preserved_stray_hol_is_kept_flagged_and_not_counted(oct_world):
    kol_day = date(2026, 11, 9)  # Kol only: a Pune person's HOL is stray
    existing = {("Lab Person 0", kol_day): "HOL", ("Dep Person 1", D_WED): "HOL"}
    plan = build_oct(oct_world, existing)
    assert plan.preserved[("Lab Person 0", kol_day)] == "HOL"
    stray = {(f.person, f.date) for f in plan.flags if f.kind == "HOL_STRAY"}
    assert stray == {("Lab Person 0", kol_day), ("Dep Person 1", D_WED)}
    base = build_oct(oct_world)
    assert plan.counters_after["Lab Person 0"] == base.counters_after["Lab Person 0"]
    assert plan.counters_after["Dep Person 1"]["last_off_date"] != D_WED.isoformat()
    assert ("Lab Person 0", kol_day) not in plan.edits


def test_pto_import_on_an_existing_different_leave_keeps_it_and_notes(oct_world):
    existing = {("Dep Person 0", D_WED): "T", ("Dep Person 1", D_WED): "HOL",
                ("Dep Person 2", D_WED): "P"}
    entries = [pto("Dep Person 0", D_WED), pto("Dep Person 1", D_WED), pto("Dep Person 2", D_WED)]
    plan = build_oct(oct_world, existing, pto_entries=entries)
    notes = [f.message for f in plan.flags if f.kind == "PTO_NOTE"]
    assert any("Dep Person 0" in n and "already T" in n for n in notes)
    assert any("Dep Person 1" in n and "already HOL" in n for n in notes)
    assert not any("Dep Person 2" in n for n in notes)  # same code: nothing to say
    assert plan.preserved[("Dep Person 0", D_WED)] == "T"
    assert plan.preserved[("Dep Person 1", D_WED)] == "HOL"
    assert not {("Dep Person 0", D_WED), ("Dep Person 1", D_WED), ("Dep Person 2", D_WED)} & set(plan.edits)


def test_preserved_leave_in_the_year_boundary_cycle_only_covers_the_file(dec_world):
    roster, cfg, matrix = dec_world
    roster._schedule["Lab Person 0"][date(2026, 12, 3)] = "P"
    roster._schedule["Lab Person 0"][date(2027, 1, 1)] = "SL"  # last column of the file
    plan = build_plan(roster, cfg, DEC, ANSWERS, holiday_matrix=matrix)
    assert set(plan.preserved) == {("Lab Person 0", date(2026, 12, 3)),
                                   ("Lab Person 0", date(2027, 1, 1))}
    assert not any(n == "Lab Person 0" and d in (date(2026, 12, 3), date(2027, 1, 1))
                   for n, d in plan.edits)
    assert any(n == "Lab Person 0" for n, _ in plan.remainder_edits)  # beyond the file: all built
