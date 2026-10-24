"""task.json against the task platform contract, the files the scripts really produce and the
tasks engine's own manifest reader."""

import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

from _common import Paths

TASK = Path(__file__).resolve().parents[1]
MANIFEST = json.loads((TASK / "task.json").read_text(encoding="utf-8"))
PATHS = Paths(TASK)
ENGINE = Path(__file__).resolve().parents[3] / "tasks-engine"


def test_manifest_shape():
    assert MANIFEST["id"] == "december-disconnect" and MANIFEST["displayName"] == "December Disconnect"
    assert MANIFEST["runtime"] == "local"
    assert "final" in MANIFEST["completedMessage"] and "audit log" in MANIFEST["completedMessage"]
    assert "sent" not in MANIFEST["completedMessage"].lower()
    steps = MANIFEST["steps"]
    assert [s["id"] for s in steps] == ["analyze", "answers", "build_draft", "review_draft",
                                        "diff_draft", "confirm_diff", "finalize"]
    assert len({s["id"] for s in steps}) == len(steps)
    assert [s["type"] for s in steps] == ["python", "review", "python", "review", "python",
                                          "confirm", "python"]
    for s in steps:
        assert s.get("label"), s["id"]
        if s["type"] in ("review", "confirm"):
            assert s.get("reviewMessage") and s["gate"]["type"] in ("form", "flags", "diff", "none")
        if s["type"] == "python":
            assert (TASK / s["cmd"]).is_file(), s["cmd"]
            assert " " not in s["cmd"] and s["cmd"].startswith("scripts/")


def test_inputs_and_prepare():
    inputs = {i["id"]: i for i in MANIFEST["inputs"]}
    assert list(inputs) == ["roster", "staff", "analytics_a", "analytics_b", "window"]
    for key in ("roster", "staff", "analytics_a", "analytics_b"):
        i = inputs[key]
        assert i["type"] == "file" and i["accept"] == [".xlsx"] and i["dest"].startswith("input/")
    assert [inputs[k]["required"] for k in inputs] == [True, True, False, False, True]
    # the destinations are the files the scripts read
    assert TASK / inputs["roster"]["dest"] == PATHS.roster
    assert TASK / inputs["staff"]["dest"] == PATHS.staff
    assert TASK / inputs["analytics_a"]["dest"] == PATHS.analytics_a
    assert TASK / inputs["analytics_b"]["dest"] == PATHS.analytics_b
    window = inputs["window"]
    assert (window["type"], window["optionsKey"]) == ("select", "windows")
    assert TASK / window["optionsFile"] == PATHS.options
    prepare = MANIFEST["prepare"]
    assert (TASK / prepare["cmd"]).is_file() and prepare["cmd"] == "scripts/prepare_options.py"
    assert prepare["after"] == ["roster", "staff"]
    assert set(prepare["after"]) <= {k for k, v in inputs.items() if v["type"] == "file"}


def test_gates_point_at_the_files_the_scripts_write():
    gates = {s["id"]: s["gate"] for s in MANIFEST["steps"] if "gate" in s}
    assert TASK / gates["answers"]["schema"] == PATHS.ask_me
    assert TASK / gates["answers"]["answers"] == PATHS.answers
    assert TASK / gates["review_draft"]["file"] == PATHS.flags
    assert TASK / gates["confirm_diff"]["file"] == PATHS.diff
    assert [gates[k]["type"] for k in ("answers", "review_draft", "confirm_diff")] == [
        "form", "flags", "diff"]


def test_the_review_messages_tell_where_the_drafts_are():
    steps = {s["id"]: s for s in MANIFEST["steps"]}
    assert "Analytics" in steps["review_draft"]["reviewMessage"]
    assert "output folder" in steps["review_draft"]["reviewMessage"]


def test_scripts_document_every_manifest_path():
    """The module docstrings (the scripts' own spec) name the files the manifest refers to."""
    text = {n: (TASK / "scripts" / f"{n}.py").read_text(encoding="utf-8")
            for n in ("prepare_options", "analyze", "build_draft", "diff_draft", "finalize")}
    assert "output/options.json" in text["prepare_options"]
    assert "output/ask-me.json" in text["analyze"] and "output/analysis.json" in text["analyze"]
    for name in ("plan.json", "flags.json", "report-data.json"):
        assert f"output/{name}" in text["build_draft"]
    assert "output/roster-diff.json" in text["diff_draft"]
    assert "output/final/" in text["finalize"] and "config/backups/" in text["finalize"]


