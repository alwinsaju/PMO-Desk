"""The whole task end to end: as the backend runs it (subprocesses, no stdin) and twice over."""

import json
import subprocess
import sys
from pathlib import Path

from draft_testkit import grid
from pipeline import EDITS, PTO_FIELD, Pipeline
from roster_lib.audit import sha256_file
from synth import answer_defaults, write_run_params

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


def run_script(name: str, root: Path, cwd: Path):
    return subprocess.run([sys.executable, str(SCRIPTS / name), "--task-dir", str(root)],
                          stdin=subprocess.DEVNULL, capture_output=True, text=True,
                          timeout=300, cwd=cwd)


def test_manifest_scripts_run_headless_in_order(tmp_path):
    p = Pipeline(tmp_path / "t")
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    master_sha = sha256_file(p.paths.roster)

    def step(name: str):
        done = run_script(name, p.root, elsewhere)
        assert done.returncode == 0, f"{name}: {done.stderr}"
        assert "Traceback" not in done.stderr
        return done

    step("prepare_options.py")
    assert json.loads(p.paths.options.read_text(encoding="utf-8"))["default"] == "2026-12"
    write_run_params(p.paths, "2026-12")
    step("analyze.py")
    answers = answer_defaults(p.form())
    answers[PTO_FIELD] = "Person 07"
    p.write_answers(answers)
    step("build_draft.py")
    p.pmo_edit(EDITS)
    step("diff_draft.py")
    assert json.loads(p.paths.diff.read_text(encoding="utf-8"))["blocking"] == []
    out = step("finalize.py")
    assert "master unchanged" in out.stdout
    assert p.report()["stage"] == "final"
    assert sha256_file(p.paths.roster) == master_sha

    # a failing step: non-zero exit and the reason on stderr, nothing on stdout needed
    again = run_script("finalize.py", p.root, elsewhere)
    assert again.returncode == 1 and again.stderr.startswith("ERROR: ")
    assert run_script("diff_draft.py", tmp_path / "no-such-task", elsewhere).returncode == 1


def test_two_complete_runs_give_the_same_files(tmp_path):
    runs = []
    for name in ("a", "b"):
        p = Pipeline(tmp_path / name)
        p.run_to_diff(EDITS)
        assert p.finalize() == 0
        runs.append(p)
    a, b = runs
    # (the draft file itself carries its creation time in the Run log, so compare the content)
    for f in ("plan.json", "flags.json", "ask-me.json"):
        assert (a.paths.output / f).read_bytes() == (b.paths.output / f).read_bytes(), f
    for name in ("roster - final Dec 2026.xlsx", "roster - 2027.xlsx"):
        assert grid(a.paths.final_dir / name) == grid(b.paths.final_dir / name)
    da, db = a.diff_json(), b.diff_json()
    for key in ("changes", "outside_changes", "issues", "blocking", "flags"):
        assert da[key] == db[key]
    assert a.paths.config.read_text() == b.paths.config.read_text()
