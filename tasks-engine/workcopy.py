"""The writable working copy of the task folders.

In the installed app the task definitions (task.json, scripts, shared libraries,
reference workbooks) are read-only files in the install folder, while a task's
inputs, outputs, config and run history are the user's work and must survive a
reinstall. So the engine runs every task from a copy under the app-data folder:

    <data>/tasks/<task>/...   task folders, shared/   (this module's output)
    <data>/history.jsonl                              (written by main.py)

`sync()` refreshes the copy from the definitions on every engine start:

* definition files (task.json, scripts/, templates/, docs, everything in shared/)
  are mirrored exactly: changed files are overwritten, files that no longer exist
  in the definitions are removed;
* user data (input/, output/, reference/, config/) is never overwritten or deleted.
  config/ and reference/ are seeded once from the definitions when absent, so a
  fresh install starts with the shipped defaults and keeps its own edits after;
* tests/ and caches are never copied.

Tasks keep resolving `input/`, `output/` and `../shared` relative to their own
folder, so no task script or manifest needs to know any of this.
"""
import logging
import shutil
from pathlib import Path

log = logging.getLogger("tasks-engine")

# Per task folder: the user's data. Never mirrored, never pruned.
DATA_DIRS = frozenset({"input", "output", "config", "reference"})
# Seeded from the definitions only while the working copy does not have them yet.
SEED_ONCE_DIRS = frozenset({"config", "reference"})
# Always present in a task's working folder, empty if need be.
ENSURED_DIRS = ("input", "output", "config")
# Never copied.
SKIP_NAMES = frozenset({"tests", "__pycache__", ".pytest_cache", ".venv", ".git", "backups"})
SHARED = "shared"


def _skip(name: str) -> bool:
    return name in SKIP_NAMES or name.endswith(".pyc") or name.startswith("~$")


def _same(src: Path, dst: Path) -> bool:
    try:
        a, b = src.stat(), dst.stat()
    except OSError:
        return False
    return a.st_size == b.st_size and a.st_mtime_ns == b.st_mtime_ns


def _copy_file(src: Path, dst: Path) -> None:
    if _same(src, dst):
        return
    try:
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
    except OSError:
        # A locked file must not stop the engine from starting; the next start retries.
        log.warning("could not refresh %s", dst, exc_info=True)


def _remove(path: Path) -> None:
    try:
        if path.is_dir() and not path.is_symlink():
            shutil.rmtree(path)
        else:
            path.unlink()
    except OSError:
        log.warning("could not remove %s", path, exc_info=True)


def _mirror(src: Path, dst: Path) -> None:
    """Make `dst` an exact copy of `src` (minus skipped names)."""
    dst.mkdir(parents=True, exist_ok=True)
    wanted = set()
    for entry in src.iterdir():
        if _skip(entry.name):
            continue
        wanted.add(entry.name)
        target = dst / entry.name
        if entry.is_dir():
            if target.exists() and not target.is_dir():
                _remove(target)
            _mirror(entry, target)
        else:
            if target.is_dir():
                _remove(target)
            _copy_file(entry, target)
    for existing in dst.iterdir():
        if existing.name not in wanted:
            _remove(existing)


def _seed(src: Path, dst: Path) -> None:
    """Copy `src` to `dst` only when `dst` does not exist yet."""
    if dst.exists():
        return
    try:
        shutil.copytree(src, dst, ignore=lambda _d, names: [n for n in names if _skip(n)])
    except OSError:
        log.warning("could not seed %s", dst, exc_info=True)


def _sync_task(src: Path, dst: Path) -> None:
    dst.mkdir(parents=True, exist_ok=True)
    wanted = set()
    for entry in src.iterdir():
        name = entry.name
        if _skip(name):
            continue
        wanted.add(name)
        target = dst / name
        if name in DATA_DIRS:
            if entry.is_dir():
                if name in SEED_ONCE_DIRS:
                    _seed(entry, target)
                else:
                    target.mkdir(exist_ok=True)
            continue
        if entry.is_dir():
            if target.exists() and not target.is_dir():
                _remove(target)
            _mirror(entry, target)
        else:
            if target.is_dir():
                _remove(target)
            _copy_file(entry, target)
    # A definition file or folder that no longer exists is removed; user data stays.
    for existing in dst.iterdir():
        if existing.name not in wanted and existing.name not in DATA_DIRS:
            _remove(existing)
    # The data folders exist even when the definitions ship none (they are
    # gitignored, so the installer does not carry them): scripts write into them.
    for name in ENSURED_DIRS:
        try:
            (dst / name).mkdir(exist_ok=True)
        except OSError:
            log.warning("could not create %s", dst / name, exc_info=True)


def sync(definitions: Path, workdir: Path) -> None:
    """Refresh `workdir` from the task definitions in `definitions`."""
    workdir.mkdir(parents=True, exist_ok=True)
    seen = set()
    for entry in sorted(definitions.iterdir()):
        if not entry.is_dir() or entry.name.startswith(".") or _skip(entry.name):
            continue
        seen.add(entry.name)
        if entry.name == SHARED:
            _mirror(entry, workdir / entry.name)
        elif (entry / "task.json").is_file():
            _sync_task(entry, workdir / entry.name)
    # A task the definitions no longer ship stops being listed; its data stays.
    for existing in workdir.iterdir():
        if existing.is_dir() and existing.name not in seen and (existing / "task.json").is_file():
            (existing / "task.json").unlink(missing_ok=True)

