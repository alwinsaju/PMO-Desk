"""
Step 5 checks: staffing check and HOL check (existing roster OR a draft).

Both checks are pure: they take a schedule and return data, never edit it and
never print. A schedule is `dict[person name, dict[date, raw cell text]]`
("" = weekly off); a date missing from a person's dict means "no data", which is
NOT the same as a blank (weekly off) cell. People are `roster_io.Person`.

Shared helpers (also used by `holiday_engine`)
  `resolve_location`  roster location text -> matrix location code
  `schedule_from_roster`  `Roster` -> schedule dict
  `pattern_on` / `week_pattern`  weekly-off pattern INFERRED from the cells:
      weekdays that tell the two patterns apart are Mon, Tue (work in Mon-Fri, off
      in Wed-Sun) and Sat, Sun (off in Mon-Fri, work in Wed-Sun); Wed-Fri work in
      both. A working code on such a day votes for the pattern that works it, a
      blank for the other; leave codes and missing cells do not vote. The person's
      own Sun-Sat week decides; if it is silent or tied the nearest weeks (up to two
      each side) decide; S2/S4 are always Wed-Sun (`codes.forced_pattern`).

staffing_check(schedule, people, config, start, end, *, team_of=None) -> [Shortage]
  Per (team, shift code, day) for shifts ACTIVE that day: count people WORKING
  (a shift code in the cell: not leave, HOL, blank, OC or custom hours) against
  `config.min_staff_for_team(team)`. "Active" = at least one member whose pattern
  makes that shift work that day, or who actually works it. A member on leave (P,
  T, SL, COMP, HOL) keeps the shift code of their nearest worked day (within 28
  days) and counts as an expected-but-absent member, so S2/S4 groups are inactive
  Mon-Tue while a Wednesday where everyone is on HOL is a shortage of `need`.
  Mexico people count when working. Never auto-fixes.
  Teams whose `config.min_staff_mode_for_team` is `per_team_day` (every team except DIS, DEP
  and L3 by default) are counted PER TEAM PER DAY across all their shifts instead
  (`Shortage.shift == ALL_SHIFTS`): working = a shift code, custom hours or on-call; the
  EFFECTIVE minimum is `effective_min` = min(configured minimum, members SCHEDULED that
  day), where scheduled (`scheduled_on`) means a working cell, or a leave cell (P, T, SL,
  COMP, HOL) on a day the person's weekly pattern works, i.e. before any leave/HOL. A day
  nobody in the team is scheduled is not active, so a one-person team or a small team on
  offset patterns never gets an impossible shortage; a team with leave dropping below the
  effective minimum is flagged.

hol_check(schedule, people, matrix, roster_labels, start, end, *, coverage_ok=None,
          ignore_dates=(), ignore_label_pattern=DEFAULT_NON_HOLIDAY_LABELS) -> [Finding]
  STRAY               a HOL where the person's location is not ticked in the matrix
                      (takes precedence over HOL_ON_WEEKLY_OFF on the same cell)
  MISSING             a person at a ticked location whose cell is a working code but
                      who has no HOL. For COMMON holidays (India people) this needs
                      coverage info (see below); for location-specific and
                      Mexico-only holidays, and for Mexico staff on any holiday that
                      ticks Mexico, everyone who works must have HOL, so it is certain
  MISSING_UNVERIFIED  same situation on a COMMON holiday when `coverage_ok` is None:
                      the person may legitimately be in the coverage set
  HOL_ON_WEEKLY_OFF   a HOL on a day the inferred pattern makes a weekly off
  MISMATCH_NO_LABEL   matrix holiday with no label in the roster's holiday row
  MISMATCH_NO_MATRIX  roster label with no matrix entry (labels matching
                      `ignore_label_pattern` - shift swap, winter disconnect, lean
                      shift by default - are not holidays and are skipped)
  UNKNOWN_LOCATION    (info) a person whose location is not in the matrix's location
                      codes; their HOLs cannot be verified
`coverage_ok`: None (no coverage info) or a collection of `(person name, date)` pairs
or a callable `(name, date) -> bool` marking people deliberately WORKING a COMMON
holiday (for a draft pass `HolidayResult.coverage`). When given, a working India
person who is not covered is a (certain) MISSING. A person on leave (P, T, SL, ...) or
with a blank cell (weekly off) is never reported missing. `ignore_dates` (December
Disconnect days) are skipped entirely.
"""

from __future__ import annotations

import bisect
import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from enum import Enum
from typing import Callable, Collection, Iterable, Mapping, Union

