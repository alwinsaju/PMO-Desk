import hashlib
import json
import zipfile
from datetime import date

import pytest
from openpyxl import load_workbook

from roster_lib.draft_builder import (
    FLAGS_SHEET,
    HOLIDAY_SHEET,
    RUNLOG_SHEET,
    SHIFT_SHEET,
    SNAPSHOT_SHEET,
    SUMMARY_SHEET,
    DraftBuildError,
    Snapshot,
    build_draft,
    flag_key,
    plan_cells,
    read_snapshot_sheet,
    read_snapshot_sidecar,
    sidecar_path_for,
)
from roster_lib.roster_io import load_roster
from roster_lib.xlsx_patch import list_sheets, load_sheet
from roster_lib.xlsx_sheets import SheetNameError, SheetSpec, add_sheets
from draft_testkit import (
    NOW,
    SHEET_PART,
    FakeFlag,
    FakePlan,
    assert_draft_package,
    grid,
    make_master,
    make_plan,
)

NEW_PARTS = [f"xl/worksheets/sheet{i}.xml" for i in range(3, 9)]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture()
def setup(tmp_path):
    info = make_master(tmp_path)
    plan = make_plan(info)
    draft = tmp_path / "out" / "draft.xlsx"
    res = build_draft(info.path, draft, plan, now=NOW)
    return info, plan, draft, res


def test_only_expected_parts_differ_from_master(setup):
    info, plan, draft, res = setup
    d = assert_draft_package(info.path, draft, NEW_PARTS)
    assert SHEET_PART in d.byte_changed
    for part in ("xl/sharedStrings.xml", "xl/calcChain.xml", "xl/threadedComments/threadedComment1.xml",
                 "xl/persons/person.xml", "docMetadata/LabelInfo.xml", "docProps/custom.xml",
                 "xl/worksheets/sheet2.xml", "xl/drawings/drawing1.xml"):
        assert part not in d.byte_changed
    assert sorted(res.added_parts) == sorted(NEW_PARTS)


def test_master_untouched(tmp_path):
    info = make_master(tmp_path)
    before = sha(info.path)
    build_draft(info.path, tmp_path / "d.xlsx", make_plan(info), now=NOW)
    assert sha(info.path) == before


def test_cells_written_and_everything_else_unchanged(setup):
    info, plan, draft, res = setup
    before, after = grid(info.path), grid(draft)
    for key, text in plan.edits.items():
        assert after[key] == text
    changed = {k for k in after if after[k] != before[k]}
    assert changed <= set(plan.edits)
    assert len(changed) > 0
    assert set(before) == set(after)


def test_snapshot_equals_plan_cells_sheet_and_sidecar(setup):
    info, plan, draft, res = setup
    snap = read_snapshot_sheet(draft)
    side = read_snapshot_sidecar(res.sidecar_path)
    assert res.sidecar_path == sidecar_path_for(draft)
    assert {(c.person, c.date): c.text for c in snap.cells} == plan.snapshot_cells()
    assert snap.core() == side.core()
    assert snap.digest() == side.digest() == res.snapshot_sha256
    roster = load_roster(info.path)
    for c in snap.cells:
        assert roster.address(roster.find(c.person)[0], c.date) == (c.row, c.col)
    assert [(c.row, c.date) for c in snap.cells] == sorted((c.row, c.date) for c in snap.cells)
    assert snap.meta["master_sha256"] == res.master_sha256 == sha(info.path)
    assert snap.meta["cycle"] == {"label": "Jan 2026", "start": "2026-01-04", "end": "2026-01-31",
                                  "rotation_sunday": "2026-01-04"}
    assert snap.meta["cell_count"] == len(plan.edits) and snap.meta["sheet_name"] == "PDT Operate"
    assert snap.meta["plan_hash"] == res.plan_hash
    # multi-line text and empty text survive the sheet
    by = snap.cell_map()
    assert by[(info.people[0].name, date(2026, 1, 20))].text == "Shift Swap\nNS"
    assert by[(info.people[0].name, date(2026, 1, 4))].text == ""
    # sidecar carries the flags the plan raised
    assert [f["key"] for f in side.flags] == ["k-err", "k-warn", "k-info"]


