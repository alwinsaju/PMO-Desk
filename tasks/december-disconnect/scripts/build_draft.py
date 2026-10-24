"""Step 3 "Build the draft plans": the MAIN winter plan and the ANALYTICS plan as two Excel drafts
the PMO reviews.

Reads `output/analysis.json` (step 1), the form `output/ask-me.json` and the answers
`output/ask-me-answers.json` (flat `{fieldId: value}`), refuses when an input changed since the
analysis, converts the answers, merges them into COPIES of the two configs (the real configs are
never edited), solves both plans and writes

    output/Winter Coverage DRAFT <window>.xlsx             main plan: 3 formula-linked tabs, hidden
                                                          snapshot (+ `.snapshot.json` sidecar)
    output/Analytics Winter Coverage DRAFT <window>.xlsx   Analytics plan, same conventions
    output/plan.json, output/analytics-plan.json           both plans (deterministic)
    output/winter-config.effective.json, output/analytics-config.effective.json
                                                          the configs the plans were built with
    output/draft-meta.json                                 hashes, file names, roster names (diff step)
    output/flags.json                                      `{"counts": {error, warning, info}, "flags": [...]}`
                                                          both audits + plan notes; messages start with
                                                          `[Main]` / `[Analytics]`, kinds WINTER_* / ANALYTICS_*
    output/report-data.json                                `stage: draft`, `workbook_path` = the main plan,
                                                          `summary.analytics_workbook_path` = the other,
                                                          `extra_paths` = both files with labels (Open buttons)

where `<window>` reads like `2026-12-25 to 2027-01-01`. The shift roster, the staff roster, the Analytics
rosters and the real configs are only read. Same inputs and answers give the same plans and flags.

A re-run (after the PMO rejected a draft) first ARCHIVES the previous drafts, sidecars, plans and diff
into `output/archive/<UTC timestamp>/`, so the PMO's edits are never destroyed, then re-solves the main
plan with stability against the previous plan (same window only; `weights.stability` per changed
person-day). The Analytics solver has no stability term: it is deterministic, so unchanged inputs give
the same plan.

Rules worth knowing
* Answers: `shift:` -> the plan person's usual shift (source "answer"); `name:` confirmed ->
  `name_aliases`, SKIP -> the staff-roster person is excluded; availability rows -> `availability`
  (main) / `available` date lists (Analytics).
* The Analytics usual shifts are refreshed from the uploaded Oct/Nov rosters (people and roles stay as
  configured); without them the config is used as is.
* An Analytics plan that cannot be built (availability leaves slots uncovered) fails the step with the
  rule that cannot be met; change the exceptions and run again.
"""

from __future__ import annotations

import sys
from typing import Any

from _common import (
    MAIN_TAG,
    Paths,
    TaskError,
    analytics_flag,
    archive_previous,
    changed_inputs,
    convert_answers,
    flags_payload,
    load_analytics,
    load_previous_plan,
    load_shift_roster,
    load_staff,
    load_winter,
    main_flag,
    merge_analytics_raw,
    merge_winter_raw,
    note_flag,
    parse_analytics,
    parse_winter,
    read_analytics_rosters,
    read_json,
    refresh_analytics_raw,
    run_script,
    scrub,
    sha256_of_text,
    window_file_text,
    write_json,
    write_text,
)
from roster_lib.audit import sha256_file
from winter_lib.analytics_audit import audit_analytics_plan
from winter_lib.analytics_plan import solve_analytics_plan
from winter_lib.analytics_workbook import build_analytics_workbook
from winter_lib.winter_audit import audit_winter_plan
from winter_lib.winter_build import NeedsShiftError, apply_shifts
from winter_lib.winter_inputs import build_inputs
from winter_lib.winter_plan import PlanInputError, solve_winter_plan
from winter_lib.winter_types import display_code
from winter_lib.winter_workbook import write_winter_workbook

PLAN_ONLY_CODES = ("time_limit", "solver_fallback", "extra_days")  # the rest repeat the audit


def roster_names_of(people) -> list[str]:
    """The names the main audit accepts: the plan names and the staff-roster spellings."""
    names = [p.name for p in people] + [p.staff_name for p in people if p.staff_name]
    return sorted(set(names))


