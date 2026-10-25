"""finalize.py: final roster, backup, audit log, next-year file and the config update."""

import getpass
import json
import shutil
import zipfile
from datetime import date
from pathlib import Path

import pytest

import synth
from draft_testkit import grid
from pipeline import EDITS, Pipeline
from roster_lib import pkgdiff
from roster_lib.audit import sha256_file
from roster_lib.config import load_config
from roster_lib.cycle_builder import Plan
from roster_lib.roster_io import load_roster
from roster_lib.xlsx_patch import list_sheets

SHEET_PART = "xl/worksheets/sheet1.xml"


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.fixture
def done(tmp_path):
    """A finished run: draft built, three user edits, diff confirmed, final built."""
    p = Pipeline(tmp_path / "t")
    p.run_to_diff(EDITS)
    p.master_sha = sha256_file(p.paths.roster)
    p.master_grid = grid(p.paths.roster)
    p.draft_grid = grid(p.draft())
    p.old_config = p.paths.config.read_bytes()
    assert p.finalize() == 0
    return p


def nothing_built(p: Pipeline, master_sha: str, config: bytes) -> None:
    """A refused finalization leaves no final, no backup, no audit and the same config."""
    if p.paths.final_dir.exists():
        assert not list(p.paths.final_dir.glob("*.xlsx"))
    assert not p.paths.backups_dir.exists() and not p.paths.audit_dir.exists()
    assert not p.paths.config_backups.exists()
    assert p.paths.config.read_bytes() == config
    assert sha256_file(p.paths.roster) == master_sha


def test_final_roster_changes_only_the_approved_cells(done):
    p = done
    final = p.paths.final_dir / "roster - final Dec 2026.xlsx"
    assert final.exists()
    assert sha256_file(p.paths.roster) == p.master_sha  # the master is never modified

    # package level: only the roster sheet part differs; no summary or snapshot sheet is added
    pkgdiff.assert_only_changed(p.paths.roster, final, {SHEET_PART})
    with open(p.paths.roster, "rb") as a, open(final, "rb") as b:
        assert [s.name for s in list_sheets(__import__("zipfile").ZipFile(a))] == \
               [s.name for s in list_sheets(__import__("zipfile").ZipFile(b))]
    # cell level: exactly the cells where the draft (with the user's edits) differs from the master
    final_grid = grid(final)
    expected = {k for k in p.master_grid if p.draft_grid[k] != p.master_grid[k]}
    assert len(expected) > 300
    differs = {k for k in final_grid if final_grid[k] != p.master_grid[k]}
    assert differs == expected
    assert all(final_grid[k] == p.draft_grid[k] for k in expected)
    assert final_grid[("Person 01", date(2026, 12, 7))] == "PTO"  # the user's own edit
    assert final_grid[("Person 06", date(2026, 12, 8))] == ""
    assert final_grid[synth.LEAVE_CELL] == "P"  # hand-typed leave untouched
    # nothing outside the cycle changed
    assert all(date(2026, 11, 29) <= d <= date(2027, 1, 1) for _, d in differs)

    report = p.report()
    assert report["stage"] == "final"
    assert report["workbook_path"] == "output/final/roster - final Dec 2026.xlsx"
    s = report["summary"]
    assert s["cycle"] == "2026-12" and s["user_changes"] == 3 and s["outside_changes"] == 0
    assert s["cells_written"] == len(expected) and s["approver"] == getpass.getuser()
    assert s["master_sha256"] == p.master_sha
    assert s["flags_after_edits"]["remaining"] > 0 and s["shift_changes"] == 3
    assert s["next_year_file"] == "output/final/roster - 2027.xlsx"
    # the Tasks app offers an Open button for the next-year file too (the final roster is workbook_path)
    assert report["extra_paths"] == [{"label": "Next-year roster", "path": "output/final/roster - 2027.xlsx"}]
    assert (p.root / report["extra_paths"][0]["path"]).is_file()