def test_sheets_added_with_expected_state_and_order(setup):
    info, plan, draft, res = setup
    with zipfile.ZipFile(draft) as z:
        sheets = list_sheets(z)
    names = [(s.name, s.state) for s in sheets]
    assert names[:2] == [("PDT Operate", "visible"), ("Notes", "hidden")]
    assert names[2:] == [(SUMMARY_SHEET, "visible"), (SHIFT_SHEET, "visible"), (HOLIDAY_SHEET, "visible"),
                         (FLAGS_SHEET, "visible"), (RUNLOG_SHEET, "visible"), (SNAPSHOT_SHEET, "veryHidden")]
    wb = load_workbook(draft)
    assert wb[SNAPSHOT_SHEET].sheet_state == "veryHidden"


def test_flags_sheet_colours_and_columns(setup):
    info, plan, draft, res = setup
    ws = load_workbook(draft)[FLAGS_SHEET]
    assert [c.value for c in ws[1]][:5] == ["Severity", "Kind", "Person", "Date", "Message"]
    rows = {ws.cell(r, 1).value: r for r in range(2, ws.max_row + 1)}
    assert set(rows) == {"ERROR", "WARNING", "INFO"}
    red, amber, plain = rows["ERROR"], rows["WARNING"], rows["INFO"]
    assert ws.cell(red, 5).fill.fgColor.rgb == "FFFFC7CE"
    assert ws.cell(red, 1).fill.fgColor.rgb == "FFFFC7CE"
    assert ws.cell(amber, 5).fill.fgColor.rgb == "FFFFEB9C"
    assert ws.cell(plain, 5).fill.fill_type is None
    assert ws.cell(amber, 4).value.date() == date(2026, 1, 17)
    assert ws.cell(amber, 3).value == info.people[1].name
    assert ws.cell(red, 8).value == "k-err"
    # the Origin column is appended (older readers keep working: columns 1-8 are unchanged)
    assert ws.cell(1, 9).value == "Origin"
    assert ws.cell(amber, 9).value == "master" and ws.cell(red, 9).value is None
    assert ws.freeze_panes == "A2"
    assert [ws.cell(r, 1).value for r in range(2, 5)] == ["ERROR", "WARNING", "INFO"]


def test_summary_and_other_sheets_content(setup):
    info, plan, draft, res = setup
    wb = load_workbook(draft)
    texts = {str(c.value) for row in wb[SUMMARY_SHEET].iter_rows() for c in row if c.value is not None}
    assert "Cells written into the roster" in texts and str(len(plan.edits)) in texts
    assert "HOL check on the draft" in texts and "HOL_ON_WEEKLY_OFF" in texts
    assert "HOL cells written by this run" in texts
    assert "HOL cells already in the master (kept, not written by this run)" in texts
    assert any(t.startswith("Existing roster findings 2026") for t in texts)
    assert "MISSING" in texts  # existing roster finding
    assert any("cycle ends inside the roster file" in t for t in texts)
    sc = wb[SHIFT_SHEET]
    assert [c.value for c in sc[2]][:3] == [info.people[0].name, "S1", "S2"]
    assert sc.cell(2, 4).value.date() == date(2026, 1, 4)
    ha = wb[HOLIDAY_SHEET]
    assert ha.cell(2, 2).value == "Test Day"
    assert ha.cell(2, 8).value == info.people[0].name and ha.cell(2, 10).value == info.people[2].name
    assert "1 -> 2" in ha.cell(2, 13).value


def test_year_boundary_note_with_remainder(tmp_path):
    info = make_master(tmp_path)
    plan = make_plan(info)
    plan.remainder_edits = {(info.people[0].name, date(2026, 3, 1)): "Shift-1"}
    plan.run_info = {**plan.run_info, "year_boundary": {"crosses": True, "remainder": {"start": "2026-03-01", "end": "2026-03-07"}}}
    draft = tmp_path / "d.xlsx"
    build_draft(info.path, draft, plan, now=NOW)
    texts = [str(c.value) for row in load_workbook(draft)[SUMMARY_SHEET].iter_rows() for c in row if c.value]
    note = next(t for t in texts if t.startswith("The roster file ends on"))
    assert "2026-02-14" in note and "2026-03-01 to 2026-03-07" in note and "1 cells" in note
    # remainder cells are NOT written into the draft or its snapshot
    assert (info.people[0].name, date(2026, 3, 1)) not in {(c.person, c.date) for c in read_snapshot_sheet(draft).cells}


