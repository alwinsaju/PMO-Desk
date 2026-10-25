"""
Step 8 "Final": build the approved roster as a NEW file; the master is never written.

build_final(master, saved_draft, diff, out_dir, confirmed=True) writes

    <out_dir>/<master stem> - final <cycle label>.xlsx     the final roster
    <out_dir>/backups/<master stem>.<sha8>.xlsx            hash-verified copy of the master
    <out_dir>/audit/<run_id>.json + audit.log.jsonl        see audit.py

and changes ONLY approved cells. The approved set is the snapshot cells (the
draft's own values, read back from the saved draft) plus the cells the PMO
changed outside the snapshot but inside the person x date grid (both are shown
in the diff the PMO confirmed). Cells whose approved value already equals the
master's current value are skipped (no-op). The cells are written into a copy
of the MASTER (xlsx_patch: one sheet part rewritten) - the final carries no
summary sheets and no snapshot, only cell value changes.

Refusals (FinalBuildRefused; nothing is written):
    confirmed is not True (the caller passes True only after the PMO confirmed);
    the master changed since the draft was built (sha256 vs the snapshot meta);
    any blocking issue in the diff (snapshot tampered or missing, a person row
    missing, dates changed, ...);
    the saved draft changed after the diff was produced (sha256), or the diff
    was produced without the master (outside edits unseen), or it no longer
    matches a fresh comparison of the saved draft.

Proof before the final is moved into place (FinalBuildError, output deleted):
    pkgdiff.assert_only_changed: only the target sheet part differs from the master;
    pkgdiff.assert_sheet_only_changed: inside it only the approved cells differ
    and everything outside sheetData (CF, validation, hyperlinks, ...) is intact;
    a grid-level comparison: the cells that differ master -> final are exactly
    the approved differing cells and hold the approved values.

Re-running with the same inputs yields a byte-identical final (an identical
existing file is reused; a different one is never overwritten, the new file gets
a " (2)" suffix). Backups are never overwritten with different content.
"""

from __future__ import annotations

import getpass
import os
import shutil
import tempfile
import zipfile
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Mapping, Optional, Union

from . import audit, pkgdiff
from .draft_diff import DraftDiff, diff_draft
from .roster_io import DEFAULT_SHEET, load_roster
from .xlsx_patch import XlsxPatchError, patch_workbook, resolve_sheet_part

FINAL_BUILD_VERSION = "final-build/1"
BACKUP_DIRNAME = "backups"
PathLike = Union[str, os.PathLike]


class FinalBuildRefused(Exception):
    """A precondition failed; nothing was written."""


class FinalBuildError(Exception):
    """The final was built but did not pass verification (or a file step failed); the output was removed."""


@dataclass
class FinalResult:
    final_path: str
    backup_path: str
    audit_path: str
    audit_log_path: str
    run_id: str
    cycle_label: str
    approver: str
    master_sha256: str
    saved_draft_sha256: str
    final_sha256: str
    backup_sha256: str
    approved_cells: int
    cells_written: int
    cells_skipped_noop: int
    user_changes: int
    outside_changes: int
    written: list[dict[str, str]]
    reused_final: bool
    reused_backup: bool
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return dict(self.__dict__)


def _label(text: str) -> str:
    """A cycle label made safe for a file name."""
    return "".join(ch for ch in text if ch not in '<>:"/\\|?*').strip() or "cycle"


def _cleanup(*paths: Optional[str]) -> None:
    for p in paths:
        if p and os.path.exists(p):
            try:
                os.remove(p)
            except OSError:
                pass


def _refuse(msg: str) -> FinalBuildRefused:
    return FinalBuildRefused(msg)


