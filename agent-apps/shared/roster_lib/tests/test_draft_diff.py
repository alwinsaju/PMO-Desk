import json
import shutil
import zipfile
from datetime import date, datetime

import pytest
from openpyxl import load_workbook

from roster_lib.draft_builder import build_draft, read_snapshot_sheet
from roster_lib.draft_diff import CellChange, DiffIssue, default_flag_delta, diff_draft
from roster_lib.xlsx_patch import patch_workbook
from draft_testkit import (
    NOW,
    SHEET,
    FakeFlag,
    a1,
    edit_cells_with_openpyxl,
    grid,
    local_flag_delta,
    make_master,
    make_plan,
    pmo_save,
)


@pytest.fixture()
def env(tmp_path):
    info = make_master(tmp_path)
    plan = make_plan(info)
    draft = tmp_path / "draft.xlsx"
    res = build_draft(info.path, draft, plan, now=NOW)
    return info, plan, draft, res, tmp_path


def codes(diff, severity=None):
    return sorted(i.code for i in diff.issues if severity is None or i.severity == severity)


def person(info, i):
    return info.people[i].name


def resave(draft, dst, tmp, mutate):
    """Excel-like save: openpyxl load, mutate, save; sidecar copied alongside."""
    wb = load_workbook(draft)
    mutate(wb)
    wb.save(dst)
    shutil.copyfile(str(draft) + ".snapshot.json", str(dst) + ".snapshot.json")
    return dst


def test_no_edits_gives_empty_diff(env):
    info, plan, draft, res, tmp = env
    saved = pmo_save(draft, tmp / "saved.xlsx", {})
    d = diff_draft(saved, master_path=info.path)
    assert d.changes == [] and d.outside_snapshot_changes == [] and d.outside_checked
    assert d.blocking_issues == [] and d.snapshot_source == "sheet"
    assert len(d.snapshot) == len(plan.edits) and d.snapshot_digest == res.snapshot_sha256
    assert not d.has_changes and codes(d) == []


def test_user_edits_detected_with_before_after_in_row_date_order(env):
    info, plan, draft, res, tmp = env
    p0, p3 = person(info, 0), person(info, 3)
    edits = {
        (p3, date(2026, 1, 7)): "Shift-9",
        (p0, date(2026, 1, 20)): "",
        (p0, date(2026, 1, 6)): "COMP",
        (p3, date(2026, 1, 5)): "Shift-3",
    }
    saved = pmo_save(draft, tmp / "saved.xlsx", edits)
    d = diff_draft(saved, master_path=info.path)
    got = [(c.person, c.date, c.before, c.after) for c in d.changes]
    assert got == [
        (p0, date(2026, 1, 6), plan.edits[(p0, date(2026, 1, 6))], "COMP"),
        (p0, date(2026, 1, 20), "Shift Swap\nNS", ""),
        (p3, date(2026, 1, 5), plan.edits[(p3, date(2026, 1, 5))], "Shift-3"),
        (p3, date(2026, 1, 7), plan.edits[(p3, date(2026, 1, 7))], "Shift-9"),
    ]
    assert all(isinstance(c, CellChange) for c in d.changes)
    assert d.changes[0].row == info.people[0].row and d.changes[2].row == info.people[3].row
    assert d.outside_snapshot_changes == [] and d.blocking_issues == []
    assert d.has_changes


def test_edit_that_restores_the_snapshot_value_is_no_change(env):
    info, plan, draft, res, tmp = env
    p0 = person(info, 0)
    saved = pmo_save(draft, tmp / "s1.xlsx", {(p0, date(2026, 1, 6)): "COMP"})
    saved2 = pmo_save(saved, tmp / "s2.xlsx", {(p0, date(2026, 1, 6)): plan.edits[(p0, date(2026, 1, 6))]})
    assert diff_draft(saved2, master_path=info.path).changes == []


def test_changes_outside_snapshot_cells_are_reported_separately(env):
    info, plan, draft, res, tmp = env
    outsider = person(info, 9)  # not in the plan
    in_plan_other_date = (person(info, 1), date(2026, 1, 2))  # in-plan person, date before the cycle
    master_vals = grid(info.path)
    saved = pmo_save(draft, tmp / "saved.xlsx", {(outsider, date(2026, 1, 9)): "Shift-5", in_plan_other_date: "OC"})
    d = diff_draft(saved, master_path=info.path)
    assert d.changes == []
    got = [(c.person, c.date, c.before, c.after) for c in d.outside_snapshot_changes]
    assert got == [
        (in_plan_other_date[0], date(2026, 1, 2), master_vals[in_plan_other_date], "OC"),
        (outsider, date(2026, 1, 9), master_vals[(outsider, date(2026, 1, 9))], "Shift-5"),
    ]
    assert d.has_changes
    # without the master the outside edits cannot be seen: said so
    d2 = diff_draft(saved)
    assert d2.outside_snapshot_changes == [] and not d2.outside_checked and "OUTSIDE_NOT_CHECKED" in codes(d2, "info")


