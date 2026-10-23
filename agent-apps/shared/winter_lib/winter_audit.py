"""
Audit of a FINISHED winter workbook (read back from the file, never from solver variables).

    audit_winter_plan(path, config, roster_names=None) -> AuditResult

Reads the `Winter Plan` grid of the file (constants; a formula cell falls back to its cached value) and checks:

    error    team_min          a team with a required minimum has fewer people than it on some day
    error    days_below_min    a person works fewer than `rules.min_days` days       (warning when their availability
                               makes it unavoidable)
    error    days_above_max    a person works more than the ceiling (`rules.max_days`; best-effort team members 3)
    error    double_slot       one person occupies two rows / slots on the same day
    error    not_a_shift       a cell holds something that is not exactly one working shift code
    error    shift_not_usual   a person's shift differs from their usual shift (and `usual_shift_edited` when the
                               usual-shift column itself no longer matches the snapshot)
    error    excluded_person   a person who must not be scheduled (config exclusions) is on the plan
    error    unknown_team      a person row whose team is not a winter team
    error    unavailable_day   a person works a day the configuration marks unavailable
    error    unknown_person    a name that is not on the supplied roster / staff list (only when names are given)
    error    window_mismatch   the grid's dates are not the configured window
    error    structure         the sheet / header / grid cannot be found
    warning  best_effort_gap   a best-effort team-day with nobody (reported, never a failure)
    warning  no_usual_shift    a person row without a readable usual shift
    info     summary lines

`ok` is True when there is no error. Works on an Excel re-saved copy (header cells are found by their text, dates
as real dates; shift codes are read with `roster_lib.codes.parse_code`, so `shift 3` and `Shift-3` are the same).
"""

from __future__ import annotations

import os
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Iterable, Optional, Union

import openpyxl

from roster_lib import codes
from roster_lib.config import name_key

from .winter_config import WinterConfig
from .winter_snapshot import read_snapshot_sheet
from .winter_types import ERROR, INFO, WARNING, Finding, canonical_shift, display_code
from .winter_workbook import SHEET_PLAN

PathLike = Union[str, os.PathLike]
_HEADER_SCAN = 15
_SEV_ORDER = {ERROR: 0, WARNING: 1, INFO: 2}


@dataclass
class AuditResult:
    findings: list[Finding] = field(default_factory=list)
    summary: dict[str, Any] = field(default_factory=dict)

    def of(self, severity: str) -> list[Finding]:
        return [f for f in self.findings if f.severity == severity]

    @property
    def errors(self) -> list[Finding]:
        return self.of(ERROR)

    @property
    def warnings(self) -> list[Finding]:
        return self.of(WARNING)

    @property
    def ok(self) -> bool:
        return not self.errors

    def codes(self, severity: Optional[str] = None) -> list[str]:
        return [f.code for f in self.findings if severity is None or f.severity == severity]

    def to_dict(self) -> dict[str, Any]:
        return {"ok": self.ok, "summary": self.summary, "findings": [f.to_dict() for f in self.findings]}


def _norm(v: Any) -> str:
    return " ".join(str(v or "").split()).casefold()


def _as_date(v: Any) -> Optional[date]:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    return None