def test_backup_and_audit_log(done):
    p = done
    backups = list(p.paths.backups_dir.iterdir())
    assert [b.name for b in backups] == [f"roster.{p.master_sha[:8]}.xlsx"]
    assert backups[0].read_bytes() == p.paths.roster.read_bytes()

    entries = [f for f in p.paths.audit_dir.iterdir() if f.suffix == ".json"]
    assert len(entries) == 1
    audit = load(entries[0])
    assert audit["approver"] == getpass.getuser() and audit["approver_source"] == "getpass"
    assert audit["cycle"]["label"] == "Dec 2026"
    assert audit["inputs"]["master"]["sha256"] == p.master_sha
    assert audit["inputs"]["matrix"]["name"] == "holiday-roster.xlsx"
    assert audit["inputs"]["pto"]["name"] == "pto-import.xlsx"
    assert audit["counts"]["user_changes"] == 3 and audit["counts"]["cells_written"] == len(audit["written"])
    assert audit["extra"]["task"] == "shift-roster" and audit["extra"]["cycle_id"] == "2026-12"
    assert audit["extra"]["answers"]["name"] == "ask-me-answers.json"
    written = {(w["person"], w["date"]): w for w in audit["written"]}
    assert written[("Person 01", "2026-12-07")]["after"] == "PTO"
    assert len(audit["diff"]["changes"]) == 3
    log = (p.paths.audit_dir / "audit.log.jsonl").read_text(encoding="utf-8").strip().splitlines()
    assert len(log) == 1 and json.loads(log[0])["run_id"] == audit["run_id"]
    assert p.report()["summary"]["audit"] == f"output/audit/{audit['run_id']}.json"
    assert p.report()["summary"]["backup"] == f"output/backups/{backups[0].name}"


def test_next_year_file_for_the_part_of_the_cycle_beyond_the_roster(done):
    p = done
    path = p.paths.final_dir / "roster - 2027.xlsx"
    assert path.exists()
    plan = Plan.from_json(p.paths.plan.read_text(encoding="utf-8"))
    roster = load_roster(path)
    assert roster.first_date == date(2027, 1, 2) and len(roster.dates) == 153
    cells = grid(path)
    names = {n for n, _ in cells}
    assert len(names) == 16
    for (name, d), text in cells.items():
        assert text == plan.remainder_edits.get((name, d), ""), (name, d)
    assert any(text for text in cells.values())
    assert roster.holiday_labels()[date(2027, 1, 26)] == "Test Republic Day"
    # the sources are untouched
    assert sha256_file(p.paths.roster) == p.master_sha
    ny = p.report()["summary"]["next_year"]
    assert ny["start"] == "2027-01-02" and ny["cells_written"] == sum(1 for t in plan.remainder_edits.values() if t)
    assert ny["warnings"]  # e.g. the file is not a full year long


def test_config_is_updated_after_the_final_with_a_timestamped_backup(done):
    p = done
    backups = list(p.paths.config_backups.iterdir())
    assert len(backups) == 1 and backups[0].name.startswith("rotation-config.")
    assert backups[0].read_bytes() == p.old_config
    new = load_config(p.paths.config)
    assert new.find("Person 14") is not None and new.find("Gone Person") is None
    assert new.find("Person 01").shift == "S1"  # the swapped shift is the new baseline
    plan = Plan.from_json(p.paths.plan.read_text(encoding="utf-8"))
    assert new.to_dict() == plan.config_after.to_dict()
    assert p.report()["summary"]["config_backup"] == f"config/backups/{backups[0].name}"


def test_a_finished_run_cannot_be_finalized_again(done, capsys):
    p = done
    final_files = sorted(f.name for f in p.paths.final_dir.iterdir())
    assert p.finalize() == 1
    err = capsys.readouterr().err
    assert "the rotation config changed since the analysis" in err and "start a new run" in err
    assert sorted(f.name for f in p.paths.final_dir.iterdir()) == final_files


def test_rerun_after_a_crash_before_the_config_was_saved_reuses_the_final(done):
    p = done
    finals = {f.name: sha256_file(f) for f in p.paths.final_dir.iterdir()}
    p.paths.config.write_bytes(p.old_config)  # as if the step died before the config save
    shutil.rmtree(p.paths.config_backups)
    assert p.finalize() == 0
    assert {f.name: sha256_file(f) for f in p.paths.final_dir.iterdir()} == finals  # no " (2)"
    assert len([f for f in p.paths.audit_dir.iterdir() if f.suffix == ".json"]) == 2  # append-only
    assert len((p.paths.audit_dir / "audit.log.jsonl").read_text().splitlines()) == 2
    assert not (p.paths.output / ".next-year-staging").exists()
    assert not [f for f in p.paths.output.iterdir() if f.name.endswith((".tmp", ".xlsx"))
                and f.name != "Roster DRAFT 2026-12.xlsx"]


def test_cycle_inside_the_file_has_no_next_year_file(tmp_path):
    p = Pipeline(tmp_path / "t")
    assert p.prepare() == 0 and p.analyze("2026-10") == 0
    p.answer()
    assert p.build_draft() == 0
    p.pmo_edit({("Person 06", date(2026, 10, 14)): "Shift-3"})
    assert p.diff() == 0 and p.diff_json()["blocking"] == []
    assert p.finalize() == 0
    names = sorted(f.name for f in p.paths.final_dir.iterdir())
    assert names == ["roster - final Oct 2026.xlsx"]
    s = p.report()["summary"]
    assert s["cycle"] == "2026-10" and s["next_year_file"] is None and s["next_year"] is None
    assert "extra_paths" not in p.report()  # no next-year file: nothing extra to open
    final = grid(p.paths.final_dir / names[0])
    assert final[("Person 06", date(2026, 10, 14))] == "Shift-3"
    assert load_config(p.paths.config).find("Person 14") is not None


