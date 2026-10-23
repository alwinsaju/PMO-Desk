import json
import shutil
from datetime import date

import openpyxl
import pytest

from winter_lib import winter_plan as wp
from winter_lib import winter_workbook as ww
from winter_lib.winter_audit import AuditResult, audit_winter_plan
from winter_lib.winter_config import parse_config
from winter_testkit import example_dict, make_people, small_cfg

DAYS = [date(2026, 12, 25 + i) if i < 7 else date(2027, 1, 1) for i in range(8)]


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    cfg = small_cfg()
    people = make_people(n_dis=7)
    plan = wp.solve_winter_plan(people, cfg)
    path = tmp_path_factory.mktemp("audit") / "w.xlsx"
    res = ww.write_winter_workbook(path, plan, cfg)
    return cfg, plan, res, people


def edit(res, tmp_path, fn, name="e.xlsx"):
    """Open the workbook with openpyxl (an 'Excel re-save'), apply fn(ws, layout), save, return the path."""
    wb = openpyxl.load_workbook(res.path)
    fn(wb[ww.SHEET_PLAN], res.layout)
    out = tmp_path / name
    wb.save(out)
    return out


def row_of(res, plan_, name):
    for g in res.layout.groups:
        if name in g.rows:
            return g.rows[name]
    raise KeyError(name)


def col_of(k):
    return ww.C_DAY0 + 1 + k


def test_clean_workbook_passes_with_a_summary(built):
    cfg, plan, res, people = built
    out = audit_winter_plan(res.path, cfg, roster_names=[p.name for p in people])
    assert isinstance(out, AuditResult) and out.ok and out.errors == []
    s = out.summary
    assert s["people"] == len(people) and s["snapshot_present"] is True
    assert s["teams"]["DIS"]["lowest_day"] >= 2 and s["teams"]["DEP"]["lowest_day"] >= 2
    assert sum(s["days_histogram"].values()) == len(people) and set(s["days_histogram"]) <= {"3", "4", "5"}
    assert s["person_days"] == len(plan.cells) and s["errors"] == 0
    # best-effort gaps are reported, never failures
    assert all(f.severity == "warning" for f in out.findings)


def test_excel_resave_does_not_change_the_verdict(built, tmp_path):
    cfg, plan, res, people = built
    out = edit(res, tmp_path, lambda ws, lay: None)  # openpyxl re-save: cached values gone, constants intact
    r = audit_winter_plan(out, cfg, roster_names=[p.name for p in people])
    assert r.ok and r.summary["person_days"] == len(plan.cells)


def test_team_minimum_breach_is_an_error(built, tmp_path):
    cfg, plan, res, people = built
    g = res.layout.group_of("DEP")
    day = plan.window[0]
    on = [p for p in g.people if plan.code(p.name, day)]
    keep = on[0]

    def fn(ws, lay):
        for p in on[1:]:
            ws.cell(row=g.rows[p.name], column=col_of(0)).value = None

    r = audit_winter_plan(edit(res, tmp_path, fn), cfg)
    errs = [f for f in r.errors if f.code == "team_min"]
    assert len(errs) == 1 and errs[0].team == "DEP" and errs[0].date == day and "1 of 2" in errs[0].message
    assert not r.ok


def test_days_below_min_and_above_max(built, tmp_path):
    cfg, plan, res, people = built
    dis = res.layout.group_of("DIS")
    a, b = dis.people[0], dis.people[1]
    l3 = res.layout.group_of("L3").people[0]

    def fn(ws, lay):
        for k, d in enumerate(plan.window):  # a: only one day
            ws.cell(row=dis.rows[a.name], column=col_of(k)).value = ("Shift-1" if k == 0 else None)
        for k, d in enumerate(plan.window):  # b: six days (usual shift)
            ws.cell(row=dis.rows[b.name], column=col_of(k)).value = ww.display_code(b.usual_shift) if k < 6 else None
        for k in range(4):  # best-effort team member: four days
            ws.cell(row=res.layout.group_of("L3").rows[l3.name], column=col_of(k)).value = ww.display_code(l3.usual_shift)
        for k in range(4, 8):
            ws.cell(row=res.layout.group_of("L3").rows[l3.name], column=col_of(k)).value = None

    r = audit_winter_plan(edit(res, tmp_path, fn), cfg)
    by = {(f.code, f.person): f for f in r.errors}
    assert ("days_below_min", a.name) in by
    assert ("days_above_max", b.name) in by and "at most 5" in by[("days_above_max", b.name)].message
    assert ("days_above_max", l3.name) in by and "best-effort" in by[("days_above_max", l3.name)].message
    assert "at most 3" in by[("days_above_max", l3.name)].message


