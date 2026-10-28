"""
Read the Analytics team and each person's usual shift from the monthly Analytics rosters.

The Analytics monthly roster (e.g. `Shift Roster - Analytics_<Month>_<Year>.xlsx`) is not
the PDT Operate layout, so this reader uses its own tolerant detection instead of fixed
cell addresses:

schedule sheet
    The sheet (the one called "Schedule" first, otherwise every sheet) that has a header
    row containing a name column (`Resource Name`, `Name`, `Employee`, `Associate`) and a
    grade/team column (`Grade`, `Team`, `Practice`).
people rows
    Every row below the header with a name, until a blank name followed by no more names
    (blank spacer rows are skipped; summary rows such as `S1` / `S2` have no grade and are
    ignored). Rows whose grade/team text does not contain `grade_filter` (default
    "Analytics") are skipped.
shift cells
    The cells to the right of the label columns. The date row (a run of at least 7
    consecutive date values) is used to find the day columns when it exists; otherwise
    every column right of the label columns is read. Cells are matched to codes with
    roster_lib.codes (S1..S4, OC...); a bare `C` also means on call in the Analytics
    roster. Cached values are used (data_only).
usual shift
    The modal shift among S1-S3 over all supplied rosters (S4 only when the person works
    nothing but S4, e.g. the Mexico colleague). Ties go to the earlier code.

Nothing here writes to the roster files. The module never contains real names; tests use
synthetic workbooks built on the fly.
"""

from __future__ import annotations

import re
import warnings
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Any, Iterable, Mapping, Optional, Sequence

import openpyxl

from roster_lib.codes import try_parse_code
from roster_lib.config import name_key

NAME_HEADERS = re.compile(r"^(resource\s*name|name|employee(\s*name)?|associate(\s*name)?|team\s*member)$", re.I)
GRADE_HEADERS = re.compile(r"^(grade|team|practice|group)$", re.I)
LOCATION_HEADERS = re.compile(r"^(location|loc|city)$", re.I)
MIN_DATES = 7

_SHIFT_ORDER = ("S1", "S2", "S3", "S4")


class AnalyticsRosterError(ValueError):
    """The workbook does not look like an Analytics monthly roster."""


@dataclass
class RosterPerson:
    name: str
    location: str = ""
    grade: str = ""
    shifts: Counter = field(default_factory=Counter)  # canonical code -> number of days
    on_call_days: int = 0

    @property
    def usual_shift(self) -> Optional[str]:
        return modal_shift(self.shifts)


@dataclass
class RosterReading:
    path: str
    sheet: str
    people: list[RosterPerson]
    warnings: list[str] = field(default_factory=list)


def modal_shift(counts: Mapping[str, int]) -> Optional[str]:
    """Most common of S1-S3 (ties: earlier code); S4 only when no S1-S3 day exists."""
    pool = {c: counts.get(c, 0) for c in _SHIFT_ORDER[:3] if counts.get(c, 0) > 0}
    if pool:
        best = max(pool.values())
        return next(c for c in _SHIFT_ORDER[:3] if pool.get(c) == best)
    if counts.get("S4", 0) > 0:
        return "S4"
    return None


def _text(v: Any) -> str:
    return "" if v is None else " ".join(str(v).split())


def _day_columns(ws, header_row: int, first_col: int) -> Optional[list[int]]:
    """Columns of the longest run of consecutive date cells on a row above the header."""
    best: list[int] = []
    for r in range(max(1, header_row - 12), header_row + 1):
        run: list[int] = []
        prev: Optional[date] = None
        for c in range(first_col, ws.max_column + 1):
            v = ws.cell(r, c).value
            d = v.date() if isinstance(v, datetime) else v if isinstance(v, date) else None
            if d is not None and (prev is None or (d - prev).days == 1):
                run.append(c)
                prev = d
            elif d is not None:
                if len(run) > len(best):
                    best = run
                run, prev = [c], d
            else:
                if len(run) > len(best):
                    best = run
                run, prev = [], None
        if len(run) > len(best):
            best = run
    return best if len(best) >= MIN_DATES else None


def _find_header(ws) -> Optional[tuple[int, int, Optional[int], Optional[int]]]:
    """(row, name_col, grade_col, location_col) of the people table header."""
    for r in range(1, min(ws.max_row, 80) + 1):
        name_col = grade_col = loc_col = None
        for c in range(1, min(ws.max_column, 12) + 1):
            t = _text(ws.cell(r, c).value)
            if not t:
                continue
            if name_col is None and NAME_HEADERS.match(t):
                name_col = c
            elif grade_col is None and GRADE_HEADERS.match(t):
                grade_col = c
            elif loc_col is None and LOCATION_HEADERS.match(t):
                loc_col = c
        if name_col and grade_col:
            return r, name_col, grade_col, loc_col
    return None


