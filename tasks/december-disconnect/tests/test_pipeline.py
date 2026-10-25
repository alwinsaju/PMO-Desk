"""The whole task end to end: as the backend runs it (subprocesses, no stdin) and twice over."""

import json
import re
import subprocess
import sys
from pathlib import Path

import openpyxl

from _common import sha256_file
from helpers import safe_analytics_swap, safe_main_edit
from pipeline import Pipeline
from synth import WINDOW, WINDOW_TEXT, answer_defaults, write_run_params

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
NAMES = re.compile(r"Sample|Sampel|Hub0|Tester|Alpha|Bravo|Charlie|Delta|Echo|Foxtrot|Golf|Hotel|Juliet")


def run_script(name: str, root: Path, cwd: Path):
    return subprocess.run([sys.executable, str(SCRIPTS / name), "--task-dir", str(root)],
                          stdin=subprocess.DEVNULL, capture_output=True, text=True,
                          timeout=600, cwd=cwd)


def grid(path: Path, sheet: str):
    wb = openpyxl.load_workbook(path)
    return [[c.value for c in row] for row in wb[sheet].iter_rows()]


def test_manifest_scripts_run_headless_in_order_and_log_no_names(tmp_path):
    p = Pipeline(tmp_path / "t")
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    logs = []

    def step(name: str):
        done = run_script(name, p.root, elsewhere)
        logs.append(done.stdout + done.stderr)
        assert done.returncode == 0, f"{name}: {done.stderr}"
        assert "Traceback" not in done.stderr
        return done

    step("prepare_options.py")
    assert json.loads(p.paths.options.read_text(encoding="utf-8"))["default"] == WINDOW
    write_run_params(p.paths)
    step("analyze.py")
    p.write_answers(answer_defaults(p.form()))
    step("build_draft.py")
    p.edit_main(safe_main_edit(p)[0])
    p.edit_analytics(safe_analytics_swap(p)[0])
    step("diff_draft.py")
    assert json.loads(p.paths.diff.read_text(encoding="utf-8"))["blocking"] == []
    out = step("finalize.py")
    assert "final: output/final/" in out.stdout
    assert p.report()["stage"] == "final"
    assert sorted(x.name for x in p.paths.final_dir.iterdir()) == [
        f"Analytics Winter Coverage FINAL {WINDOW_TEXT}.xlsx", f"Winter Coverage FINAL {WINDOW_TEXT}.xlsx"]
    # every log of every step holds counts only
    assert not NAMES.search("\n".join(logs)), NAMES.search("\n".join(logs))

    # failing steps: non-zero exit, ONE readable line on stderr, no traceback, no name
    missing = run_script("diff_draft.py", tmp_path / "no-such-task", elsewhere)
    assert missing.returncode == 1 and missing.stderr.startswith("ERROR: ")
    assert missing.stderr.count("\n") == 1 and "Traceback" not in missing.stderr
    p.paths.staff.write_bytes(b"changed")
    again = run_script("finalize.py", p.root, elsewhere)
    assert again.returncode == 1 and again.stderr.startswith("ERROR: ")
    assert not NAMES.search(again.stderr)


def test_every_script_accepts_help_and_the_task_dir_option(tmp_path):
    for name in ("prepare_options.py", "analyze.py", "build_draft.py", "diff_draft.py", "finalize.py"):
        done = subprocess.run([sys.executable, str(SCRIPTS / name), "--help"], capture_output=True,
                              text=True, stdin=subprocess.DEVNULL, timeout=120)
        assert done.returncode == 0 and "--task-dir" in done.stdout


def test_two_complete_runs_give_the_same_files(tmp_path):
    runs = []
    for name in ("a", "b"):
        p = Pipeline(tmp_path / name)
        p.run_to_draft()
        p.edit_main(safe_main_edit(p)[0])
        p.edit_analytics(safe_analytics_swap(p)[0])
        assert p.diff() == 0 and p.finalize() == 0
        runs.append(p)
    a, b = runs
    for f in ("plan.json", "analytics-plan.json", "flags.json", "ask-me.json",
              "winter-config.effective.json", "analytics-config.effective.json"):
        assert (a.paths.output / f).read_bytes() == (b.paths.output / f).read_bytes(), f
    da, db = a.diff_json(), b.diff_json()
    for key in ("changes", "outside_changes", "issues", "blocking", "flags", "counts"):
        assert da[key] == db[key], key
    # (the workbooks carry their creation time in the file properties: compare the content)
    for name, sheets in ((f"Winter Coverage FINAL {WINDOW_TEXT}.xlsx", ("Winter Plan", "Winter Coverage")),
                         (f"Analytics Winter Coverage FINAL {WINDOW_TEXT}.xlsx", ("Winter Roster", "By Person"))):
        for sheet in sheets:
            assert grid(a.paths.final_dir / name, sheet) == grid(b.paths.final_dir / name, sheet), sheet
    assert a.world.shift_roster_config.read_text() == b.world.shift_roster_config.read_text()


def test_reject_and_rerun_loop(tmp_path):
    """The documented limitation: a blocked confirm step cannot be repaired in place. The PMO rejects,
    the task runs again, the old drafts are archived and the new drafts re-solve with stability."""
    from helpers import breaking_main_edit

    p = Pipeline(tmp_path / "t")
    p.run_to_draft()
    edit, _ = breaking_main_edit(p)
    p.edit_main(edit)
    assert p.diff() == 0 and p.diff_json()["blocking"]
    assert p.finalize() == 1  # refused
    # reject -> run again from the start
    assert p.analyze() == 0
    p.answer()
    assert p.build_draft() == 0
    assert len(list(p.paths.archive_dir.iterdir())) == 1
    assert p.diff() == 0 and p.diff_json()["blocking"] == [] and p.diff_json()["changes"] == []
    assert p.finalize() == 0
    # the archived draft still holds the PMO's rule-breaking edit
    archived = next(p.paths.archive_dir.iterdir()) / f"Winter Coverage DRAFT {WINDOW_TEXT}.xlsx"
    assert sha256_file(archived) != sha256_file(p.main_draft())
