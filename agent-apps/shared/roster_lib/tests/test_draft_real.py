"""Smoke tests against the real reference workbook (skipped when absent). Counts and structure only."""

import shutil
import zipfile
from datetime import date, timedelta

from openpyxl import load_workbook

from roster_lib import pkgdiff
from roster_lib.draft_builder import SNAPSHOT_SHEET, build_draft, read_snapshot_sheet
from roster_lib.roster_io import load_roster
from roster_lib.xlsx_patch import list_sheets
from draft_testkit import CYCLE, NOW, REAL, FakeFlag, FakePlan, needs_real


def real_copy(tmp_path):
    dst = tmp_path / "real_master.xlsx"
    shutil.copyfile(REAL, dst)  # never touch the reference file itself
    return dst


def real_plan(roster, n_people=5, n_days=21):
    start = date(2026, 3, 1)
    edits = {}
    for p in roster.people[:n_people]:
        for i in range(n_days):
            d = start + timedelta(days=i)
            edits[(p.name, d)] = "" if d.weekday() >= 5 else "Shift-1"
    return FakePlan(cycle=CYCLE, edits=edits,
                    flags=[FakeFlag("k1", "STAFFING_SHORTAGE", "ERROR", "m"), FakeFlag("k2", "CHANGE_NOTE", "INFO", "n")],
                    run_info={"library_version": "t"})


@needs_real
def test_real_file_draft_smoke(tmp_path):
    master = real_copy(tmp_path)
    roster = load_roster(master)
    plan = real_plan(roster)
    draft = tmp_path / "real_draft.xlsx"
    res = build_draft(master, draft, plan, now=NOW)
    assert res.cells_written == 105 and res.people == 5
    d = pkgdiff.diff_packages(master, draft)
    assert d.only_in_a == [] and len(d.only_in_b) == 6
    sheet_part = "xl/worksheets/sheet1.xml"
    assert set(d.byte_changed) <= {sheet_part, "xl/workbook.xml", "xl/_rels/workbook.xml.rels",
                                   "[Content_Types].xml", "xl/styles.xml", "docProps/app.xml"}
    with zipfile.ZipFile(draft) as z:
        states = {s.name: s.state for s in list_sheets(z)}
    assert states[SNAPSHOT_SHEET] == "veryHidden" and len(states) == 12
    assert len(read_snapshot_sheet(draft).cells) == 105
    r2 = load_roster(draft)
    assert len(r2.people) == len(roster.people) and r2.dates == roster.dates
    wb = load_workbook(draft)
    assert len(wb.sheetnames) == 12
