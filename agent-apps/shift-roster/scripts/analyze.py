"""Step 1 "Analyze roster": what must the user decide before the draft can be built?

Reads `input/run-params.json` (`params.cycle`, e.g. `2026-12` = the cycle's first month),
the roster, the Holiday Roster, the optional PTO import and the rotation config, runs
`cycle_builder.analyze_cycle` and writes

* `output/ask-me.json`   the form schema the "Answer questions" gate shows;
* `output/analysis.json` everything the later steps need: the cycle, the sha256 of every input
                         (a later step refuses when one changed), availability, the full
                         library analysis and the answer-conversion info.

A new run starts here, so the derived files of an earlier run (answers, plan, flags, diff,
report data) are removed first: stale answers must never satisfy the new form.

Exits non-zero with the reason on stderr when the cycle cannot be built (its previous cycle
has no data, the Holiday Roster is unusable, the PTO import has bad rows).

Form fields (ids are `<kind>:<name>`, all selects; the answers file is a flat
`{fieldId: value}`):

  shift:<person>          group "Ask-me"      required, default KEEP: KEEP, S1..S5, NS, US-CST, US-PST,
                                              11AM-8PM, MX-8-5 (KEEP is offered only when a current
                                              shift was found)
  pattern:<person>        group "Ask-me"      optional, default AUTO: AUTO, MON_FRI, WED_SUN
  new:<person>            group "New people"  required: new_seat | replaces:<leaver>
  seat_shift:<person>     group "New people"  optional follow-up, used only for new_seat; default the
                                              most common shift of the person's section last cycle
  seat_pattern:<person>   group "New people"  optional follow-up (AUTO, MON_FRI, WED_SUN)
  seat_team:<person>      group "New people"  optional follow-up; default the config's usual team
  seat_rotation:<person>  group "New people"  optional follow-up; default UNCLASSIFIED (asked
                                              every cycle until categorised)
  pto:<import name>       group "PTO matches" required: a roster name | SKIP

With nothing to ask the form has no fields (the gate passes immediately).
"""

from __future__ import annotations

import sys
from collections import Counter
from typing import Any

from _common import (
    ANALYSIS_FORMAT,
    AUTO,
    F_NEW,
    F_PATTERN,
    F_PTO,
    F_SEAT_PATTERN,
    F_SEAT_ROTATION,
    F_SEAT_SHIFT,
    F_SEAT_TEAM,
    F_SHIFT,
    KEEP,
    NEW_SEAT,
    PATTERN_LABELS,
    REPLACES_PREFIX,
    ROTATION_CHOICES,
    SKIP,
    Paths,
    TaskError,
    cycle_dict,
    field_id,
    input_records,
    load_config_file,
    load_master,
    load_matrix_file,
    most_common,
    pattern_options,
    read_pto_file,
    read_selected_cycle,
    remove_quietly,
    run_script,
    schedule_of,
    shift_options,
    write_json,
)
from roster_lib.checks import is_shift_canonical
from roster_lib.config import name_key
from roster_lib.cycle_builder import active_people, analyze_cycle
from roster_lib.cycles import previous_cycle
from roster_lib.rotation import derive_state


def _pattern_label(pattern: str | None) -> str | None:
    return PATTERN_LABELS.get(pattern or "", pattern)


def _current(item) -> str:
    if not item.current_shift:
        return "Current: no shift found in the previous cycle"
    text = f"Current: {item.current_shift}"
    if item.current_pattern:
        text += f", {_pattern_label(item.current_pattern)}"
    if item.current_text and item.current_text != item.current_shift:
        text += f" (written as '{item.current_text}')"
    return text


def _section_default_shift(roster_people, schedule, prev, section: str) -> str:
    """The most common shift of the people in `section` in the previous cycle (else S1)."""
    codes = []
    for p in roster_people:
        if p.section != section:
            continue
        cells = {d: t for d, t in schedule.get(p.name, {}).items() if prev.contains(d)}
        state = derive_state(cells, prev)
        if state is not None and is_shift_canonical(state.code):
            codes.append(state.code)
    return most_common(codes, "S1")