from .codes import (
    BLANK,
    DEFAULT_TABLE,
    HOL,
    LEAVE_CODES,
    Kind,
    Pattern,
    default_pattern,
    forced_pattern,
    is_working_code,
    try_parse_code,
    works_on,
)
from .config import PER_TEAM_DAY
from .holiday_matrix import (
    MEXICO_LOCATION,
    HolidayMatrix,
    HolidayType,
    holidays_on,
    is_off,
    label_mismatches,
)

Schedule = Mapping[str, Mapping[date, str]]
CoverageOk = Union[Collection[tuple[str, date]], Callable[[str, date], bool]]

ALL_SHIFTS = "ALL"  # the `shift` of a per-team-day shortage / holiday group
UNKNOWN = "UNKNOWN"  # canonical placeholder for cell text that is not a recognised code
DEFAULT_NON_HOLIDAY_LABELS = re.compile(
    r"shift[\s_-]*swap|winter[\s_-]*disconnect|lean[\s_-]*shift", re.IGNORECASE)
_NEAREST_SHIFT_REACH_DAYS = 28
_PATTERN_REACH_WEEKS = 2


# ---- small shared helpers ----------------------------------------------------------

def daterange(start: date, end: date) -> list[date]:
    """start..end inclusive."""
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


def week_start(d: date) -> date:
    """The Sunday that starts the Sunday-Saturday week containing `d`."""
    return d - timedelta(days=(d.weekday() + 1) % 7)


def canonical_of(text: str | None) -> str:
    """Canonical code of a cell's text; `UNKNOWN` when it is not a recognised code."""
    parsed = try_parse_code(text)
    return UNKNOWN if parsed is None else parsed.canonical


def is_shift_canonical(canonical: str) -> bool:
    info = DEFAULT_TABLE.get(canonical)
    return info is not None and info.kind is Kind.SHIFT


def is_working_cell(text: str | None) -> bool:
    """A shift code, custom hours or on-call: the person works that day."""
    return is_working_code(canonical_of(text))


def resolve_location(text: str | None, location_codes: Mapping[str, str]) -> str | None:
    """Matrix location code for roster location text (a name or a code, case-insensitive);
    None if unknown."""
    if not text or not text.strip():
        return None
    wanted = " ".join(text.split()).casefold()
    for name, code in location_codes.items():
        if wanted in (name.casefold(), code.casefold()):
            return code
    return None


def india_codes(matrix: HolidayMatrix) -> frozenset[str]:
    return frozenset(c for n, c in matrix.location_codes.items() if n != MEXICO_LOCATION)


def mexico_code(matrix: HolidayMatrix) -> str | None:
    return matrix.location_codes.get(MEXICO_LOCATION)


def schedule_from_roster(roster, start: date | None = None, end: date | None = None):
    """`{name: {date: raw text}}` for every person of a `roster_io.Roster` (inclusive range,
    default the whole roster). Duplicate names are not supported (the last row wins)."""
    days = daterange(start or roster.first_date, end or roster.last_date)
    return {p.name: dict(zip(days, roster.row_texts(p, days[0], days[-1])))
            for p in roster.people}


# ---- weekly-off pattern inference ---------------------------------------------------

# weekday -> (pattern voted for by a WORKING cell, pattern voted for by a BLANK cell)
_VOTES = {
    0: (Pattern.MON_FRI, Pattern.WED_SUN),
    1: (Pattern.MON_FRI, Pattern.WED_SUN),
    5: (Pattern.WED_SUN, Pattern.MON_FRI),
    6: (Pattern.WED_SUN, Pattern.MON_FRI),
}


