"""Last step "Build the final plans" (runs only after the PMO confirmed the diff).

1. Refuses unless: no input changed since the analysis, the confirmed `output/roster-diff.json` has no
   blocking issue, BOTH saved drafts are still byte for byte the files the PMO confirmed (sha256 recorded
   by the diff step), and a fresh comparison (both audits re-run on the saved files, snapshots
   cross-checked) shows no blocking issue and the same changes.
2. Copies each saved draft, unchanged (the PMO's confirmed edits, formulas intact, nothing regenerated):

       output/final/Winter Coverage FINAL <window>.xlsx
       output/final/Analytics Winter Coverage FINAL <window>.xlsx

   An identical file already there is reused; a different one is never overwritten (" (2)" suffix).
3. Writes an append-only audit entry with the `roster_lib.audit` conventions into `output/audit/`
   (`<run id>.json` + `audit.log.jsonl`): approver = the OS user, sha256 of every input and of the saved
   drafts and finals, the confirmed diff, the plan hashes, the seed (names allowed: output folder).
4. Cross-task: adds the disconnect days (window start + 1 .. window end - 1, the days strictly between
   the two holidays) to `disconnect_windows` in the shift-roster task's `config/rotation-config.json`
   unless they are already covered (overlapping or touching windows are merged), keeping a
   timestamped, hash-verified copy of the old file in that task's `config/backups/`. This is how the
   Shift Roster task learns to ignore those days. The path is `shift_roster_config` in
   `config/task-config.json` (default `../shift-roster/config/rotation-config.json`); an absent file is
   skipped with an info note, an unreadable one stops the step BEFORE anything is written.
5. `output/report-data.json` (`stage: final`, `workbook_path` = the final main plan,
   `summary.analytics_workbook_path` = the final Analytics plan, the audit path, the cross-task result).

The shift roster, staff roster, Analytics rosters and both configs are never modified. Running the step
again after a success is safe: the identical finals are reused, the cross-task windows are already
covered, and one more audit line is appended.
"""

from __future__ import annotations

import dataclasses
import getpass
import os
import shutil
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from _common import (
    Paths,
    TaskError,
    changed_inputs,
    copy_verified,
    disconnect_days,
    draft_meta,
    flag_counts,
    input_records,
    now_stamp,
    read_json,
    run_script,
    scrub,
    shift_roster_config_path,
    window_file_text,
    write_json,
)
from _diffing import compare_drafts
from roster_lib import audit
from roster_lib.audit import file_record, sha256_file
from roster_lib.config import ConfigError, DateWindow, load_config, save_config

FINALIZE_VERSION = "december-disconnect/1"


def place(src: Path, dst_dir: Path, name: str) -> Path:
    """Copy `src` into `dst_dir` as `name`. An identical file already there is kept, a different one is
    never overwritten (the new file gets a " (n)" suffix)."""
    dst_dir.mkdir(parents=True, exist_ok=True)
    dst = dst_dir / name
    stem, suffix = os.path.splitext(name)
    n = 1
    while dst.exists():
        if sha256_file(dst) == sha256_file(src):
            return dst
        n += 1
        dst = dst_dir / f"{stem} ({n}){suffix}"
    copy_verified(src, dst)
    return dst


def final_name(draft_name: str) -> str:
    return draft_name.replace(" DRAFT ", " FINAL ", 1)


# ---- the cross-task step ----------------------------------------------------------------------