def test_agent_md_core_instructions_stay_short():
    """Older runtimes truncate TASK.md: the core instructions must fit in 4000 characters."""
    text = (TASK / "TASK.md").read_text(encoding="utf-8")
    assert len(text) < 4000
    for heading in ("Purpose", "Inputs", "Current Workflow", "Testing"):
        assert re.search(rf"^## {heading}", text, re.M), heading


def test_readme_has_the_required_sections():
    text = (TASK / "README.md").read_text(encoding="utf-8")
    for heading in ("How it works", "Inputs", "Rules", "Review and confirm", "Decisions and assumptions"):
        assert re.search(rf"^## .*{heading}", text, re.M), heading
    assert "winter-config.json" in text and "exclusions.people" in text


def test_tracked_text_files_hold_no_personal_data_markers():
    """Cheap guard: no e-mail addresses in the task's tracked files."""
    for path in [TASK / "README.md", TASK / "TASK.md", TASK / "task.json",
                 *sorted((TASK / "scripts").glob("*.py")), *sorted((TASK / "tests").glob("*.py"))]:
        assert not re.search(r"[\w.]+@[\w-]+\.\w+", path.read_text(encoding="utf-8")), path.name


def test_input_output_and_config_folders_are_gitignored():
    repo = TASK.parent.parent
    probes = ["input/roster.xlsx", "output/flags.json", "output/final/x.xlsx", "config/winter-config.json",
              "config/analytics-config.json", "config/task-config.json"]
    try:
        done = subprocess.run(["git", "check-ignore", *[f"tasks/december-disconnect/{p}" for p in probes]],
                              cwd=repo, capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.SubprocessError):
        pytest.skip("git is not available")
    if done.returncode == 128:
        pytest.skip("not a git checkout")
    ignored = {line.strip() for line in done.stdout.splitlines()}
    assert ignored == {f"tasks/december-disconnect/{p}" for p in probes}, done.stdout
    # and the task's code is NOT ignored
    code = subprocess.run(["git", "check-ignore", "tasks/december-disconnect/scripts/finalize.py",
                           "tasks/december-disconnect/task.json"], cwd=repo, capture_output=True,
                          text=True, timeout=60)
    assert code.returncode == 1 and code.stdout.strip() == ""


@pytest.mark.skipif(not (ENGINE / "main.py").exists(), reason="the tasks engine is not present")
def test_engine_reads_the_manifest():
    """The engine's own `Task.apply_manifest` accepts task.json (import only; no server, no endpoint)."""
    code = (
        "import json, sys; sys.path.insert(0, sys.argv[1]);"
        "import main as engine; from pathlib import Path;"
        "m = json.loads(Path(sys.argv[2]).read_text(encoding='utf-8'));"
        "t = engine.Task(m, Path(sys.argv[3]));"
        "d = t.to_dict();"
        "print(json.dumps({'id': d['id'], 'runtime': d['runtime'], 'prepare': d['prepare'],"
        " 'inputs': [i['id'] for i in d['inputs']], 'steps': [(s['id'], s['type'], (s['gate'] or {}).get('type')) for s in d['steps']],"
        " 'force_local': t.force_local, 'completed': getattr(t, 'completed_message', None)}))"
    )
    done = subprocess.run([sys.executable, "-c", code, str(ENGINE), str(TASK / "task.json"), str(TASK)],
                          capture_output=True, text=True, timeout=120, cwd=TASK)
    if done.returncode != 0 and "No module named" in done.stderr:
        pytest.skip("the engine's dependencies are not installed in this interpreter: " + done.stderr.strip().splitlines()[-1])
    assert done.returncode == 0, done.stderr[-800:]
    info = json.loads(done.stdout.strip().splitlines()[-1])
    assert info["id"] == "december-disconnect" and info["runtime"] == "local" and info["force_local"] is True
    assert info["prepare"] is True and info["inputs"] == ["roster", "staff", "analytics_a", "analytics_b", "window"]
    assert info["steps"] == [["analyze", "python", None], ["answers", "review", "form"],
                             ["build_draft", "python", None], ["review_draft", "review", "flags"],
                             ["diff_draft", "python", None], ["confirm_diff", "confirm", "diff"],
                             ["finalize", "python", None]]
    assert info["completed"] == MANIFEST["completedMessage"]


def test_cleanup_flag_and_no_persisted_input():
    assert MANIFEST["cleanup"] == {"onComplete": True}
    # every upload is per-run; config/ and output/ are the engine's untouchable areas
    assert not any(i.get("persist") for i in MANIFEST["inputs"])
