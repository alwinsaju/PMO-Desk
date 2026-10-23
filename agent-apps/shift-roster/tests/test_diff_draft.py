"""diff_draft.py: what changed in the draft the user edited and saved in Excel."""

import json
import shutil
from datetime import date
from pathlib import Path

import pytest

import synth
from draft_testkit import edit_cells_with_openpyxl, resave_with_openpyxl
from pipeline import EDITS, Pipeline
from roster_lib.cycle_builder import Plan
from roster_lib.xlsx_patch import patch_workbook

RECHECKED = ("HOL_", "STAFFING_SHORTAGE", "HEADCOUNT_BELOW_MIN")


def rechecked(kind: str) -> bool:
    return kind.startswith("HOL_") or kind in RECHECKED


@pytest.fixture
def edited(tmp_path):
    p = Pipeline(tmp_path / "t")
    p.run_to_diff(EDITS)
    return p


def test_changes_and_flag_delta_in_the_contract_shape(edited):
    p = edited
    d = p.diff_json()
    assert d["cycle"] == "2026-12"
    assert d["changes"] == [
        {"person": "Person 01", "date": "2026-12-07", "before": "Shift-1", "after": "PTO"},
        {"person": "Person 06", "date": "2026-12-08", "before": "Shift-1", "after": ""},
        {"person": "Person 09", "date": "2026-12-09", "before": "Shift-5", "after": "On-call"}]
    assert d["outside_changes"] == [] and d["blocking"] == [] and d["issues"] == []
    assert set(d["flags"]) == {"new", "resolved", "remaining", "not_rechecked"}
    plan = Plan.from_json(p.paths.plan.read_text(encoding="utf-8"))
    before = {f.key for f in plan.flags}
    # only re-checked flag kinds are compared: nothing plan-time is reported as resolved
    assert d["flags"]["new"] and all(rechecked(f["kind"]) for f in d["flags"]["new"])
    assert all(f["key"] not in before for f in d["flags"]["new"])
    assert all(f["key"] in before and rechecked(f["kind"]) for f in d["flags"]["resolved"])
    assert all(f["severity"] in ("error", "warning", "info") for f in d["flags"]["new"])
    carried = sum(1 for f in plan.flags if not rechecked(f.kind))
    assert d["flags"]["not_rechecked"] == carried and carried > 0
    standing = sum(1 for f in plan.flags if rechecked(f.kind)) - len(d["flags"]["resolved"])
    assert d["flags"]["remaining"] == standing + carried
    assert d["counts"] == {"changes": 3, "outside_changes": 0, "issues": 0, "blocking": 0,
                           "snapshot_cells": len(plan.edits)}
    assert d["saved_draft"] == "Roster DRAFT 2026-12.xlsx" and d["snapshot_source"] == "sheet"
    assert d["recheck_ran"] is True and d["outside_checked"] is True


def test_no_edits_means_no_changes_and_no_flag_delta(tmp_path):
    p = Pipeline(tmp_path / "t")
    p.run_to_diff()
    d = p.diff_json()
    assert d["changes"] == [] and d["outside_changes"] == [] and d["blocking"] == []
    assert d["flags"]["new"] == [] and d["flags"]["resolved"] == []
    plan = Plan.from_json(p.paths.plan.read_text(encoding="utf-8"))
    assert d["flags"]["remaining"] == len(plan.flags)  # nothing changed: every flag still stands


def test_edit_outside_the_cycle_is_listed_separately(tmp_path):
    p = Pipeline(tmp_path / "t")
    p.run_to_draft()
    p.pmo_edit({("Person 06", date(2026, 9, 1)): "Shift-3", **EDITS})
    assert p.diff() == 0
    d = p.diff_json()
    assert len(d["changes"]) == 3
    assert d["outside_changes"] == [
        {"person": "Person 06", "date": "2026-09-01", "before": "Shift-1", "after": "Shift-3"}]
    assert d["blocking"] == []


def test_diff_is_deterministic(edited):
    first = edited.paths.diff.read_bytes()
    assert edited.diff() == 0
    assert edited.paths.diff.read_bytes() == first


def test_an_excel_resave_gives_the_same_changes(tmp_path):
    """Excel rewrites the whole file (shared strings, styles); the diff reads text only."""
    p = Pipeline(tmp_path / "t")
    p.run_to_draft()
    edited_file = p.pmo_edit(EDITS)
    resaved = p.root / "resaved.xlsx"
    resave_with_openpyxl(edited_file, resaved)
    shutil.copyfile(resaved, p.draft())
    assert p.diff() == 0
    d = p.diff_json()
    assert [(c["person"], c["date"], c["after"]) for c in d["changes"]] == [
        ("Person 01", "2026-12-07", "PTO"), ("Person 06", "2026-12-08", ""),
        ("Person 09", "2026-12-09", "On-call")]
    assert d["blocking"] == [] and d["snapshot_source"] == "sheet"