def test_shift_not_usual_and_invalid_text(built, tmp_path):
    cfg, plan, res, people = built
    p = res.layout.group_of("DIS").people[0]
    row = res.layout.group_of("DIS").rows[p.name]
    days = plan.days_of(p.name)
    k0, k1, k2 = (plan.window.index(d) for d in days[:3])

    def fn(ws, lay):
        ws.cell(row=row, column=col_of(k0)).value = "NS" if p.usual_shift != "NS" else "Shift-3"
        ws.cell(row=row, column=col_of(k1)).value = "HOL"
        ws.cell(row=row, column=col_of(k2)).value = "Shift-1 / NS"

    r = audit_winter_plan(edit(res, tmp_path, fn), cfg)
    kinds = {(f.code, f.date) for f in r.errors if f.person == p.name}
    assert ("shift_not_usual", days[0]) in kinds
    assert ("not_a_shift", days[1]) in kinds and ("not_a_shift", days[2]) in kinds
    msgs = " ".join(f.message for f in r.errors if f.code == "not_a_shift")
    assert "leave code" in msgs and "one slot per person per day" in msgs


def test_variant_spellings_of_the_usual_shift_are_accepted(built, tmp_path):
    cfg, plan, res, people = built
    p = res.layout.group_of("DIS").people[0]
    row = res.layout.group_of("DIS").rows[p.name]
    d0 = plan.days_of(p.name)[0]

    def fn(ws, lay):
        ws.cell(row=row, column=col_of(plan.window.index(d0))).value = {"S1": "shift 1", "S3": "S3 ", "S2": "SHIFT-2",
                                                                          "NS": "ns", "S4": "shift-4",
                                                                          "US-CST": "us cst"}[p.usual_shift]

    assert audit_winter_plan(edit(res, tmp_path, fn), cfg).ok


def test_double_slot_through_a_duplicate_person_row(built, tmp_path):
    cfg, plan, res, people = built
    dis = res.layout.group_of("DIS")
    a, b = dis.people[0], dis.people[1]
    d = plan.days_of(a.name)[0]
    k = plan.window.index(d)

    def fn(ws, lay):
        ws.cell(row=dis.rows[b.name], column=ww.C_NAME + 1).value = a.name  # b's row now carries a's name
        ws.cell(row=dis.rows[b.name], column=ww.C_USUAL + 1).value = ww.display_code(a.usual_shift)
        for kk in range(8):
            ws.cell(row=dis.rows[b.name], column=col_of(kk)).value = None
        ws.cell(row=dis.rows[b.name], column=col_of(k)).value = ww.display_code(a.usual_shift)

    r = audit_winter_plan(edit(res, tmp_path, fn), cfg)
    assert any(f.code == "double_slot" and f.person == a.name and f.date == d for f in r.errors)
    assert any(f.code == "duplicate_person" for f in r.warnings)


def test_excluded_unknown_and_unavailable(built, tmp_path):
    cfg, plan, res, people = built
    victim = res.layout.group_of("DIS").people[2]
    d = plan.days_of(victim.name)[0]
    cfg2 = small_cfg(exclusions={"team_patterns": [], "people": [victim.name], "name_patterns": []},
                     availability={res.layout.group_of("DEP").people[0].name: {"unavailable": [plan.window[0].isoformat()]}})
    roster = [p.name for p in people if p.name != res.layout.group_of("DIS").people[3].name]
    dep0 = res.layout.group_of("DEP").people[0]
    # make dep0 work on the unavailable day
    row = res.layout.group_of("DEP").rows[dep0.name]

    def fn(ws, lay):
        ws.cell(row=row, column=col_of(0)).value = ww.display_code(dep0.usual_shift)

    r = audit_winter_plan(edit(res, tmp_path, fn), cfg2, roster_names=roster)
    codes_ = {(f.code, f.person) for f in r.errors}
    assert ("excluded_person", victim.name) in codes_
    assert ("unknown_person", res.layout.group_of("DIS").people[3].name) in codes_
    assert ("unavailable_day", dep0.name) in codes_


