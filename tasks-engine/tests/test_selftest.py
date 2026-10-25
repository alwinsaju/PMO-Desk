"""The first-run self-test: real libraries, fixture data only, failures reported not raised."""
import json
import subprocess
import sys
from pathlib import Path

import selftest

REPO = Path(selftest.__file__).resolve().parents[1]
TASKS = REPO / "tasks"


def by_id(report):
    return {c["id"]: c for c in report["checks"]}


def test_everything_passes_on_the_shipped_libraries_and_fixtures():
    report = selftest.run_selftest(TASKS)

    assert report["ok"] is True, report
    checks = by_id(report)
    assert set(checks) == {"python", "packages", "libraries", "step"}
    assert all(c["ok"] for c in checks.values())
    assert "numpy" in checks["packages"]["detail"] and "scipy" in checks["packages"]["detail"]
    assert "RotationConfig" in checks["libraries"]["detail"]
    assert "20 fixture rows" in checks["step"]["detail"]


def test_a_missing_package_is_reported_with_its_name_and_the_rest_still_runs():
    report = selftest.run_selftest(TASKS, modules={"openpyxl": "openpyxl", "no_such_package_xyz": "no-such-package-xyz"})

    checks = by_id(report)
    assert report["ok"] is False
    assert checks["packages"]["ok"] is False and "no_such_package_xyz" in checks["packages"]["detail"]
    assert checks["libraries"]["ok"] and checks["step"]["ok"]


def test_missing_shared_libraries_are_reported(tmp_path, monkeypatch):
    monkeypatch.delenv("AI_OS_TASKS_DATA_DIR", raising=False)
    monkeypatch.delenv("AI_OS_TASKS_DIR", raising=False)
    monkeypatch.setattr(selftest, "ENGINE_DIR", tmp_path / "engine")

    report = selftest.run_selftest(tmp_path / "empty")

    assert by_id(report)["libraries"]["ok"] is False
    assert "shared task libraries" in by_id(report)["libraries"]["detail"]


def test_a_failing_step_surfaces_its_error(monkeypatch):
    monkeypatch.setattr(selftest, "STEP_SCRIPT", "raise SystemExit('step exploded')")

    report = selftest.run_selftest(TASKS)

    step = by_id(report)["step"]
    assert report["ok"] is False and step["ok"] is False
    assert "step exploded" in step["detail"]


def test_it_never_leaves_files_behind_or_touches_the_task_folders(tmp_path, monkeypatch):
    before = sorted(p.relative_to(TASKS).as_posix() for p in TASKS.rglob("*") if p.is_file() and "__pycache__" not in p.parts)
    selftest.run_selftest(TASKS)
    after = sorted(p.relative_to(TASKS).as_posix() for p in TASKS.rglob("*") if p.is_file() and "__pycache__" not in p.parts)
    assert before == after


def test_the_command_line_prints_one_json_object():
    done = subprocess.run([sys.executable, str(Path(selftest.__file__)), "--tasks-dir", str(TASKS)],
                          capture_output=True, text=True, timeout=180)

    assert done.returncode == 0, done.stderr[-500:]
    report = json.loads(done.stdout)
    assert report["ok"] is True and report["python"].count(".") == 2