def test_snapshot_sheet_deleted_falls_back_to_sidecar(env):
    info, plan, draft, res, tmp = env
    p = person(info, 2)

    def mutate(wb):
        del wb["_snapshot"]
        wb[SHEET][a1(info, p, date(2026, 1, 8))].value = "Shift-8"

    saved = resave(draft, tmp / "saved.xlsx", tmp, mutate)
    d = diff_draft(saved, master_path=info.path)
    assert d.snapshot_source == "sidecar" and "SNAPSHOT_SHEET_MISSING" in codes(d, "warning")
    assert [(c.person, c.date, c.after) for c in d.changes] == [(p, date(2026, 1, 8), "Shift-8")]
    assert d.blocking_issues == []


def test_sidecar_missing_is_a_warning_and_both_missing_is_an_error(env):
    info, plan, draft, res, tmp = env
    saved = pmo_save(draft, tmp / "saved.xlsx", {}, sidecar=False)
    d = diff_draft(saved)
    assert d.snapshot_source == "sheet" and "SIDECAR_MISSING" in codes(d, "warning") and d.blocking_issues == []
    wb = load_workbook(draft)
    del wb["_snapshot"]
    bare = tmp / "bare.xlsx"
    wb.save(bare)
    d = diff_draft(bare, master_path=info.path)
    assert d.snapshot_source is None and "SNAPSHOT_MISSING" in codes(d, "error") and d.changes == []


def test_explicit_sidecar_path(env):
    info, plan, draft, res, tmp = env
    saved = pmo_save(draft, tmp / "saved.xlsx", {}, sidecar=False)
    d = diff_draft(saved, sidecar_path=res.sidecar_path)
    assert "SIDECAR_MISSING" not in codes(d)


def test_unreadable_sidecar_is_a_warning(env):
    info, plan, draft, res, tmp = env
    saved = pmo_save(draft, tmp / "saved.xlsx", {})
    (tmp / "saved.xlsx.snapshot.json").write_text("{not json", encoding="utf-8")
    d = diff_draft(saved)
    assert "SIDECAR_UNREADABLE" in codes(d, "warning") and d.snapshot_source == "sheet" and d.blocking_issues == []


def test_tamper_sidecar_disagrees_with_sheet(env):
    info, plan, draft, res, tmp = env
    saved = pmo_save(draft, tmp / "saved.xlsx", {})
    side = tmp / "saved.xlsx.snapshot.json"
    data = json.loads(side.read_text(encoding="utf-8"))
    data["cells"][3][2] = "Shift-7"
    side.write_text(json.dumps(data), encoding="utf-8")
    d = diff_draft(saved, master_path=info.path)
    assert "SNAPSHOT_TAMPERED" in codes(d, "error")
    assert d.snapshot_source == "sidecar"
    assert any(c.before == "Shift-7" for c in d.changes)  # the tampered value shows up as a difference


def test_tamper_sheet_disagrees_with_sidecar(env):
    info, plan, draft, res, tmp = env
    snap = read_snapshot_sheet(draft)
    first_data = 1 + len(snap.meta) + 1 + 1  # marker row + meta rows + header row, then the first data row
    saved = tmp / "saved.xlsx"
    patch_workbook(draft, saved, "_snapshot", {(first_data, 3): "Shift-7"})
    shutil.copyfile(str(draft) + ".snapshot.json", str(saved) + ".snapshot.json")
    d = diff_draft(saved, master_path=info.path)
    assert "SNAPSHOT_TAMPERED" in codes(d, "error")
    assert "1 snapshot cell(s) differ" in next(i.message for i in d.issues if i.code == "SNAPSHOT_TAMPERED")


def test_tamper_meta_is_caught(env):
    info, plan, draft, res, tmp = env
    saved = pmo_save(draft, tmp / "saved.xlsx", {})
    side = tmp / "saved.xlsx.snapshot.json"
    data = json.loads(side.read_text(encoding="utf-8"))
    data["meta"]["master_sha256"] = "0" * 64
    side.write_text(json.dumps(data), encoding="utf-8")
    d = diff_draft(saved)
    assert "SNAPSHOT_TAMPERED" in codes(d, "error")
    assert "master_sha256" in next(i.message for i in d.issues if i.code == "SNAPSHOT_TAMPERED")


def test_master_changed_since_draft(env):
    info, plan, draft, res, tmp = env
    other = tmp / "master2.xlsx"
    patch_workbook(info.path, other, SHEET, {(info.people[9].row, info.date_col(date(2026, 2, 2))): "Shift-1"})
    saved = pmo_save(draft, tmp / "saved.xlsx", {})
    assert "MASTER_CHANGED" in codes(diff_draft(saved, master_path=other), "error")
    assert "MASTER_CHANGED" not in codes(diff_draft(saved, master_path=info.path))