def test_excluded_team_label_on_the_plan(built, tmp_path):
    cfg, plan, res, people = built
    p = res.layout.group_of("DIS").people[0]
    cfg2 = small_cfg(exclusions={"team_patterns": ["DIS"], "people": [], "name_patterns": []})
    r = audit_winter_plan(res.path, cfg2)
    assert sum(1 for f in r.errors if f.code == "excluded_person") == len(res.layout.group_of("DIS").people)


def test_unknown_team_label(built, tmp_path):
    cfg, plan, res, people = built
    p = res.layout.group_of("DIS").people[0]

    def fn(ws, lay):
        ws.cell(row=lay.group_of("DIS").rows[p.name], column=ww.C_TEAM + 1).value = "Nowhere"

    r = audit_winter_plan(edit(res, tmp_path, fn), cfg)
    assert any(f.code == "unknown_team" and f.person == p.name for f in r.errors)


def test_usual_shift_column_edited_is_caught_through_the_snapshot(built, tmp_path):
    cfg, plan, res, people = built
    dis = res.layout.group_of("DIS")
    p = dis.people[0]
    days = plan.days_of(p.name)

    def fn(ws, lay):
        # change the shift AND the usual-shift column so the two agree: only the snapshot gives it away
        new = "Shift-5" if p.usual_shift != "S5" else "Shift-1"
        ws.cell(row=dis.rows[p.name], column=ww.C_USUAL + 1).value = new
        for d in days:
            ws.cell(row=dis.rows[p.name], column=col_of(plan.window.index(d))).value = new

    r = audit_winter_plan(edit(res, tmp_path, fn), cfg)
    assert [f.code for f in r.errors if f.person == p.name] == ["usual_shift_edited"]


def test_unavailability_makes_below_min_a_warning(built, tmp_path):
    cfg, plan, res, people = built
    p = res.layout.group_of("DIS").people[0]
    cfg2 = small_cfg(availability={p.name: {"allowed": ["2026-12-30", "2026-12-31"]}})
    dis = res.layout.group_of("DIS")

    def fn(ws, lay):
        for k, d in enumerate(plan.window):
            ws.cell(row=dis.rows[p.name], column=col_of(k)).value = ww.display_code(p.usual_shift) if k in (5, 6) else None

    r = audit_winter_plan(edit(res, tmp_path, fn), cfg2)
    f = [x for x in r.findings if x.code == "days_below_min" and x.person == p.name]
    assert len(f) == 1 and f[0].severity == "warning" and "only 2 available" in f[0].message


def test_uncalculated_formula_in_the_grid_is_an_error(built, tmp_path):
    cfg, plan, res, people = built
    p = res.layout.group_of("DIS").people[0]

    def fn(ws, lay):
        ws.cell(row=lay.group_of("DIS").rows[p.name], column=col_of(7)).value = '="NS"'

    r = audit_winter_plan(edit(res, tmp_path, fn), cfg)
    assert any(f.code == "not_a_shift" and "formula" in f.message for f in r.errors)


def test_window_mismatch_and_structure_errors(built, tmp_path):
    cfg, plan, res, people = built
    d = example_dict()
    d["window"] = {"start": "2026-12-26", "end": "2027-01-02"}
    for k in ("holidays", "fair_days", "availability"):
        d.pop(k)
    d["shift_overrides"], d["name_aliases"] = {}, {}
    d["exclusions"] = {"team_patterns": [], "people": [], "name_patterns": []}
    r = audit_winter_plan(res.path, parse_config(d))
    assert [f.code for f in r.errors] == ["window_mismatch"]
    wb = openpyxl.Workbook()
    wb.save(tmp_path / "blank.xlsx")
    assert audit_winter_plan(tmp_path / "blank.xlsx", cfg).errors[0].code == "structure"
    (tmp_path / "junk.xlsx").write_bytes(b"not a zip")
    assert audit_winter_plan(tmp_path / "junk.xlsx", cfg).errors[0].code == "structure"
    wb = openpyxl.Workbook()
    wb.active.title = ww.SHEET_PLAN
    wb.save(tmp_path / "nohdr.xlsx")
    assert "Team member" in audit_winter_plan(tmp_path / "nohdr.xlsx", cfg).errors[0].message


def test_audit_is_deterministic_and_serialisable(built):
    cfg, plan, res, people = built
    a = audit_winter_plan(res.path, cfg).to_dict()
    b = audit_winter_plan(res.path, cfg).to_dict()
    assert a == b and json.dumps(a)
