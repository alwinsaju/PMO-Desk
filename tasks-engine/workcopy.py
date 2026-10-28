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
  in the definitions are removed. The one exception is the user data that lives
  inside shared/ (see "Protected paths in shared/" below);
* user data (input/, output/, reference/, config/) is never overwritten or deleted.
  config/ and reference/ are seeded once from the definitions when absent, so a
  fresh install starts with the shipped defaults and keeps its own edits after;
* tests/ and caches are never copied.

Protected paths in shared/
--------------------------
shared/ is mirrored exactly, but two of its folders hold files the user supplies
and the installer deliberately does not ship (real employee data):

    shared/roster/Names.xlsx            the name list several reports read
    shared/roster-reference/...         Holiday Roster and other reference files

The protection is by DIRECTORY, not by file type, so a user's `.xlsb`, `.txt`,
`.docx`, `.pdf` or `.ods` survives too. A file under shared/ is PROTECTED, and so
never overwritten and never deleted by the mirror, when `is_protected_shared()` is
true for its path relative to shared/:

    the first path component is one of PROTECTED_SHARED_DIRS ("roster",
    "roster-reference") and the file is not code or docs (it does not end in one
    of MIRRORED_EXTS: .py .md), at any depth below that folder.

Matching ignores case and accepts "/" and "\\" as separators. Code and docs in those
folders (and all of the rest of shared/) are still mirrored exactly, so engine
updates keep applying and stale code is still pruned. A folder is removed only once
it holds no protected file. If a definition ever ships a protected file, it is
copied only while the user has no such file yet (seed once, like config/); it never
replaces the user's. Lock files (~$...) and caches are not data and are not
protected. A task's own templates/ is not protected: it holds shipped templates only.

Removals are never silent: every file the mirror deletes is logged at INFO and
`sync()` returns how many there were.

Tasks keep resolving `input/`, `output/` and `../shared` relative to their own
folder, so no task script or manifest needs to know any of this.
"""
import logging
import os
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
# User data inside shared/: never overwritten, never pruned (see the module docstring).
PROTECTED_SHARED_DIRS = frozenset({"roster", "roster-reference"})
# ...except code and docs, which stay mirrored (updated and pruned) like the rest of shared/.
MIRRORED_EXTS = frozenset({".py", ".md"})


def _skip(name: str) -> bool:
    return name in SKIP_NAMES or name.endswith(".pyc") or name.startswith("~$")


def _rel_parts(rel) -> tuple:
    """Lower-cased path components of a path relative to shared/, or () if it is unsafe."""
    text = rel if isinstance(rel, str) else "/".join(rel)
    parts = tuple(p.lower() for p in text.replace("\\", "/").split("/") if p not in ("", "."))
    if any(p == ".." or ":" in p for p in parts):
        return ()  # traversal or a drive/stream: never claims protection
    return parts


def is_protected_shared(rel) -> bool:
    """True when `rel` (a path under shared/, as a string or a tuple of names) is user data
    the mirror must keep: any non-code file at any depth inside a PROTECTED_SHARED_DIRS folder."""
    parts = _rel_parts(rel)
    if len(parts) < 2 or parts[0] not in PROTECTED_SHARED_DIRS or _skip(parts[-1]):
        return False
    return os.path.splitext(parts[-1])[1] not in MIRRORED_EXTS


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


def _remove(path: Path, gone: list) -> None:
    """Delete a file or folder; every file that really went is logged and appended to `gone`."""
    try:
        if path.is_dir() and not path.is_symlink():
            files = [p for p in path.rglob("*") if not p.is_dir()]
            shutil.rmtree(path)
        else:
            files = [path]
            path.unlink()
    except OSError:
        log.warning("could not remove %s", path, exc_info=True)
        return
    for removed in files:
        log.info("workcopy sync removed %s", removed)
        gone.append(removed)


def _clear(path: Path, rel, gone: list) -> bool:
    """Remove `path` except the protected files under it (`rel` is None outside shared/).

    Returns True when `path` is gone."""
    if rel is None:
        _remove(path, gone)
        return not path.exists()
    if path.is_dir() and not path.is_symlink():
        for child in list(path.iterdir()):
            _clear(child, rel + (child.name,), gone)
        try:
            path.rmdir()  # only succeeds once nothing protected is left inside
        except OSError:
            pass
    elif not is_protected_shared(rel):
        _remove(path, gone)
    return not path.exists()


def _mirror(src: Path, dst: Path, gone: list, rel=None) -> None:
    """Make `dst` an exact copy of `src` (minus skipped names).

    `rel` is the path below shared/ while mirroring shared/ (protected user data is
    kept, see is_protected_shared) and None everywhere else (nothing protected)."""
    dst.mkdir(parents=True, exist_ok=True)
    wanted = set()
    for entry in src.iterdir():
        if _skip(entry.name):
            continue
        wanted.add(entry.name)
        target = dst / entry.name
        sub = None if rel is None else rel + (entry.name,)
        if entry.is_dir():
            if target.exists() and not target.is_dir() and not _clear(target, sub, gone):
                continue
            _mirror(entry, target, gone, sub)
        else:
            if target.is_dir() and not _clear(target, sub, gone):
                continue  # a folder holding the user's data stands where a file should go
            if sub is not None and is_protected_shared(sub) and target.exists():
                continue  # the user's file wins over a shipped one
            _copy_file(entry, target)
    for existing in dst.iterdir():
        if existing.name not in wanted:
            _clear(existing, None if rel is None else rel + (existing.name,), gone)


def _seed(src: Path, dst: Path) -> None:
    """Copy `src` to `dst` only when `dst` does not exist yet."""
    if dst.exists():
        return
    try:
        shutil.copytree(src, dst, ignore=lambda _d, names: [n for n in names if _skip(n)])
    except OSError:
        log.warning("could not seed %s", dst, exc_info=True)


def _sync_task(src: Path, dst: Path, gone: list) -> None:
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
                _remove(target, gone)
            _mirror(entry, target, gone)
        else:
            if target.is_dir():
                _remove(target, gone)
            _copy_file(entry, target)
    # A definition file or folder that no longer exists is removed; user data stays.
    for existing in dst.iterdir():
        if existing.name not in wanted and existing.name not in DATA_DIRS:
            _remove(existing, gone)
    # The data folders exist even when the definitions ship none (they are
    # gitignored, so the installer does not carry them): scripts write into them.
    for name in ENSURED_DIRS:
        try:
            (dst / name).mkdir(exist_ok=True)
        except OSError:
            log.warning("could not create %s", dst / name, exc_info=True)


def sync(definitions: Path, workdir: Path) -> int:
    """Refresh `workdir` from the task definitions in `definitions`.

    Returns how many files the mirror removed (each one is logged)."""
    workdir.mkdir(parents=True, exist_ok=True)
    gone: list[Path] = []
    seen = set()
    for entry in sorted(definitions.iterdir()):
        if not entry.is_dir() or entry.name.startswith(".") or _skip(entry.name):
            continue
        seen.add(entry.name)
        if entry.name == SHARED:
            _mirror(entry, workdir / entry.name, gone, ())
        elif (entry / "task.json").is_file():
            _sync_task(entry, workdir / entry.name, gone)
    # A task the definitions no longer ship stops being listed; its data stays.
    for existing in workdir.iterdir():
        manifest = existing / "task.json"
        if existing.is_dir() and existing.name not in seen and manifest.is_file():
            _remove(manifest, gone)
    return len(gone)