def test_excel_resave_scrambles_strings_and_styles_but_diff_reads_correctly(env):
    info, plan, draft, res, tmp = env
    p0, p4 = person(info, 0), person(info, 4)
    resaved = tmp / "resaved.xlsx"
    edit_cells_with_openpyxl(
        draft, resaved, {a1(info, p0, date(2026, 1, 8)): "Shift-6", a1(info, p4, date(2026, 1, 12)): None}
    )
    shutil.copyfile(str(draft) + ".snapshot.json", str(resaved) + ".snapshot.json")
    with zipfile.ZipFile(draft) as za, zipfile.ZipFile(resaved) as zb:
        assert za.read("xl/worksheets/sheet1.xml") != zb.read("xl/worksheets/sheet1.xml")  # strings re-indexed
        assert za.read("xl/styles.xml") != zb.read("xl/styles.xml")
    d = diff_draft(resaved, master_path=info.path)
    assert d.snapshot_source == "sheet" and d.blocking_issues == [], [i.message for i in d.issues]
    assert [(c.person, c.date, c.after) for c in d.changes] == [
        (p0, date(2026, 1, 8), "Shift-6"),
        (p4, date(2026, 1, 12), ""),
    ]
    assert d.changes[0].before == plan.edits[(p0, date(2026, 1, 8))]
    assert d.outside_snapshot_changes == []
    assert read_snapshot_sheet(resaved).core() == read_snapshot_sheet(draft).core()
    assert "SUMMARY_SHEET_MISSING" not in codes(d)


def test_structural_person_row_missing_and_renamed(env):
    info, plan, draft, res, tmp = env
    in_plan, excluded = info.people[2], info.people[9]

    def mutate(wb):
        ws = wb[SHEET]
        ws.cell(in_plan.row, 2).value = None  # name wiped (person is in the snapshot)
        ws.cell(excluded.row, 2).value = "Renamed Person"  # out of scope person renamed

    saved = resave(draft, tmp / "saved.xlsx", tmp, mutate)
    d = diff_draft(saved, master_path=info.path)
    missing = [i for i in d.issues if i.code == "PERSON_MISSING"]
    assert [i.person for i in missing] == [in_plan.name]  # reported once
    assert "NAME_CHANGED" in codes(d, "warning") and "PERSON_ADDED" not in codes(d)
    assert d.blocking_issues  # a missing person blocks
    assert all(c.person != in_plan.name for c in d.changes)  # the others are still compared


def test_structural_dates_changed(env):
    info, plan, draft, res, tmp = env

    def mutate(wb):
        wb[SHEET].cell(info.date_row, 5).value = datetime(2026, 1, 2)  # first date shifted by a day

    saved = resave(draft, tmp / "saved.xlsx", tmp, mutate)
    assert "DATES_CHANGED" in codes(diff_draft(saved), "error")
    assert "DATES_CHANGED" in codes(diff_draft(saved, master_path=info.path), "error")


def test_structural_roster_sheet_unreadable(env):
    info, plan, draft, res, tmp = env

    def mutate(wb):
        wb[SHEET].cell(info.date_row, 7).value = "oops"  # break the date chain

    saved = resave(draft, tmp / "saved.xlsx", tmp, mutate)
    d = diff_draft(saved, master_path=info.path)
    assert "ROSTER_UNREADABLE" in codes(d, "error") and d.changes == []


def test_non_grid_changes_warn(env):
    info, plan, draft, res, tmp = env

    def mutate(wb):
        del wb["Flags"]
        wb["Run log"].title = "My log"
        wb["Notes"].sheet_state = "visible"
        ws = wb[SHEET]
        ws.cell(info.holiday_row, info.date_col(date(2026, 1, 3))).value = "Changed label"
        ws.cell(info.people[7].row, 3).value = "Pune"  # location of an out-of-scope person

    saved = resave(draft, tmp / "saved.xlsx", tmp, mutate)
    d = diff_draft(saved, master_path=info.path)
    w = codes(d, "warning")
    assert w.count("SUMMARY_SHEET_MISSING") == 2
    assert "SHEET_STATE_CHANGED" in w and "HOLIDAY_LABELS_CHANGED" in w and "PERSON_ATTRIBUTES_CHANGED" in w
    assert d.blocking_issues == []


def test_formula_in_grid_warns(env):
    info, plan, draft, res, tmp = env
    p = person(info, 1)

    def mutate(wb):
        wb[SHEET][a1(info, p, date(2026, 1, 9))].value = '="Shift-"&1'

    saved = resave(draft, tmp / "saved.xlsx", tmp, mutate)
    assert "FORMULA_IN_GRID" in codes(diff_draft(saved), "warning")


