import hashlib
import json
import os
import shutil
import zipfile
from datetime import date, datetime, timezone

import pytest

from roster_lib import audit, final_build, pkgdiff
from roster_lib.draft_builder import build_draft
from roster_lib.draft_diff import diff_draft
from roster_lib.final_build import FinalBuildError, FinalBuildRefused, build_final
from roster_lib.xlsx_patch import patch_workbook
from draft_testkit import (
    NOW,
    SHEET,
    SHEET_PART,
    a1,
    edit_cells_with_openpyxl,
    grid,
    make_master,
    make_plan,
    pmo_save,
)

T0 = datetime(2026, 2, 3, 9, 30, 0, tzinfo=timezone.utc)


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def tree(path):
    out = []
    for root, _, files in os.walk(path):
        out += [os.path.relpath(os.path.join(root, f), path) for f in files]
    return sorted(out)


@pytest.fixture()
def env(tmp_path):
    work = tmp_path / "work"
    work.mkdir()
    info = make_master(work)
    plan = make_plan(info)
    draft = work / "draft.xlsx"
    build_draft(info.path, draft, plan, now=NOW)
    return info, plan, draft, work, tmp_path / "out"


def name(info, i):
    return info.people[i].name


def user_edits(info):
    return {
        (name(info, 0), date(2026, 1, 6)): "COMP",  # in the snapshot, changed
        (name(info, 3), date(2026, 1, 7)): "Shift-9",
        (name(info, 1), date(2026, 1, 20)): "",  # clear
        (name(info, 9), date(2026, 1, 9)): "Shift-5",  # outside the snapshot
    }


def saved_and_diff(env, edits=None):
    info, plan, draft, work, out = env
    saved = pmo_save(draft, work / "saved.xlsx", user_edits(info) if edits is None else edits)
    return saved, diff_draft(saved, master_path=info.path)


def expected_grid(info, plan, edits):
    g = grid(info.path)
    for k, v in plan.edits.items():
        g[k] = v
    for k, v in edits.items():
        g[k] = v
    return g