def _check_preconditions(master: str, saved: str, diff: DraftDiff, confirmed: bool, sidecar_path) -> tuple[DraftDiff, str, str]:
    if confirmed is not True:
        raise _refuse("the diff has not been confirmed by the PMO (confirmed must be True)")
    if os.path.normcase(master) == os.path.normcase(saved):
        raise _refuse("the saved draft and the master are the same file")
    for label, p in (("master", master), ("saved draft", saved)):
        if not os.path.exists(p):
            raise _refuse(f"{label} not found: {p}")
    master_sha, saved_sha = audit.sha256_file(master), audit.sha256_file(saved)
    if diff.blocking_issues:
        raise _refuse("the diff has blocking issues: " + "; ".join(f"{i.code}: {i.message}" for i in diff.blocking_issues))
    if not diff.outside_checked:
        raise _refuse("the diff was produced without the master, so edits outside the snapshot cells were not looked for")
    if diff.saved_draft_sha256 != saved_sha:
        raise _refuse("the saved draft changed after the diff was produced (sha256 differs)")
    fresh = diff_draft(saved, master_path=master, sidecar_path=sidecar_path)
    if fresh.blocking_issues:
        raise _refuse("blocking issues: " + "; ".join(f"{i.code}: {i.message}" for i in fresh.blocking_issues))
    recorded = fresh.meta.get("master_sha256")
    if recorded != master_sha:
        raise _refuse("the master changed since the draft was built (sha256 differs from the snapshot)")
    a, b = diff.to_dict(), fresh.to_dict()
    if (a["changes"], a["outside_snapshot_changes"]) != (b["changes"], b["outside_snapshot_changes"]):
        raise _refuse("the confirmed diff does not match a fresh comparison of the saved draft")
    return fresh, master_sha, saved_sha


def _approved_edits(master: str, saved: str, fresh: DraftDiff, sheet: str):
    """-> (edits {(row, col): text}, written rows, approved count, noop count, expected {(name, date): text})."""
    droster, mroster = load_roster(saved, sheet), load_roster(master, sheet)
    approved: dict[tuple[str, Any], str] = {}
    for sc in fresh.snapshot:
        found = droster.find(sc.person)
        if len(found) != 1:
            raise _refuse(f"{sc.person}: not found exactly once in the saved draft")
        approved[(sc.person, sc.date)] = droster.cell(found[0], sc.date)
    for c in fresh.outside_snapshot_changes:
        approved[(c.person, c.date)] = c.after
    edits: dict[tuple[int, int], str] = {}
    expected: dict[tuple[str, Any], str] = {}
    written: list[dict[str, str]] = []
    noop = 0
    for (name, d), value in sorted(approved.items(), key=lambda kv: (_row_of(mroster, kv[0][0]), kv[0][1])):
        found = mroster.find(name)
        if len(found) != 1:
            raise _refuse(f"{name}: not found exactly once in the master")
        if d not in mroster.date_to_col:
            raise _refuse(f"{name} {d}: the date is not a column of the master")
        mp = found[0]
        current = mroster.cell(mp, d)
        if current == value:
            noop += 1
            continue
        edits[mroster.address(mp, d)] = value
        expected[(mp.name, d)] = value
        written.append({"person": mp.name, "date": d.isoformat(), "before": current, "after": value})
    return edits, written, len(approved), noop, expected


def _row_of(roster, name: str) -> int:
    found = roster.find(name)
    return found[0].row if found else 0


def _verify_final(master: str, built: str, sheet: str, edits: Mapping[tuple[int, int], str], expected: Mapping) -> None:
    with zipfile.ZipFile(master) as z:
        part = resolve_sheet_part(z, sheet)
    try:
        pkgdiff.assert_only_changed(master, built, {part}, strict=True)
        if edits:
            pkgdiff.assert_sheet_only_changed(master, built, part, set(edits))
    except AssertionError as e:
        raise FinalBuildError(f"verification failed (package level): {e}") from None
    mroster, froster = load_roster(master, sheet), load_roster(built, sheet)
    if mroster.dates != froster.dates or [(p.name, p.row) for p in mroster.people] != [(p.name, p.row) for p in froster.people]:
        raise FinalBuildError("verification failed: the final's dates or people differ from the master")
    changed: dict[tuple[str, Any], str] = {}
    for p in mroster.people:
        fp = froster.person_at(p.row)
        for d in mroster.dates:
            a, b = mroster.cell(p, d), froster.cell(fp, d)
            if a != b:
                changed[(p.name, d)] = b
    if changed != dict(expected):
        extra = sorted(set(changed) - set(expected))
        missing = sorted(set(expected) - set(changed))
        wrong = sorted(k for k in set(changed) & set(expected) if changed[k] != expected[k])
        raise FinalBuildError(
            f"verification failed: grid differences are not exactly the approved cells "
            f"(unexpected {len(extra)}, missing {len(missing)}, wrong value {len(wrong)})")


