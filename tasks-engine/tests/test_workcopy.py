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


# ---- user data inside shared/ (roster/Names.xlsx, roster-reference/*.xls*) ----

def _put_user_data(work: Path) -> dict:
    keep = {
        work / "shared" / "roster" / "Names.xlsx": "my names",
        work / "shared" / "roster-reference" / "Holiday Roster 2026.xlsx": "my holidays",
        work / "shared" / "roster-reference" / "PDT_Staff_Roster.xls": "old format",
        work / "shared" / "roster-reference" / "Macro.xlsm": "macro book",
        work / "shared" / "roster-reference" / "codes.csv": "a,b",
        work / "shared" / "roster-reference" / "2027" / "Holiday Roster 2027.xlsx": "nested",
        work / "shared" / "roster-reference" / "2027" / "deep" / "extra.json": "{}",
    }
    for path, text in keep.items():
        write(path, text)
    return keep


def _assert_kept(keep: dict):
    for path, text in keep.items():
        assert path.read_text() == text, path


@pytest.fixture
def shipped(defs):
    """The install ships code and docs in the two data folders, but no data."""
    write(defs / "shared" / "roster" / "name_matching.py", "match v1")
    write(defs / "shared" / "roster-reference" / "README.md", "drop files here")
    return defs


def test_protected_shared_data_survives_a_sync(shipped, tmp_path):
    work = tmp_path / "work"
    workcopy.sync(shipped, work)
    keep = _put_user_data(work)

    workcopy.sync(shipped, work)

    _assert_kept(keep)
    assert (work / "shared" / "roster" / "name_matching.py").read_text() == "match v1"
    assert (work / "shared" / "roster-reference" / "README.md").is_file()


def test_protected_data_survives_when_its_folder_is_not_shipped_at_all(defs, tmp_path):
    # roster-reference/ is not in the definitions: the folder must not be pruned wholesale
    work = tmp_path / "work"
    workcopy.sync(defs, work)
    keep = _put_user_data(work)
    write(work / "shared" / "roster-reference" / "stray.py", "not data")

    workcopy.sync(defs, work)

    _assert_kept(keep)
    assert not (work / "shared" / "roster-reference" / "stray.py").exists()


def test_shipped_code_in_the_data_folders_is_still_mirrored_and_pruned(shipped, tmp_path):
    work = tmp_path / "work"
    workcopy.sync(shipped, work)
    keep = _put_user_data(work)
    write(work / "shared" / "roster" / "stale_module.py", "removed upstream")
    write(work / "shared" / "roster" / "notes.txt", "not a data extension")
    write(work / "shared" / "roster-reference" / "2027" / "scratch.py", "stale code in a user folder")
    write(shipped / "shared" / "roster" / "name_matching.py", "match v2 - longer")
    write(shipped / "shared" / "roster" / "extra.py", "new module")
    (shipped / "shared" / "roster-reference" / "README.md").unlink()

    workcopy.sync(shipped, work)

    assert (work / "shared" / "roster" / "name_matching.py").read_text() == "match v2 - longer"
    assert (work / "shared" / "roster" / "extra.py").is_file()
    assert not (work / "shared" / "roster" / "stale_module.py").exists()
    assert not (work / "shared" / "roster" / "notes.txt").exists()
    assert not (work / "shared" / "roster-reference" / "README.md").exists()
    assert not (work / "shared" / "roster-reference" / "2027" / "scratch.py").exists()
    _assert_kept(keep)


def test_a_stale_data_file_outside_the_data_folders_is_still_removed(shipped, tmp_path):
    work = tmp_path / "work"
    workcopy.sync(shipped, work)
    write(work / "shared" / "lib" / "old_table.json", "shipped once, gone now")
    write(work / "shared" / "lib" / "old_book.xlsx", "same")
    write(work / "shared" / "Names.xlsx", "wrong folder")
    write(work / "shared" / "roster_lib" / "examples" / "a.xlsx", "similar name, not a data folder")

    workcopy.sync(shipped, work)

    assert not (work / "shared" / "lib" / "old_table.json").exists()
    assert not (work / "shared" / "lib" / "old_book.xlsx").exists()
    assert not (work / "shared" / "Names.xlsx").exists()
    assert not (work / "shared" / "roster_lib").exists()