def audit_winter_plan(path: PathLike, config: WinterConfig, roster_names: Optional[Iterable[str]] = None
                      ) -> AuditResult:
    res = AuditResult()
    add = res.findings.append

    try:
        wb = openpyxl.load_workbook(os.fspath(path), data_only=False)
    except Exception as e:  # unreadable file
        add(Finding(ERROR, "structure", f"the workbook cannot be opened: {type(e).__name__}: {e}"))
        return res
    if SHEET_PLAN not in wb.sheetnames:
        add(Finding(ERROR, "structure", f"the workbook has no {SHEET_PLAN!r} sheet"))
        return res
    ws = wb[SHEET_PLAN]
    cached_ws = None  # loaded lazily for formula cells

    def cell_value(r: int, c: int) -> Any:
        nonlocal cached_ws
        v = ws.cell(row=r, column=c).value
        if isinstance(v, str) and v.startswith("="):
            if cached_ws is None:
                cached_ws = openpyxl.load_workbook(os.fspath(path), data_only=True)[SHEET_PLAN]
            return cached_ws.cell(row=r, column=c).value if cached_ws.cell(row=r, column=c).value is not None else v
        return v

    # ---- header
    name_pos = None
    for r in range(1, _HEADER_SCAN + 1):
        for c in range(1, min(ws.max_column, 12) + 1):
            if _norm(ws.cell(row=r, column=c).value) == "team member":
                name_pos = (r, c)
                break
        if name_pos:
            break
    if name_pos is None:
        add(Finding(ERROR, "structure", "the header cell 'Team member' was not found on the Winter Plan sheet"))
        return res
    hr, name_col = name_pos
    for mr in ws.merged_cells.ranges:  # the label sits in the first cell of a merged A:B block
        if mr.min_row <= hr <= mr.max_row and mr.min_col <= name_col <= mr.max_col:
            name_col = mr.max_col
            break

    def find_label(label: str) -> Optional[int]:
        for r in range(hr, hr + 3):
            for c in range(1, ws.max_column + 1):
                if _norm(ws.cell(row=r, column=c).value) == label:
                    return c
        return None

    team_col, usual_col, loc_col = find_label("team"), find_label("usual shift"), find_label("loc")
    date_cols: list[tuple[int, date]] = []
    date_row = None
    for r in range(hr, hr + 3):
        found = [(c, _as_date(ws.cell(row=r, column=c).value)) for c in range(1, ws.max_column + 1)]
        found = [(c, d) for c, d in found if d is not None]
        if len(found) >= 1:
            date_cols, date_row = found, r
            break
    if team_col is None or not date_cols:
        add(Finding(ERROR, "structure", "the Winter Plan header (Team column / date columns) was not found"))
        return res
    if usual_col is None:
        add(Finding(WARNING, "no_usual_shift", "the 'Usual shift' column was not found: shifts cannot be compared"))
    plan_days = tuple(d for _, d in date_cols)
    if plan_days != tuple(config.days):
        add(Finding(ERROR, "window_mismatch",
                    f"the plan covers {plan_days[0]}..{plan_days[-1]} ({len(plan_days)} columns) but the configured "
                    f"window is {config.start}..{config.end} ({len(config.days)} days)"))
        return res

    # ---- people rows
    people: list[dict[str, Any]] = []
    for r in range(max(date_row + 1, hr + 3), ws.max_row + 1):
        a = _norm(ws.cell(row=r, column=1).value)
        if a == "total on shift" or _norm(ws.cell(row=r, column=name_col).value) == "total on shift":
            break
        name = ws.cell(row=r, column=name_col).value
        if name is None or not str(name).strip():
            continue  # group header (merged label) or spacer
        idx = ws.cell(row=r, column=name_col - 1).value if name_col > 1 else 1
        if isinstance(idx, str) and not idx.strip().isdigit() and idx.strip():
            continue  # a merged header label that spilled into the name column
        people.append({
            "row": r, "name": " ".join(str(name).split()),
            "team_label": str(ws.cell(row=r, column=team_col).value or "").strip(),
            "loc": str(ws.cell(row=r, column=loc_col).value or "").strip() if loc_col else "",
            "usual_text": ws.cell(row=r, column=usual_col).value if usual_col else None,
            "cells": [(d, cell_value(r, c)) for c, d in date_cols],
        })

    snapshot = None
    try:
        snapshot = read_snapshot_sheet(path)
    except Exception:
        snapshot = None
    snap_usual: dict[str, Optional[str]] = {}
    if snapshot is not None:
        for pm in snapshot.meta.get("people", []):
            snap_usual[name_key(pm["name"])] = pm.get("usual_shift")

    roster_keys = None if roster_names is None else {name_key(n) for n in roster_names}

    # ---- per-person checks
    worked: dict[int, list[date]] = {}
    team_of: dict[int, Optional[str]] = {}
    seen_names: dict[str, int] = {}
    slots: dict[tuple[str, date], int] = defaultdict(int)
    for i, p in enumerate(people):
        nm, row = p["name"], p["row"]
        team = config.resolve_team(p["team_label"])
        team_of[i] = team
        if config.is_excluded_name(nm) or config.is_excluded_label(p["team_label"]):
            add(Finding(ERROR, "excluded_person", f"{nm!r} must not be scheduled (excluded by the configuration)",
                        team=team, person=nm))
        if team is None:
            add(Finding(ERROR, "unknown_team", f"{nm!r}: team {p['team_label']!r} is not a winter team", person=nm))
        if roster_keys is not None and name_key(nm) not in roster_keys:
            add(Finding(ERROR, "unknown_person", f"{nm!r} is not on the roster / staff list", team=team, person=nm))
        k = name_key(nm)
        if k in seen_names:
            add(Finding(WARNING, "duplicate_person", f"{nm!r} appears on rows {seen_names[k]} and {row}", team=team,
                        person=nm))
        seen_names.setdefault(k, row)

        usual = None
        if usual_col is not None:
            usual = canonical_shift(None if p["usual_text"] is None else str(p["usual_text"]))
            if usual is None:
                add(Finding(WARNING, "no_usual_shift", f"{nm!r}: no readable usual shift (row {row})", team=team,
                            person=nm))
            elif snapshot is not None and k in snap_usual and snap_usual[k] and snap_usual[k] != usual:
                add(Finding(ERROR, "usual_shift_edited",
                            f"{nm!r}: the usual-shift column says {display_code(usual)} but the plan was built with "
                            f"{display_code(snap_usual[k])}", team=team, person=nm))
        days: list[date] = []
        for d, raw in p["cells"]:
            if raw is None or (isinstance(raw, str) and not raw.strip()):
                continue
            text = str(raw).strip()
            if text.startswith("="):
                add(Finding(ERROR, "not_a_shift", f"{nm!r} on {d}: the cell holds an uncalculated formula",
                            team=team, person=nm, date=d))
                continue
            canon = canonical_shift(text)
            if canon is None:
                parsed = codes.try_parse_code(text)
                if parsed is not None and parsed.canonical in codes.LEAVE_CODES:
                    why = f"{text!r} is a leave code, not a working shift"
                else:
                    why = (f"{text!r} is not exactly one working shift code (one slot per person per day)")
                add(Finding(ERROR, "not_a_shift", f"{nm!r} on {d}: {why}", team=team, person=nm, date=d))
                continue
            days.append(d)
            slots[(k, d)] += 1
            if usual is not None and canon != usual:
                add(Finding(ERROR, "shift_not_usual",
                            f"{nm!r} on {d}: {display_code(canon)} is not their usual shift {display_code(usual)}",
                            team=team, person=nm, date=d))
            if d in _unavailable(config, nm):
                add(Finding(ERROR, "unavailable_day", f"{nm!r} is marked unavailable on {d} but is planned",
                            team=team, person=nm, date=d))
        worked[i] = days
        n = len(days)
        ceiling = config.max_days_for(team) if team else config.max_days
        avail = len(config.available_dates(nm))
        if n < config.min_days:
            sev = WARNING if avail < config.min_days else ERROR
            tail = f" (only {avail} available day(s) in the window)" if avail < config.min_days else ""
            add(Finding(sev, "days_below_min", f"{nm!r} works {n} day(s), below {config.min_days}{tail}", team=team,
                        person=nm))
        if n > ceiling:
            who = "a best-effort team member" if team and config.team(team).best_effort else "a person"
            add(Finding(ERROR, "days_above_max", f"{nm!r} works {n} days: {who} may work at most {ceiling}", team=team,
                        person=nm))
    for (k, d), cnt in sorted(slots.items(), key=lambda kv: (kv[0][1], kv[0][0])):
        if cnt > 1:
            nm = next(p["name"] for p in people if name_key(p["name"]) == k)
            add(Finding(ERROR, "double_slot", f"{nm!r} has {cnt} slots on {d} (one slot per person per day)",
                        person=nm, date=d))

    # ---- team minimums per day
    per_team: dict[str, list[int]] = {}
    for t in config.teams:
        counts = []
        for d in plan_days:
            n = sum(1 for i, p in enumerate(people) if team_of[i] == t.name and d in set(worked[i]))
            counts.append(n)
            if t.best_effort:
                if n == 0:
                    add(Finding(WARNING, "best_effort_gap", f"{t.label}: nobody on {d} (best effort)", team=t.name,
                                date=d))
            elif n < t.min_per_day:
                add(Finding(ERROR, "team_min", f"{t.label}: {n} of {t.min_per_day} required on {d}", team=t.name,
                            date=d))
        per_team[t.name] = counts

    hist = Counter(len(v) for v in worked.values())
    res.summary = {
        "people": len(people),
        "window": [d.isoformat() for d in plan_days],
        "teams": {t.name: {"people": sum(1 for x in team_of.values() if x == t.name),
                           "min_per_day": t.min_per_day, "best_effort": t.best_effort,
                           "headcount_by_day": per_team[t.name], "lowest_day": min(per_team[t.name]) if per_team[t.name] else 0}
                  for t in config.teams},
        "days_histogram": {str(k): hist[k] for k in sorted(hist)},
        "person_days": sum(len(v) for v in worked.values()),
        "extra_days": sum(max(0, len(v) - config.min_days) for v in worked.values()),
        "snapshot_present": snapshot is not None,
        "errors": 0, "warnings": 0,
    }
    res.findings.sort(key=lambda f: (_SEV_ORDER[f.severity], f.code, f.team or "", f.date or date.min, f.person or "",
                                     f.message))
    res.summary["errors"] = len(res.errors)
    res.summary["warnings"] = len(res.warnings)
    return res


def _unavailable(config: WinterConfig, name: str) -> set[date]:
    allowed = set(config.available_dates(name))
    return {d for d in config.days if d not in allowed}