def build_form(analysis, cycle, roster, config, pto_entries) -> tuple[dict[str, Any], dict[str, Any]]:
    """The form schema (`ask-me.json`) and the info `convert_answers` needs later."""
    active = active_people(roster.people, config)
    schedule = schedule_of(roster, [p.name for p in active])
    prev = previous_cycle(cycle)
    new_keys = {name_key(n.name) for n in analysis.changes.new}
    fields: list[dict[str, Any]] = []
    shift_people: list[str] = []

    # --- ask-me: shift (and optional weekly-off pattern) for the people the rotation cannot decide
    for item in analysis.ask_me:
        if name_key(item.name) in new_keys:
            continue  # asked below as a new person
        has_current = bool(item.current_shift)
        desc = _current(item) + ". " + item.reason
        fields.append({
            "id": field_id(F_SHIFT, item.name), "group": "Ask-me", "label": item.name,
            "description": desc, "type": "select",
            "options": shift_options(include_keep=has_current),
            **({"default": KEEP} if has_current else {}), "required": True})
        fields.append({
            "id": field_id(F_PATTERN, item.name), "group": "Ask-me",
            "label": f"{item.name} weekly off",
            "description": "Leave on Automatic to keep the current pattern (or use the "
                           "shift's default when the shift changes).",
            "type": "select", "options": pattern_options(), "default": AUTO, "required": False})
        shift_people.append(item.name)

    # --- new people: replacement or new seat
    removed = [r.name for r in analysis.changes.removed]
    teams = [p.team for p in config.people]
    default_team = most_common(teams, "Operate")
    team_options = [{"value": t, "label": t} for t in sorted(set(teams) | {default_team})]
    new_people: dict[str, Any] = {}
    for n in analysis.changes.new:
        new_people[n.name] = {"section": n.section, "location": n.location_code,
                              "in_config": n.in_config}
        why = ("is in the config but has no shift or leave code in the previous cycle"
               if n.in_config else "is on the roster but not in the rotation config")
        options = [{"value": NEW_SEAT, "label": "New seat"}]
        options += [{"value": REPLACES_PREFIX + old, "label": f"Replaces {old}"} for old in removed]
        fields.append({
            "id": field_id(F_NEW, n.name), "group": "New people", "label": n.name,
            "description": f"{n.name} ({n.section}, {n.location_code}) {why}. A replacement "
                           "inherits the leaver's rotation category, shift and holiday counter.",
            "type": "select", "options": options, "required": True})
        seat_note = "Only used when 'New seat' is chosen above."
        fields.append({
            "id": field_id(F_SEAT_SHIFT, n.name), "group": "New people",
            "label": f"{n.name} shift (new seat)", "description": seat_note, "type": "select",
            "options": shift_options(include_keep=False),
            "default": _section_default_shift(active, schedule, prev, n.section),
            "required": False})
        fields.append({
            "id": field_id(F_SEAT_PATTERN, n.name), "group": "New people",
            "label": f"{n.name} weekly off (new seat)", "description": seat_note,
            "type": "select", "options": pattern_options(), "default": AUTO, "required": False})
        fields.append({
            "id": field_id(F_SEAT_TEAM, n.name), "group": "New people",
            "label": f"{n.name} team (new seat)", "description": seat_note, "type": "select",
            "options": team_options, "default": default_team, "required": False})
        fields.append({
            "id": field_id(F_SEAT_ROTATION, n.name), "group": "New people",
            "label": f"{n.name} rotation (new seat)",
            "description": seat_note + " UNCLASSIFIED means asked again every cycle.",
            "type": "select", "options": [{"value": r, "label": r} for r in ROTATION_CHOICES],
            "default": "UNCLASSIFIED", "required": False})

    # --- PTO names that are close to, but not exactly, a roster name
    pto_names: dict[str, list[str]] = {}
    for import_name, candidates in analysis.pto["needs_confirmation"].items():
        rows = [e for e in pto_entries or [] if e.name == import_name]
        span = ""
        if rows:
            first, last = min(e.start for e in rows), max(e.end for e in rows)
            span = f" ({len(rows)} row(s), {first.isoformat()} .. {last.isoformat()})"
        options = [{"value": c["roster_name"], "label": c["roster_name"]} for c in candidates]
        options.append({"value": SKIP, "label": "Skip this entry"})
        why = "; ".join(f"{c['roster_name']}: {c['reason']}" for c in candidates[:4])
        fields.append({
            "id": field_id(F_PTO, import_name), "group": "PTO matches", "label": import_name,
            "description": f"The PTO import name{span} is close to roster names. {why}",
            "type": "select", "options": options, "required": True})
        pto_names[import_name] = [c["roster_name"] for c in candidates]

    form = {"title": f"Questions for cycle {cycle_dict(cycle)['id']}", "fields": fields}
    info = {"shift_people": shift_people, "new_people": new_people, "removed": removed,
            "pto_names": pto_names}
    return form, info


def _main(paths: Paths) -> None:
    cycle = read_selected_cycle(paths)
    roster = load_master(paths)
    config = load_config_file(paths)
    matrix, matrix_errors = load_matrix_file(paths, config)
    pto_entries = read_pto_file(paths)  # None when no PTO import was uploaded

    removed = remove_quietly(paths.stale_outputs())
    analysis = analyze_cycle(roster, config, cycle, holiday_matrix=matrix,
                             holiday_matrix_errors=matrix_errors, pto_entries=pto_entries)
    blockers = [b for b in analysis.blockers if not b.startswith("answer needed")]
    cyc = cycle_dict(cycle)

    form, info = build_form(analysis, cycle, roster, config, pto_entries)
    record = {
        "format": ANALYSIS_FORMAT,
        "cycle": {**cyc, "previous": analysis.previous_cycle},
        "blocked": bool(blockers),
        "blockers": blockers,
        "inputs": input_records(paths),
        "availability": analysis.to_dict()["availability"],
        "form_info": info,
        "pto_unmatched": list(analysis.pto["unmatched"]),
        "analysis": analysis.to_dict(),
    }
    write_json(paths.analysis, record)
    if blockers:
        raise TaskError("cycle " + cyc["id"] + " cannot be built: " + "; ".join(blockers))

    write_json(paths.ask_me, form)
    required = sum(1 for f in form["fields"] if f.get("required"))
    kinds = Counter(f["group"] for f in form["fields"] if f.get("required"))
    print(f"analysis: cycle {cyc['id']} ({cyc['label']}), {analysis.active_count} active people, "
          f"{len(form['fields'])} form field(s), {required} required "
          f"({', '.join(f'{k}: {v}' for k, v in sorted(kinds.items())) or 'none'})"
          + (f"; removed {removed} stale file(s) of an earlier run" if removed else ""))
    if analysis.pto["unmatched"]:
        print(f"note: {len(analysis.pto['unmatched'])} PTO name(s) match nobody; they will be "
              "flagged in the draft and not applied")
    if analysis.year_boundary["crosses"]:
        print("note: the cycle runs past the roster's last date; the rest goes to a next-year file")


def main(argv=None, task_dir=None) -> int:
    return run_script(_main, argv, task_dir)


if __name__ == "__main__":
    sys.exit(main())
