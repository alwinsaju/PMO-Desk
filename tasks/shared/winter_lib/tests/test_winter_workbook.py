import json
import re
import zipfile
from datetime import date

import openpyxl
import pytest

from formula_eval import Evaluator
from winter_lib import winter_plan as wp
from winter_lib import winter_workbook as ww
from winter_lib.winter_snapshot import (SnapshotError, read_snapshot_sheet, read_snapshot_sidecar, sidecar_path_for)
from winter_lib.winter_types import PlanPerson, display_code
from winter_testkit import make_people, person, small_cfg

LOGO = ww.DEFAULT_LOGO


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    cfg = small_cfg()
    people = make_people(n_dis=7)
    people[0] = PlanPerson(people[0].name, "DIS", "Hyd", "S1", "Complaints", "history")
    plan = wp.solve_winter_plan(people, cfg)
    path = tmp_path_factory.mktemp("wb") / "winter.xlsx"
    res = ww.write_winter_workbook(path, plan, cfg)
    return cfg, plan, res


def addr(ws, name):
    for row in ws.iter_rows():
        for c in row:
            if c.value == name:
                return c.row, c.column
    raise KeyError(name)


def test_sheets_order_hidden_snapshot_and_sidecar(built):
    cfg, plan, res = built
    wb = openpyxl.load_workbook(res.path)
    assert wb.sheetnames == [ww.SHEET_COVERAGE, ww.SHEET_DAILY, ww.SHEET_PLAN, "_snapshot"]
    assert [wb[n].sheet_state for n in wb.sheetnames] == ["visible", "visible", "visible", "veryHidden"]
    sheet_snap = read_snapshot_sheet(res.path)
    side = read_snapshot_sidecar(res.path)
    assert sheet_snap.digest() == side.digest() == res.snapshot.digest()
    assert res.sidecar_path == sidecar_path_for(res.path)
    assert sheet_snap.meta["plan_hash"] == plan.plan_hash() and sheet_snap.meta["config_hash"] == cfg.config_hash()
    assert sheet_snap.meta["window"]["start"] == "2026-12-25" and len(sheet_snap.meta["window"]["days"]) == 8
    assert len(sheet_snap.cells) == len(plan.people) * 8


def test_every_formula_recalculates_with_zero_errors_and_matches_the_cached_values(built):
    _, _, res = built
    ev = Evaluator(res.path)
    problems = ev.check()
    assert problems == []
    assert ev.checked > 400


def test_plan_grid_matches_the_plan_and_snapshot(built):
    cfg, plan, res = built
    ws = openpyxl.load_workbook(res.path)[ww.SHEET_PLAN]
    snap = read_snapshot_sheet(res.path)
    by = snap.cell_map()
    for p in plan.people:
        r = res.layout.group_of(p.team).rows[p.name]
        assert ws.cell(row=r, column=ww.C_NAME + 1).value == p.name
        assert ws.cell(row=r, column=ww.C_USUAL + 1).value == display_code(p.usual_shift)
        for k, d in enumerate(plan.window):
            written = ws.cell(row=r, column=ww.C_DAY0 + 1 + k).value
            assert (written or "") == display_code(plan.code(p.name, d))
            sc = by[(p.name, d)]
            assert (sc.text, sc.row, sc.col) == (written or "", r, ww.C_DAY0 + 1 + k)


def test_dropdown_validation_and_conditional_formats(built):
    cfg, plan, res = built
    ws = openpyxl.load_workbook(res.path)[ww.SHEET_PLAN]
    dvs = ws.data_validations.dataValidation
    assert len(dvs) == sum(1 for g in res.layout.groups if g.people)
    for dv in dvs:
        assert dv.type == "list" and dv.errorStyle in (None, "stop") and dv.allow_blank and dv.showErrorMessage
        assert dv.formula1.startswith("$") and ":" in dv.formula1
    # the list source is the shift key on the same sheet
    first = res.layout.key_first_row
    assert ws.cell(row=first, column=res.layout.key_col + 1).value == "Shift-1"
    assert ws.cell(row=first + len(res.layout.key_order) - 1, column=res.layout.key_col + 1).value == "8am-5pm CST"
    assert len(list(ws.conditional_formatting)) > 10


def test_formulas_present_in_the_derived_cells(built):
    cfg, plan, res = built
    ws = openpyxl.load_workbook(res.path)[ww.SHEET_PLAN]
    g = res.layout.group_of("DIS")
    r = g.first
    dw = ws.cell(row=r, column=res.layout.dw_col + 1).value
    assert dw.startswith("=COUNTIF(") and '"?*"' in dw
    fair = ws.cell(row=r, column=res.layout.fair_col + 1).value
    assert fair.count("COUNTIF") == 4  # Dec 25, 26, 27 and Jan 1
    hdr = ws.cell(row=g.header_row, column=ww.C_DAY0 + 1).value
    assert hdr.startswith("=COUNTIF(")
    total = ws.cell(row=res.layout.total_row, column=ww.C_DAY0 + 1).value
    assert total.startswith("=") and total.count("+") == len(res.layout.groups) - 1


