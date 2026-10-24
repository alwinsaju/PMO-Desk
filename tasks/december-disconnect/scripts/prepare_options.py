"""Prepare script (not a workflow step): which disconnect window can be selected?

Read-only. Reads `config/winter-config.json`, `config/analytics-config.json`, the shift roster
(`input/roster.xlsx`) and the PDT staff roster (`input/staff-roster.xlsx`) and writes
`output/options.json`:

    {"roster": {"first_date", "last_date", "people"},
     "staff": {"people"},
     "analytics": {"people", "slots", "window_matches"},
     "windows": [{"id": "2026-12-25..2027-01-01", "label": "Dec 25 - Jan 1, 2027",
                  "start", "end", "days", "enabled": true, "reason": "...",
                  "lookback": {"start", "end"}}],
     "default": "2026-12-25..2027-01-01",
     "problems": [{"severity": "error|warning|info", "message": "..."}]}

There is ONE window: the one in the winter config (it is a yearly input, never hard-coded).
`enabled` is false (with the `reason`, shown on hover) while a config is missing or invalid, a
roster cannot be read, the two configs disagree on the window, or the shift roster holds no data
in the usual-shift lookback (the months before the window). Expected problems are written as
readable `problems` and the script still exits 0, so the app can show them next to the window.
Nothing but `output/options.json` is written; no name is ever written or printed.
"""

from __future__ import annotations

import sys
from typing import Any

from _common import (
    Paths,
    TaskError,
    load_analytics,
    load_shift_roster,
    load_staff,
    load_winter,
    run_script,
    window_id,
    window_label,
    write_json,
)


def problem(severity: str, message: str) -> dict[str, str]:
    return {"severity": severity, "message": message}


def build_options(paths: Paths) -> dict[str, Any]:
    problems: list[dict[str, str]] = []
    options: dict[str, Any] = {"roster": None, "staff": None, "analytics": None, "windows": [],
                               "default": None, "problems": problems}
    blockers: list[str] = []

    def fail(message: str) -> None:
        problems.append(problem("error", message))
        blockers.append(message)

    cfg = acfg = None
    try:
        cfg, _ = load_winter(paths)
    except TaskError as exc:
        fail(str(exc))
    try:
        acfg, _ = load_analytics(paths)
    except TaskError as exc:
        fail(str(exc))

    roster = None
    if cfg is not None:  # the config's team aliases are needed to read the roster sections
        try:
            roster = load_shift_roster(paths, cfg)
        except TaskError as exc:
            fail(str(exc))
    elif not paths.roster.exists():
        fail("the shift roster workbook is missing (input/roster.xlsx)")
    if roster is not None:
        options["roster"] = {"first_date": roster.first_date.isoformat(),
                             "last_date": roster.last_date.isoformat(),
                             "people": len(roster.people)}
        for warning in roster.warnings:
            problems.append(problem("warning", f"shift roster: {warning}"))

    try:
        staff = load_staff(paths)
        options["staff"] = {"people": len(staff.rows)}
        for warning in staff.warnings:
            problems.append(problem("warning", f"staff roster: {warning}"))
    except TaskError as exc:
        fail(str(exc))

    window_ok = None
    if acfg is not None:
        options["analytics"] = {"people": len(acfg.people), "slots": len(acfg.slots),
                                "window_matches": None}
    if cfg is not None and acfg is not None:
        window_ok = (acfg.dates[0], acfg.dates[-1]) == (cfg.start, cfg.end)
        options["analytics"]["window_matches"] = window_ok
        if not window_ok:
            fail("the analytics config and the winter config have different windows")

    if cfg is None:
        return options

    lb_first, lb_last = cfg.lookback_range()
    reason = ""
    enabled = not blockers
    if blockers:
        reason = f"The window cannot be built yet: {blockers[0]}"
    elif roster is not None and (roster.last_date < lb_first or roster.first_date > lb_last):
        enabled = False
        reason = (f"The shift roster covers {roster.first_date}..{roster.last_date} but the usual shifts "
                  f"come from {lb_first}..{lb_last}: upload the current shift roster.")
        problems.append(problem("error", reason))
    elif roster is not None:
        reason = (f"{len(cfg.days)} days. Usual shifts are read from the shift roster "
                  f"({lb_first}..{lb_last}).")
        if roster.last_date < lb_last:
            problems.append(problem(
                "warning", f"the shift roster ends {roster.last_date}, before the lookback ends "
                           f"({lb_last}); usual shifts use the data it has"))
    entry = {
        "id": window_id(cfg.start, cfg.end),
        "label": window_label(cfg.start, cfg.end),
        "start": cfg.start.isoformat(),
        "end": cfg.end.isoformat(),
        "days": len(cfg.days),
        "enabled": enabled,
        "reason": reason,
        "lookback": {"start": lb_first.isoformat(), "end": lb_last.isoformat()},
    }
    options["windows"] = [entry]
    if enabled:
        options["default"] = entry["id"]
    return options


def _main(paths: Paths) -> None:
    options = build_options(paths)
    write_json(paths.options, options)
    windows = options["windows"]
    errors = [p for p in options["problems"] if p["severity"] == "error"]
    print(f"options: {len(windows)} window(s), {sum(1 for w in windows if w['enabled'])} enabled, "
          f"default {options['default']}, {len(errors)} error(s)")


def main(argv=None, task_dir=None) -> int:
    return run_script(_main, argv, task_dir)


if __name__ == "__main__":
    sys.exit(main())