def test_a_shipped_file_never_overwrites_a_protected_one_but_seeds_an_absent_one(shipped, tmp_path):
    work = tmp_path / "work"
    workcopy.sync(shipped, work)
    holiday = work / "shared" / "roster-reference" / "Holiday Roster 2026.xlsx"
    write(work / "shared" / "roster" / "Names.xlsx", "my names")
    write(shipped / "shared" / "roster" / "Names.xlsx", "someone else's names")
    write(shipped / "shared" / "roster-reference" / "Holiday Roster 2026.xlsx", "default holidays")

    workcopy.sync(shipped, work)
    workcopy.sync(shipped, work)

    assert (work / "shared" / "roster" / "Names.xlsx").read_text() == "my names"
    assert holiday.read_text() == "default holidays"  # absent -> seeded once
    holiday.write_text("my edit")
    workcopy.sync(shipped, work)
    assert holiday.read_text() == "my edit"


def test_protected_data_survives_a_shipped_file_taking_its_folders_name(shipped, tmp_path):
    work = tmp_path / "work"
    workcopy.sync(shipped, work)
    keep = _put_user_data(work)
    write(shipped / "shared" / "roster-reference" / "2027", "a file where the user has a folder")

    workcopy.sync(shipped, work)

    _assert_kept(keep)
    assert (work / "shared" / "roster-reference" / "2027").is_dir()


def test_syncing_with_protected_data_is_idempotent(shipped, tmp_path, monkeypatch):
    work = tmp_path / "work"
    workcopy.sync(shipped, work)
    keep = _put_user_data(work)
    workcopy.sync(shipped, work)
    snapshot = sorted(str(p.relative_to(work)) for p in work.rglob("*"))
    copied = []
    real = workcopy.shutil.copy2
    monkeypatch.setattr(workcopy.shutil, "copy2", lambda s, d, *a, **k: (copied.append(s), real(s, d, *a, **k))[1])

    workcopy.sync(shipped, work)

    assert sorted(str(p.relative_to(work)) for p in work.rglob("*")) == snapshot
    assert copied == []
    _assert_kept(keep)


def test_protection_ignores_case_so_windows_style_names_survive(shipped, tmp_path):
    work = tmp_path / "work"
    workcopy.sync(shipped, work)
    keep = {
        work / "shared" / "Roster" / "names.XLSX": "mine",
        work / "shared" / "ROSTER-REFERENCE" / "holiday roster.XLS": "mine too",
    }
    for path, text in keep.items():
        write(path, text)

    workcopy.sync(shipped, work)

    _assert_kept(keep)


@pytest.mark.parametrize("rel", [
    "roster/Names.xlsx",
    "roster/names.XLSX",
    "ROSTER\\Names.xlsx",
    "Roster-Reference/Holiday Roster 2026.xls",
    "roster-reference\\2027/deep\\Holiday Roster 2027.XLSM",
    "roster-reference/codes.csv",
    "roster-reference/overrides.json",
    "./roster/Names.xlsx",
    ("roster-reference", "2027", "x.xls"),
])
def test_is_protected_shared_accepts_user_data(rel):
    assert workcopy.is_protected_shared(rel)


@pytest.mark.parametrize("rel", [
    "",
    "Names.xlsx",
    "roster",
    "roster/name_matching.py",
    "roster/README.md",
    "roster-reference/README.md",
    "roster-reference/Picture1.png",
    "roster/~$Names.xlsx",
    "roster/__pycache__/x.pyc",
    "roster_lib/examples/holiday_roster_template.xlsx",
    "roster_lib/examples/rotation_config.example.json",
    "assets/logo.png",
    "rosterx/Names.xlsx",
    "roster/../Names.xlsx",
    "roster/../../outside.xlsx",
    "roster-reference/..\\..\\outside.xlsx",
    "roster/C:/Names.xlsx",
    "C:\\roster\\Names.xlsx",
    "roster/Names.xlsx:stream",
])
def test_is_protected_shared_rejects_code_other_folders_and_traversal(rel):
    assert not workcopy.is_protected_shared(rel)


def test_task_templates_are_still_mirrored_exactly(defs, tmp_path):
    work = tmp_path / "work"
    workcopy.sync(defs, work)
    write(work / "alpha" / "templates" / "extra.xlsx", "not shipped")
    write(work / "alpha" / "templates" / "mail.html", "hand edit")

    workcopy.sync(defs, work)

    assert not (work / "alpha" / "templates" / "extra.xlsx").exists()
    assert (work / "alpha" / "templates" / "mail.html").read_text() == "<p/>"


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
