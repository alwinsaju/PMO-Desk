import json
import warnings
from datetime import date
from pathlib import Path

import openpyxl
import pytest

from analytics_fixtures import build_synthetic, edit_workbook, synthetic_plan
from winter_lib.analytics_formula_eval import Workbook as EvalWorkbook, check_workbook_formulas
from winter_lib.analytics_plan import AnalyticsPlan, solve_analytics_plan
from winter_lib.analytics_workbook import (
    AnalyticsWorkbookError, SNAPSHOT_SCHEMA, build_analytics_workbook, read_snapshot_sheet, read_snapshot_sidecar,
    roster_rows,
)


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    path = tmp_path_factory.mktemp("wb") / "analytics.xlsx"
    config, plan = build_synthetic(path)
    return path, config, plan


def load(path, data_only=True):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return openpyxl.load_workbook(path, data_only=data_only)


def test_tabs_order_and_hidden_snapshot(built):
    path, config, plan = built
    wb = load(path)
    assert wb.sheetnames == ["Daily View", "Winter Roster", "By Person", "_snapshot"]
    assert [ws.sheet_state for ws in wb] == ["visible", "visible", "visible", "veryHidden"]


def test_formulas_have_zero_errors_and_cached_values_equal_recalculated(built):
    path, config, plan = built
    chk = check_workbook_formulas(path)
    assert chk.ok, (chk.errors[:3], chk.mismatches[:3])
    assert chk.formula_count > 150


def test_winter_roster_rows_match_the_plan(built):
    path, config, plan = built
    ws = load(path)["Winter Roster"]
    hdr = [ws.cell(4, c).value for c in range(1, 11)]
    assert hdr[:9] == ["Date", "Day type", "Holiday / weekend", "Slot", "Start (IST)", "Hours (IST)", "Time zone",
                       "Assigned", "Check"]
    rows = [[ws.cell(r, c).value for c in range(1, 9)] for r in range(5, 5 + 42)]
    slots = [r for r in rows if r[3] != "On call"]
    ocs = [r for r in rows if r[3] == "On call"]
    assert len(slots) == 34 and len(ocs) == 8
    by = {(a.date, a.label): a.person for a in plan.assignments}
    for r in slots:
        assert by[(r[0].date(), r[3])] == r[7]
    assert {r[7] for r in rows if r[6] == "Mexico"} == {"Juliet"}
    assert [r[7] for r in ocs] == [plan.on_call[d] for d in config.dates]
    assert all(str(ws.cell(r, 9).value) == "OK" for r in range(5, 47))
    assert ws.column_dimensions["J"].hidden


def test_winter_roster_has_name_dropdowns_on_every_assigned_cell(built):
    path, config, plan = built
    ws = load(path, data_only=False)["Winter Roster"]
    dvs = [dv for dv in ws.data_validations.dataValidation if dv.type == "list"]
    assert len(dvs) == 1
    dv = dvs[0]
    assert "By Person" in dv.formula1 and "$C$7:$C$16" in dv.formula1
    assert "H5:H46" in str(dv.sqref)


def test_by_person_counts_and_rule_check_are_formula_driven(built):
    path, config, plan = built
    ws = load(path)["By Person"]
    f = load(path, data_only=False)["By Person"]
    assert f["N7"].value.startswith("=COUNTIFS(")
    for i, p in enumerate(config.people):
        r = 7 + i
        assert ws.cell(r, 3).value == p.display
        assert ws.cell(r, 14).value == plan.counts[p.display]  # Slots
        assert ws.cell(r, 16).value == plan.on_call_counts.get(p.display, 0)  # On-call days
        assert ws.cell(r, 20).value == "OK"
    rules = [(ws.cell(r, 2).value, ws.cell(r, 6).value, ws.cell(r, 7).value, ws.cell(r, 8).value) for r in range(20, 28)]
    assert [x[3] for x in rules] == ["PASS"] * 8
    assert rules[0][1] == 34 and rules[4][1] == 8
    assert "Mexico" in rules[7][0]


def test_daily_view_shows_who_works_each_slot(built):
    path, config, plan = built
    ws = load(path)["Daily View"]
    assert [ws.cell(5, c).value for c in (1, 3, 4, 5, 7)] == ["34 / 34", "30 / 30", "4 / 4", "8 / 8", "8 / 8"]
    by_day = {}
    for a in plan.assignments:
        by_day.setdefault((a.date, a.code), []).append(a.person)
    for k, d in enumerate(config.dates):
        r = 9 + k
        assert ws.cell(r, 2).value.date() == d
        for code, col in (("S1", 3), ("S2", 4), ("S3", 5), ("S4", 6)):
            names = by_day.get((d, code))
            assert ws.cell(r, col).value == ("\n".join(names) if names else "—")
        assert ws.cell(r, 7).value == plan.on_call[d]
        assert ws.cell(r, 8).value.split(" / ")[0] == ws.cell(r, 8).value.split(" / ")[1]
    hdr = ws.cell(8, 3).value
    assert "S1" in hdr and "8AM" in hdr and "08:00" in hdr