def test_daily_roster_names_land_in_the_right_lane_and_team(built):
    cfg, plan, res = built
    ev = Evaluator(res.path)
    ws = openpyxl.load_workbook(res.path)[ww.SHEET_DAILY]
    hdr = {ws.cell(row=4, column=c).value: c for c in range(4, 4 + len(res.layout.groups))}
    for k, d in enumerate(plan.window):
        top = 6 + 4 * k
        assert ws.cell(row=top, column=2).value.date() == d
        for li, lane in enumerate(("Morning", "Evening", "Night/US")):
            for g in res.layout.groups:
                if not g.people:
                    continue
                expect = [p.name for p in g.people if plan.code(p.name, d) and wp.lane_name(plan.code(p.name, d)) == lane]
                got = ev.value(ww.SHEET_DAILY, top + li, hdr[g.label])
                assert [x for x in (got or "").split("\n") if x] == expect
        for g in res.layout.groups:
            assert ev.value(ww.SHEET_DAILY, top + 3, hdr[g.label]) == plan.headcount(g.team, d)
        assert ev.value(ww.SHEET_DAILY, top + 3, 4 + len(res.layout.groups)) == sum(plan.headcount(g.team, d)
                                                                                   for g in res.layout.groups)


def test_coverage_sheet_values(built):
    cfg, plan, res = built
    ev = Evaluator(res.path)
    ws = openpyxl.load_workbook(res.path)[ww.SHEET_COVERAGE]
    first = 10
    for i, g in enumerate(res.layout.groups):
        r = first + i
        assert ws.cell(row=r, column=2).value == g.label
        assert ev.value(ww.SHEET_COVERAGE, r, 3) == len(g.people)
        assert ev.value(ww.SHEET_COVERAGE, r, 4) == g.min_per_day
        assert [ev.value(ww.SHEET_COVERAGE, r, 5 + k) for k in range(8)] == [plan.headcount(g.team, d) for d in plan.window]
        status = ev.value(ww.SHEET_COVERAGE, r, 15)
        if g.min_per_day:
            assert status == f"✓ Min {g.min_per_day}/day met every day"
    # KPI tiles: row 5
    tiles = [ev.value(ww.SHEET_COVERAGE, 5, c) for c in (2, 5, 7, 9, 11)]
    assert tiles[0] == f"{len(plan.people)} / {len(plan.people)}"
    assert tiles[1] == "40 / 40"  # five teams with a minimum x 8 days
    assert tiles[2] == 0
    assert tiles[4] == sum(max(0, n - 3) for n in plan.day_counts().values())


def test_cf_heatmap_and_status_rules_on_coverage(built):
    _, _, res = built
    ws = openpyxl.load_workbook(res.path)[ww.SHEET_COVERAGE]
    ranges = {str(cf.sqref): [r.formula for r in cf.rules] for cf in ws.conditional_formatting}
    heat = ranges["E10:L21"]
    assert heat[0] == ["E10=0"] and heat[1] == ["E10>=$D10"] and heat[2] == ["E10<$D10"]
    assert ws["D12"].number_format == '[=0]"best effort";0'


def test_look_and_feel(built):
    _, _, res = built
    wb = openpyxl.load_workbook(res.path)
    for name in (ww.SHEET_COVERAGE, ww.SHEET_DAILY, ww.SHEET_PLAN):
        ws = wb[name]
        assert len(ws._images) == 1  # the logo
        assert ws["C1"].fill.fgColor.rgb.upper().endswith("282728") and ws["A3"].fill.fgColor.rgb.upper().endswith("86BC25")
        assert ws["A1"].fill.fgColor.rgb.upper().endswith("FFFFFF")
        assert ws.sheet_view.showGridLines is False
    fonts = {c.font.name for row in wb[ww.SHEET_PLAN].iter_rows(min_row=7, max_row=20) for c in row if c.value is not None}
    assert fonts == {"Arial"}
    assert wb[ww.SHEET_PLAN].freeze_panes == "C7"