def test_run_log_contents(tmp_path):
    info = make_master(tmp_path)
    matrix, pto, cfg = tmp_path / "m.xlsx", tmp_path / "p.xlsx", tmp_path / "c.json"
    matrix.write_bytes(b"matrix")
    pto.write_bytes(b"pto")
    cfg.write_bytes(b"{}")
    draft = tmp_path / "d.xlsx"
    res = build_draft(info.path, draft, make_plan(info), matrix_path=matrix, pto_path=pto, config_path=cfg,
                      extra_run_log={"Operator note": "hello", "Extra": {"a": 1}}, now=NOW)
    rows = [[c.value for c in r] for r in load_workbook(draft)[RUNLOG_SHEET].iter_rows()]
    kv = {r[0]: r[1:] for r in rows if r[0]}
    assert kv["Master file"] == ["master.xlsx", res.master_sha256]
    assert kv["Holiday matrix"] == ["m.xlsx", hashlib.sha256(b"matrix").hexdigest()]
    assert kv["PTO import"][1] == hashlib.sha256(b"pto").hexdigest()
    assert kv["Rotation config"][1] == hashlib.sha256(b"{}").hexdigest()
    assert kv["Created (UTC)"][0].startswith("2026-02-01T12:00:00")
    assert kv["Cycle"][0] == "Jan 2026" and kv["Seed used"][0] == 42 and kv["Config version"][0] == 3
    assert kv["Library commit"][0] == "abc1234" and kv["Library version"][0] == "test/1"
    assert kv["Plan hash (sha256)"][0] == res.plan_hash
    assert "pending" in kv["Approver"][0]
    assert kv["Operator note"][0] == "hello" and json.loads(kv["Extra"][0]) == {"a": 1}


def test_run_log_without_optional_inputs(setup):
    info, plan, draft, res = setup
    kv = {r[0].value: r[1].value for r in load_workbook(draft)[RUNLOG_SHEET].iter_rows() if r[0].value}
    assert kv["Holiday matrix"] == "(not used)"


def test_idempotent_cell_content(tmp_path):
    info = make_master(tmp_path)
    plan = make_plan(info)
    a, b = tmp_path / "a.xlsx", tmp_path / "b.xlsx"
    ra = build_draft(info.path, a, plan, now=NOW)
    rb = build_draft(info.path, b, plan, now=NOW.replace(hour=15))
    assert ra.snapshot_sha256 == rb.snapshot_sha256
    assert (tmp_path / "a.xlsx.snapshot.json").read_bytes() == (tmp_path / "b.xlsx.snapshot.json").read_bytes()
    for sheet in (SUMMARY_SHEET, SHIFT_SHEET, HOLIDAY_SHEET, FLAGS_SHEET, SNAPSHOT_SHEET, "PDT Operate"):
        la, lb = load_sheet(a, sheet), load_sheet(b, sheet)
        assert {k: c.text for k, c in la.cells.items()} == {k: c.text for k, c in lb.cells.items()}
    with zipfile.ZipFile(a) as za, zipfile.ZipFile(b) as zb:
        differing = [n for n in za.namelist() if za.read(n) != zb.read(n)]
    assert differing == ["xl/worksheets/sheet7.xml"]  # only the Run log (timestamp)


def test_falls_back_to_plan_edits_without_snapshot_cells(tmp_path):
    info = make_master(tmp_path)
    plan = make_plan(info)
    plan.with_snapshot_cells = False
    assert getattr(plan, "snapshot_cells", None) is None
    assert plan_cells(plan) == plan.edits
    draft = tmp_path / "d.xlsx"
    build_draft(info.path, draft, plan, now=NOW)
    assert {(c.person, c.date): c.text for c in read_snapshot_sheet(draft).cells} == plan.edits


def test_snapshot_cells_decide_what_is_written(tmp_path):
    info = make_master(tmp_path)
    plan = make_plan(info)
    full = dict(plan.edits)
    keep = dict(list(full.items())[:10])
    plan.snapshot_cells = lambda: keep  # a plan that writes fewer cells than its edits
    draft = tmp_path / "d.xlsx"
    res = build_draft(info.path, draft, plan, now=NOW)
    assert res.cells_written == 10
    assert {(c.person, c.date) for c in read_snapshot_sheet(draft).cells} == set(keep)