def test_recheck_receives_edited_schedule_and_flag_delta(env):
    info, plan, draft, res, tmp = env
    p3 = person(info, 3)
    saved = pmo_save(draft, tmp / "saved.xlsx", {(p3, date(2026, 1, 14)): "OC", (person(info, 0), date(2026, 1, 8)): "Shift-9"})
    seen = {}

    def recheck(schedule):
        seen["schedule"] = schedule
        out = [FakeFlag("k-warn", "HOL_ON_WEEKLY_OFF", "WARNING", "HOL on a weekly off", person(info, 1), date(2026, 1, 17)),
               FakeFlag("k-info", "CHANGE_NOTE", "INFO", "note")]
        if schedule[person(info, 0)][date(2026, 1, 8)] == "Shift-9":
            out.append(FakeFlag("k-new", "STAFFING_SHORTAGE", "ERROR", "now short", None, date(2026, 1, 8)))
        return out

    d = diff_draft(saved, master_path=info.path, recheck=recheck, flag_delta=local_flag_delta)
    sched = seen["schedule"]
    assert sorted(sched) == sorted(info.people[i].name for i in range(6))  # snapshot people only
    dates = sorted(next(iter(sched.values())))
    assert dates[0] == date(2026, 1, 4) and dates[-1] == date(2026, 1, 31) and len(dates) == 28
    assert sched[p3][date(2026, 1, 14)] == "OC"  # the edit is in the schedule
    assert sched[person(info, 0)][date(2026, 1, 20)] == "Shift Swap\nNS"
    assert d.recheck_ran
    assert [f["key"] for f in d.flags_new] == ["k-new"]
    assert [f["key"] for f in d.flags_resolved] == ["k-err"]  # in the sidecar's flags, not raised any more
    assert [f["key"] for f in d.flags_remaining] == ["k-warn", "k-info"]
    assert d.flags_new[0]["severity"] == "ERROR" and d.flags_new[0]["date"] == "2026-01-08"
    assert "FLAGS_BEFORE_UNKNOWN" not in codes(d)


def test_flags_before_parameter_and_default_delta(env):
    info, plan, draft, res, tmp = env
    saved = pmo_save(draft, tmp / "saved.xlsx", {}, sidecar=False)
    before = [FakeFlag("a", "K", "ERROR", "m"), FakeFlag("b", "K", "WARNING", "m")]
    d = diff_draft(saved, recheck=lambda s: [FakeFlag("b", "K", "WARNING", "m"), FakeFlag("c", "K", "INFO", "m")],
                   flags_before=before)
    assert ([f["key"] for f in d.flags_new], [f["key"] for f in d.flags_resolved], [f["key"] for f in d.flags_remaining]) == (
        ["c"], ["a"], ["b"])
    d = diff_draft(saved, recheck=lambda s: [FakeFlag("z", "K", "INFO", "m")])  # no sidecar, no flags_before
    assert "FLAGS_BEFORE_UNKNOWN" in codes(d, "info") and [f["key"] for f in d.flags_new] == ["z"]
    assert diff_draft(saved).recheck_ran is False


def test_default_flag_delta():
    a, b, c = FakeFlag("a", "K", "ERROR", "m"), FakeFlag("b", "K", "ERROR", "m"), FakeFlag("c", "K", "ERROR", "m")
    assert default_flag_delta([a, b], [b, c]) == ([c], [a], [b])


def test_to_json_deterministic_and_complete_for_the_ui(env):
    info, plan, draft, res, tmp = env
    saved = pmo_save(draft, tmp / "saved.xlsx", {(person(info, 0), date(2026, 1, 6)): "COMP"})
    kw = dict(master_path=info.path, recheck=lambda s: [FakeFlag("k-warn", "K", "WARNING", "m")], flag_delta=local_flag_delta)
    a, b = diff_draft(saved, **kw), diff_draft(saved, **kw)
    assert a.to_json() == b.to_json()
    data = json.loads(a.to_json())
    assert data["format"] == "draft-diff/1" and data["snapshot_source"] == "sheet"
    assert data["changes"] == [{"person": person(info, 0), "date": "2026-01-06",
                                "before": plan.edits[(person(info, 0), date(2026, 1, 6))],
                                "after": "COMP", "row": info.people[0].row, "col": info.date_col(date(2026, 1, 6))}]
    assert data["counts"]["changes"] == 1 and data["saved_draft_sha256"] == a.saved_draft_sha256
    assert set(data["flags"]) == {"new", "resolved", "remaining"} and data["flags"]["resolved"][0]["key"] == "k-err"
    assert data["meta"]["cycle"]["label"] == "Jan 2026" and data["snapshot_cells"] == len(plan.edits)
    assert isinstance(DiffIssue("X", "info", "m").to_dict(), dict)