class PersonCells:
    """One person's cells with cached parsing, nearest-shift lookup and pattern inference."""

    def __init__(self, cells: Mapping[date, str],
                 hint: Callable[[date], bool | None] | None = None):
        """`hint(d)` (optional) says whether the person's weekly TEMPLATE has them working on
        `d` (True), off (False) or knows nothing (None); a PATTERN person's weekly offs are
        whatever blank cells their template has, so the Mon-Fri / Wed-Sun inference below
        yields to it."""
        self.cells = cells
        self.hint = hint
        self._canon: dict[date, str] = {}
        self._shift_dates: list[date] | None = None
        self._week_pattern: dict[date, Pattern | None] = {}

    def canon(self, d: date) -> str | None:
        """Canonical code on `d`; None when there is no data for that date."""
        if d not in self.cells:
            return None
        got = self._canon.get(d)
        if got is None:
            got = self._canon[d] = canonical_of(self.cells[d])
        return got

    def nearest_shift_code(self, d: date, reach_days: int = _NEAREST_SHIFT_REACH_DAYS) -> str | None:
        """Shift code of the closest day (earlier wins a tie) holding a shift code."""
        if self._shift_dates is None:
            self._shift_dates = sorted(
                x for x in self.cells if is_shift_canonical(self.canon(x) or ""))
        dates = self._shift_dates
        i = bisect.bisect_left(dates, d)
        best = None
        for j in (i - 1, i):
            if 0 <= j < len(dates):
                gap = abs((dates[j] - d).days)
                if gap <= reach_days and (best is None or gap < best[0]):
                    best = (gap, dates[j])
        return None if best is None else self.canon(best[1])

    def _votes(self, ws: date, tally: dict[Pattern, int]) -> None:
        for i in range(7):
            day = ws + timedelta(days=i)
            vote = _VOTES.get(day.weekday())
            canon = self.canon(day)
            if vote is None or canon is None:
                continue
            if canon == BLANK:
                tally[vote[1]] += 1
            elif is_working_code(canon):
                tally[vote[0]] += 1

    def week_pattern(self, d: date) -> Pattern | None:
        ws = week_start(d)
        if ws in self._week_pattern:
            return self._week_pattern[ws]
        result = None
        for ring in range(_PATTERN_REACH_WEEKS + 1):
            tally = {Pattern.MON_FRI: 0, Pattern.WED_SUN: 0}
            for k in ((0,) if ring == 0 else (-ring, ring)):
                self._votes(ws + timedelta(days=7 * k), tally)
            if tally[Pattern.MON_FRI] != tally[Pattern.WED_SUN]:
                result = max(tally, key=tally.get)
                break
        self._week_pattern[ws] = result
        return result

    def pattern_on(self, d: date) -> Pattern | None:
        """Weekly-off pattern in force around `d` (see module docstring); None if unknowable."""
        canon = self.canon(d)
        code = canon if canon and is_shift_canonical(canon) else self.nearest_shift_code(d)
        forced = forced_pattern(code) if code else None
        if forced is not None:
            return forced
        found = self.week_pattern(d)
        if found is not None:
            return found
        return default_pattern(code) if code else None


def week_pattern(cells: Mapping[date, str], d: date) -> Pattern | None:
    """Pattern voted by the cells around `d` alone (no shift-code rules); see module docs."""
    return PersonCells(cells).week_pattern(d)


def pattern_on(cells: Mapping[date, str], d: date) -> Pattern | None:
    """Weekly-off pattern in force on `d` inferred from one person's cells."""
    return PersonCells(cells).pattern_on(d)


# ---- staffing check -------------------------------------------------------------------

def scheduled_on(pc: PersonCells, d: date) -> bool:
    """True when the person is scheduled to work on `d` before any leave/HOL: a working cell
    (shift code, custom hours, on-call), or a leave cell (P, T, SL, COMP, HOL) on a day their
    weekly pattern works. Blank cells and dates with no data are not scheduled."""
    canon = pc.canon(d)
    if canon is None:
        return False
    if is_working_code(canon):
        return True
    if canon in LEAVE_CODES:
        hinted = pc.hint(d) if pc.hint else None
        if hinted is not None:
            return hinted
        if pc.nearest_shift_code(d) is None:
            return False
        pattern = pc.pattern_on(d)
        return pattern is not None and works_on(pattern, d)
    return False


def effective_min(config, team: str | None, scheduled: int) -> int:
    """The minimum that applies on a day. `per_shift` teams: the configured minimum.
    `per_team_day` teams: min(configured minimum, members scheduled that day) so a small team
    never gets an impossible minimum (0 when nobody is scheduled: the day is not active)."""
    minimum = config.min_staff_for_team(team)
    if config.min_staff_mode_for_team(team) == PER_TEAM_DAY:
        return min(minimum, scheduled)
    return minimum


@dataclass(frozen=True)
class Shortage:
    team: str
    shift: str
    date: date
    have: int
    need: int

    @property
    def severity(self) -> str:
        return "ERROR" if self.have == 0 else "WARNING"

    @property
    def message(self) -> str:
        where = self.team if self.shift == ALL_SHIFTS else f"{self.team} {self.shift}"
        return (f"{where} on {self.date.isoformat()}: {self.have} working, "
                f"minimum {self.need}")


