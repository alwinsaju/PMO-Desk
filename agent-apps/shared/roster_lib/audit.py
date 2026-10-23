"""
Append-only audit trail for the final roster build.

Layout under `<out_dir>/audit/`:

    <run_id>.json      one full entry per run (created exclusively, never rewritten)
    audit.log.jsonl    one compact summary line per run, appended

Nothing here ever deletes, truncates or rewrites an existing file: an entry
file is opened with mode "x" (a run id collision gets a numeric suffix) and the
log is only opened for append. Entries contain exactly what the run used and
produced (file names and sha256 of the inputs and outputs, the approver, the
cycle, the seed, the full diff that was confirmed, counts, the library
version). Person names ARE allowed here: the audit folder is output, not source.

The module is a leaf (no roster_lib imports) so draft_builder, final_build and
the tests share its hashing and JSON helpers.
"""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Mapping, Optional, Union

AUDIT_FORMAT = "roster-audit/1"
AUDIT_DIRNAME = "audit"
AUDIT_LOG_NAME = "audit.log.jsonl"

PathLike = Union[str, os.PathLike]


class AuditError(Exception):
    """The audit entry could not be written."""


def sha256_file(path: PathLike) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def file_record(path: Optional[PathLike]) -> Optional[dict[str, Any]]:
    """{"name", "sha256", "bytes"} of a file, or None when no path was given."""
    if path is None:
        return None
    p = os.fspath(path)
    return {"name": os.path.basename(p), "sha256": sha256_file(p), "bytes": os.path.getsize(p)}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_utc(moment: datetime) -> str:
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def canonical_json(data: Any) -> str:
    """Deterministic compact JSON (sorted keys, no whitespace, UTF-8 text kept)."""
    return json.dumps(data, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str)


def new_run_id(inputs: Mapping[str, Any], now: datetime) -> str:
    """`<UTC timestamp>-<8 hex>`: the hex is a digest of the inputs and the timestamp."""
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    stamp = now.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    digest = sha256_text(canonical_json({"inputs": inputs, "at": stamp}))[:8]
    return f"{stamp}-{digest}"


@dataclass(frozen=True)
class AuditRecord:
    run_id: str
    entry_path: str
    log_path: str


def audit_dir(out_dir: PathLike) -> str:
    return os.path.join(os.fspath(out_dir), AUDIT_DIRNAME)


def write_audit(out_dir: PathLike, entry: dict[str, Any], summary: Optional[Mapping[str, Any]] = None) -> AuditRecord:
    """Write `entry` (needs "run_id") as a new file and append a summary line to the log.

    The entry dict is updated in place when a run id collision forces a suffix.
    """
    if "run_id" not in entry:
        raise AuditError("audit entry has no run_id")
    d = audit_dir(out_dir)
    os.makedirs(d, exist_ok=True)
    base = str(entry["run_id"])
    run_id, n = base, 1
    while True:
        path = os.path.join(d, f"{run_id}.json")
        try:
            f = open(path, "x", encoding="utf-8", newline="\n")
            break
        except FileExistsError:
            n += 1
            run_id = f"{base}-{n}"
            if n > 1000:
                raise AuditError(f"cannot find a free audit file name for run {base}") from None
    entry["run_id"] = run_id
    entry.setdefault("format", AUDIT_FORMAT)
    try:
        with f:
            f.write(json.dumps(entry, sort_keys=True, ensure_ascii=False, indent=2, default=str))
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
    except BaseException:
        if os.path.exists(path):
            os.remove(path)
        raise
    line = {"run_id": run_id, "entry": os.path.basename(path), **(dict(summary) if summary else {})}
    log_path = os.path.join(d, AUDIT_LOG_NAME)
    with open(log_path, "a", encoding="utf-8", newline="\n") as log:
        log.write(canonical_json(line) + "\n")
        log.flush()
        os.fsync(log.fileno())
    return AuditRecord(run_id=run_id, entry_path=path, log_path=log_path)


def read_audit_log(out_dir: PathLike) -> list[dict[str, Any]]:
    """The summary lines of the log, oldest first (empty when there is no log)."""
    path = os.path.join(audit_dir(out_dir), AUDIT_LOG_NAME)
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def read_audit_entry(out_dir: PathLike, run_id: str) -> dict[str, Any]:
    with open(os.path.join(audit_dir(out_dir), f"{run_id}.json"), encoding="utf-8") as f:
        return json.load(f)
