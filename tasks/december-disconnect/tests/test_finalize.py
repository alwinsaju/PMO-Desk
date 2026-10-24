"""finalize.py: refusals, the final files, the audit entry and the cross-task config update."""

import getpass
import json
import shutil
from datetime import date

import openpyxl
import pytest

from _common import sha256_file
from helpers import breaking_main_edit, load, safe_analytics_swap, safe_main_edit
from synth import WINDOW, WINDOW_TEXT, shift_roster_config_dict

FINAL_MAIN = f"Winter Coverage FINAL {WINDOW_TEXT}.xlsx"
FINAL_AN = f"Analytics Winter Coverage FINAL {WINDOW_TEXT}.xlsx"


def confirmed(p, main=True, analytics=True):
    """The PMO edits both drafts (valid edits), the comparison runs: ready for the confirm gate."""
    if main:
        p.edit_main(safe_main_edit(p)[0])
    if analytics:
        p.edit_analytics(safe_analytics_swap(p)[0])
    assert p.diff() == 0
    assert p.diff_json()["blocking"] == []
    return p


def sr_config(p):
    return json.loads(p.world_config.read_text(encoding="utf-8"))


@pytest.fixture()
def p(draft_world):
    # the cross-task target of the copied world (a relative path in config/task-config.json)
    draft_world.world_config = draft_world.root / "other-task" / "config" / "rotation-config.json"
    return draft_world


def test_final_files_are_byte_copies_of_the_confirmed_drafts(p, capsys):
    confirmed(p)
    saved = {"main": sha256_file(p.main_draft()), "analytics": sha256_file(p.analytics_draft())}
    inputs = {k: sha256_file(getattr(p.paths, k)) for k in ("roster", "staff", "analytics_a", "analytics_b",
                                                           "winter_config", "analytics_config")}
    capsys.readouterr()
    assert p.finalize() == 0
    out = capsys.readouterr().out
    final_main, final_an = p.paths.final_dir / FINAL_MAIN, p.paths.final_dir / FINAL_AN
    assert sha256_file(final_main) == saved["main"] and sha256_file(final_an) == saved["analytics"]
    # the PMO's edits and the formulas are intact in the copies
    wb = openpyxl.load_workbook(final_main)
    formulas = sum(1 for ws in wb.worksheets for row in ws.iter_rows() for c in row
                   if isinstance(c.value, str) and c.value.startswith("="))
    assert formulas > 100
    # the drafts and every input are untouched
    assert saved == {"main": sha256_file(p.main_draft()), "analytics": sha256_file(p.analytics_draft())}
    assert inputs == {k: sha256_file(getattr(p.paths, k)) for k in inputs}
    # logs: counts only
    assert "final: output/final/" in out and "Sample" not in out and "Hub0" not in out


def test_report_data_final(p):
    confirmed(p)
    assert p.finalize() == 0
    r = p.report()
    assert r["stage"] == "final" and r["workbook_path"] == f"output/final/{FINAL_MAIN}"
    s = r["summary"]
    assert s["analytics_workbook_path"] == f"output/final/{FINAL_AN}"
    assert (s["final_main_file"], s["final_analytics_file"]) == (FINAL_MAIN, FINAL_AN)
    assert FINAL_MAIN in s["message"] and FINAL_AN in s["message"] and "audit" in s["message"].lower()
    assert s["user_changes"] == 3 and s["main_changes"] == 1 and s["analytics_changes"] == 2
    assert s["approver"] == getpass.getuser()
    assert s["audit"].startswith("output/audit/") and (p.root / s["audit"]).is_file()
    assert s["final_main_sha256"] == sha256_file(p.paths.final_dir / FINAL_MAIN)
    assert s["window"] == WINDOW and s["flags"]["error"] == 0
    # both finals are offered as Open buttons (labelled, task-relative, existing)
    assert r["extra_paths"] == [{"label": "Main plan", "path": f"output/final/{FINAL_MAIN}"},
                                {"label": "Analytics plan", "path": f"output/final/{FINAL_AN}"}]
    assert all((p.root / x["path"]).is_file() for x in r["extra_paths"])