def collect_flags(*, inputs, people, plan, main_audit, analytics_audit,
                  aplan, converted, refresh, stability_used: bool, main_file: str,
                  analytics_file: str) -> list[dict[str, Any]]:
    """Every flag of the draft, as dicts (see `_common.main_flag` / `analytics_flag`)."""
    flags: list[dict[str, Any]] = [
        note_flag("WINTER_DRAFT_FILE", f"main plan draft: output/{main_file}", "main"),
        # the Tasks app's Open button only opens the main plan: say where the other workbook is
        note_flag("ANALYTICS_DRAFT_FILE", f"Analytics plan draft (a separate workbook, open it from the "
                  f"output folder): output/{analytics_file}", "analytics"),
    ]
    reasons = {(f.code, f.team, f.date): f.message for f in plan.findings if f.code == "team_min"}
    for f in main_audit.findings:
        flag = main_flag(f)
        better = reasons.get((f.code, f.team, f.date))
        if better:
            flag["message"] = f"{MAIN_TAG} {better}"
        flags.append(flag)
    for f in plan.findings:
        if f.code in PLAN_ONLY_CODES:
            flags.append(main_flag(f, source="plan"))
    for f in inputs.findings:
        if f.code == "needs_shift":
            continue  # answered in the form: reported below as an assumption
        flags.append(main_flag(f, source="input"))
    for p in people:
        if p.shift_source == "answer":
            flags.append(main_flag(_Info("shift_assumed", f"{p.name} has no shift history: planned on "
                                        f"{display_code(p.usual_shift)} as you answered", p), source="input"))
    for staff_name, roster_name in converted.name_alias.items():
        flags.append(main_flag(_Info("name_confirmed", f"staff roster {staff_name!r} was confirmed as "
                                     f"{roster_name!r} (added as a name alias for this run)", None,
                                     roster_name), source="input"))
    for staff_name in converted.name_skip:
        flags.append(main_flag(_Info("name_skipped", f"staff roster {staff_name!r} was skipped on your "
                                     "answer and is not scheduled", None, staff_name, "warning"),
                               source="input"))
    for row in converted.rows("main"):
        flags.append(main_flag(_Info("availability_exception", _exception_text(row), None, row.person),
                               source="input"))
    if stability_used:
        flags.append(note_flag("WINTER_STABILITY", "re-solved keeping the previous draft's assignments "
                               "where possible (the previous draft is archived)", "main"))

    for f in analytics_audit.findings:
        flags.append(analytics_flag(f))
    for text in aplan.notes:
        flags.append(note_flag("ANALYTICS_NOTE", text, "analytics"))
    if refresh.files:
        flags.append(note_flag(
            "ANALYTICS_ROSTER_REFRESH",
            f"usual shifts refreshed from {refresh.files} Analytics roster file(s): {refresh.updated} "
            f"changed, {refresh.unchanged} unchanged, {refresh.not_in_rosters} not found in the rosters",
            "analytics", "input"))
    for row in converted.rows("analytics"):
        flags.append(note_flag("ANALYTICS_AVAILABILITY_EXCEPTION", _exception_text(row), "analytics",
                               "input"))
    return flags


class _Info:
    """A minimal stand-in with the attributes `main_flag` reads (for task-level notes)."""

    def __init__(self, code: str, message: str, person=None, name: str | None = None,
                 severity: str = "info"):
        self.code, self.message, self.severity = code, message, severity
        self.team = getattr(person, "team", None)
        self.person = getattr(person, "name", None) or name
        self.date = None