def test_an_openpyxl_edit_and_save_variant(tmp_path):
    p = Pipeline(tmp_path / "t")
    p.run_to_draft()
    info = p.world.info
    ref = lambda name, d: f"{_col(info.date_col(d))}{info.person(name).row}"  # noqa: E731
    out = p.root / "openpyxl-save.xlsx"
    edit_cells_with_openpyxl(p.draft(), out, {ref("Person 01", date(2026, 12, 7)): "PTO",
                                              ref("Person 06", date(2026, 12, 8)): None})
    shutil.copyfile(out, p.draft())
    assert p.diff() == 0
    d = p.diff_json()
    assert [(c["person"], c["date"], c["after"]) for c in d["changes"]] == [
        ("Person 01", "2026-12-07", "PTO"), ("Person 06", "2026-12-08", "")]
    assert d["blocking"] == []
    # openpyxl rewrites a hyperlinked data cell to its URL: the only spurious outside change
    assert all(c["person"] == "Person 04" for c in d["outside_changes"])


def _col(n: int) -> str:
    out = ""
    while n:
        n, r = divmod(n - 1, 26)
        out = chr(65 + r) + out
    return out


def test_tampered_snapshot_is_blocking(tmp_path):
    p = Pipeline(tmp_path / "t")
    p.run_to_draft()
    side = Path(str(p.draft()) + ".snapshot.json")
    data = json.loads(side.read_text(encoding="utf-8"))
    data["cells"][0][2] = "Shift-9"  # the sidecar no longer matches the hidden sheet
    side.write_text(json.dumps(data), encoding="utf-8")
    assert p.diff() == 0  # the script still reports: the gate is what refuses
    d = p.diff_json()
    assert [b["kind"] for b in d["blocking"]] == ["SNAPSHOT_TAMPERED"]
    assert any(i["kind"] == "SNAPSHOT_TAMPERED" and i["severity"] == "error" for i in d["issues"])
    assert d["counts"]["blocking"] == 1


def test_missing_snapshot_is_blocking(tmp_path):
    p = Pipeline(tmp_path / "t")
    p.run_to_draft()
    Path(str(p.draft()) + ".snapshot.json").unlink()
    # a draft whose hidden sheet is also gone: take a copy of the master as the "saved draft"
    shutil.copyfile(p.paths.roster, p.draft())
    assert p.diff() == 0
    assert [b["kind"] for b in p.diff_json()["blocking"]] == ["SNAPSHOT_MISSING"]


def test_master_changed_after_the_draft_is_blocking(tmp_path):
    p = Pipeline(tmp_path / "t")
    p.run_to_draft()
    synth.patch_master(p.world, {("Person 06", date(2026, 12, 3)): "Shift-3"})
    assert p.diff() == 0
    kinds = [b["kind"] for b in p.diff_json()["blocking"]]
    assert kinds == ["MASTER_CHANGED"]  # not reported twice as an input change


@pytest.mark.parametrize("which", ["holidays", "pto", "config"])
def test_other_inputs_changed_after_the_analysis_are_blocking(tmp_path, which):
    p = Pipeline(tmp_path / "t")
    p.run_to_draft()
    path = {"holidays": p.paths.holidays, "pto": p.paths.pto, "config": p.paths.config}[which]
    if which == "config":
        cfg = json.loads(path.read_text(encoding="utf-8"))
        cfg["seed"] = 8
        path.write_text(json.dumps(cfg), encoding="utf-8")
    elif which == "pto":
        path.unlink()
    else:
        from openpyxl import load_workbook
        wb = load_workbook(path)  # still a valid Holiday Roster, one row more
        wb.active.append(["Test Extra Day", date(2026, 12, 30), "X"])
        wb.save(path)
    assert p.diff() == 0
    d = p.diff_json()
    assert [b["kind"] for b in d["blocking"]] == ["INPUT_CHANGED"]
    assert "changed since the analysis" in d["blocking"][0]["message"]
    assert any(i["kind"] == "INPUT_CHANGED" and i["severity"] == "error" for i in d["issues"])


def test_renamed_person_row_is_blocking(tmp_path):
    p = Pipeline(tmp_path / "t")
    p.run_to_draft()
    row = p.world.person("Person 06").row
    tmp = p.root / "renamed.xlsx"
    patch_workbook(p.draft(), tmp, "PDT Operate", {f"B{row}": "Somebody Else"})
    shutil.copyfile(tmp, p.draft())
    assert p.diff() == 0
    kinds = {b["kind"] for b in p.diff_json()["blocking"]}
    assert "PERSON_MISSING" in kinds


def test_missing_draft_or_plan_fails_readably(tmp_path, capsys):
    p = Pipeline(tmp_path / "t")
    assert p.diff() == 1
    assert "the analysis not found" in capsys.readouterr().err
    p.run_to_draft()
    p.paths.diff.write_text("{}", encoding="utf-8")  # the comparison of an earlier attempt
    p.draft().unlink()
    assert p.diff() == 1
    assert "Roster DRAFT 2026-12.xlsx is missing" in capsys.readouterr().err
    assert not p.paths.diff.exists()  # a failed comparison leaves no stale diff for the gate
    p.paths.plan.unlink()
    assert p.diff() == 1
    assert "the plan is missing" in capsys.readouterr().err


def test_unreadable_draft_fails_readably(tmp_path, capsys):
    p = Pipeline(tmp_path / "t")
    p.run_to_draft()
    p.draft().write_bytes(b"not a workbook")
    assert p.diff() == 1
    err = capsys.readouterr().err
    assert "is not a valid .xlsx file" in err and "Traceback" not in err
    assert not p.paths.diff.exists()