def _make_backup(master: str, out_dir: str, master_sha: str) -> tuple[str, bool]:
    bdir = os.path.join(out_dir, BACKUP_DIRNAME)
    os.makedirs(bdir, exist_ok=True)
    stem, ext = os.path.splitext(os.path.basename(master))
    path = os.path.join(bdir, f"{stem}.{master_sha[:8]}{ext}")
    if os.path.exists(path):
        if audit.sha256_file(path) == master_sha:
            return path, True
        raise FinalBuildError(f"a backup with a different content already exists and is never overwritten: {path}")
    fd, tmp = tempfile.mkstemp(suffix=".backup.tmp", dir=bdir)
    os.close(fd)
    try:
        shutil.copyfile(master, tmp)
        if audit.sha256_file(tmp) != master_sha:
            raise FinalBuildError("the backup copy does not match the master (sha256); not kept")
        os.replace(tmp, path)
    except BaseException:
        _cleanup(tmp)
        raise
    if audit.sha256_file(path) != master_sha:
        raise FinalBuildError("the backup does not match the master after it was written")
    return path, False


def _target_path(out_dir: str, stem: str, label: str, built_sha: str) -> tuple[str, bool]:
    base = f"{stem} - final {label}"
    for n in range(1, 100):
        name = f"{base}.xlsx" if n == 1 else f"{base} ({n}).xlsx"
        path = os.path.join(out_dir, name)
        if not os.path.exists(path):
            return path, False
        if audit.sha256_file(path) == built_sha:
            return path, True
    raise FinalBuildError("too many final files with different content for this cycle in the output folder")


