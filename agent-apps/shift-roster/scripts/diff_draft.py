"""Step 5 "Compare your edits": what did the user change in the saved draft?

Reads `output/plan.json` and the draft the user edited and saved in Excel
(`output/Roster DRAFT <cycle id>.xlsx`, same name), compares it with the snapshot of what the
draft step wrote (the hidden sheet cross-checked with the sidecar), re-checks the flags on the
edited schedule with `make_rechecker` (plan + roster + config + holiday matrix) and writes
`output/roster-diff.json`:

    {"cycle": "2026-12",
     "changes":         [{"person", "date", "before", "after"}],   cells inside the draft's cycle
     "outside_changes": [{"person", "date", "before", "after"}],   cells elsewhere in the grid
     "issues":   [{"severity": "warning|error", "kind", "message", ["person", "date"]}],
     "blocking": [{"kind", "message"}],   snapshot tampered/missing, a person row missing, master
                                          changed, an input changed since the analysis ...
     "flags": {"new": [...], "resolved": [...], "remaining": <count>, "not_rechecked": <count>},
     "counts": {...}, "saved_draft", "saved_draft_sha256", "snapshot_source", ...}

`flags` compares only the flags the re-checker recomputes (HOL check, staffing, per-shift
headcount): new = raised by the edits, resolved = cleared by them; `remaining` = those still
standing plus the plan-time flags that cannot be re-checked (`not_rechecked`).
`blocking` makes the confirm gate refuse. The script itself exits 0 whenever the comparison
could be made (also with blocking issues); it exits non-zero only when it cannot compare
(plan or draft missing, unreadable). The draft and the master are only read.
"""

from __future__ import annotations

import sys

from _common import (
    Paths,
    carried_flag_count,
    changed_inputs,
    compute_diff,
    diff_payload,
    load_config_file,
    load_master,
    load_matrix_file,
    load_plan,
    read_json,
    remove_quietly,
    run_script,
    write_json,
    TaskError,
)


def input_blockers(paths: Paths, analysis: dict, have_master_changed: bool) -> list[dict[str, str]]:
    keys = ["holidays", "pto", "config"] + ([] if have_master_changed else ["roster"])
    return [{"kind": "INPUT_CHANGED", "message": m + "; start the task again"}
            for m in changed_inputs(paths, analysis["inputs"], keys)]


def _main(paths: Paths) -> None:
    # a failed comparison must never leave the previous comparison behind for the gate to show
    remove_quietly([paths.diff])
    analysis = read_json(paths.analysis, "the analysis")
    plan = load_plan(paths)
    cid = analysis["cycle"]["id"]
    roster = load_master(paths)
    config = load_config_file(paths)  # validates that the config is still readable
    matrix, errors = load_matrix_file(paths, config)
    if matrix is None:
        raise TaskError("the Holiday Roster cannot be used: " + "; ".join(errors[:4]))

    diff = compute_diff(paths, cid, plan, roster, matrix)
    master_changed = any(i.code == "MASTER_CHANGED" for i in diff.issues)
    payload = diff_payload(diff, cid, input_blockers(paths, analysis, master_changed),
                           carried_flag_count(plan))
    write_json(paths.diff, payload)
    c = payload["counts"]
    print(f"diff: {c['changes']} change(s) in the cycle, {c['outside_changes']} outside it, "
          f"{c['issues']} issue(s), {c['blocking']} blocking; flags new "
          f"{len(payload['flags']['new'])}, resolved {len(payload['flags']['resolved'])}, "
          f"remaining {payload['flags']['remaining']}")
    if c["blocking"]:
        print("BLOCKING: " + "; ".join(b["kind"] for b in payload["blocking"]))


def main(argv=None, task_dir=None) -> int:
    return run_script(_main, argv, task_dir)


if __name__ == "__main__":
    sys.exit(main())