# ---- refusals ---------------------------------------------------------------------------------

def refused(tmp_path, capsys, tamper) -> tuple[Pipeline, str]:
    p = Pipeline(tmp_path / "t")
    p.run_to_diff(EDITS)
    master_sha = sha256_file(p.paths.roster)
    tamper(p)
    config = p.paths.config.read_bytes()  # whatever the test left; finalize must not touch it
    capsys.readouterr()
    assert p.finalize() == 1
    err = capsys.readouterr().err
    assert err.startswith("ERROR: ") and "Traceback" not in err
    if sha256_file(p.paths.roster) == master_sha:
        nothing_built(p, master_sha, config)
    return p, err


def test_refuses_a_blocking_diff(tmp_path, capsys):
    def tamper(p):
        side = Path(str(p.draft()) + ".snapshot.json")
        data = json.loads(side.read_text(encoding="utf-8"))
        data["cells"][0][2] = "Shift-9"
        side.write_text(json.dumps(data), encoding="utf-8")
        assert p.diff() == 0 and p.diff_json()["blocking"]

    _, err = refused(tmp_path, capsys, tamper)
    assert "the confirmed diff has blocking issues" in err and "SNAPSHOT_TAMPERED" in err


def test_refuses_when_the_master_changed_between_draft_and_finalize(tmp_path, capsys):
    def tamper(p):
        synth.patch_master(p.world, {("Person 06", date(2026, 12, 3)): "Shift-3"})

    p, err = refused(tmp_path, capsys, tamper)
    assert "the roster workbook changed since the analysis" in err
    # the changed master is left exactly as the user's own edit made it
    assert grid(p.paths.roster)[("Person 06", date(2026, 12, 3))] == "Shift-3"


def test_refuses_when_the_diff_blocked_on_a_changed_master(tmp_path, capsys):
    def tamper(p):
        synth.patch_master(p.world, {("Person 06", date(2026, 12, 3)): "Shift-3"})
        assert p.diff() == 0
        assert [b["kind"] for b in p.diff_json()["blocking"]] == ["MASTER_CHANGED"]

    _, err = refused(tmp_path, capsys, tamper)
    assert "the roster workbook changed since the analysis" in err


def test_refuses_when_the_draft_changed_after_the_confirmation(tmp_path, capsys):
    def tamper(p):
        p.pmo_edit({("Person 09", date(2026, 12, 10)): "NS"})  # saved again after the diff

    _, err = refused(tmp_path, capsys, tamper)
    assert "changed after you confirmed" in err


def test_refuses_when_the_confirmed_diff_no_longer_matches(tmp_path, capsys):
    def tamper(p):
        d = p.diff_json()
        d["changes"] = d["changes"][:-1]  # the file the user saw is not what the draft holds
        p.paths.diff.write_text(json.dumps(d), encoding="utf-8")

    _, err = refused(tmp_path, capsys, tamper)
    assert "no longer match the comparison you confirmed" in err


@pytest.mark.parametrize("what", ["holidays", "config", "pto"])
def test_refuses_when_another_input_changed(tmp_path, capsys, what):
    def tamper(p):
        path = {"holidays": p.paths.holidays, "config": p.paths.config, "pto": p.paths.pto}[what]
        if what == "config":
            cfg = json.loads(path.read_text(encoding="utf-8"))
            cfg["seed"] = 8
            path.write_text(json.dumps(cfg), encoding="utf-8")
        else:
            path.write_bytes(path.read_bytes() + b"\0")

    _, err = refused(tmp_path, capsys, tamper)
    assert "changed since the analysis" in err


def test_refuses_without_the_confirmed_diff_or_the_draft(tmp_path, capsys):
    def no_diff(p):
        p.paths.diff.unlink()

    _, err = refused(tmp_path, capsys, no_diff)
    assert "the confirmed diff not found" in err

    def no_draft(p):
        p.draft().unlink()

    _, err = refused(tmp_path / "second", capsys, no_draft)
    assert "Roster DRAFT 2026-12.xlsx is missing" in err


def test_refuses_without_a_plan_or_analysis(tmp_path, capsys):
    p = Pipeline(tmp_path / "t")
    assert p.finalize() == 1
    assert "the analysis not found" in capsys.readouterr().err
    p.run_to_diff(EDITS)
    p.paths.plan.unlink()
    assert p.finalize() == 1
    assert "the plan is missing" in capsys.readouterr().err
