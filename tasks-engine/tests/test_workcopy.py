"""The writable working copy: definitions are mirrored, the user's data is never touched."""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

import main as engine
import workcopy

ENGINE_DIR = Path(engine.__file__).resolve().parent


def write(path: Path, text="x"):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


@pytest.fixture
def defs(tmp_path):
    root = tmp_path / "defs"
    write(root / "alpha" / "task.json", json.dumps({"id": "alpha", "steps": []}))
    write(root / "alpha" / "TASK.md", "docs")
    write(root / "alpha" / "scripts" / "run.py", "print('v1')")
    write(root / "alpha" / "templates" / "mail.html", "<p/>")
    write(root / "alpha" / "tests" / "test_alpha.py", "never copied")
    write(root / "alpha" / "scripts" / "__pycache__" / "run.pyc", "junk")
    write(root / "alpha" / "config" / "rotation.json", '{"seed": 1}')
    write(root / "alpha" / "config" / "backups" / "old.json", "never seeded")
    write(root / "shared" / "lib" / "core.py", "core v1")
    write(root / "shared" / "lib" / "tests" / "test_core.py", "never copied")
    write(root / "shared" / "assets" / "logo.png", "png")
    write(root / "notes.md", "a stray root file is ignored")
    return root


def test_first_sync_builds_the_copy_without_tests_or_caches(defs, tmp_path):
    work = tmp_path / "work"

    workcopy.sync(defs, work)

    assert (work / "alpha" / "task.json").is_file()
    assert (work / "alpha" / "scripts" / "run.py").read_text() == "print('v1')"
    assert (work / "alpha" / "templates" / "mail.html").is_file()
    assert (work / "shared" / "lib" / "core.py").read_text() == "core v1"
    assert (work / "shared" / "assets" / "logo.png").is_file()
    assert not (work / "alpha" / "tests").exists()
    assert not (work / "alpha" / "scripts" / "__pycache__").exists()
    assert not (work / "shared" / "lib" / "tests").exists()
    assert not (work / "notes.md").exists()


def test_config_is_seeded_once_without_backups(defs, tmp_path):
    work = tmp_path / "work"
    workcopy.sync(defs, work)
    assert json.loads((work / "alpha" / "config" / "rotation.json").read_text()) == {"seed": 1}
    assert not (work / "alpha" / "config" / "backups").exists()

    # the user edits the config; an upgrade ships a different default
    (work / "alpha" / "config" / "rotation.json").write_text('{"seed": 99}')
    write(defs / "alpha" / "config" / "rotation.json", '{"seed": 2}')
    workcopy.sync(defs, work)

    assert json.loads((work / "alpha" / "config" / "rotation.json").read_text()) == {"seed": 99}


def test_resync_overwrites_changed_files_and_prunes_removed_ones(defs, tmp_path):
    work = tmp_path / "work"
    workcopy.sync(defs, work)
    write(defs / "alpha" / "scripts" / "run.py", "print('v2 - longer')")
    (defs / "alpha" / "templates" / "mail.html").unlink()
    write(defs / "shared" / "lib" / "new.py", "new")
    (defs / "shared" / "lib" / "core.py").unlink()
    # a hand edit inside a definition folder of the copy does not survive
    write(work / "alpha" / "scripts" / "hand_edit.py", "stray")

    workcopy.sync(defs, work)

    assert (work / "alpha" / "scripts" / "run.py").read_text() == "print('v2 - longer')"
    assert not (work / "alpha" / "templates" / "mail.html").exists()
    assert (work / "shared" / "lib" / "new.py").is_file()
    assert not (work / "shared" / "lib" / "core.py").exists()
    assert not (work / "alpha" / "scripts" / "hand_edit.py").exists()


def test_user_data_is_never_touched(defs, tmp_path):
    work = tmp_path / "work"
    workcopy.sync(defs, work)
    keep = {
        work / "alpha" / "input" / "roster.xlsx": "my roster",
        work / "alpha" / "input" / ".uploads-meta.json": "{}",
        work / "alpha" / "output" / "final" / "Roster.xlsx": "my result",
        work / "alpha" / "reference" / "old.xlsx": "mine",
    }
    for path, text in keep.items():
        write(path, text)
    # the definitions now ship an input/ and output/ folder of their own: ignored
    write(defs / "alpha" / "input" / "roster.xlsx", "someone else's file")
    write(defs / "alpha" / "output" / "final" / "Roster.xlsx", "someone else's result")

    workcopy.sync(defs, work)
    workcopy.sync(defs, work)

    for path, text in keep.items():
        assert path.read_text() == text, path


