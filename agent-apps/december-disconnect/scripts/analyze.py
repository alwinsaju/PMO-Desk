"""Step 1 "Check the rosters and list the questions": what must the PMO decide before the drafts
can be built?

Reads `input/run-params.json` (`params.window`, the id written by prepare_options), the shift
roster, the PDT staff roster, the two optional Analytics rosters and the two configs, runs
`winter_inputs.build_inputs` (who is on the main plan, their usual shift) and writes

* `output/ask-me.json`   the form schema the "Answer the questions" gate shows;
* `output/analysis.json` what the later steps need: the window, the sha256 of every input (a later
                         step refuses when one changed), counts, the answer-conversion info and
                         the Analytics refresh summary.

A new run starts here, so the derived files of an earlier run (answers, plan, flags, diff, report
data, effective configs) are removed first: stale answers must never satisfy the new form. The
previous plan files are KEPT as `previous-plan.json` / `previous-analytics-plan.json`: they are the
stability reference when the PMO re-runs after rejecting a draft. Earlier drafts stay where they
are; the draft step archives them.

Exits non-zero with the reason on stderr when the window cannot be built (configs invalid or
disagreeing, a roster unusable, the shift roster has no data before the window).

Form fields (ids are `<kind>:<name>` or `<kind>_<n>`; the answers file is a flat `{fieldId: value}`):

  shift:<person>     group "New people"    required select: S1..S5, NS, US-CST, US-PST, 11AM-8PM,
                                           MX-8-5; default = the config's `default_new_person_shift`
                                           (S1 when unset). One per person without shift history.
  name:<staff name>  group "Name matches"  required select: the shift-roster name that spelled
                                           almost the same | SKIP (do not schedule the person). One
                                           per fuzzy staff-roster / shift-roster match.
  avail_person_<n>, avail_dates_<n>, avail_mode_<n>   (n = 1..5)   group "Availability exceptions"
                     MAIN plan: person (or NONE), dates "YYYY-MM-DD,YYYY-MM-DD" (ranges
                     "YYYY-MM-DD..YYYY-MM-DD" also work), mode unavailable | only_available.
  aavail_person_<n>, aavail_dates_<n>, aavail_mode_<n>   (n = 1..3)   same shape for ANALYTICS.

The availability rows are optional; with no people to ask about, only they remain.
"""

from __future__ import annotations

import sys
from collections import Counter
from typing import Any

from _common import (
    ANALYSIS_FORMAT,
    ANALYTICS_ROWS,
    DEFAULT_ASSUMED_SHIFT,
    F_AAVAIL_DATES,
    F_AAVAIL_MODE,
    F_AAVAIL_PERSON,
    F_AVAIL_DATES,
    F_AVAIL_MODE,
    F_AVAIL_PERSON,
    F_NAME,
    F_SHIFT,
    MAIN_ROWS,
    MODE_LABELS,
    MODES,
    NONE,
    SKIP,
    Paths,
    TaskError,
    field_id,
    input_records,
    keep_previous_plans,
    load_analytics,
    load_shift_roster,
    load_staff,
    load_winter,
    read_analytics_rosters,
    read_selected_window,
    refresh_analytics_raw,
    remove_quietly,
    run_script,
    shift_options,
    write_json,
)
from winter_lib.winter_config import parse_config
from winter_lib.winter_inputs import build_inputs


def _availability_fields(group: str, prefix: tuple[str, str, str], rows: int, people_options: list[dict],
                         plan_label: str, first_hint: str) -> list[dict[str, Any]]:
    person_id, dates_id, mode_id = prefix
    fields: list[dict[str, Any]] = []
    for n in range(1, rows + 1):
        hint = first_hint if n == 1 else ""
        fields.append({
            "id": f"{person_id}_{n}", "group": group, "label": f"{plan_label}: exception {n}, person",
            "description": hint, "type": "select", "options": people_options, "default": NONE,
            "required": False})
        fields.append({
            "id": f"{dates_id}_{n}", "group": group, "label": f"{plan_label}: exception {n}, dates",
            "description": "YYYY-MM-DD, comma separated (a range works too: 2026-12-28..2026-12-30)",
            "type": "text", "default": "", "required": False})
        fields.append({
            "id": f"{mode_id}_{n}", "group": group, "label": f"{plan_label}: exception {n}, rule",
            "description": "", "type": "select",
            "options": [{"value": m, "label": MODE_LABELS[m]} for m in MODES], "default": MODES[0],
            "required": False})
    return fields


