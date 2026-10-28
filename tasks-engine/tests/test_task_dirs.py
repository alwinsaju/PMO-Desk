"""A task's data folders (input/, output/, config/ and the folders its manifest
paths live in) are gitignored and not shipped, so they must be created by the
engine before anything runs in them."""
import asyncio
import json
import os
import shutil
import subprocess
import sys
import time

import pytest
from conftest import make_client

import main as backend
import workcopy

WRITE_OUTPUT = "from pathlib import Path\nPath('output/result.txt').write_text('done')\nprint('wrote')\n"


def bare_task(root, manifest_extra=None, script=WRITE_OUTPUT):
    """A task folder with a manifest and one script and NOTHING else."""
    folder = root / "bare"
    (folder / "scripts").mkdir(parents=True)
    manifest = {
        "id": "bare",
        "displayName": "Bare",
        "steps": [{"id": "write", "type": "python", "cmd": "scripts/write.py"}],
        **(manifest_extra or {}),
    }
    (folder / "task.json").write_text(json.dumps(manifest))
    (folder / "scripts" / "write.py").write_text(script)
    return folder


def test_a_step_that_writes_into_output_succeeds_in_a_folder_that_has_none(tmp_path):
    folder = bare_task(tmp_path)
    task = backend.Task(json.loads((folder / "task.json").read_text()), folder)  # not through discovery
    assert not (folder / "output").exists()

    asyncio.run(backend.run_steps(task, task.steps))

    assert task.state == "resting", task.error
    assert (folder / "output" / "result.txt").read_text() == "done"


def test_discovery_creates_the_folders_too(tmp_path):
    folder = bare_task(tmp_path)

    backend.discover_tasks()

    for name in ("input", "output", "config"):
        assert (folder / name).is_dir()


def test_the_run_endpoint_works_end_to_end_without_the_folders(tmp_path):
    folder = bare_task(tmp_path)
    backend.discover_tasks()
    shutil.rmtree(folder / "output")  # e.g. cleaned up by hand after discovery
    with make_client() as client:
        assert client.post("/tasks/bare/start").json()["ok"]
        for _ in range(500):
            if backend.tasks["bare"].state != "working":
                break
            time.sleep(0.02)
    assert backend.tasks["bare"].state == "resting", backend.tasks["bare"].error
    assert (folder / "output" / "result.txt").is_file()


def test_prepare_finds_its_output_folder(tmp_path):
    script = "from pathlib import Path\nPath('output/options.json').write_text('{\"cycles\": []}')\n"
    folder = bare_task(
        tmp_path,
        {
            "inputs": [
                {"id": "roster", "type": "file", "accept": [".xlsx"], "dest": "input/roster.xlsx"},
                {"id": "cycle", "type": "select", "optionsFile": "output/options.json", "optionsKey": "cycles"},
            ],
            "prepare": {"cmd": "scripts/prepare.py", "after": ["roster"]},
        },
    )
    (folder / "scripts" / "prepare.py").write_text(script)
    task = backend.Task(json.loads((folder / "task.json").read_text()), folder)
    backend.tasks["bare"] = task
    (folder / "input").mkdir()
    (folder / "input" / "roster.xlsx").write_bytes(b"x")
    assert not (folder / "output").exists()

    result = backend._run_prepare(task, folder / "scripts" / "prepare.py")

    assert result.returncode == 0, result.stderr
    assert (folder / "output" / "options.json").is_file()


def test_the_folders_of_manifest_paths_are_created(tmp_path):
    folder = bare_task(
        tmp_path,
        {
            "inputs": [
                {"id": "a", "type": "file", "accept": [".xlsx"], "dest": "input/sub/deeper/a.xlsx"},
                {"id": "b", "type": "select", "optionsFile": "output/opts/options.json", "optionsKey": "x"},
            ],
            "steps": [
                {"id": "write", "type": "python", "cmd": "scripts/write.py"},
                {"id": "ask", "type": "review", "gate": {"type": "form", "schema": "output/forms/ask.json", "answers": "output/answers/a.json"}},
                {"id": "diff", "type": "confirm", "gate": {"type": "diff", "file": "output/diffs/d.json"}},
            ],
        },
    )

    backend.discover_tasks()

    for rel in ("input/sub/deeper", "output/opts", "output/forms", "output/answers", "output/diffs"):
        assert (folder / rel).is_dir(), rel
    assert not (folder / "output" / "opts" / "options.json").exists()  # only folders, never files