def plan_disconnect_update(paths: Paths, start, end) -> dict[str, Any]:
    """What to do with the shift-roster task's rotation config (nothing is written here).

    -> {"status": "update" | "already_covered" | "skipped", "path", "reason"?, "windows"?, "config"?}"""
    days = disconnect_days(start, end)
    target = shift_roster_config_path(paths)
    out: dict[str, Any] = {"path": str(target)}
    if days is None:
        return {**out, "status": "skipped",
                "reason": "the window has no day between its two holidays"}
    if not target.exists():
        return {**out, "status": "skipped",
                "reason": "the shift roster config is absent (config key shift_roster_config)"}
    try:
        rc = load_config(target)
    except ConfigError as exc:
        raise TaskError("the shift roster config has problems, so the disconnect days cannot be "
                        "added to it: " + scrub("; ".join(exc.problems[:3]))) from None
    first, last = days
    out["days"] = {"start": first.isoformat(), "end": last.isoformat()}
    needed = {first + timedelta(days=i) for i in range((last - first).days + 1)}
    if needed <= set(rc.disconnect_dates()):
        return {**out, "status": "already_covered"}
    a, b, rest = first, last, []
    for w in rc.disconnect_windows:  # absorb windows that overlap or touch the new one
        if w.start <= b + timedelta(days=1) and w.end >= a - timedelta(days=1):
            a, b = min(a, w.start), max(b, w.end)
        else:
            rest.append(w)
    windows = sorted(rest + [DateWindow(a, b)], key=lambda w: (w.start, w.end))
    return {**out, "status": "update", "config": rc, "windows": windows}


def apply_disconnect_update(plan: dict[str, Any], moment: datetime | None = None) -> dict[str, Any]:
    """Write the planned update with a timestamped backup. Returns the (JSON-safe) result."""
    result = {k: v for k, v in plan.items() if k not in ("config", "windows")}
    if plan["status"] != "update":
        return result
    target = Path(plan["path"])
    backups = target.parent / "backups"
    backups.mkdir(parents=True, exist_ok=True)
    stamp = now_stamp(moment)
    backup = backups / f"rotation-config.{stamp}.json"
    n = 1
    while backup.exists():
        n += 1
        backup = backups / f"rotation-config.{stamp}-{n}.json"
    shutil.copy2(target, backup)
    if sha256_file(backup) != sha256_file(target):
        backup.unlink()
        raise TaskError("the shift roster config backup could not be verified; the config was not changed")
    updated = dataclasses.replace(plan["config"], disconnect_windows=list(plan["windows"]))
    fd, tmp = tempfile.mkstemp(prefix=".rotation-config.", suffix=".tmp", dir=target.parent)
    os.close(fd)
    try:
        save_config(updated, tmp)
        os.replace(tmp, target)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    result["status"] = "updated"
    result["windows_after"] = [w.to_dict() for w in plan["windows"]]
    result["backup"] = backup.name
    return result


# ---- the step -----------------------------------------------------------------------------------