def read_analytics_roster(
    path: str | Path,
    *,
    grade_filter: str = "Analytics",
    sheet_name: Optional[str] = None,
) -> RosterReading:
    """Read the Analytics people and their shift counts from one monthly roster."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        wb = openpyxl.load_workbook(path, data_only=True, read_only=False)
    try:
        candidates = [ws for ws in wb.worksheets if sheet_name is None or ws.title == sheet_name]
        candidates.sort(key=lambda ws: 0 if ws.title.strip().casefold() == "schedule" else 1)
        for ws in candidates:
            found = _find_header(ws)
            if not found:
                continue
            header_row, name_col, grade_col, loc_col = found
            label_end = max(c for c in (name_col, grade_col, loc_col or 0))
            days = _day_columns(ws, header_row, label_end + 1)
            cols = days or list(range(label_end + 1, ws.max_column + 1))
            people: list[RosterPerson] = []
            warn: list[str] = []
            gf = grade_filter.casefold()
            seen: set[str] = set()
            for r in range(header_row + 1, ws.max_row + 1):
                name = _text(ws.cell(r, name_col).value)
                grade = _text(ws.cell(r, grade_col).value)
                if not name or not grade or gf not in grade.casefold():
                    continue
                key = name_key(name)
                if key in seen:
                    warn.append(f"row {r}: {name!r} appears more than once; the first row is used")
                    continue
                seen.add(key)
                p = RosterPerson(name=name, grade=grade,
                                 location=_text(ws.cell(r, loc_col).value) if loc_col else "")
                for c in cols:
                    raw = _text(ws.cell(r, c).value)
                    if not raw:
                        continue
                    if raw.casefold() == "c":
                        p.on_call_days += 1
                        continue
                    parsed = try_parse_code(raw)
                    if parsed is None:
                        continue
                    if parsed.canonical in _SHIFT_ORDER:
                        p.shifts[parsed.canonical] += 1
                    elif parsed.canonical == "OC":
                        p.on_call_days += 1
                people.append(p)
            if not people:
                warn.append(f"no rows with grade containing {grade_filter!r} on sheet {ws.title!r}")
                continue
            if days is None:
                warn.append(f"no date row found on {ws.title!r}; every column right of the labels was read")
            return RosterReading(str(path), ws.title, people, warn)
    finally:
        wb.close()
    raise AnalyticsRosterError(f"{Path(path).name}: no people table with a name and grade/team column found")


def merge_readings(readings: Sequence[RosterReading]) -> list[RosterPerson]:
    """Combine several monthly readings (same person by name) into one list, shifts summed."""
    merged: dict[str, RosterPerson] = {}
    for rd in readings:
        for p in rd.people:
            k = name_key(p.name)
            m = merged.get(k)
            if m is None:
                m = merged[k] = RosterPerson(name=p.name, location=p.location, grade=p.grade)
            elif not m.location and p.location:
                m.location = p.location
            m.shifts.update(p.shifts)
            m.on_call_days += p.on_call_days
    return list(merged.values())


def read_analytics_people(paths: Iterable[str | Path], *, grade_filter: str = "Analytics") -> list[RosterPerson]:
    """People and merged shift counts over all given monthly Analytics rosters."""
    return merge_readings([read_analytics_roster(p, grade_filter=grade_filter) for p in paths])


def draft_config_dict(
    people: Sequence[RosterPerson],
    *,
    window: tuple[str, str],
    include: Optional[Iterable[str]] = None,
    on_call: Iterable[str] = (),
    mexico: Iterable[str] = (),
    availability: Optional[Mapping[str, Mapping[str, str] | Sequence[str]]] = None,
    short_names: Optional[Mapping[str, str]] = None,
    title: Optional[str] = None,
) -> dict[str, Any]:
    """A config dict (see analytics_config) built from the people read off the rosters.

    `include` restricts the team (names as in the roster); `on_call` / `mexico` name the
    people with those roles; `availability` maps a name to {"from","to"} or a list of dates.
    Names not found in `people` raise AnalyticsRosterError so a typo never goes unnoticed.
    """
    by_key = {name_key(p.name): p for p in people}

    def need(name: str) -> RosterPerson:
        p = by_key.get(name_key(name))
        if p is None:
            raise AnalyticsRosterError(f"{name!r} is not on the roster reading")
        return p

    chosen = [need(n) for n in include] if include is not None else list(people)
    oc = {name_key(need(n).name) for n in on_call}
    mx = {name_key(need(n).name) for n in mexico}
    avail = {name_key(need(n).name): v for n, v in (availability or {}).items()}
    shorts = {name_key(need(n).name): s for n, s in (short_names or {}).items()}
    out_people: list[dict[str, Any]] = []
    for p in chosen:
        k = name_key(p.name)
        d: dict[str, Any] = {"name": p.name}
        d["short_name"] = shorts.get(k) or p.name.split()[0]
        if p.location:
            d["location"] = p.location
        if p.usual_shift:
            d["usual_shift"] = p.usual_shift
        d["role"] = "on_call" if k in oc else "mexico" if k in mx else "support"
        if k in avail:
            v = avail[k]
            d["available"] = dict(v) if isinstance(v, Mapping) else list(v)
        out_people.append(d)
    cfg: dict[str, Any] = {"version": 1, "window": {"start": window[0], "end": window[1]}, "people": out_people}
    if title:
        cfg["title"] = title
    return cfg
