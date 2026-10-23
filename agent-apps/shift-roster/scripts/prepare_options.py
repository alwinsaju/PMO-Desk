"""Prepare script (not a workflow step): which cycles can be selected?

Read-only. Reads `input/roster.xlsx`, `input/holiday-roster.xlsx` and
`config/rotation-config.json`, writes `output/options.json`:

    {"roster": {"first_date", "last_date", "people", ...},
     "cycles": [{"id": "2026-12", "label": "Dec 2026 - Jan 2027", "start", "end",
                 "enabled": true, "reason": "...", "coverage": 1.0, ...}],
     "default": "2026-12",
     "problems": [{"severity": "error|warning|info", "message": "..."}]}

One cycle entry per cycle that overlaps the roster plus the next cycle after the roster's
last date. `enabled` / `reason` / `coverage` come from `cycles.cycle_availability` (a cycle
is selectable only when the previous cycle has data); `reason` is shown on hover. A cycle is
also disabled while the config or the Holiday Roster cannot be used (the reason says why).
`default` is the earliest enabled cycle that is not filled yet (else the latest enabled one).

Expected problems (unreadable roster, missing config, bad Holiday Roster, ...) are written
as readable `problems` and the script still exits 0, so the app can show them next to the
cycle list. Nothing but `output/options.json` is written.
"""

from __future__ import annotations

import sys
from typing import Any

from _common import (
    Paths,
    TaskError,
    cycle_id,
    cycle_range_label,
    candidate_cycles,
    cycle_is_filled,
    load_config_file,
    load_master,
    load_matrix_file,
    run_script,
    schedule_of,
    write_json,
)
from roster_lib.codes import counts_as_code
from roster_lib.config import RotationConfig
from roster_lib.cycle_builder import active_people
from roster_lib.cycles import cycle_availability, previous_cycle, split_at_year_boundary


def problem(severity: str, message: str) -> dict[str, str]:
    return {"severity": severity, "message": message}


def years_without_holidays(cycle, matrix) -> list[int]:
    """Calendar years the cycle touches (first to last date) that have no row in the matrix."""
    have = {h.date.year for h in matrix.holidays}
    return [y for y in range(cycle.start.year, cycle.end.year + 1) if y not in have]


def build_options(paths: Paths) -> dict[str, Any]:
    problems: list[dict[str, str]] = []
    options: dict[str, Any] = {"roster": None, "cycles": [], "default": None, "problems": problems}

    try:
        roster = load_master(paths)
    except TaskError as exc:
        problems.append(problem("error", str(exc)))
        roster = None

    config: RotationConfig | None = None
    config_problem: str | None = None
    try:
        config = load_config_file(paths)
    except TaskError as exc:
        config_problem = str(exc)
        problems.append(problem("error", config_problem))

    matrix, matrix_errors = load_matrix_file(paths, config)
    matrix_problem: str | None = None
    if matrix is None:
        matrix_problem = "the Holiday Roster cannot be used: " + "; ".join(matrix_errors[:4])
        problems.append(problem("error", matrix_problem))

    if roster is None:
        return options

    active = active_people(roster.people, config or RotationConfig())
    options["roster"] = {
        "first_date": roster.first_date.isoformat(),
        "last_date": roster.last_date.isoformat(),
        "people": len(active) if config is not None else len(roster.people),
        "people_total": len(roster.people),
        "excluded": len(roster.people) - len(active),
    }
    for warning in roster.warnings:
        problems.append(problem("warning", f"roster: {warning}"))

    names = [p.name for p in active]
    schedule = schedule_of(roster, names)
    threshold = (config or RotationConfig()).has_data_threshold
    blocked_reason = config_problem or matrix_problem
    holiday_disabled = 0

    entries: list[dict[str, Any]] = []
    for cycle in candidate_cycles(roster.first_date, roster.last_date):
        avail = cycle_availability(cycle, schedule, names, counts_as_code, threshold)
        in_file, remainder = split_at_year_boundary(cycle, roster.last_date)
        filled = cycle_is_filled(cycle, schedule, names, threshold)
        enabled, reason = avail.enabled, avail.reason
        if enabled and blocked_reason:
            enabled = False
            reason = f"{cycle.label} cannot be built yet: {blocked_reason}"
        elif enabled and matrix is not None and years_without_holidays(cycle, matrix):
            missing = years_without_holidays(cycle, matrix)
            holiday_disabled += 1
            enabled = False
            reason = (f"Holiday Roster has no {' or '.join(str(y) for y in missing)} rows - "
                      "upload the new year's Holiday Roster")
        elif enabled and filled:
            reason += " This cycle already has data in the roster file."
        entries.append({
            "id": cycle_id(cycle),
            "label": cycle_range_label(cycle),
            "start": cycle.start.isoformat(),
            "end": cycle.end.isoformat(),
            "enabled": enabled,
            "reason": reason,
            "coverage": None if avail.coverage is None else round(avail.coverage, 4),
            "filled": filled,
            "previous": previous_cycle(cycle).label,
            "crosses_file_end": in_file is not None and remainder is not None,
        })
    options["cycles"] = entries

    enabled_entries = [e for e in entries if e["enabled"]]
    unfilled = [e for e in enabled_entries if not e["filled"]]
    if unfilled:
        options["default"] = unfilled[0]["id"]
    elif enabled_entries:
        options["default"] = enabled_entries[-1]["id"]
    if not enabled_entries and not blocked_reason and holiday_disabled:
        problems.append(problem(
            "warning", "no cycle can be selected: the Holiday Roster on file does not cover the "
                       "needed year (upload the new year's Holiday Roster)"))
    elif not enabled_entries and not blocked_reason:
        problems.append(problem(
            "warning", "no cycle can be selected: every cycle's previous cycle is missing data "
                       "(hover a cycle to see why)"))
    return options


def _main(paths: Paths) -> None:
    options = build_options(paths)
    write_json(paths.options, options)
    cycles = options["cycles"]
    errors = [p for p in options["problems"] if p["severity"] == "error"]
    print(f"options: {len(cycles)} cycle(s), {sum(1 for c in cycles if c['enabled'])} enabled, "
          f"default {options['default']}, {len(errors)} error(s)")


def main(argv=None, task_dir=None) -> int:
    return run_script(_main, argv, task_dir)


if __name__ == "__main__":
    sys.exit(main())