def test_a_task_the_definitions_dropped_is_unlisted_but_keeps_its_data(defs, tmp_path):
    work = tmp_path / "work"
    workcopy.sync(defs, work)
    write(work / "alpha" / "output" / "result.xlsx", "keep me")
    for path in sorted((defs / "alpha").rglob("*"), reverse=True):
        path.unlink() if path.is_file() else path.rmdir()
    (defs / "alpha").rmdir()

    workcopy.sync(defs, work)

    assert not (work / "alpha" / "task.json").exists()
    assert (work / "alpha" / "output" / "result.xlsx").read_text() == "keep me"


def test_a_locked_file_does_not_stop_the_sync(defs, tmp_path, monkeypatch):
    work = tmp_path / "work"
    real = workcopy.shutil.copy2

    def flaky(src, dst, *a, **kw):
        if str(src).endswith("run.py"):
            raise PermissionError("locked")
        return real(src, dst, *a, **kw)

    monkeypatch.setattr(workcopy.shutil, "copy2", flaky)

    workcopy.sync(defs, work)  # must not raise

    assert (work / "alpha" / "task.json").is_file()
    assert not (work / "alpha" / "scripts" / "run.py").exists()


def test_unchanged_files_are_not_copied_again(defs, tmp_path, monkeypatch):
    work = tmp_path / "work"
    workcopy.sync(defs, work)
    copied = []
    real = workcopy.shutil.copy2
    monkeypatch.setattr(workcopy.shutil, "copy2", lambda s, d, *a, **k: (copied.append(s), real(s, d, *a, **k))[1])

    workcopy.sync(defs, work)

    assert copied == []


def test_the_engine_runs_from_the_working_copy_when_a_data_dir_is_set(defs, tmp_path):
    data = tmp_path / "userdata"
    env = {**os.environ, "AI_OS_TASKS_DIR": str(defs), "AI_OS_TASKS_DATA_DIR": str(data)}
    code = (
        "import json, main;"
        "print(json.dumps({'root': str(main.TASKS_ROOT), 'history': str(main.HISTORY_FILE),"
        " 'tasks': sorted(main.tasks), 'folder': str(main.tasks['alpha'].folder)}))"
    )

    done = subprocess.run([sys.executable, "-I", "-c", f"import sys; sys.path.insert(0, {str(ENGINE_DIR)!r}); {code}"],
                          capture_output=True, text=True, env=env, timeout=120, cwd=tmp_path)

    assert done.returncode == 0, done.stderr[-800:]
    info = json.loads(done.stdout.strip().splitlines()[-1])
    assert Path(info["root"]) == (data / "tasks").resolve()
    assert Path(info["history"]) == (data / "history.jsonl").resolve()
    assert info["tasks"] == ["alpha"]
    assert Path(info["folder"]) == (data / "tasks" / "alpha").resolve()
    assert (data / "tasks" / "shared" / "lib" / "core.py").is_file()


def test_without_a_data_dir_the_engine_runs_in_place(defs, tmp_path):
    env = {k: v for k, v in os.environ.items() if k != "AI_OS_TASKS_DATA_DIR"}
    env["AI_OS_TASKS_DIR"] = str(defs)
    code = "import main; print(main.TASKS_ROOT, main.HISTORY_FILE.parent)"

    done = subprocess.run([sys.executable, "-I", "-c", f"import sys; sys.path.insert(0, {str(ENGINE_DIR)!r}); {code}"],
                          capture_output=True, text=True, env=env, timeout=120, cwd=tmp_path)

    assert done.returncode == 0, done.stderr[-800:]
    root, history_dir = done.stdout.strip().splitlines()[-1].split(" ", 1)
    assert Path(root) == defs.resolve()
    assert Path(history_dir) == (ENGINE_DIR / ".data").resolve()