@pytest.mark.parametrize(
    "bad",
    ["../escape/a.xlsx", "input/../../escape/a.xlsx", "/abs/escape/a.xlsx", "C:/escape/a.xlsx", "other/a.xlsx", "input", "output/\x00/a"],
)
def test_manifest_paths_that_leave_the_task_are_ignored(tmp_path, bad):
    folder = bare_task(tmp_path, {"inputs": [{"id": "a", "type": "file", "accept": [".xlsx"], "dest": bad}]})

    backend.discover_tasks()

    assert sorted(p.name for p in tmp_path.iterdir()) == ["bare"]
    assert sorted(p.name for p in folder.iterdir()) == ["config", "input", "output", "scripts", "task.json"]


def test_a_linked_data_folder_is_left_alone(tmp_path):
    folder = bare_task(tmp_path, {"inputs": [{"id": "a", "type": "file", "accept": [".xlsx"], "dest": "input/sub/a.xlsx"}]})
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    try:
        os.symlink(elsewhere, folder / "input", target_is_directory=True)
    except (OSError, NotImplementedError):
        if sys.platform != "win32":
            pytest.skip("cannot create a symlink here")
        done = subprocess.run(["cmd", "/c", "mklink", "/J", str(folder / "input"), str(elsewhere)], capture_output=True)
        if done.returncode != 0:
            pytest.skip("cannot create a symlink or junction here")

    backend.discover_tasks()

    assert list(elsewhere.iterdir()) == []  # nothing was created through the link


def test_an_unwritable_location_is_logged_not_raised(tmp_path, monkeypatch, caplog):
    folder = bare_task(tmp_path)
    task = backend.Task(json.loads((folder / "task.json").read_text()), folder)
    real = backend.Path.mkdir

    def refuse(self, *a, **k):
        if self.name == "output":
            raise PermissionError("read-only")
        return real(self, *a, **k)

    monkeypatch.setattr(backend.Path, "mkdir", refuse)
    backend._ensure_task_dirs(task)  # must not raise

    assert "could not create" in caplog.text


# --- the working copy creates them even when the definitions ship none ---------------


def test_sync_creates_the_data_folders_for_every_task_when_the_definitions_have_none(tmp_path):
    defs = tmp_path / "defs"
    for name in ("alpha", "beta"):
        (defs / name / "scripts").mkdir(parents=True)
        (defs / name / "task.json").write_text(json.dumps({"id": name, "steps": []}))
        (defs / name / "scripts" / "run.py").write_text("print(1)")
    work = tmp_path / "work"

    workcopy.sync(defs, work)

    for name in ("alpha", "beta"):
        for folder in ("input", "output", "config"):
            assert (work / name / folder).is_dir(), (name, folder)


def test_sync_keeps_existing_data_when_it_creates_the_folders(tmp_path):
    defs = tmp_path / "defs"
    (defs / "alpha").mkdir(parents=True)
    (defs / "alpha" / "task.json").write_text(json.dumps({"id": "alpha", "steps": []}))
    work = tmp_path / "work"
    (work / "alpha" / "output").mkdir(parents=True)
    (work / "alpha" / "output" / "mine.xlsx").write_text("keep")

    workcopy.sync(defs, work)
    workcopy.sync(defs, work)

    assert (work / "alpha" / "output" / "mine.xlsx").read_text() == "keep"
    assert (work / "alpha" / "input").is_dir() and (work / "alpha" / "config").is_dir()


def test_a_bare_installed_task_runs_through_the_working_copy(tmp_path):
    """The installed-app path end to end: definitions with no data folders, synced, then run."""
    defs = tmp_path / "defs"
    folder = bare_task(defs)  # defs/bare
    assert sorted(p.name for p in folder.iterdir()) == ["scripts", "task.json"]
    work = tmp_path / "work" / "tasks"
    workcopy.sync(defs, work)
    task = backend.Task(json.loads((work / "bare" / "task.json").read_text()), work / "bare")

    asyncio.run(backend.run_steps(task, task.steps))

    assert task.state == "resting", task.error
    assert (work / "bare" / "output" / "result.txt").read_text() == "done"