def test_audit_entry_follows_the_roster_lib_conventions(p):
    confirmed(p)
    assert p.finalize() == 0
    entries = sorted(x for x in p.paths.audit_dir.glob("*.json"))
    assert len(entries) == 1
    e = json.loads(entries[0].read_text(encoding="utf-8"))
    assert e["format"] == "roster-audit/1" and e["run_id"] == entries[0].stem
    assert e["task"] == "december-disconnect" and e["window"] == WINDOW
    assert e["approver"] == getpass.getuser() and e["approver_source"] == "getpass"
    assert set(e["inputs"]) == {"roster", "staff", "analytics_a", "analytics_b", "winter_config",
                                "analytics_config"}
    assert all(len(v["sha256"]) == 64 for v in e["inputs"].values())
    assert e["saved_drafts"]["main"]["sha256"] == e["outputs"]["final_main"]["sha256"]
    assert e["saved_drafts"]["analytics"]["sha256"] == e["outputs"]["final_analytics"]["sha256"]
    assert e["diff"]["blocking"] == [] and len(e["diff"]["changes"]) == 3
    assert e["counts"]["changes"] == 3 and set(e["plan_hashes"]) == {"main", "analytics"}
    assert e["started_utc"] <= e["finished_utc"] and e["cross_task"]["status"] == "updated"
    log = (p.paths.audit_dir / "audit.log.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(log) == 1
    line = json.loads(log[0])
    assert line["run_id"] == e["run_id"] and line["final_main"] == FINAL_MAIN and line["changes"] == 3


def test_running_finalize_again_is_idempotent(p, capsys):
    confirmed(p)
    assert p.finalize() == 0
    backups = sorted((p.world_config.parent / "backups").iterdir())
    final_sha = sha256_file(p.paths.final_dir / FINAL_MAIN)
    config_sha = sha256_file(p.world_config)
    assert p.finalize() == 0
    assert "windows: already_covered" in capsys.readouterr().out
    assert sorted(x.name for x in p.paths.final_dir.iterdir()) == sorted([FINAL_MAIN, FINAL_AN])
    assert sha256_file(p.paths.final_dir / FINAL_MAIN) == final_sha
    assert sorted((p.world_config.parent / "backups").iterdir()) == backups  # no second backup
    assert sha256_file(p.world_config) == config_sha
    assert len(list(p.paths.audit_dir.glob("*.json"))) == 2  # append-only: one more entry
    assert len((p.paths.audit_dir / "audit.log.jsonl").read_text().splitlines()) == 2


def test_a_different_file_already_in_final_is_never_overwritten(p):
    confirmed(p)
    p.paths.final_dir.mkdir()
    (p.paths.final_dir / FINAL_MAIN).write_bytes(b"someone else's file")
    assert p.finalize() == 0
    assert (p.paths.final_dir / FINAL_MAIN).read_bytes() == b"someone else's file"
    second = p.paths.final_dir / FINAL_MAIN.replace(".xlsx", " (2).xlsx")
    assert sha256_file(second) == sha256_file(p.main_draft())
    assert p.report()["workbook_path"] == f"output/final/{second.name}"


def test_a_run_without_edits_can_be_finalized(p):
    assert p.diff() == 0
    assert p.finalize() == 0
    assert p.report()["summary"]["user_changes"] == 0
    assert sha256_file(p.paths.final_dir / FINAL_MAIN) == sha256_file(p.main_draft())


# ---- the cross-task update -----------------------------------------------------------------------------

def test_disconnect_days_are_added_with_a_backup(p):
    original = p.world_config.read_text(encoding="utf-8")
    assert sr_config(p)["disconnect_windows"] == []
    confirmed(p)
    assert p.finalize() == 0
    assert sr_config(p)["disconnect_windows"] == [{"start": "2026-12-26", "end": "2026-12-31"}]
    backups = list((p.world_config.parent / "backups").iterdir())
    assert len(backups) == 1 and backups[0].name.startswith("rotation-config.20")
    assert backups[0].read_text(encoding="utf-8") == original
    cross = p.report()["summary"]["cross_task"]
    assert cross["status"] == "updated" and cross["days"] == {"start": "2026-12-26", "end": "2026-12-31"}
    assert cross["backup"] == backups[0].name
    # the shift roster's own loader accepts the result and ignores the days
    from roster_lib.config import load_config
    assert date(2026, 12, 29) in load_config(p.world_config).disconnect_dates()
    assert date(2026, 12, 25) not in load_config(p.world_config).disconnect_dates()


def test_covered_days_leave_the_config_alone(p):
    p.world_config.write_text(json.dumps(shift_roster_config_dict(
        [{"start": "2026-12-26", "end": "2026-12-31"}])), encoding="utf-8")
    before = sha256_file(p.world_config)
    confirmed(p, analytics=False)
    assert p.finalize() == 0
    assert sha256_file(p.world_config) == before
    assert not (p.world_config.parent / "backups").exists()
    assert p.report()["summary"]["cross_task"]["status"] == "already_covered"


def test_overlapping_windows_are_merged_and_others_kept(p):
    p.world_config.write_text(json.dumps(shift_roster_config_dict([
        {"start": "2026-06-01", "end": "2026-06-05"},
        {"start": "2026-12-20", "end": "2026-12-27"}])), encoding="utf-8")
    confirmed(p, analytics=False)
    assert p.finalize() == 0
    assert sr_config(p)["disconnect_windows"] == [{"start": "2026-06-01", "end": "2026-06-05"},
                                                  {"start": "2026-12-20", "end": "2026-12-31"}]


def test_partly_covered_window_is_extended(p):
    p.world_config.write_text(json.dumps(shift_roster_config_dict(
        [{"start": "2026-12-26", "end": "2026-12-28"}])), encoding="utf-8")
    confirmed(p, analytics=False)
    assert p.finalize() == 0
    assert sr_config(p)["disconnect_windows"] == [{"start": "2026-12-26", "end": "2026-12-31"}]


def test_an_absent_shift_roster_config_is_skipped_with_a_note(p, capsys):
    p.world_config.unlink()
    confirmed(p, analytics=False)
    capsys.readouterr()
    assert p.finalize() == 0
    out = capsys.readouterr().out
    assert "windows: skipped" in out and "absent" in out
    cross = p.report()["summary"]["cross_task"]
    assert cross["status"] == "skipped" and "absent" in cross["reason"]
    assert (p.paths.final_dir / FINAL_MAIN).exists()


def test_an_invalid_shift_roster_config_stops_before_anything_is_written(p, capsys):
    raw = shift_roster_config_dict()
    raw["disconnect_windows"] = [{"start": "bad", "end": "worse"}]
    p.world_config.write_text(json.dumps(raw), encoding="utf-8")
    confirmed(p, analytics=False)
    capsys.readouterr()
    assert p.finalize() == 1
    assert "shift roster config has problems" in capsys.readouterr().err
    assert not p.paths.final_dir.exists() and not p.paths.audit_dir.exists()
    assert p.report()["stage"] == "draft"


def test_the_target_path_comes_from_task_config(p):
    elsewhere = p.root / "somewhere" / "rc.json"
    elsewhere.parent.mkdir()
    elsewhere.write_text(json.dumps(shift_roster_config_dict()), encoding="utf-8")
    p.paths.task_config.write_text(json.dumps({"shift_roster_config": "somewhere/rc.json"}), encoding="utf-8")
    confirmed(p, analytics=False)
    assert p.finalize() == 0
    assert json.loads(elsewhere.read_text())["disconnect_windows"] == [{"start": "2026-12-26", "end": "2026-12-31"}]
    assert sr_config(p)["disconnect_windows"] == []  # the default target was not touched


def test_plan_disconnect_update_for_a_short_window(tmp_path):
    import finalize
    from _common import Paths
    paths = Paths(tmp_path)
    plan = finalize.plan_disconnect_update(paths, date(2026, 12, 25), date(2026, 12, 26))
    assert plan["status"] == "skipped" and "no day between" in plan["reason"]


# ---- refusals ---------------------------------------------------------------------------------------------

def test_refuses_without_a_confirmed_diff(p, capsys):
    assert p.finalize() == 1
    assert "the confirmed diff not found (roster-diff.json)" in capsys.readouterr().err
    assert not p.paths.final_dir.exists()


def test_refuses_a_diff_with_blocking_issues_naming_kinds_only(p, capsys):
    edit, (person, day) = breaking_main_edit(p)
    p.edit_main(edit)
    assert p.diff() == 0
    capsys.readouterr()
    assert p.finalize() == 1
    err = capsys.readouterr().err
    assert "blocking issue(s) (WINTER_DAYS_BELOW_MIN)" in err and person not in err
    assert not p.paths.final_dir.exists() and not p.paths.audit_dir.exists()
    assert sr_config(p)["disconnect_windows"] == []


@pytest.mark.parametrize("which", ["main", "analytics"])
def test_refuses_a_draft_changed_after_the_comparison(p, which, capsys):
    confirmed(p)
    path = p.main_draft() if which == "main" else p.analytics_draft()
    # a harmless re-save: different bytes, same content
    wb = openpyxl.load_workbook(path)
    wb.save(path)
    capsys.readouterr()
    assert p.finalize() == 1
    assert f"the {which} draft was changed after you confirmed" in capsys.readouterr().err
    assert not p.paths.final_dir.exists()
    assert sr_config(p)["disconnect_windows"] == []
    # running the comparison again and confirming makes it finalizable
    assert p.diff() == 0 and p.finalize() == 0


def test_refuses_when_a_draft_vanished_after_the_comparison(p, capsys):
    confirmed(p)
    p.analytics_draft().unlink()
    assert p.finalize() == 1
    assert "is missing from output/" in capsys.readouterr().err


def test_refuses_when_an_input_changed(p, capsys):
    confirmed(p)
    p.paths.staff.write_bytes(p.paths.staff.read_bytes() + b"x")
    assert p.finalize() == 1
    assert "the staff roster changed since the analysis" in capsys.readouterr().err


def test_refuses_a_tampered_snapshot_even_with_matching_hashes(p, capsys):
    confirmed(p)
    side = p.main_draft().with_name(p.main_draft().name + ".snapshot.json")
    data = json.loads(side.read_text(encoding="utf-8"))
    data["cells"][0][2] = "Shift-9"
    side.write_text(json.dumps(data), encoding="utf-8")  # the sidecar is not part of the hashed drafts
    capsys.readouterr()
    assert p.finalize() == 1
    assert "SNAPSHOT_TAMPERED" in capsys.readouterr().err
    assert not p.paths.final_dir.exists()


def test_refuses_when_the_audit_now_fails(p, capsys):
    """The confirmed file is unchanged, but an effective config that changed makes the audit different."""
    confirmed(p)
    eff = json.loads(p.paths.winter_effective.read_text(encoding="utf-8"))
    eff["rules"]["max_days"] = 3  # the draft has people with 4 days
    p.paths.winter_effective.write_text(json.dumps(eff), encoding="utf-8")
    capsys.readouterr()
    assert p.finalize() == 1
    err = capsys.readouterr().err
    assert "CONFIG_CHANGED" in err and "WINTER_DAYS_ABOVE_MAX" in err
    assert not p.paths.final_dir.exists()


def test_error_messages_never_name_a_person(p, capsys):
    confirmed(p)
    p.paths.staff.write_bytes(b"x")
    assert p.finalize() == 1
    err = capsys.readouterr().err
    for secret in ("Sample", "Hub0", "Tester", "Alpha"):
        assert secret not in err
