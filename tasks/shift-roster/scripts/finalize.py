"""Last step "Build final roster" (runs only after the user confirmed the diff).

1. Refuses unless: no input changed since the analysis, the confirmed `output/roster-diff.json`
   has no blocking issue, and the saved draft is still the one the user confirmed (sha256); the
   diff is recomputed from the saved draft and the master.
2. `final_build.build_final(..., confirmed=True, approver=None)`: the approved cells are written
   into a COPY of the master (only the target sheet part changes; pkgdiff and a grid comparison
   prove it). Files:

       output/final/<master> - final <cycle>.xlsx     the final roster
       output/backups/<master>.<sha8>.xlsx            hash-verified copy of the master
       output/audit/<run id>.json + audit.log.jsonl   who approved what (names allowed: output)

3. When the cycle runs past the roster's last date (`plan.remainder_edits` is not empty) also
   `next_year_file.build_next_year_file` -> `output/final/<master> - <next year>.xlsx`.
4. THEN the updated rotation config (`plan.config_after`: shifts and person changes become the
   new baseline) is saved to `config/rotation-config.json`, the previous file first copied to
   `config/backups/rotation-config.<UTC timestamp>.json`.
5. `output/report-data.json` (`stage: final`, `workbook_path` = the final roster, next-year file
   and audit path in the summary; `extra_paths` = `[{label: "Next-year roster", path}]` when a
   next-year file was built, so the Tasks app offers an Open button for it too).

The master (`input/roster.xlsx`) is never modified: its sha256 is asserted at the end (and by
the library at every stage). Because step 4 changes the config, running this step twice after a
success is refused ("the rotation config changed since the analysis"): start a new run.
"""

from __future__ import annotations

import os
import shutil
import sys
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from _common import (
    Paths,
    TaskError,
    carried_flag_count,
    changed_inputs,
    compute_diff,
    diff_payload,
    flag_counts,
    load_config_file,
    load_master,
    load_plan,
    read_json,
    resolve_holiday_source,
    run_script,
    save_config_with_backup,
    write_json,
)
from roster_lib.audit import file_record, sha256_file
from roster_lib.final_build import build_final
from roster_lib.next_year_file import build_next_year_file


def place(src: Path, dst_dir: Path) -> Path:
    """Move `src` into `dst_dir`; an identical file already there is kept (src dropped), a
    different one is never overwritten (the new file gets a " (n)" suffix)."""
    dst_dir.mkdir(parents=True, exist_ok=True)
    dst = dst_dir / src.name
    n = 1
    while dst.exists():
        if sha256_file(dst) == sha256_file(src):
            src.unlink()
            return dst
        n += 1
        dst = dst_dir / f"{src.stem} ({n}){src.suffix}"
    os.replace(src, dst)
    return dst


def next_year_labels(matrix, roster) -> dict[date, str]:
    """Holiday names the matrix has for the dates of the next-year file."""
    start = roster.last_date + timedelta(days=1)
    end = start + timedelta(days=len(roster.dates) - 1)
    names: dict[date, list[str]] = {}
    for h in matrix.holidays:
        if start <= h.date <= end:
            names.setdefault(h.date, []).append(h.name)
    return {d: " / ".join(v) for d, v in sorted(names.items())}