def test_only_approved_cells_change_cell_level_and_package_level(env):
    info, plan, draft, work, out = env
    saved, diff = saved_and_diff(env)
    res = build_final(info.path, saved, diff, out, approver="pmo", now=T0)
    assert os.path.basename(res.final_path) == "master - final Jan 2026.xlsx"
    assert grid(res.final_path) == expected_grid(info, plan, user_edits(info))
    d = pkgdiff.assert_only_changed(info.path, res.final_path, {SHEET_PART}, strict=True)
    assert d.byte_changed == [SHEET_PART]
    # no summary sheets, no snapshot: the final carries cell value changes only
    with zipfile.ZipFile(res.final_path) as z:
        assert [n for n in z.namelist() if n.startswith("xl/worksheets/sheet")] == ["xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]
    with zipfile.ZipFile(info.path) as za, zipfile.ZipFile(res.final_path) as zb:
        assert za.read("xl/threadedComments/threadedComment1.xml") == zb.read("xl/threadedComments/threadedComment1.xml")
        assert za.read("docMetadata/LabelInfo.xml") == zb.read("docMetadata/LabelInfo.xml")
    # approved = snapshot cells + the one outside edit; the user's values win over the draft's
    assert res.approved_cells == len(plan.edits) + 1
    assert res.user_changes == 3 and res.outside_changes == 1
    assert res.cells_written + res.cells_skipped_noop == res.approved_cells
    assert res.cells_skipped_noop > 0  # weekend blanks equal the master


def test_master_untouched_and_nothing_else_in_master_folder(env):
    info, plan, draft, work, out = env
    saved, diff = saved_and_diff(env)
    before, listing = sha(info.path), tree(work)
    build_final(info.path, saved, diff, out, now=T0)
    assert sha(info.path) == before and tree(work) == listing


def test_noop_edits_skipped(env):
    info, plan, draft, work, out = env
    p0 = name(info, 0)
    master_val = grid(info.path)[(p0, date(2026, 1, 6))]
    saved, diff = saved_and_diff(env, {(p0, date(2026, 1, 6)): master_val})  # PMO sets it back to the master's value
    assert diff.changes and diff.changes[0].after == master_val
    res = build_final(info.path, saved, diff, out, now=T0)
    written = {(w["person"], w["date"]) for w in res.written}
    assert (p0, "2026-01-06") not in written
    g = grid(res.final_path)
    assert g[(p0, date(2026, 1, 6))] == master_val
    assert all(w["before"] != w["after"] for w in res.written)
    assert res.cells_skipped_noop >= 1 and res.cells_written == len(res.written)


def test_backup_verified_and_reused(env):
    info, plan, draft, work, out = env
    saved, diff = saved_and_diff(env)
    res = build_final(info.path, saved, diff, out, now=T0)
    assert res.backup_path == str(out / "backups" / f"master.{sha(info.path)[:8]}.xlsx")
    assert sha(res.backup_path) == sha(info.path) == res.backup_sha256 and not res.reused_backup
    res2 = build_final(info.path, saved, diff, out, now=T0.replace(minute=31))
    assert res2.reused_backup and res2.backup_path == res.backup_path


def test_existing_backup_with_other_content_is_never_overwritten(env):
    info, plan, draft, work, out = env
    saved, diff = saved_and_diff(env)
    bdir = out / "backups"
    bdir.mkdir(parents=True)
    other = bdir / f"master.{sha(info.path)[:8]}.xlsx"
    other.write_bytes(b"different content")
    with pytest.raises(FinalBuildError, match="never overwritten"):
        build_final(info.path, saved, diff, out, now=T0)
    assert other.read_bytes() == b"different content"
    assert tree(out) == [os.path.join("backups", other.name)]  # no final, no audit, no temp files


def test_refuses_when_not_confirmed(env):
    info, plan, draft, work, out = env
    saved, diff = saved_and_diff(env)
    with pytest.raises(FinalBuildRefused, match="confirmed"):
        build_final(info.path, saved, diff, out, confirmed=False)
    assert not out.exists() or tree(out) == []


def test_refuses_when_master_changed_since_draft(env):
    info, plan, draft, work, out = env
    saved, diff = saved_and_diff(env)
    changed = work / "master_changed.xlsx"
    patch_workbook(info.path, changed, SHEET, {(info.people[12].row, info.date_col(date(2026, 2, 2))): "Shift-1"})
    with pytest.raises(FinalBuildRefused, match="master"):
        build_final(changed, saved, diff, out, now=T0)
    assert not out.exists() or tree(out) == []


def test_refuses_when_snapshot_tampered(env):
    info, plan, draft, work, out = env
    saved = pmo_save(draft, work / "saved.xlsx", user_edits(info))
    side = work / "saved.xlsx.snapshot.json"
    data = json.loads(side.read_text(encoding="utf-8"))
    data["cells"][5][2] = "Shift-7"
    side.write_text(json.dumps(data), encoding="utf-8")
    diff = diff_draft(saved, master_path=info.path)
    assert "SNAPSHOT_TAMPERED" in diff.issue_codes()
    with pytest.raises(FinalBuildRefused, match="SNAPSHOT_TAMPERED"):
        build_final(info.path, saved, diff, out, now=T0)
    assert not out.exists() or tree(out) == []


def test_refuses_when_saved_draft_changed_after_the_diff(env):
    info, plan, draft, work, out = env
    saved, diff = saved_and_diff(env)
    saved2 = pmo_save(saved, work / "saved2.xlsx", {(name(info, 2), date(2026, 1, 8)): "OC"})
    shutil.copyfile(saved2, saved)  # the file is saved again after the PMO looked at the diff
    shutil.copyfile(str(saved2) + ".snapshot.json", str(saved) + ".snapshot.json")
    with pytest.raises(FinalBuildRefused, match="changed after the diff"):
        build_final(info.path, saved, diff, out, now=T0)


def test_refuses_diff_computed_without_master(env):
    info, plan, draft, work, out = env
    saved = pmo_save(draft, work / "saved.xlsx", user_edits(info))
    with pytest.raises(FinalBuildRefused, match="without the master"):
        build_final(info.path, saved, diff_draft(saved), out, now=T0)


def test_refuses_saved_draft_that_is_the_master(env):
    info, plan, draft, work, out = env
    with pytest.raises(FinalBuildRefused):
        build_final(info.path, info.path, diff_draft(draft, master_path=info.path), out)


def test_audit_entry_and_log(env, monkeypatch):
    info, plan, draft, work, out = env
    matrix, pto, cfg = work / "m.xlsx", work / "p.xlsx", work / "c.json"
    matrix.write_bytes(b"m")
    pto.write_bytes(b"p")
    cfg.write_bytes(b"{}")
    saved, diff = saved_and_diff(env)
    res = build_final(info.path, saved, diff, out, approver="Pat PMO", matrix_path=matrix, pto_path=pto, config_path=cfg,
                      extra={"ticket": "T-1"}, now=T0)
    e = audit.read_audit_entry(out, res.run_id)
    assert e["run_id"] == res.run_id and e["format"] == audit.AUDIT_FORMAT
    assert e["approver"] == "Pat PMO" and e["approver_source"] == "given"
    assert e["started_utc"] == "2026-02-03T09:30:00.000000Z" and e["finished_utc"] == e["started_utc"]
    assert e["inputs"]["master"] == {"name": "master.xlsx", "sha256": sha(info.path), "bytes": os.path.getsize(info.path)}
    assert e["inputs"]["saved_draft"]["sha256"] == sha(saved)
    assert e["inputs"]["matrix"]["sha256"] == hashlib.sha256(b"m").hexdigest()
    assert e["inputs"]["pto"]["name"] == "p.xlsx" and e["inputs"]["config"]["sha256"] == hashlib.sha256(b"{}").hexdigest()
    assert e["cycle"]["label"] == "Jan 2026" and e["seed"] == 42 and e["config_version"] == 3
    assert e["diff"] == json.loads(json.dumps(diff.to_dict()))  # the full confirmed diff
    assert len(e["diff"]["changes"]) == 3 and len(e["diff"]["outside_snapshot_changes"]) == 1
    assert e["counts"] == {"snapshot_cells": len(plan.edits), "user_changes": 3, "outside_changes": 1,
                           "approved_cells": len(plan.edits) + 1, "cells_written": res.cells_written,
                           "cells_skipped_noop": res.cells_skipped_noop}
    assert len(e["written"]) == res.cells_written and e["written"][0].keys() == {"person", "date", "before", "after"}
    assert e["outputs"]["final"]["sha256"] == sha(res.final_path) == res.final_sha256
    assert e["outputs"]["backup"]["sha256"] == sha(info.path) and e["outputs"]["saved_draft"]["sha256"] == sha(saved)
    assert e["library"]["final_build"] == final_build.FINAL_BUILD_VERSION and e["library"]["cycle_builder"] == "test/1"
    assert e["extra"] == {"ticket": "T-1"} and e["plan_hash"] == diff.meta["plan_hash"]
    log = audit.read_audit_log(out)
    assert len(log) == 1 and log[0]["run_id"] == res.run_id and log[0]["final_sha256"] == res.final_sha256
    assert log[0]["cells_written"] == res.cells_written and log[0]["approver"] == "Pat PMO"
    assert [t.replace(os.sep, "/") for t in tree(out)] == sorted([
        "audit/audit.log.jsonl", f"audit/{res.run_id}.json", f"backups/master.{sha(info.path)[:8]}.xlsx",
        "master - final Jan 2026.xlsx"])


def test_approver_defaults_to_the_os_user(env, monkeypatch):
    info, plan, draft, work, out = env
    monkeypatch.setattr(final_build.getpass, "getuser", lambda: "os.user")
    saved, diff = saved_and_diff(env)
    res = build_final(info.path, saved, diff, out, now=T0)
    e = audit.read_audit_entry(out, res.run_id)
    assert res.approver == "os.user" and e["approver"] == "os.user" and e["approver_source"] == "getpass"


def test_rerun_same_inputs_identical_final_and_append_only_audit(env):
    info, plan, draft, work, out = env
    saved, diff = saved_and_diff(env)
    r1 = build_final(info.path, saved, diff, out, approver="a", now=T0)
    first_final = open(r1.final_path, "rb").read()
    first_entry = open(r1.audit_path, "rb").read()
    r2 = build_final(info.path, saved, diff, out, approver="a", now=T0)
    assert r2.final_path == r1.final_path and r2.reused_final and open(r2.final_path, "rb").read() == first_final
    assert grid(r2.final_path) == grid(r1.final_path)
    assert r2.run_id == r1.run_id + "-2" and open(r1.audit_path, "rb").read() == first_entry
    assert len(audit.read_audit_log(out)) == 2
    assert [f for f in os.listdir(out) if f.endswith(".xlsx")] == ["master - final Jan 2026.xlsx"]
    assert not [f for f in os.listdir(out) if f.endswith(".tmp")]


def test_different_approved_set_gets_a_new_file_never_overwrites(env):
    info, plan, draft, work, out = env
    saved, diff = saved_and_diff(env)
    r1 = build_final(info.path, saved, diff, out, now=T0)
    saved2, diff2 = saved_and_diff(env, {(name(info, 0), date(2026, 1, 6)): "COMP2"})
    before = open(r1.final_path, "rb").read()
    r2 = build_final(info.path, saved2, diff2, out, now=T0.replace(minute=40))
    assert os.path.basename(r2.final_path) == "master - final Jan 2026 (2).xlsx"
    assert open(r1.final_path, "rb").read() == before and r2.final_sha256 != r1.final_sha256


def test_verification_failure_removes_everything(env, monkeypatch):
    info, plan, draft, work, out = env
    saved, diff = saved_and_diff(env)
    real_patch = final_build.patch_workbook

    def sneaky(src, dst, sheet, edits, **kw):
        edits = dict(edits)
        edits[(info.people[15].row, info.date_col(date(2026, 2, 3)))] = "SNEAK"  # a cell nobody approved
        return real_patch(src, dst, sheet, edits, **kw)

    monkeypatch.setattr(final_build, "patch_workbook", sneaky)
    with pytest.raises(FinalBuildError, match="verification failed"):
        build_final(info.path, saved, diff, out, now=T0)
    assert tree(out) == []  # no final, no temp file, no backup, no audit


def test_works_on_an_excel_resaved_draft(env):
    info, plan, draft, work, out = env
    p0 = name(info, 0)
    resaved = work / "resaved.xlsx"
    edit_cells_with_openpyxl(draft, resaved, {a1(info, p0, date(2026, 1, 8)): "Shift-6"})
    shutil.copyfile(str(draft) + ".snapshot.json", str(resaved) + ".snapshot.json")
    diff = diff_draft(resaved, master_path=info.path)
    assert len(diff.changes) == 1 and diff.blocking_issues == []
    res = build_final(info.path, resaved, diff, out, now=T0)
    assert grid(res.final_path) == expected_grid(info, plan, {(p0, date(2026, 1, 8)): "Shift-6"})
    pkgdiff.assert_only_changed(info.path, res.final_path, {SHEET_PART})


def test_no_changes_at_all_still_builds_when_plan_matches_master(tmp_path):
    work = tmp_path / "w"
    work.mkdir()
    info = make_master(work)
    plan = make_plan(info)
    plan.edits = {k: grid(info.path)[k] for k in plan.edits}  # every planned cell already equals the master
    draft = work / "d.xlsx"
    build_draft(info.path, draft, plan, now=NOW)
    saved = pmo_save(draft, work / "s.xlsx", {})
    diff = diff_draft(saved, master_path=info.path)
    res = build_final(info.path, saved, diff, tmp_path / "out", now=T0)
    assert res.cells_written == 0 and res.warnings and sha(res.final_path) == sha(info.path)