def test_snapshot_sheet_and_sidecar_agree_and_carry_the_plan_hash(built):
    path, config, plan = built
    sheet = read_snapshot_sheet(path)
    side = read_snapshot_sidecar(path)
    assert sheet is not None and side is not None
    assert sheet.digest() == side.digest()
    assert sheet.meta["plan_hash"] == plan.plan_hash != ""
    assert len(sheet.rows) == 42
    raw = json.loads(Path(str(path) + ".snapshot.json").read_text(encoding="utf-8"))
    assert raw["schema"] == SNAPSHOT_SCHEMA
    assert {tuple(r[:3]) for r in raw["rows"] if r[0] == "oc"} == {("oc", d.isoformat(), "On call") for d in config.dates}


def test_notes_reach_the_workbook(built):
    path, config, plan = built
    ws = load(path)["Daily View"]
    text = " ".join(str(c.value) for row in ws.iter_rows() for c in row if c.value)
    assert "available Dec 28" in text and "5th slot" in text
    bp = load(path)["By Person"]
    notes = {bp.cell(7 + i, 21).value for i in range(10)}
    assert any("Available Dec 28" in (n or "") for n in notes)
    assert any("5th slot" in (n or "") for n in notes)


def test_availability_grid_is_written(built):
    path, config, plan = built
    ws = load(path)["By Person"]
    delta_row = 7 + [p.display for p in config.people].index("Delta")
    flags = [ws.cell(delta_row, 23 + j).value for j in range(8)]
    assert flags == ["No", "No", "No", "Yes", "Yes", "Yes", "No", "No"]


def test_edits_in_the_workbook_flow_through_the_formulas(built, tmp_path):
    path, config, plan = built
    first_slot = next(a for a in plan.assignments if a.person != "Alpha" and a.date == date(2026, 12, 26))
    other = next(a for a in plan.assignments if a.person == "Alpha" and a.date == date(2026, 12, 26))
    edited = edit_workbook(path, tmp_path / "e.xlsx", {(first_slot.date, first_slot.label): "Alpha"})
    ev = EvalWorkbook(edited)
    vals = ev.evaluate_all()
    res = {k: v for k, v in vals.items() if k[0] == "By Person"}
    rule_rows = {r: res[("By Person", r, 8)] for r in range(20, 28)}
    assert rule_rows[22] == "FAIL"  # double slot for Alpha
    assert rule_rows[20] == "PASS"  # all slots still filled
    assert rule_rows[21] == "FAIL"  # counts differ from the plan
    chk = res[("By Person", 7, 20)]
    assert chk == "Review"
    # blanking a slot shows Open and breaks the fill rule
    edited2 = edit_workbook(path, tmp_path / "e2.xlsx", {(other.date, other.label): None})
    vals2 = EvalWorkbook(edited2).evaluate_all()
    assert vals2[("By Person", 20, 8)] == "FAIL"
    assert vals2[("Daily View", 5, 1)] == "33 / 34"


def test_build_is_deterministic(tmp_path):
    config, plan = synthetic_plan()
    a = tmp_path / "a.xlsx"
    b = tmp_path / "b.xlsx"
    build_analytics_workbook(config, plan, a)
    build_analytics_workbook(config, plan, b)

    def dump(p):
        wb = load(p, data_only=False)
        return [[(c.coordinate, c.value) for row in ws.iter_rows() for c in row if c.value is not None] for ws in wb]

    assert dump(a) == dump(b)
    assert Path(str(a) + ".snapshot.json").read_text() == Path(str(b) + ".snapshot.json").read_text()


def test_infeasible_plan_is_refused_and_leaves_nothing(tmp_path):
    config, _ = synthetic_plan()
    bad = AnalyticsPlan(status="infeasible", problems=["no one is available"])
    out = tmp_path / "x.xlsx"
    with pytest.raises(AnalyticsWorkbookError, match="infeasible"):
        build_analytics_workbook(config, bad, out)
    assert not out.exists() and list(tmp_path.iterdir()) == []


def test_roster_rows_layout(built):
    path, config, plan = built
    rows = roster_rows(config, plan)
    assert len(rows) == 42
    assert [r.label for r in rows[:5]] == ["S1", "S2-A", "S2-B", "S3", "On call"]
    assert rows[4].start.strftime("%H:%M") == "06:00"
