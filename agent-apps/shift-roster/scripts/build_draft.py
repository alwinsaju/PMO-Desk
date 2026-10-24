"""Step 3 "Build draft": the cycle as plain data, then an Excel draft the user reviews.

Reads `output/analysis.json` (step 1), the form `output/ask-me.json` and the answers
`output/ask-me-answers.json` (flat `{fieldId: value}`), refuses when an input changed since
the analysis, converts the answers to the library's structured answers
(`{"changes": ..., "rotation": ...}` plus the confirmed PTO name matches), runs
`cycle_builder.build_plan` and writes

    output/plan.json                       `Plan.to_json()` (deterministic; step 5 and 7 read it)
    output/Roster DRAFT <cycle id>.xlsx    a COPY of the master with the new cycle filled in, the
                                           summary sheets and the hidden snapshot (draft_builder)
    output/Roster DRAFT <cycle id>.xlsx.snapshot.json   the snapshot sidecar
    output/flags.json                      `{"counts": {error, warning, info}, "flags": [...]}`
    output/report-data.json                `stage: draft`, `workbook_path`, summary
                                           (incl. `holiday_source`: kind, file, sha256, covers_years)

The master (`input/roster.xlsx`) is only read. The holiday tie-break seed comes from the config
(printed). The same inputs and answers give the same cell content, plan.json and flags.json.

Rules worth knowing
* A PTO import name the user chose to SKIP is dropped before planning and noted (INFO flag).
* A replacement whose inherited category is asked every cycle (ASK_ME / UNCLASSIFIED) keeps the
  replaced seat's shift and weekly-off pattern (answer KEEP) and gets an INFO flag: edit the draft
  if that is wrong.
* Anything else the library still needs fails the step with a readable list (the form gate
  normally prevents it).
"""

from __future__ import annotations

import sys
from typing import Any

from _common import (
    SHEET_NAME,
    Paths,
    TaskError,
    add_flags,
    changed_inputs,
    convert_answers,
    cycle_id,
    flag_counts,
    flags_payload,
    load_config_file,
    load_master,
    parse_cycle_id,
    read_json,
    read_pto_file,
    resolve_holiday_source,
    run_script,
    sha256_of_text,
    write_json,
    write_text,
)
from roster_lib.audit import sha256_file
from roster_lib.config import name_key
from roster_lib.cycle_builder import Flag, NeedsAnswers, build_plan
from roster_lib.draft_builder import build_draft as build_draft_workbook


def plan_with_replacement_defaults(roster, config, cycle, converted, matrix, entries):
    """`build_plan`, answering KEEP for replacements the library still wants a shift for.

    -> (plan, names that got KEEP)"""
    answers = {"changes": dict(converted.structured["changes"]),
               "rotation": {k: dict(v) for k, v in converted.structured["rotation"].items()}}
    replaced = {name_key(n) for n in converted.replacements}
    kept: list[str] = []
    for attempt in (0, 1):
        try:
            plan = build_plan(roster, config, cycle, answers, holiday_matrix=matrix,
                              pto_entries=entries, confirmed_pto=converted.confirmed_pto)
            return plan, kept
        except NeedsAnswers as exc:
            fixable = [m for m in exc.missing if m.stage == "rotation"
                       and name_key(m.name) in replaced]
            if attempt == 0 and fixable and not exc.invalid and len(fixable) == len(exc.missing):
                for m in fixable:
                    answers["rotation"][m.name] = {"shift": "KEEP"}
                    kept.append(m.name)
                continue
            lines = [f"{m.name} ({m.stage}: {m.reason})" for m in exc.missing] + \
                    [f"invalid: {p}" for p in exc.invalid]
            raise TaskError("the draft cannot be built, answers are still needed: "
                            + "; ".join(lines[:8])) from None
    raise AssertionError("unreachable")  # pragma: no cover