def _exception_text(row) -> str:
    days = ", ".join(d.isoformat() for d in row.dates)
    rule = "is not available on" if row.mode == "unavailable" else "is available only on"
    return f"availability exception from your answers: {row.person} {rule} {days}"


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
                        "required (run the 'Answer the questions' step)")
    else:
        flat = {}
    stale = changed_inputs(paths, analysis["inputs"])
    if stale:
        raise TaskError("; ".join(stale) + ": run the task again from the start so the "
                        "questions match the new files")

    cfg0, raw = load_winter(paths)
    acfg0, araw = load_analytics(paths)
    window = analysis["window"]
    wtext = window_file_text(cfg0.start, cfg0.end)
    converted = convert_answers(form, flat, (cfg0.start, cfg0.end))

    # ---- the configs the plans are built with (copies; the real files are never written)
    eff_raw = merge_winter_raw(raw, converted)
    cfg = parse_winter(eff_raw)
    readings = read_analytics_rosters(paths)
    araw2, refresh = refresh_analytics_raw(araw, readings)
    acfg_mid = parse_analytics(araw2)
    aeff_raw = merge_analytics_raw(araw2, converted, acfg_mid)
    acfg = parse_analytics(aeff_raw)

    # ---- inputs and the main plan
    roster = load_shift_roster(paths, cfg)
    staff = load_staff(paths)
    inputs = build_inputs(paths.staff, paths.roster, cfg, roster=roster, staff=staff)
    try:
        people = apply_shifts(inputs, converted.shifts)
    except NeedsShiftError as exc:
        raise TaskError(f"{len(exc.people)} person(s) still need a shift answer: run the task again "
                        "from the start") from None
    if not people:
        raise TaskError("nobody can be scheduled (check the staff roster, the team mapping and the exclusions)")
    previous = load_previous_plan(paths, cfg)
    try:
        plan = solve_winter_plan(people, cfg, previous)
    except PlanInputError as exc:
        raise TaskError(f"the main plan cannot be solved: {type(exc).__name__}") from None
    aplan = solve_analytics_plan(acfg)
    if not aplan.ok:
        raise TaskError("the Analytics plan cannot be built, a rule cannot be met: "
                        + "; ".join(scrub(x) for x in aplan.problems[:4] or ["no solution"]) + ". Change the Analytics "
                        "availability exceptions and run the task again")

    # ---- write: archive the previous draft, then both workbooks
    archived, archived_n = archive_previous(paths)
    main_path, an_path = paths.draft_main(wtext), paths.draft_analytics(wtext)
    names = roster_names_of(people)
    wres = write_winter_workbook(main_path, plan, cfg)
    ares = build_analytics_workbook(acfg, aplan, an_path)
    main_audit = audit_winter_plan(main_path, cfg, roster_names=names)
    an_audit = audit_analytics_plan(an_path, acfg)

    flags = collect_flags(inputs=inputs, people=people, plan=plan, main_audit=main_audit,
                          analytics_audit=an_audit, aplan=aplan, converted=converted, refresh=refresh,
                          stability_used=previous is not None, main_file=main_path.name,
                          analytics_file=an_path.name)
    payload = flags_payload(flags)
    plan_text = plan.to_json()
    write_text(paths.plan, plan_text)
    write_json(paths.analytics_plan, aplan.to_dict())
    write_json(paths.winter_effective, eff_raw)
    write_json(paths.analytics_effective, aeff_raw)
    write_json(paths.meta, {
        "format": "december-disconnect-draft/1",
        "window": window,
        "files": {"main": paths.rel(main_path), "analytics": paths.rel(an_path)},
        "plan_hashes": {"main": wres.plan_hash, "analytics": aplan.plan_hash},
        "effective_configs": {"winter": sha256_file(paths.winter_effective),
                              "analytics": sha256_file(paths.analytics_effective)},
        "roster_names": names,
        "answers_digest": sha256_of_text("\n".join(f"{k}={flat[k]}" for k in sorted(flat)))[:16],
        "counts": {"people": len(people), "slots": len(acfg.slots)},
    })
    write_json(paths.flags, payload)
    hist = main_audit.summary.get("days_histogram", {})
    summary: dict[str, Any] = {
        "window": window,
        "flags": payload["counts"],
        "people": len(people),
        "person_days": main_audit.summary.get("person_days"),
        "days_histogram": hist,
        "analytics_workbook_path": paths.rel(an_path),
        "analytics_slots_filled": an_audit.filled,
        "analytics_slots_total": an_audit.total_slots,
        "analytics_people": len(acfg.people),
        "seed": cfg.seed,
        "solver_status": plan.run_info.status,
        "mip_gap": plan.run_info.mip_gap,
        "stability": previous is not None,
        "archived_files": archived_n,
    }
    # `extra_paths`: the Tasks app shows one Open button per file (the main plan is workbook_path)
    write_json(paths.report, {"workbook_path": paths.rel(main_path), "stage": "draft",
                              "extra_paths": [{"label": "Main plan", "path": paths.rel(main_path)},
                                              {"label": "Analytics plan", "path": paths.rel(an_path)}],
                              "summary": summary})
    c = payload["counts"]
    print(f"draft: window {window}, main plan {len(people)} people / {summary['person_days']} person-days "
          f"(days histogram {dict(hist)}); analytics {an_audit.filled} of {an_audit.total_slots} slots; "
          f"flags error={c['error']} warning={c['warning']} info={c['info']}"
          + (f"; stability against the previous plan" if previous is not None else "")
          + (f"; archived {archived_n} earlier file(s)" if archived_n else ""))
    print(f"draft files: {paths.rel(main_path)}; {paths.rel(an_path)}")
    if ares.notes:
        print(f"analytics: {len(ares.notes)} plan note(s) in the flags")


def main(argv=None, task_dir=None) -> int:
    return run_script(_main, argv, task_dir)


if __name__ == "__main__":
    sys.exit(main())