def _main(paths: Paths) -> None:
    analysis = read_json(paths.analysis, "the analysis")
    meta = draft_meta(paths)
    window = analysis["window"]
    stale = changed_inputs(paths, analysis["inputs"])
    if stale:
        raise TaskError("; ".join(stale) + ": start a new run")

    confirmed = read_json(paths.diff, "the confirmed diff")
    if confirmed.get("blocking"):
        kinds = sorted({b["kind"] for b in confirmed["blocking"]})
        raise TaskError(f"the confirmed diff has {len(confirmed['blocking'])} blocking issue(s) "
                        f"({', '.join(kinds)}): reject it, fix the cause and run the task again")
    saved = {k: paths.root / meta["files"][k] for k in ("main", "analytics")}
    for key, path in saved.items():
        want = (confirmed.get("saved_drafts") or {}).get(key, {}).get("sha256")
        if not path.exists():
            raise TaskError(f"the saved {key} draft {path.name} is missing from output/")
        if not want or sha256_file(path) != want:
            raise TaskError(f"the {key} draft was changed after you confirmed the comparison: run the "
                            "comparison again and confirm it")

    fresh = compare_drafts(paths, analysis, meta)
    if fresh.blocking:
        kinds = sorted({b["kind"] for b in fresh.blocking})
        raise TaskError(f"the drafts have {len(fresh.blocking)} blocking issue(s) ({', '.join(kinds)})")
    if fresh.changes != confirmed["changes"]:
        raise TaskError("the changes no longer match the comparison you confirmed: run the comparison again")

    # the cross-task update is planned (and the target validated) before anything is written
    start, end = analysis["start"], analysis["end"]
    from datetime import date as _date
    cross_plan = plan_disconnect_update(paths, _date.fromisoformat(start), _date.fromisoformat(end))

    started = audit.utc_now()
    finals: dict[str, Path] = {}
    for key, path in saved.items():
        finals[key] = place(path, paths.final_dir, final_name(path.name))
    for key, path in saved.items():  # the drafts are untouched by the copy
        if sha256_file(path) != fresh.hashes[key]:
            raise TaskError(f"the {key} draft changed during finalization (this must never happen)")

    cross = apply_disconnect_update(cross_plan)

    approver_source = "getpass"
    try:
        approver = getpass.getuser()
    except Exception:  # pragma: no cover - no user name available
        approver = "unknown"
    inputs = input_records(paths)
    final_recs = {k: file_record(p) for k, p in finals.items()}
    entry = {
        "run_id": audit.new_run_id({k: (v or {}).get("sha256") for k, v in inputs.items()}
                                   | {"approver": approver}, started),
        "started_utc": audit.iso_utc(started),
        "finished_utc": audit.iso_utc(audit.utc_now()),
        "approver": approver,
        "approver_source": approver_source,
        "task": "december-disconnect",
        "window": window,
        "inputs": inputs,
        "saved_drafts": {k: file_record(p) for k, p in saved.items()},
        "plan_hashes": meta["plan_hashes"],
        "effective_configs": meta["effective_configs"],
        "snapshot": {"sources": fresh.snapshot_sources, "counts": fresh.counts},
        "diff": confirmed,
        "counts": {"changes": len(confirmed["changes"]),
                   "main_changes": confirmed["counts"]["main_changes"],
                   "analytics_changes": confirmed["counts"]["analytics_changes"],
                   "audit_errors": 0},
        "outputs": {"final_main": final_recs["main"], "final_analytics": final_recs["analytics"]},
        "cross_task": {k: v for k, v in cross.items() if k != "path"} | {"config_name": Path(cross["path"]).name},
        "library": {"finalize": FINALIZE_VERSION},
        "extra": {"answers": file_record(paths.answers) if paths.answers.exists() else None,
                  "audits": fresh.audits},
    }
    summary_line = {"finished_utc": entry["finished_utc"], "approver": approver, "window": window,
                    "final_main": final_recs["main"]["name"],
                    "final_main_sha256": final_recs["main"]["sha256"],
                    "final_analytics": final_recs["analytics"]["name"],
                    "final_analytics_sha256": final_recs["analytics"]["sha256"],
                    "changes": len(confirmed["changes"]), "cross_task": cross["status"]}
    record = audit.write_audit(paths.output, entry, summary_line)

    report_summary: dict[str, Any] = {
        "window": window,
        "flags": flag_counts(read_json(paths.flags, "the flags")["flags"]),
        "user_changes": len(confirmed["changes"]),
        "main_changes": confirmed["counts"]["main_changes"],
        "analytics_changes": confirmed["counts"]["analytics_changes"],
        "approver": approver,
        "analytics_workbook_path": paths.rel(finals["analytics"]),
        "final_main_file": finals["main"].name,
        "final_analytics_file": finals["analytics"].name,
        "message": f"Final plans in the output/final folder: {finals['main'].name} and "
                   f"{finals['analytics'].name}. Audit log: {Path(record.entry_path).name} in output/audit.",
        "audit": paths.rel(record.entry_path),
        "final_main_sha256": final_recs["main"]["sha256"],
        "final_analytics_sha256": final_recs["analytics"]["sha256"],
        "cross_task": {k: v for k, v in cross.items() if k not in ("path",)},
    }
    write_json(paths.report, {"workbook_path": paths.rel(finals["main"]), "stage": "final",
                              "extra_paths": [{"label": "Main plan", "path": paths.rel(finals["main"])},
                                              {"label": "Analytics plan", "path": paths.rel(finals["analytics"])}],
                              "summary": report_summary})
    print(f"final: {paths.rel(finals['main'])} and {paths.rel(finals['analytics'])} "
          f"({len(confirmed['changes'])} confirmed change(s)), approver {approver}")
    print(f"audit: {paths.rel(record.entry_path)}; shift roster disconnect windows: {cross['status']}"
          + (f" ({cross['reason']})" if cross.get("reason") else "")
          + (" (backup kept)" if cross.get("backup") else ""))


def main(argv=None, task_dir=None) -> int:
    return run_script(_main, argv, task_dir)


if __name__ == "__main__":
    sys.exit(main())