def _main(paths: Paths) -> None:
    analysis = read_json(paths.analysis, "the analysis")
    if analysis.get("blocked"):
        raise TaskError("the analysis is blocked: " + "; ".join(analysis.get("blockers", [])))
    form = read_json(paths.ask_me, "the question form")
    required = [f["id"] for f in form.get("fields", []) if f.get("required")]
    if paths.answers.exists():
        flat = read_json(paths.answers, "the answers")
    elif required:
        raise TaskError(f"the answers file is missing but {len(required)} question(s) are "
                        "required (run the 'Answer questions' step)")
    else:
        flat = {}

    stale = changed_inputs(paths, analysis["inputs"], ["roster", "holidays", "pto", "config"])
    if stale:
        raise TaskError("; ".join(stale) + ": run the task again from the start so the "
                        "questions match the new files")

    cycle = parse_cycle_id(analysis["cycle"]["id"])
    converted = convert_answers(form, flat, analysis.get("form_info"))

    roster = load_master(paths)
    config = load_config_file(paths)
    # the very Holiday Roster the analysis used (uploaded or reference), pinned by the analysis
    source, matrix_errors, _notes = resolve_holiday_source(
        paths, config, pinned=(analysis.get("inputs") or {}).get("holidays"))
    if source is None:
        raise TaskError("the Holiday Roster cannot be used: " + "; ".join(matrix_errors[:4]))
    matrix = source.matrix
    entries = read_pto_file(paths)
    if entries is not None and converted.skipped_pto:
        skip = set(converted.skipped_pto)
        entries = [e for e in entries if e.name not in skip]

    master_sha = sha256_file(paths.roster)
    plan, kept = plan_with_replacement_defaults(roster, config, cycle, converted, matrix, entries)

    notes = [Flag("PTO_SKIPPED", "INFO", f"PTO entries for {name!r} were skipped on your "
                  "answer and not applied", name) for name in converted.skipped_pto]
    for name in kept:
        old = next((o for n, o in converted.replacements.items() if name_key(n) == name_key(name)),
                   "the leaver")
        notes.append(Flag("CHANGE_NOTE", "INFO",
                          f"{name} replaces {old}: the replaced seat's shift and weekly-off "
                          "pattern were kept; change the draft if that is wrong", name))
    add_flags(plan, notes)

    cid = cycle_id(cycle)
    plan_text = plan.to_json()
    draft = paths.draft(cid)
    result = build_draft_workbook(
        paths.roster, draft, plan, matrix_path=source.path,
        pto_path=paths.pto if paths.pto.exists() else None, config_path=paths.config,
        extra_run_log={"Task": "shift-roster",
                       "Holiday Roster source": f"{source.kind} ({source.file})", "Answers": f"{converted.answered} answered field(s)",
                       "Answers digest": sha256_of_text(
                           "\n".join(f"{k}={flat[k]}" for k in sorted(flat)))[:16]},
        sheet_name=SHEET_NAME, roster=roster)
    if sha256_file(paths.roster) != master_sha:  # pragma: no cover - defensive
        raise TaskError("the master changed while the draft was being built")

    write_text(paths.plan, plan_text)
    flags = flags_payload(plan.flags)
    write_json(paths.flags, flags)
    summary: dict[str, Any] = {
        "cycle": cid,
        "flags": flags["counts"],
        "shift_changes": len(plan.shift_changes),
        "cells": result.cells_written,
        "people": result.people,
        "preserved_leave": len(plan.preserved),
        "next_year_cells": len(plan.remainder_edits),
        "crosses_year_end": bool(plan.remainder_edits),
        "seed": plan.run_info["seed_used"],
        "seed_source": plan.run_info["seed_source"],
        "holiday_source": source.to_dict(),
    }
    write_json(paths.report, {"workbook_path": paths.rel(draft), "stage": "draft",
                              "summary": summary})
    counts = flag_counts(plan.flags)
    print(f"draft: cycle {cid}, {result.cells_written} cell(s) for {result.people} people, "
          f"{len(plan.shift_changes)} shift change(s); flags error={counts['error']} "
          f"warning={counts['warning']} info={counts['info']}; "
          f"seed {plan.run_info['seed_used']} ({plan.run_info['seed_source']})")
    print(f"holiday roster: {source.kind} file (sha256 {source.sha256[:12]})")
    print(f"draft file: {paths.rel(draft)}")


def main(argv=None, task_dir=None) -> int:
    return run_script(_main, argv, task_dir)


if __name__ == "__main__":
    sys.exit(main())