def build_form(inputs, cfg, acfg, refresh, window) -> tuple[dict[str, Any], dict[str, Any]]:
    """The form schema (`ask-me.json`) and the info the draft step needs later."""
    fields: list[dict[str, Any]] = []
    everyone = list(inputs.people) + list(inputs.needs_shift)
    default_shift = cfg.default_new_person_shift or DEFAULT_ASSUMED_SHIFT
    lb_first, lb_last = inputs.lookback

    # --- people without shift history
    shift_people: list[str] = []
    for p in inputs.needs_shift:
        fields.append({
            "id": field_id(F_SHIFT, p.name), "group": "New people", "label": p.name,
            "description": f"{p.team}. No shift history in the shift roster between {lb_first} and "
                           f"{lb_last}: choose the shift to plan (default {default_shift}).",
            "type": "select", "options": shift_options(), "default": default_shift, "required": True})
        shift_people.append(p.name)

    # --- fuzzy name matches to confirm
    by_name = {p.name: p for p in everyone}
    name_matches: dict[str, str] = {}
    for f in inputs.findings:
        if f.code != "name_fuzzy" or not f.person or f.person not in by_name:
            continue
        staff_name = by_name[f.person].staff_name
        if not staff_name or staff_name in name_matches:
            continue
        name_matches[staff_name] = f.person
        fields.append({
            "id": field_id(F_NAME, staff_name), "group": "Name matches", "label": staff_name,
            "description": f"The staff roster name is spelled almost like the shift roster name "
                           f"{f.person!r} ({by_name[f.person].team}). Is it the same person?",
            "type": "select",
            "options": [{"value": f.person, "label": f"Same person as {f.person}"},
                        {"value": SKIP, "label": "Different person: do not schedule"}],
            "required": True})

    # --- availability exceptions
    main_options = [{"value": NONE, "label": "No exception"}] + [
        {"value": p.name, "label": f"{p.name} ({p.team})"} for p in everyone]
    configured = len(cfg.availability)
    fields += _availability_fields(
        "Availability exceptions", (F_AVAIL_PERSON, F_AVAIL_DATES, F_AVAIL_MODE), MAIN_ROWS,
        main_options, "Main plan",
        "Optional. Leave the person on 'No exception' to skip a row. "
        f"{configured} person(s) already have an exception in the config.")
    on_call = sum(1 for x in acfg.people if x.role == "on_call")
    mexico = sum(1 for x in acfg.people if x.role == "mexico")
    note = (f"Analytics plan: {len(acfg.people)} people ({on_call} on call, {mexico} Mexico), "
            f"{len(acfg.slots)} slots over {len(acfg.dates)} days.")
    if refresh.files:
        note += (f" Usual shifts were refreshed from {refresh.files} roster file(s): "
                 f"{refresh.updated} changed, {refresh.unchanged} unchanged.")
    else:
        note += " Usual shifts come from the config (no Analytics roster was uploaded)."
    analytics_options = [{"value": NONE, "label": "No exception"}] + [
        {"value": x.display, "label": f"{x.display} ({x.role}, {x.usual_shift or '?'})"}
        for x in acfg.people]
    fields += _availability_fields(
        "Availability exceptions", (F_AAVAIL_PERSON, F_AAVAIL_DATES, F_AAVAIL_MODE), ANALYTICS_ROWS,
        analytics_options, "Analytics", note)

    form = {"title": f"Questions for the December Disconnect {window}", "fields": fields}
    info = {"shift_people": shift_people, "name_matches": name_matches,
            "people": [{"name": p.name, "team": p.team} for p in everyone],
            "analytics_people": [x.display for x in acfg.people]}
    return form, info