def staffing_check(schedule: Schedule, people: Iterable, config, start: date, end: date, *,
                   team_of: Callable[[object], str | None] | None = None,
                   works_hint: Mapping[str, Callable[[date], bool | None]] | None = None
                   ) -> list[Shortage]:
    """Shortages per (team, shift code, day) for shifts active that day, and per (team, day)
    for `per_team_day` teams (`shift == ALL_SHIFTS`). Never auto-fixes."""
    team_fn = team_of or config.team_of
    days = daterange(start, end)
    have: dict[tuple[str, str, date], int] = defaultdict(int)
    members: dict[tuple[str, str, date], int] = defaultdict(int)
    for person in people:
        cells = schedule.get(person.name)
        if not cells:
            continue
        team = team_fn(person)
        if not team:
            continue
        pc = PersonCells(cells, (works_hint or {}).get(person.name))
        if config.min_staff_mode_for_team(team) == PER_TEAM_DAY:
            for d in days:
                canon = pc.canon(d)
                if canon is not None and is_working_code(canon):
                    have[(team, ALL_SHIFTS, d)] += 1
                if scheduled_on(pc, d):
                    members[(team, ALL_SHIFTS, d)] += 1
            continue
        for d in days:
            canon = pc.canon(d)
            if canon is None:
                continue
            if is_shift_canonical(canon):
                have[(team, canon, d)] += 1
                members[(team, canon, d)] += 1
            elif canon in LEAVE_CODES:
                code = pc.nearest_shift_code(d)
                if code is None:
                    continue
                hinted = pc.hint(d) if pc.hint else None
                if hinted is not None:
                    if hinted:
                        members[(team, code, d)] += 1
                    continue
                pattern = pc.pattern_on(d)
                if pattern is not None and works_on(pattern, d):
                    members[(team, code, d)] += 1
    out = []
    for (team, shift, d) in sorted(members, key=lambda k: (k[2], k[0], k[1])):
        need = effective_min(config, team, members[(team, shift, d)])
        got = have.get((team, shift, d), 0)
        if got < need:
            out.append(Shortage(team, shift, d, got, need))
    return out


# ---- HOL check ---------------------------------------------------------------------------

class Severity(Enum):
    ERROR = "ERROR"
    WARNING = "WARNING"
    INFO = "INFO"


class FindingKind(Enum):
    STRAY = "STRAY"
    MISSING = "MISSING"
    MISSING_UNVERIFIED = "MISSING (unverified coverage)"
    HOL_ON_WEEKLY_OFF = "HOL_ON_WEEKLY_OFF"
    MISMATCH_NO_LABEL = "MISMATCH (holiday has no roster label)"
    MISMATCH_NO_MATRIX = "MISMATCH (roster label has no holiday)"
    UNKNOWN_LOCATION = "UNKNOWN_LOCATION"

    @property
    def group(self) -> str:
        """STRAY, MISSING, HOL_ON_WEEKLY_OFF, MISMATCH or UNKNOWN_LOCATION."""
        return self.name.split("_")[0] if self.name.startswith(("MISSING", "MISMATCH")) \
            else self.name


_SEVERITY = {
    FindingKind.STRAY: Severity.ERROR,
    FindingKind.MISSING: Severity.ERROR,
    FindingKind.MISSING_UNVERIFIED: Severity.WARNING,
    FindingKind.HOL_ON_WEEKLY_OFF: Severity.WARNING,
    FindingKind.MISMATCH_NO_LABEL: Severity.WARNING,
    FindingKind.MISMATCH_NO_MATRIX: Severity.WARNING,
    FindingKind.UNKNOWN_LOCATION: Severity.INFO,
}
_KIND_ORDER = {k: i for i, k in enumerate(FindingKind)}


@dataclass(frozen=True)
class Finding:
    kind: FindingKind
    severity: Severity
    date: date | None
    person: str | None
    location: str | None  # matrix location code
    message: str  # human-readable, for the Draft Summary / Flags sheet


def _finding(kind, d, person, location, message) -> Finding:
    return Finding(kind, _SEVERITY[kind], d, person, location, message)


def _covered(coverage_ok: CoverageOk, name: str, d: date) -> bool:
    if callable(coverage_ok):
        return bool(coverage_ok(name, d))
    return (name, d) in coverage_ok


def _fmt(d: date) -> str:
    return d.isoformat()


