"""Task packs: a task folder that can be added without reinstalling AI OS.

A pack is a zip with a `pack.json` that lists every other file with its SHA-256, and
the task itself (`task.json`, scripts, optional `config/` seeds). Installing one is
refused unless every listed checksum matches, no unlisted file is present, no file
can land outside the pack's own folder, and the task only uses the step types the
engine knows. The pack's *fingerprint* (the SHA-256 of its pack.json) is shown to the
person, who can compare it with the one the publisher gave them; that is what makes a
pack "signed" in the sense that matters here: the contents cannot change without the
fingerprint changing.

A pack's scripts are code that runs on this computer. The engine cannot make that
safe, so installing is always an explicit, informed act (the Tasks app shows the file
list and the warning and asks for the fingerprint to be confirmed).

Pure stdlib; main.py wires it to HTTP.
"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
import stat
import zipfile
from io import BytesIO
from pathlib import Path, PurePosixPath

FORMAT = "ai-os-task-pack"
MANIFEST = "pack.json"
TASK_FILE = "task.json"
MAX_ZIP_BYTES = 30 * 1024 * 1024
MAX_FILES = 200
MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_TOTAL_BYTES = 25 * 1024 * 1024
ALLOWED_EXTENSIONS = frozenset({".json", ".py", ".ps1", ".md", ".txt", ".html", ".htm", ".csv", ".png", ".jpg", ".svg"})
STEP_TYPES = frozenset({"python", "powershell", "review", "confirm"})
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$")
# Where a pack may ask for input files to be placed, relative to its own folder.
INPUT_DEST_ROOTS = ("input/", "config/")
# Folders of the installed pack that are the person's data and survive an upgrade.
KEEP_ON_UPGRADE = ("input", "output", "config")


class PackError(Exception):
    """The pack cannot be used; the message says why in plain words."""


def unsafe_name(name: str) -> str | None:
    """Why a zip entry name cannot be extracted, or None."""
    if not name:
        return "an entry has no name"
    if len(name) > 200:
        return f"the entry name {name[:40]!r} is too long"
    if any(ord(c) < 32 for c in name):
        return "an entry name has control characters"
    if "\\" in name:
        return f"the entry name {name!r} uses a backslash"
    if name.startswith("/") or re.match(r"^[A-Za-z]:", name):
        return f"the entry name {name!r} is an absolute path"
    if any(part in ("", ".", "..") for part in name.split("/")):
        return f"the entry name {name!r} climbs out of the folder"
    return None


def fingerprint_of(manifest: dict) -> str:
    """SHA-256 of the manifest's canonical form."""
    canonical = json.dumps(manifest, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(canonical.encode("ascii")).hexdigest()


def _read_entries(data: bytes) -> dict[str, bytes]:
    if len(data) > MAX_ZIP_BYTES:
        raise PackError("That pack is larger than 30 MB.")
    try:
        archive = zipfile.ZipFile(BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise PackError("This is not a zip file.") from exc
    infos = [i for i in archive.infolist() if not i.is_dir()]
    if len(infos) > MAX_FILES:
        raise PackError(f"The pack has {len(infos)} files; the limit is {MAX_FILES}.")
    entries: dict[str, bytes] = {}
    total = 0
    for info in infos:
        bad = unsafe_name(info.filename)
        if bad:
            raise PackError(f"Refused: {bad}.")
        if info.filename in entries:
            raise PackError(f"Refused: {info.filename!r} appears twice.")
        if info.flag_bits & 0x1:
            raise PackError("Encrypted packs are not supported.")
        if stat.S_ISLNK(info.external_attr >> 16):
            raise PackError(f"Refused: {info.filename!r} is a link.")
        if info.file_size > MAX_FILE_BYTES:
            raise PackError(f"{info.filename!r} is larger than 5 MB.")
        total += info.file_size
        if total > MAX_TOTAL_BYTES:
            raise PackError("The pack unpacks to more than 25 MB.")
        try:
            entries[info.filename] = archive.read(info)
        except (zipfile.BadZipFile, RuntimeError, OSError) as exc:
            raise PackError(f"{info.filename!r} is damaged.") from exc
    return entries


def _relative_inside(path: object, label: str) -> str:
    if not isinstance(path, str) or not path.strip():
        raise PackError(f"{label} needs a file path.")
    bad = unsafe_name(path) if isinstance(path, str) else None
    if bad or ":" in path:
        raise PackError(f"{label} points outside the pack ({path!r}).")
    return PurePosixPath(path).as_posix()


def _check_task(task: dict, pack_id: str, listed: set[str]) -> list[dict]:
    if task.get("id") != pack_id:
        raise PackError("task.json has a different id than the pack.")
    steps = task.get("steps")
    if not isinstance(steps, list) or not steps:
        raise PackError("task.json has no steps.")
    summary = []
    for step in steps:
        if not isinstance(step, dict) or not isinstance(step.get("id"), str) or not isinstance(step.get("type"), str):
            raise PackError("Every step needs an id and a type.")
        if step["type"] not in STEP_TYPES:
            raise PackError(f"Step {step['id']!r} uses a type this engine does not allow ({step['type']!r}).")
        cmd = step.get("cmd")
        if step["type"] in ("python", "powershell"):
            rel = _relative_inside(cmd, f"Step {step['id']!r}")
            if rel not in listed:
                raise PackError(f"Step {step['id']!r} runs {rel!r}, which is not in the pack.")
            args = step.get("args", [])
            if not isinstance(args, list) or not all(isinstance(a, str) for a in args):
                raise PackError(f"Step {step['id']!r} has arguments that are not text.")
        summary.append({"id": step["id"], "type": step["type"], "cmd": cmd if isinstance(cmd, str) else None})
    for item in task.get("inputs", []) if isinstance(task.get("inputs"), list) else []:
        dest = item.get("dest") if isinstance(item, dict) else None
        rel = _relative_inside(dest, "An input")
        if not rel.startswith(INPUT_DEST_ROOTS):
            raise PackError(f"An input is placed at {rel!r}; it must go under input/ or config/.")
    prepare = task.get("prepare")
    if isinstance(prepare, dict) and prepare.get("cmd"):
        rel = _relative_inside(prepare["cmd"], "The prepare step")
        if rel not in listed:
            raise PackError(f"The prepare step runs {rel!r}, which is not in the pack.")
    return summary


def inspect_pack(data: bytes) -> dict:
    """Validate a pack without installing it. Returns what the person is shown before agreeing."""
    entries = _read_entries(data)
    raw_manifest = entries.get(MANIFEST)
    if raw_manifest is None:
        raise PackError("This zip is not a task pack (it has no pack.json).")
    try:
        manifest = json.loads(raw_manifest.decode("utf-8-sig"))
    except ValueError as exc:
        raise PackError("pack.json is damaged.") from exc
    if not isinstance(manifest, dict) or manifest.get("format") != FORMAT or manifest.get("version") != 1:
        raise PackError("This pack was made by a version this engine cannot read.")
    pack_id = manifest.get("id")
    if not isinstance(pack_id, str) or not ID_RE.match(pack_id):
        raise PackError("The pack's id must be lower-case letters, digits and hyphens (3 to 50 characters).")
    name = manifest.get("name")
    if not isinstance(name, str) or not name.strip() or len(name) > 80:
        raise PackError("The pack has no name.")
    listed = manifest.get("files")
    if not isinstance(listed, dict) or TASK_FILE not in listed:
        raise PackError("pack.json must list task.json and every other file with its checksum.")
    present = {n for n in entries if n != MANIFEST}
    if present != set(listed):
        extra = sorted(present - set(listed))
        missing = sorted(set(listed) - present)
        detail = f"unlisted: {extra[:3]}" if extra else f"missing: {missing[:3]}"
        raise PackError(f"The files in the pack do not match its list ({detail}).")
    files = []
    for rel in sorted(present):
        suffix = PurePosixPath(rel).suffix.lower()
        if suffix not in ALLOWED_EXTENSIONS:
            raise PackError(f"{rel!r} is a type of file packs may not contain ({suffix or 'no extension'}).")
        digest = hashlib.sha256(entries[rel]).hexdigest()
        if listed[rel] != digest:
            raise PackError(f"{rel!r} does not match its checksum, so the pack was changed after it was made.")
        files.append({"path": rel, "size": len(entries[rel]), "runs": suffix in (".py", ".ps1")})
    try:
        task = json.loads(entries[TASK_FILE].decode("utf-8-sig"))
    except ValueError as exc:
        raise PackError("task.json is damaged.") from exc
    steps = _check_task(task, pack_id, present)
    return {
        "id": pack_id,
        "name": name.strip(),
        "packVersion": str(manifest.get("packVersion", ""))[:20],
        "fingerprint": fingerprint_of(manifest),
        "files": files,
        "steps": steps,
        "totalBytes": sum(f["size"] for f in files),
        "_entries": entries,
        "_manifest": manifest,
    }


def public_info(info: dict) -> dict:
    return {k: v for k, v in info.items() if not k.startswith("_")}


def install_pack(data: bytes, packs_root: Path, builtin_ids: set[str], fingerprint: str) -> dict:
    """Install a pack whose fingerprint the person confirmed. An upgrade keeps the pack's input, output and config."""
    info = inspect_pack(data)
    if fingerprint != info["fingerprint"]:
        raise PackError("The fingerprint does not match this pack, so nothing was installed.")
    pack_id = info["id"]
    if pack_id in builtin_ids:
        raise PackError(f"{pack_id!r} is already a built-in task, so a pack cannot replace it.")
    packs_root.mkdir(parents=True, exist_ok=True)
    target = packs_root / pack_id
    staging = packs_root / f".{pack_id}.installing"
    retired = packs_root / f".{pack_id}.old"
    for leftover in (staging, retired):
        shutil.rmtree(leftover, ignore_errors=True)
    staging.mkdir()
    try:
        for rel, content in info["_entries"].items():
            dest = staging / Path(*rel.split("/"))
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(content)
        if target.exists():
            for keep in KEEP_ON_UPGRADE:
                old = target / keep
                if old.is_dir():
                    new = staging / keep
                    if new.exists():
                        # The person's own files win over seeds in the new pack.
                        for src in old.rglob("*"):
                            if src.is_file():
                                to = new / src.relative_to(old)
                                to.parent.mkdir(parents=True, exist_ok=True)
                                shutil.copy2(src, to)
                    else:
                        shutil.copytree(old, new)
            target.rename(retired)
        staging.rename(target)
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        if retired.exists() and not target.exists():
            retired.rename(target)
        raise
    shutil.rmtree(retired, ignore_errors=True)
    return public_info(info)


def list_packs(packs_root: Path) -> list[dict]:
    """Installed packs: id, name, version, fingerprint. A folder that cannot be read is skipped."""
    out = []
    if not packs_root.is_dir():
        return out
    for folder in sorted(packs_root.iterdir()):
        if folder.name.startswith(".") or not folder.is_dir():
            continue
        try:
            manifest = json.loads((folder / MANIFEST).read_text(encoding="utf-8-sig"))
            out.append(
                {
                    "id": manifest["id"],
                    "name": manifest["name"],
                    "packVersion": str(manifest.get("packVersion", ""))[:20],
                    "fingerprint": fingerprint_of(manifest),
                }
            )
        except (OSError, ValueError, KeyError):
            continue
    return out


def remove_pack(packs_root: Path, pack_id: str) -> bool:
    """Delete an installed pack's folder (including its input and output). False when it is not installed."""
    if not ID_RE.match(pack_id):
        return False
    target = packs_root / pack_id
    if not target.is_dir():
        return False
    shutil.rmtree(target)
    return True


def build_pack(pack_id: str, name: str, pack_version: str, files: dict[str, bytes]) -> bytes:
    """Make a pack zip from files (used by the mailer wizard). `files` must include task.json."""
    manifest = {
        "format": FORMAT,
        "version": 1,
        "id": pack_id,
        "name": name,
        "packVersion": pack_version,
        "files": {rel: hashlib.sha256(content).hexdigest() for rel, content in sorted(files.items())},
    }
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(MANIFEST, json.dumps(manifest, indent=2))
        for rel, content in sorted(files.items()):
            archive.writestr(rel, content)
    return buffer.getvalue()