def _main(paths: Paths) -> None:
    cfg, raw = load_winter(paths)
    acfg, araw = load_analytics(paths)
    window = read_selected_window(paths, cfg)
    if (acfg.dates[0], acfg.dates[-1]) != (cfg.start, cfg.end):
        raise TaskError("the analytics config and the winter config have different windows")
    roster = load_shift_roster(paths, cfg)
    staff = load_staff(paths)
    readings = read_analytics_rosters(paths)
    lb_first, lb_last = cfg.lookback_range()
    if roster.last_date < lb_first or roster.first_date > lb_last:
        raise TaskError(f"the shift roster covers {roster.first_date}..{roster.last_date} but the usual "
                        f"shifts come from {lb_first}..{lb_last}: upload the current shift roster")

    kept = keep_previous_plans(paths)
    removed = remove_quietly(paths.stale_outputs())
    # the form asks for people without history, so the config's default shift is switched off here
    # (it becomes the form's default answer instead)
    ask_cfg = parse_config({**raw, "default_new_person_shift": None})
    inputs = build_inputs(paths.staff, paths.roster, ask_cfg, roster=roster, staff=staff)
    _, refresh = refresh_analytics_raw(araw, readings)

    blockers = [f"{f.code}" for f in inputs.findings if f.severity == "error"]
    if not inputs.people and not inputs.needs_shift:
        blockers.append("nobody can be scheduled (check the staff roster, the team mapping and the exclusions)")
    form, info = build_form(inputs, cfg, acfg, refresh, window)
    findings = Counter(f.code for f in inputs.findings)
    record = {
        "format": ANALYSIS_FORMAT,
        "window": window,
        "start": cfg.start.isoformat(),
        "end": cfg.end.isoformat(),
        "lookback": {"start": lb_first.isoformat(), "end": lb_last.isoformat()},
        "blocked": bool(blockers),
        "blockers": blockers,
        "inputs": input_records(paths),
        "stats": inputs.stats,
        "excluded": len(inputs.excluded),
        "findings": dict(sorted(findings.items())),
        "analytics": {"people": len(acfg.people), "slots": len(acfg.slots),
                      "refresh": refresh.to_dict()},
        "form_info": info,
    }
    write_json(paths.analysis, record)
    if blockers:
        raise TaskError(f"window {window} cannot be built: " + "; ".join(blockers))

    write_json(paths.ask_me, form)
    required = Counter(f["group"] for f in form["fields"] if f.get("required"))
    s = inputs.stats
    print(f"analysis: window {window}, {len(inputs.people)} scheduled + {len(inputs.needs_shift)} "
          f"without shift history, {len(inputs.excluded)} excluded, {len(form['fields'])} form field(s), "
          f"{sum(required.values())} required "
          f"({', '.join(f'{k}: {v}' for k, v in sorted(required.items())) or 'none'})"
          + (f"; removed {removed} stale file(s) of an earlier run" if removed else "")
          + (f"; kept {kept} plan file(s) as the stability reference" if kept else ""))
    print(f"analytics: {len(acfg.people)} people, {len(acfg.slots)} slots; roster refresh: "
          f"{refresh.files} file(s), {refresh.updated} updated, {refresh.unchanged} unchanged, "
          f"{refresh.not_in_rosters} not in the rosters")
    if s["unmapped"] or s["staff_only"] or s["shift_only"]:
        print(f"note: {s['unmapped']} staff person(s) with no winter team, {s['staff_only']} only on the "
              f"staff roster, {s['shift_only']} only on the shift roster (see the warnings in the draft)")


def main(argv=None, task_dir=None) -> int:
    return run_script(_main, argv, task_dir)


if __name__ == "__main__":
    sys.exit(main())