def hol_check(schedule: Schedule, people: Iterable, matrix: HolidayMatrix,
              roster_labels: Mapping[date, str], start: date, end: date, *,
              coverage_ok: CoverageOk | None = None,
              ignore_dates: Collection[date] = (),
              ignore_label_pattern: "re.Pattern[str] | str | None" = DEFAULT_NON_HOLIDAY_LABELS,
              works_hint: Mapping[str, Callable[[date], bool | None]] | None = None,
              ) -> list[Finding]:
    """Structured HOL findings for start..end (see the module docstring for the semantics)."""
    ignored = frozenset(ignore_dates)
    india = india_codes(matrix)
    mex = mexico_code(matrix)
    findings: list[Finding] = []
    days = daterange(start, end)
    unknown_reported: set[str] = set()

    for person in people:
        cells = schedule.get(person.name)
        if not cells:
            continue
        loc = resolve_location(person.location_code, matrix.location_codes)
        pc = PersonCells(cells, (works_hint or {}).get(person.name))
        for d in days:
            if d in ignored or d not in cells:
                continue
            canon = pc.canon(d)
            if canon == HOL:
                if loc is None:
                    if person.name not in unknown_reported:
                        unknown_reported.add(person.name)
                        findings.append(_finding(
                            FindingKind.UNKNOWN_LOCATION, None, person.name, None,
                            f"{person.name}: location {person.location_code!r} is not in the "
                            "holiday matrix, so its HOL cells cannot be verified"))
                    continue
                if not is_off(matrix, loc, d):
                    findings.append(_finding(
                        FindingKind.STRAY, d, person.name, loc,
                        f"{person.name} ({loc}) has HOL on {_fmt(d)} but {loc} has no holiday "
                        "that day (not ticked in the Holiday Roster)"))
                    continue
                hinted = pc.hint(d) if pc.hint else None
                if hinted is False:
                    findings.append(_finding(
                        FindingKind.HOL_ON_WEEKLY_OFF, d, person.name, loc,
                        f"{person.name} ({loc}) has HOL on {_fmt(d)}, which is a weekly off "
                        "in their weekly template"))
                    continue
                pattern = None if hinted else pc.pattern_on(d)
                if pattern is not None and not works_on(pattern, d):
                    findings.append(_finding(
                        FindingKind.HOL_ON_WEEKLY_OFF, d, person.name, loc,
                        f"{person.name} ({loc}) has HOL on {_fmt(d)}, which is a weekly off "
                        f"for their {pattern.value} pattern"))
            elif (loc is not None and is_working_code(canon) and is_off(matrix, loc, d)):
                relevant = [h for h in holidays_on(matrix, d)
                            if loc.casefold() in {c.casefold() for c in h.off_locations}]
                names = ", ".join(sorted({h.name for h in relevant}))
                common = loc in india and any(h.type is HolidayType.COMMON for h in relevant)
                where = f"{person.name} ({loc}) works on {_fmt(d)} ({names})"
                if not common:
                    findings.append(_finding(
                        FindingKind.MISSING, d, person.name, loc,
                        f"{where} but has no HOL; {loc} is off and there is no coverage "
                        "rule for this holiday"))
                elif coverage_ok is None:
                    findings.append(_finding(
                        FindingKind.MISSING_UNVERIFIED, d, person.name, loc,
                        f"{where} with no HOL; common holiday, coverage was not supplied so "
                        "it cannot be confirmed that they are needed"))
                elif not _covered(coverage_ok, person.name, d):
                    findings.append(_finding(
                        FindingKind.MISSING, d, person.name, loc,
                        f"{where} but has no HOL and is not in the coverage set"))

    labels = dict(roster_labels)
    if ignore_label_pattern is not None:
        pat = (re.compile(ignore_label_pattern, re.IGNORECASE)
               if isinstance(ignore_label_pattern, str) else ignore_label_pattern)
        labels = {d: t for d, t in labels.items() if not pat.search(str(t))}
    no_label, no_matrix = label_mismatches(matrix, labels, start, end)
    for d in no_label:
        if d in ignored:
            continue
        names = ", ".join(sorted({h.name for h in holidays_on(matrix, d)}))
        findings.append(_finding(
            FindingKind.MISMATCH_NO_LABEL, d, None, None,
            f"The Holiday Roster has {names} on {_fmt(d)} but the roster's holiday row "
            "has no label that day"))
    for d in no_matrix:
        if d in ignored:
            continue
        findings.append(_finding(
            FindingKind.MISMATCH_NO_MATRIX, d, None, None,
            f"The roster's holiday row has a label on {_fmt(d)} "
            f"({' '.join(str(labels[d]).split())!r}) but the Holiday Roster has no "
            "holiday that day"))

    findings.sort(key=lambda f: (f.date or date.min, _KIND_ORDER[f.kind], f.person or ""))
    return findings