def build_final(
    master_path: PathLike,
    saved_draft_path: PathLike,
    diff: DraftDiff,
    out_dir: PathLike,
    *,
    approver: Optional[str] = None,
    confirmed: bool = True,
    matrix_path: Optional[PathLike] = None,
    pto_path: Optional[PathLike] = None,
    config_path: Optional[PathLike] = None,
    extra: Optional[Mapping[str, Any]] = None,
    sidecar_path: Optional[PathLike] = None,
    now: Optional[datetime] = None,
) -> FinalResult:
    """Build the final roster from `master_path` + the approved cells (see the module docstring).

    `diff` is the DraftDiff the PMO confirmed (computed with master_path, from
    this same saved draft). `now` fixes the audit timestamps (tests).
    """
    master = os.path.abspath(os.fspath(master_path))
    saved = os.path.abspath(os.fspath(saved_draft_path))
    out = os.path.abspath(os.fspath(out_dir))
    started = now or audit.utc_now()
    fresh, master_sha, saved_sha = _check_preconditions(master, saved, diff, confirmed, sidecar_path)
    meta = fresh.meta
    sheet = meta.get("sheet_name") or DEFAULT_SHEET
    label = _label(str((meta.get("cycle") or {}).get("label", "cycle")))
    stem = os.path.splitext(os.path.basename(master))[0]
    approver_source = "given" if approver else "getpass"
    if not approver:
        try:
            approver = getpass.getuser()
        except Exception:  # pragma: no cover - no user name available
            approver = "unknown"

    edits, written, n_approved, n_noop, expected = _approved_edits(master, saved, fresh, sheet)
    warnings: list[str] = []
    if not edits:
        warnings.append("no approved cell differs from the master: the final is identical to the master")

    os.makedirs(out, exist_ok=True)
    fd, built = tempfile.mkstemp(suffix=".final.tmp", dir=out)
    os.close(fd)
    try:
        try:
            patch_workbook(master, built, sheet, edits)
        except XlsxPatchError as e:
            raise FinalBuildError(f"could not write the approved cells into a copy of the master: {e}") from None
        _verify_final(master, built, sheet, edits, expected)
        backup_path, reused_backup = _make_backup(master, out, master_sha)
        if audit.sha256_file(master) != master_sha:
            raise FinalBuildError("the master changed while the final was being built")
        built_sha = audit.sha256_file(built)
        final_path, reused_final = _target_path(out, stem, label, built_sha)
        if os.path.normcase(final_path) in (os.path.normcase(master), os.path.normcase(saved)):
            raise FinalBuildError("the final would overwrite an input file")  # pragma: no cover - names differ by construction

        inputs = {
            "master": audit.file_record(master),
            "saved_draft": audit.file_record(saved),
            "matrix": audit.file_record(matrix_path),
            "pto": audit.file_record(pto_path),
            "config": audit.file_record(config_path),
        }
        run_id = audit.new_run_id({k: (v or {}).get("sha256") for k, v in inputs.items()} | {"approver": approver}, started)
        backup_rec = audit.file_record(backup_path)
        final_rec = {"name": os.path.basename(final_path), "sha256": built_sha, "bytes": os.path.getsize(built)}
        entry = {
            "run_id": run_id,
            "started_utc": audit.iso_utc(started),
            "finished_utc": audit.iso_utc(now or audit.utc_now()),
            "approver": approver,
            "approver_source": approver_source,
            "inputs": inputs,
            "cycle": meta.get("cycle"),
            "seed": meta.get("seed"),
            "config_version": meta.get("config_version"),
            "plan_hash": meta.get("plan_hash"),
            "snapshot": {"source": fresh.snapshot_source, "digest": fresh.snapshot_digest, "cells": len(fresh.snapshot)},
            "diff": diff.to_dict(),
            "counts": {
                "snapshot_cells": len(fresh.snapshot), "user_changes": len(fresh.changes),
                "outside_changes": len(fresh.outside_snapshot_changes), "approved_cells": n_approved,
                "cells_written": len(edits), "cells_skipped_noop": n_noop,
            },
            "written": written,
            "outputs": {"final": final_rec, "backup": backup_rec, "saved_draft": inputs["saved_draft"]},
            "library": {"final_build": FINAL_BUILD_VERSION, "cycle_builder": meta.get("library_version")},
            "warnings": warnings,
            "extra": dict(extra) if extra else {},
        }
        summary = {"finished_utc": entry["finished_utc"], "approver": approver,
                   "cycle": (meta.get("cycle") or {}).get("label"), "final": final_rec["name"],
                   "final_sha256": built_sha, "cells_written": len(edits), "master_sha256": master_sha}
        try:
            record = audit.write_audit(out, entry, summary)
        except OSError as e:
            raise FinalBuildError(f"the audit entry could not be written: {e}") from None
        if reused_final:
            _cleanup(built)
        else:
            os.replace(built, final_path)
    except BaseException:
        _cleanup(built)
        raise
    return FinalResult(
        final_path=final_path, backup_path=backup_path, audit_path=record.entry_path, audit_log_path=record.log_path,
        run_id=record.run_id, cycle_label=label, approver=approver, master_sha256=master_sha, saved_draft_sha256=saved_sha,
        final_sha256=built_sha, backup_sha256=backup_rec["sha256"], approved_cells=n_approved, cells_written=len(edits),
        cells_skipped_noop=n_noop, user_changes=len(fresh.changes), outside_changes=len(fresh.outside_snapshot_changes),
        written=written, reused_final=reused_final, reused_backup=reused_backup, warnings=warnings)