def test_editing_the_plan_flows_into_the_other_tabs(built, tmp_path):
    """Simulates an Excel re-save (openpyxl drops cached values): change a cell, recalculate with the evaluator."""
    cfg, plan, res = built
    wb = openpyxl.load_workbook(res.path)
    ws = wb[ww.SHEET_PLAN]
    g = res.layout.group_of("DIS")
    victim = next(p for p in g.people if plan.days_of(p.name))
    r = g.rows[victim.name]
    # clear one planned day, and put the person on NS (night lane) on a day off
    worked = plan.days_of(victim.name)
    off = next(d for d in plan.window if d not in worked)
    k_on, k_off = plan.window.index(worked[0]), plan.window.index(off)
    ws.cell(row=r, column=ww.C_DAY0 + 1 + k_on).value = None
    ws.cell(row=r, column=ww.C_DAY0 + 1 + k_off).value = "NS"
    edited = tmp_path / "edited.xlsx"
    wb.save(edited)
    ev = Evaluator(str(edited))
    base = plan.headcount("DIS", worked[0])
    assert ev.value(ww.SHEET_COVERAGE, 10, 5 + k_on) == base - 1
    assert ev.value(ww.SHEET_COVERAGE, 10, 5 + k_off) == plan.headcount("DIS", off) + 1
    daily = openpyxl.load_workbook(edited)[ww.SHEET_DAILY]
    team_col = 4  # DIS is the first team
    night_row = 6 + 4 * k_off + 2
    assert victim.name in (ev.value(ww.SHEET_DAILY, night_row, team_col) or "").split("\n")
    assert ev.value(ww.SHEET_PLAN, r, res.layout.dw_col + 1) == len(worked)  # one removed, one added
    assert daily  # still loads


def test_deterministic_sheet_xml(built, tmp_path):
    cfg, plan, res = built
    other = ww.write_winter_workbook(tmp_path / "again.xlsx", plan, cfg)

    def sheets(p):
        with zipfile.ZipFile(p) as z:
            return {n: z.read(n) for n in z.namelist() if n.startswith("xl/worksheets/") or n == "xl/workbook.xml"}

    assert sheets(res.path) == sheets(other.path)
    assert other.snapshot.digest() == res.snapshot.digest()


def test_window_of_five_days_and_empty_team(tmp_path):
    d = json.load(open(ww.__file__.replace("winter_workbook.py", "examples/winter_config.example.json"), encoding="utf-8"))
    d["window"] = {"start": "2027-12-27", "end": "2027-12-31"}
    for k in ("holidays", "fair_days"):
        d.pop(k)
    d["availability"], d["shift_overrides"], d["name_aliases"] = {}, {}, {}
    d["exclusions"] = {"team_patterns": [], "people": [], "name_patterns": []}
    from winter_lib.winter_config import parse_config
    cfg = parse_config(d)
    plan = wp.solve_winter_plan(make_people(), cfg)  # Lab and others have nobody at all
    res = ww.write_winter_workbook(tmp_path / "w5.xlsx", plan, cfg)
    ev = Evaluator(res.path)
    assert ev.check() == []
    ws = openpyxl.load_workbook(res.path)[ww.SHEET_COVERAGE]
    lab = next(r for r in range(10, 22) if ws.cell(row=r, column=2).value == "Lab")
    assert ev.value(ww.SHEET_COVERAGE, lab, 4 + 5 + 3) == "Nobody on 5 day(s) · best effort (3 days each, none added)"


def test_formula_too_long_is_refused(tmp_path):
    cfg = small_cfg()
    people = [person(f"Big{i:03d} Person", "DIS", "S1") for i in range(100)]
    plan = wp.WinterPlan(tuple(cfg.days), people, {})
    with pytest.raises(ValueError, match="too many people"):
        ww.write_winter_workbook(tmp_path / "big.xlsx", plan, cfg)


def test_no_sidecar_when_disabled_and_missing_logo_ok(tmp_path):
    cfg = small_cfg()
    plan = wp.solve_winter_plan(make_people(), cfg)
    res = ww.write_winter_workbook(tmp_path / "x.xlsx", plan, cfg, logo_path=None, sidecar=False)
    assert res.sidecar_path is None and read_snapshot_sidecar(res.path) is None
    assert len(openpyxl.load_workbook(res.path)[ww.SHEET_PLAN]._images) == 0


def test_snapshot_errors(tmp_path):
    wb = openpyxl.Workbook()
    wb.active.title = "_snapshot"
    wb.active["A1"] = "something else"
    wb.save(tmp_path / "bad.xlsx")
    with pytest.raises(SnapshotError):
        read_snapshot_sheet(tmp_path / "bad.xlsx")
    wb = openpyxl.Workbook()
    wb.save(tmp_path / "none.xlsx")
    assert read_snapshot_sheet(tmp_path / "none.xlsx") is None
    (tmp_path / "bad.xlsx.snapshot.json").write_text("{nope", encoding="utf-8")
    with pytest.raises(SnapshotError):
        read_snapshot_sidecar(tmp_path / "bad.xlsx")