def _main(paths: Paths) -> None:
    analysis = read_json(paths.analysis, "the analysis")
    plan = load_plan(paths)
    cid = analysis["cycle"]["id"]

    stale = changed_inputs(paths, analysis["inputs"], ["roster", "holidays", "pto", "config"])
    if stale:
        extra = ("; the rotation config is updated when a cycle is finalized, so a finished "
                 "run cannot be finalized again" if any("config" in m for m in stale) else "")
        raise TaskError("; ".join(stale) + extra + ": start a new run")

    confirmed = read_json(paths.diff, "the confirmed diff")
    if confirmed.get("blocking"):
        raise TaskError("the confirmed diff has blocking issues: "
                        + "; ".join(f"{b['kind']}: {b['message']}" for b in confirmed["blocking"]))
    saved = paths.draft(cid)
    if not saved.exists():
        raise TaskError(f"the saved draft {saved.name} is missing from output/")
    if sha256_file(saved) != confirmed.get("saved_draft_sha256"):
        raise TaskError("the draft was changed after you confirmed the comparison: run the "
                        "comparison again and confirm it")

    master_sha = sha256_file(paths.roster)
    if master_sha != analysis["inputs"]["roster"]["sha256"]:
        raise TaskError("the master roster changed since the analysis: start a new run")

    roster = load_master(paths)
    config = load_config_file(paths)  # must still be valid before it is replaced
    # the same Holiday Roster the draft was built with (checked above: it did not change)
    source, errors, _notes = resolve_holiday_source(
        paths, config, pinned=(analysis.get("inputs") or {}).get("holidays"))
    if source is None:
        raise TaskError("the Holiday Roster cannot be used: " + "; ".join(errors[:4]))
    matrix = source.matrix

    diff = compute_diff(paths, cid, plan, roster, matrix)
    fresh = diff_payload(diff, cid, carried=carried_flag_count(plan), holiday_source=source)
    if fresh["blocking"]:
        raise TaskError("the draft has blocking issues: "
                        + "; ".join(f"{b['kind']}: {b['message']}" for b in fresh["blocking"]))
    for key in ("changes", "outside_changes"):
        if fresh[key] != confirmed[key]:
            raise TaskError(f"the {key.replace('_', ' ')} no longer match the comparison you "
                            "confirmed: run the comparison again")

    answers_record = file_record(paths.answers) if paths.answers.exists() else None
    result = build_final(
        paths.roster, saved, diff, paths.output, approver=None, confirmed=True,
        matrix_path=source.path, pto_path=paths.pto if paths.pto.exists() else None,
        config_path=paths.config,
        extra={"task": "shift-roster", "cycle_id": cid, "answers": answers_record,
               "plan_cells": len(plan.edits), "remainder_cells": len(plan.remainder_edits),
               "holiday_source": source.to_dict()})
    final_path = place(Path(result.final_path), paths.final_dir)

    next_year_path: Path | None = None
    next_year_note: dict[str, Any] | None = None
    if plan.remainder_edits:
        year = min(d for _, d in plan.remainder_edits).year
        staging = paths.output / ".next-year-staging"
        staging.mkdir(parents=True, exist_ok=True)
        built = staging / f"{paths.roster.stem} - {year}.xlsx"
        ny = build_next_year_file(
            final_path, built, plan.remainder_edits,
            holiday_labels=next_year_labels(matrix, roster), sheet_name=roster.sheet_name)
        next_year_path = place(built, paths.final_dir)
        shutil.rmtree(staging, ignore_errors=True)
        next_year_note = {"start": ny.start.isoformat(), "end": ny.end.isoformat(),
                          "cells_written": ny.cells_written, "labels_written": ny.labels_written,
                          "warnings": list(ny.warnings), "old_year_cells": len(ny.old_year_cells)}

    if sha256_file(paths.roster) != master_sha:
        raise TaskError("the master roster changed during finalization (this must never happen); "
                        "the config was NOT updated")

    # The final roster is built and verified: only now does the new config become the baseline.
    config_backup = save_config_with_backup(paths, plan.config_after)

    if sha256_file(paths.roster) != master_sha:  # pragma: no cover - paranoia
        raise TaskError("the master roster changed (this must never happen)")

    summary: dict[str, Any] = {
        "cycle": cid,
        "flags": flag_counts(plan.flags),
        "flags_after_edits": {"new": len(fresh["flags"]["new"]),
                              "resolved": len(fresh["flags"]["resolved"]),
                              "remaining": fresh["flags"]["remaining"]},
        "shift_changes": len(plan.shift_changes),
        "user_changes": result.user_changes,
        "outside_changes": result.outside_changes,
        "cells_written": result.cells_written,
        "approver": result.approver,
        "next_year_file": paths.rel(next_year_path) if next_year_path else None,
        "next_year": next_year_note,
        "audit": paths.rel(result.audit_path),
        "backup": paths.rel(result.backup_path),
        "config_backup": paths.rel(config_backup) if config_backup else None,
        "master_sha256": master_sha,
        "holiday_source": source.to_dict(),
    }
    report: dict[str, Any] = {"workbook_path": paths.rel(final_path), "stage": "final"}
    if next_year_path:  # the Tasks app adds an Open button per extra file
        report["extra_paths"] = [{"label": "Next-year roster", "path": paths.rel(next_year_path)}]
    report["summary"] = summary
    write_json(paths.report, report)
    print(f"final: {paths.rel(final_path)} ({result.cells_written} cell(s) written, "
          f"{result.user_changes} of your change(s) + {result.outside_changes} outside the "
          f"cycle), approver {result.approver}")
    if next_year_path:
        print(f"next-year file: {paths.rel(next_year_path)} "
              f"({len(next_year_note['warnings'])} warning(s))")
    print(f"audit: {summary['audit']}; backup: {summary['backup']}; "
          f"config backup: {summary['config_backup']}; master unchanged")


def main(argv=None, task_dir=None) -> int:
    return run_script(_main, argv, task_dir)


if __name__ == "__main__":
    sys.exit(main())