def test_collision_with_existing_sheet_name(tmp_path):
    info = make_master(tmp_path)
    colliding = tmp_path / "coll.xlsx"
    add_sheets(info.path, colliding, [SheetSpec("flags", [["x"]])])
    draft = tmp_path / "out" / "d.xlsx"
    with pytest.raises(SheetNameError):
        build_draft(colliding, draft, make_plan(info), now=NOW)
    assert not draft.exists() and not (tmp_path / "out" / "d.xlsx.snapshot.json").exists()
    assert [p.name for p in (tmp_path / "out").iterdir()] == []  # no temp files left


def test_unknown_person_or_date_rejected_and_nothing_written(tmp_path):
    info = make_master(tmp_path)
    draft = tmp_path / "d.xlsx"
    plan = make_plan(info)
    plan.edits[("Nobody Here", date(2026, 1, 5))] = "Shift-1"
    with pytest.raises(DraftBuildError, match="Nobody Here"):
        build_draft(info.path, draft, plan, now=NOW)
    plan = make_plan(info)
    plan.edits[(info.people[0].name, date(2030, 1, 5))] = "Shift-1"
    with pytest.raises(DraftBuildError, match="outside the roster"):
        build_draft(info.path, draft, plan, now=NOW)
    assert not draft.exists()


def test_draft_must_not_be_master(tmp_path):
    info = make_master(tmp_path)
    before = sha(info.path)
    with pytest.raises(DraftBuildError, match="different file"):
        build_draft(info.path, info.path, make_plan(info), now=NOW)
    assert sha(info.path) == before


def test_person_name_matching_is_case_insensitive(tmp_path):
    info = make_master(tmp_path)
    name = info.people[0].name
    plan = FakePlan(cycle=make_plan(info).cycle, edits={(name.upper(), date(2026, 1, 5)): "Shift-3"})
    draft = tmp_path / "d.xlsx"
    build_draft(info.path, draft, plan, now=NOW)
    assert grid(draft)[(name, date(2026, 1, 5))] == "Shift-3"


def test_empty_plan_builds_a_draft_with_empty_snapshot(tmp_path):
    info = make_master(tmp_path)
    plan = FakePlan(cycle=make_plan(info).cycle, edits={})
    draft = tmp_path / "d.xlsx"
    res = build_draft(info.path, draft, plan, now=NOW)
    assert res.cells_written == 0 and read_snapshot_sheet(draft).cells == []
    assert grid(draft) == grid(info.path)


def test_flag_key_fallback_for_flags_without_key():
    class F:
        kind, severity, message, person, date, team, shift = "K", "ERROR", "m", "p", date(2026, 1, 1), None, None

    assert "K" in flag_key(F) and "2026-01-01" in flag_key(F)
    assert flag_key({"key": "x"}) == "x"


def test_snapshot_roundtrip_dict():
    s = Snapshot({"a": 1}, [])
    assert Snapshot.from_dict(s.to_dict()).core() == s.core()


def test_works_with_the_real_plan_and_flag_types(tmp_path):
    """Duck typing check against cycle_builder.Plan / Flag (no .key needed: a composite key is used)."""
    from roster_lib.config import RotationConfig
    from roster_lib.cycle_builder import Flag, Plan

    info = make_master(tmp_path)
    fake = make_plan(info)
    plan = Plan(
        cycle=fake.cycle, edits=dict(fake.edits), remainder_edits={}, shift_changes=fake.shift_changes,
        holiday_assignments=fake.holiday_assignments,
        flags=[Flag("STAFFING_SHORTAGE", "ERROR", "short", None, date(2026, 1, 14), "DIS", "S1"),
               Flag("CHANGE_NOTE", "INFO", "note")],
        counters_before={}, counters_after={}, config_after=RotationConfig(), run_info=fake.run_info,
        existing_roster_findings=fake.existing_roster_findings)
    draft = tmp_path / "d.xlsx"
    res = build_draft(info.path, draft, plan, now=NOW)
    assert res.cells_written == len(plan.edits) and res.flags_by_severity == {"ERROR": 1, "INFO": 1}
    cells = {(c.person, c.date): c.text for c in read_snapshot_sheet(draft).cells}
    assert cells == dict(getattr(plan, "snapshot_cells", lambda: plan.edits)())
