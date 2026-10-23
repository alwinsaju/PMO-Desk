"""Step 5 "Compare your edits with the drafts": what did the PMO change in the two saved drafts?

Reads `output/draft-meta.json`, both plans and the two draft workbooks as the PMO edited and saved
them in Excel (same names), compares EACH workbook with its snapshot (the hidden sheet cross-checked
with the sidecar and with the plan the draft step wrote), re-runs both audits on the saved files and
writes `output/roster-diff.json`:

    {"cycle": "2026-12-25..2027-01-01", "window": "2026-12-25..2027-01-01",
     "changes": [{"person", "date", "before", "after"}],
         main plan:      person = the team member, before/after = the Winter Plan cell text
         Analytics plan: person = "Analytics <slot label>" (e.g. "Analytics S2-A", "Analytics On call"),
                         before/after = the assigned names
     "outside_changes": [],                              (every grid cell is a plan cell)
     "issues":   [{"severity": "warning|error", "kind", "message"}],
     "blocking": [{"kind", "message"}],   audit ERRORS in either file (kinds WINTER_* / ANALYTICS_*),
                                          SNAPSHOT_TAMPERED / SNAPSHOT_MISSING, DRAFT_MISSING,
                                          DRAFT_UNREADABLE, PERSON_MISSING, INPUT_CHANGED,
                                          CONFIG_CHANGED, PLAN_CHANGED, FILE_CHANGED
     "flags": {"new": [...], "resolved": [...], "remaining": <count>, "not_rechecked": <count>},
     "counts": {...}, "saved_drafts": {"main": {"name", "sha256"}, "analytics": {...}},
     "saved_draft_sha256": <main plan sha256>, "audits": {...}}

`flags` compares the audit findings (errors and warnings) of `flags.json` (the untouched drafts) with
the audits of the saved files: new = raised by the PMO's edits, resolved = cleared by them;
`remaining` = those still standing plus the plan-time flags that cannot be re-checked
(`not_rechecked`: input warnings and plan notes). `blocking` makes the confirm gate refuse. The script
exits 0 whenever a comparison could be made (also with blocking issues, and also when a saved draft is
missing: that is a blocking row); it exits non-zero only when it cannot compare at all (the plans or
the draft record are missing). The drafts and every input are only read, and a failed comparison
removes the previous `roster-diff.json`.

LIMITATION: when the confirm step is blocked by audit errors the PMO cannot fix them in place and
continue: reject, run the task again; the re-run archives the old drafts and re-solves with stability.
"""

from __future__ import annotations

import sys

from _common import (
    Paths,
    audit_delta,
    draft_meta,
    read_json,
    remove_quietly,
    run_script,
    write_json,
)
from _diffing import compare_drafts


def diff_payload(paths: Paths, cmp, analysis: dict) -> dict:
    flags_before = read_json(paths.flags, "the flags")["flags"]
    before_audit = [f for f in flags_before if f.get("source") == "audit"]
    carried = sum(1 for f in flags_before if f.get("source") != "audit" and f["severity"] != "info")
    recheck_ran = {"main", "analytics"} <= set(cmp.audits)
    if recheck_ran:
        delta = audit_delta(before_audit, cmp.audit_flags, carried)
    else:
        standing = sum(1 for f in before_audit if f["severity"] != "info")
        delta = {"new": [], "resolved": [], "remaining": standing + carried, "not_rechecked": carried}
    issues = list(cmp.issues)
    for f in delta["new"]:
        if f["severity"] == "warning":
            issues.append({"severity": "warning", "kind": f["kind"], "message": f["message"]})
    n_main = sum(1 for c in cmp.changes if not c["person"].startswith("Analytics "))
    n_an = len(cmp.changes) - n_main
    return {
        "cycle": analysis["window"],
        "window": analysis["window"],
        "changes": cmp.changes,
        "outside_changes": [],
        "issues": issues,
        "blocking": cmp.blocking,
        "flags": delta,
        "counts": {"changes": len(cmp.changes), "main_changes": n_main, "analytics_changes": n_an,
                   "outside_changes": 0, "issues": len(issues), "blocking": len(cmp.blocking),
                   **cmp.counts},
        "saved_drafts": {k: {"name": cmp.names.get(k), "sha256": cmp.hashes.get(k)}
                         for k in ("main", "analytics")},
        "saved_draft": cmp.names.get("main"),
        "saved_draft_sha256": cmp.hashes.get("main"),
        "snapshot_sources": cmp.snapshot_sources,
        "recheck_ran": recheck_ran,
        "audits": cmp.audits,
    }


def _main(paths: Paths) -> None:
    # a failed comparison must never leave the previous comparison behind for the gate to show
    remove_quietly([paths.diff])
    analysis = read_json(paths.analysis, "the analysis")
    meta = draft_meta(paths)
    cmp = compare_drafts(paths, analysis, meta)
    payload = diff_payload(paths, cmp, analysis)
    write_json(paths.diff, payload)
    c = payload["counts"]
    f = payload["flags"]
    print(f"diff: {c['main_changes']} change(s) in the main plan, {c['analytics_changes']} in the Analytics "
          f"plan, {c['issues']} issue(s), {c['blocking']} blocking; flags new {len(f['new'])}, resolved "
          f"{len(f['resolved'])}, remaining {f['remaining']}")
    if c["blocking"]:
        kinds = sorted({b["kind"] for b in payload["blocking"]})
        print("BLOCKING: " + "; ".join(kinds))


def main(argv=None, task_dir=None) -> int:
    return run_script(_main, argv, task_dir)


if __name__ == "__main__":
    sys.exit(main())
