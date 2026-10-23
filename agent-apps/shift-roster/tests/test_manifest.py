"""agent.json against the task platform contract and the files the scripts really produce."""

import json
import re
from pathlib import Path

import pytest

from _common import Paths

TASK = Path(__file__).resolve().parents[1]
MANIFEST = json.loads((TASK / "agent.json").read_text(encoding="utf-8"))
PATHS = Paths(TASK)


def test_manifest_shape():
    assert MANIFEST["id"] == "shift-roster" and MANIFEST["displayName"] == "Shift Roster"
    assert MANIFEST["runtime"] == "local"
    # plain words for the task-complete notification (the next-year file is conditional)
    message = MANIFEST["completedMessage"]
    assert isinstance(message, str) and 20 < len(message) < 300
    assert "final roster" in message and "audit log" in message and "next-year" in message
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
    assert list(inputs) == ["roster", "holidays", "pto", "cycle"]
    for key in ("roster", "holidays", "pto"):
        i = inputs[key]
        assert i["type"] == "file" and i["accept"] == [".xlsx"] and i["dest"].startswith("input/")
    assert (inputs["roster"]["required"], inputs["holidays"]["required"],
            inputs["pto"]["required"], inputs["cycle"]["required"]) == (True, True, False, True)
    # the destinations are the files the scripts read
    assert TASK / inputs["roster"]["dest"] == PATHS.roster
    assert TASK / inputs["holidays"]["dest"] == PATHS.holidays
    assert TASK / inputs["pto"]["dest"] == PATHS.pto
    cycle = inputs["cycle"]
    assert (cycle["type"], cycle["optionsKey"]) == ("select", "cycles")
    assert TASK / cycle["optionsFile"] == PATHS.options
    prepare = MANIFEST["prepare"]
    assert (TASK / prepare["cmd"]).is_file() and prepare["cmd"] == "scripts/prepare_options.py"
    assert set(prepare["after"]) <= {k for k, v in inputs.items() if v["type"] == "file"}


def test_gates_point_at_the_files_the_scripts_write():
    gates = {s["id"]: s["gate"] for s in MANIFEST["steps"] if "gate" in s}
    assert TASK / gates["answers"]["schema"] == PATHS.ask_me
    assert TASK / gates["answers"]["answers"] == PATHS.answers
    assert TASK / gates["review_draft"]["file"] == PATHS.flags
    assert TASK / gates["confirm_diff"]["file"] == PATHS.diff
    assert [gates[k]["type"] for k in ("answers", "review_draft", "confirm_diff")] == [
        "form", "flags", "diff"]


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
    """Older runtimes truncate AGENT.md: the core instructions must fit in 4000 characters."""
    text = (TASK / "AGENT.md").read_text(encoding="utf-8")
    assert len(text) < 4000
    for heading in ("Purpose", "Inputs", "Current Workflow", "Testing"):
        assert re.search(rf"^## {heading}", text, re.M), heading


def test_tracked_text_files_hold_no_personal_data_markers():
    """Cheap guard: no e-mail addresses in the task's tracked files."""
    for path in [TASK / "README.md", TASK / "AGENT.md", TASK / "agent.json",
                 *sorted((TASK / "scripts").glob("*.py")), *sorted((TASK / "tests").glob("*.py"))]:
        assert not re.search(r"[\w.]+@[\w-]+\.\w+", path.read_text(encoding="utf-8")), path.name


def test_holiday_roster_is_a_persisted_yearly_input_and_the_run_is_cleaned():
    inputs = {i["id"]: i for i in MANIFEST["inputs"]}
    assert inputs["holidays"]["persist"] is True and "once a year" in inputs["holidays"]["label"]
    # the per-run uploads are not persisted (the backend cleans them after a completed run)
    assert not any(inputs[k].get("persist") for k in ("roster", "pto", "cycle"))
    assert MANIFEST["cleanup"] == {"onComplete": True}


def test_no_script_deletes_input_files():
    """The persisted Holiday Roster (and every other upload) is only ever read by the scripts:
    nothing in scripts/ removes a path under input/."""
    import ast

    scripts = TASK / "scripts"
    removers = {"unlink", "remove", "rmtree", "rmdir"}
    for path in sorted(scripts.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                f = node.func
                name = f.attr if isinstance(f, ast.Attribute) else getattr(f, "id", "")
                if name in removers:
                    seg = ast.get_source_segment(path.read_text(encoding="utf-8"), node) or ""
                    assert "holiday" not in seg.lower() and "input" not in seg.lower().replace("input_dir", ""), (path.name, seg)
