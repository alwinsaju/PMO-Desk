"""
Step 4 holidays: write HOL into a draft cycle fairly and deterministically.

Input is the NEW cycle's schedule with rotation and PTO already applied (so the
working days are known): `dict[person name, dict[date, raw text]]`, "" = weekly
off. Output is a `HolidayResult` whose `edits` (`{(name, date): "HOL"}`) the caller
applies; nothing here mutates the schedule. All holidays inside start..end are
processed in DATE ORDER.

Who is affected
  Only people WORKING that day (a shift code, custom hours or on-call in the cell)
  can get a HOL: weekly-off days (blank) and leave days (P, T, SL, COMP, HOL) are
  never touched. PTO beats HOL: a person on leave keeps the leave code, gets no HOL
  and it does not count as a holiday off.

Holiday kinds (from `holiday_matrix`)
  LOCATION_SPECIFIC / MEXICO_ONLY   everyone at the ticked locations who works gets
      HOL. No fairness, no counters. Shortages are flagged, never auto-fixed.
  COMMON (all India locations; Common India-Mexico when Mexico is ticked too)
      Mexico staff, when Mexico is ticked, always get HOL (no counter, never in the
      coverage pool). Fairness applies to India-based people only. For each
      (team, shift code) group working that day:
        outside = members who are not off (non-India staff, Mexico staff when
                  Mexico is not ticked); they count toward the minimum
        pool    = India members working that day
        need    = max(0, min_staff(team) - len(outside))
        order the pool by offs_taken DESC, then last_off_date DESC (most recent
        off first; never-off last), then a seeded deterministic tie-break;
        the first `need` of that order COVER (keep their shift), the rest get HOL,
        offs_taken += 1, last_off_date = the holiday date.
      So the person with the fewest offs gets the next off (A has 4 offs, B has 3:
      A covers, B is off), and on a tie the one who was off most recently covers.
      `need >= len(pool)` means nobody in the group can have an off: flagged
      (`CANNOT_MEET_MINIMUM` when `need > len(pool)`, else `NO_OFF_AT_MINIMUM`).
      Common India-Mexico holidays flag many shifts because Mexico staff are off:
      expected.
  A group is (team, shift code) with team = `config.team_of(person)` (section after
  `team_aliases`). Custom hours group by their text, on-call by "OC".
  For a `per_team_day` team (see `config`; every team except DIS, DEP, L3 by default) the
  fairness group on a day is the WHOLE TEAM across all its shifts (shift `ALL`): pool =
  India members working that day, outside = the other members who work (Mexico when not
  off, non-India), and the minimum is the EFFECTIVE one, min(configured minimum, members
  scheduled that day before leave/HOL, `checks.effective_min`), so
  `need = max(0, effective_min - len(outside))`. `per_shift` teams are unchanged.

Counters (`OffCounter(offs_taken, last_off_date)`, per India person, by name)
  Built from the existing roster by `build_counters`: a person's HOL cells in the
  calendar year, before the new cycle starts, on COMMON holidays that fell on a
  working day, ignoring PTO, December Disconnect days (`disconnect_dates`) and stray
  HOLs (location not ticked that day). Assumption: only COMMON holidays count,
  because fairness only applies to them (HOLs on location-specific holidays are not
  counted). A HOL on a weekly-off day (pattern inferred, see `checks`) is not counted.
  A person absent from the counters and not inherited starts at the POOL AVERAGE
  (floor of the mean offs_taken of the India people who have a counter, last_off_date
  None), as do `pool_average_seats`. `inherited_counters` maps new name -> old name
  (a replacement takes over the leaver's counter, both fields). Comp-offs are not
  tracked and COMP is never generated.

Determinism: the same inputs and seed give identical results (the tie-break is a
SHA-256 of seed, date, team, shift and name; no global RNG). The seed is recorded in
the result and logged.

After the edits a staffing check runs on the holiday dates; shortages not already
reported as CANNOT_MEET_MINIMUM become `STAFFING_SHORTAGE` flags. Nothing is fixed.
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from datetime import date
from typing import Collection, Iterable, Mapping

from .checks import (
    ALL_SHIFTS,
    PersonCells,
    Schedule,
    effective_min,
    india_codes,
    is_working_cell,
    mexico_code,
    resolve_location,
    schedule_from_roster,
    scheduled_on,
    staffing_check,
)
from .codes import HOL, OC, parse_code, works_on
from .config import PER_SHIFT, PER_TEAM_DAY, RotationConfig, name_key
from .holiday_matrix import HolidayMatrix, HolidayType, holidays_on

log = logging.getLogger(__name__)

Edits = dict[tuple[str, date], str]


@dataclass(frozen=True)
class OffCounter:
    offs_taken: int = 0
    last_off_date: date | None = None


Counters = dict[str, OffCounter]


@dataclass(frozen=True)
class GroupAssignment:
    """What happened to one (team, shift) group on one holiday date."""

    date: date
    holidays: tuple[str, ...]
    kind: str  # COMMON_INDIA_MEXICO, COMMON, LOCATION_SPECIFIC or MEXICO_ONLY
    team: str
    shift: str
    min_staff: int  # the EFFECTIVE minimum that day (see `checks.effective_min`)
    fairness: bool  # True when India people of this group went through the fairness order
    off: tuple[str, ...]  # everyone given HOL (fairness offs + straight HOL)
    straight_off: tuple[str, ...]  # given HOL without fairness (location rule / Mexico)
    covering: tuple[str, ...]  # pool members who keep their shift (fairness only)
    outside: tuple[str, ...]  # working anyway: not at an off location
    need: int  # people the pool had to provide (fairness only)
    shortage: int  # max(0, min_staff - len(outside) - len(covering))
    counters_before: Mapping[str, OffCounter]  # pool members, fairness only
    counters_after: Mapping[str, OffCounter]
    mode: str = PER_SHIFT  # `per_shift` (shift = a code) or `per_team_day` (shift = "ALL")

    @property
    def working(self) -> tuple[str, ...]:
        return self.outside + self.covering


@dataclass(frozen=True)
class HolidayFlag:
    kind: str  # CANNOT_MEET_MINIMUM, NO_OFF_AT_MINIMUM, STAFFING_SHORTAGE
    date: date
    team: str
    shift: str
    have: int
    need: int
    message: str


@dataclass(frozen=True)
class HolidayResult:
    edits: Edits
    assignments: list[GroupAssignment]
    counters_before: Counters  # after inheritance / pool-average seeding, before any holiday
    counters_after: Counters
    flags: list[HolidayFlag]
    seed: int
    coverage: frozenset[tuple[str, date]]  # (name, date) deliberately working a COMMON holiday
    pool_average: int


def apply_edits(schedule: Schedule, edits: Mapping[tuple[str, date], str]) -> dict[str, dict[date, str]]:
    """A copy of `schedule` with the edits applied (the input is not modified)."""
    out = {name: dict(cells) for name, cells in schedule.items()}
    for (name, d), text in edits.items():
        out.setdefault(name, {})[d] = text
    return out


# ---- counters ------------------------------------------------------------------------------

def _location_map(matrix: HolidayMatrix, config: RotationConfig | None) -> dict[str, str]:
    codes = dict(config.location_codes) if config is not None else {}
    codes.update(matrix.location_codes)
    return codes


def build_counters_from_schedule(
    schedule: Schedule, people: Iterable, matrix: HolidayMatrix, year: int,
    config: RotationConfig | None, cycle_start: date, disconnect_dates: Collection[date] = (),
) -> Counters:
    """Counters for every India-based person from an existing schedule (see module docs)."""
    locs = _location_map(matrix, config)
    india = india_codes(matrix)
    skip = frozenset(disconnect_dates)
    counters: Counters = {}
    for person in people:
        loc = resolve_location(person.location_code, locs)
        if loc not in india:
            continue
        cells = schedule.get(person.name) or {}
        pc = PersonCells(cells)
        offs, last = 0, None
        for d in sorted(cells):
            if d.year != year or d >= cycle_start or d in skip or pc.canon(d) != HOL:
                continue
            common = [h for h in holidays_on(matrix, d)
                      if h.type is HolidayType.COMMON and loc in h.off_locations]
            if not common:
                continue  # stray, or a location-specific holiday: not counted
            pattern = pc.pattern_on(d)
            if pattern is not None and not works_on(pattern, d):
                continue  # HOL on a weekly off
            offs += 1
            last = d
        counters[person.name] = OffCounter(offs, last)
    return counters


def build_counters(roster, matrix: HolidayMatrix, year: int, config: RotationConfig | None,
                   cycle_start: date, disconnect_dates: Collection[date] = ()) -> Counters:
    """`build_counters_from_schedule` for a `roster_io.Roster` (uses `roster.people`)."""
    return build_counters_from_schedule(
        schedule_from_roster(roster), roster.people, matrix, year, config, cycle_start,
        disconnect_dates)


def _seed_counters(counters: Mapping[str, OffCounter], india_people: list,
                   inherited: Mapping[str, str], average_seats: Collection[str]
                   ) -> tuple[Counters, int]:
    """Counters for the India people of the new cycle plus the pool average used."""
    by_key = {name_key(n): n for n in counters}
    seat_keys = {name_key(n) for n in average_seats}
    inherited_by_new = {name_key(new): old for new, old in inherited.items()}
    established = [counters[p.name].offs_taken for p in india_people
                   if p.name in counters and name_key(p.name) not in seat_keys
                   and name_key(p.name) not in inherited_by_new]
    average = sum(established) // len(established) if established else 0
    out: Counters = dict(counters)
    for p in india_people:
        key = name_key(p.name)
        if key in inherited_by_new:
            old = by_key.get(name_key(inherited_by_new[key]))
            out[p.name] = counters[old] if old is not None else OffCounter(average, None)
        elif key in seat_keys or p.name not in counters:
            out[p.name] = OffCounter(average, None)
    return out, average


# ---- the engine --------------------------------------------------------------------------------

def _tie_break(seed: int, d: date, team: str, shift: str, name: str) -> int:
    digest = hashlib.sha256(f"{seed}|{d.isoformat()}|{team}|{shift}|{name}".encode()).digest()
    return int.from_bytes(digest[:8], "big")


def _group_key(text: str) -> str:
    """Shift code, custom-hours text or 'OC' for a working cell."""
    parsed = parse_code(text)
    if parsed.canonical == "CUSTOM":
        return " ".join((parsed.custom or text).split())
    return OC if parsed.canonical == OC else parsed.canonical


def _kind_of(holidays) -> str:
    if any(h.type is HolidayType.COMMON and h.common_india_mexico for h in holidays):
        return "COMMON_INDIA_MEXICO"
    if any(h.type is HolidayType.COMMON for h in holidays):
        return "COMMON"
    if any(h.type is HolidayType.LOCATION_SPECIFIC for h in holidays):
        return "LOCATION_SPECIFIC"
    return "MEXICO_ONLY"


def assign_holidays(
    schedule: Schedule, people: Iterable, matrix: HolidayMatrix, counters: Mapping[str, OffCounter],
    config: RotationConfig, start: date, end: date, *, seed: int | None = None,
    inherited_counters: Mapping[str, str] | None = None,
    pool_average_seats: Collection[str] = (),
) -> HolidayResult:
    """Compute the HOL edits for every holiday in start..end (see the module docstring)."""
    seed = config.seed if seed is None else seed
    people = list(people)
    locs = _location_map(matrix, config)
    india, mex = india_codes(matrix), mexico_code(matrix)
    loc_of = {p.name: resolve_location(p.location_code, locs) for p in people}
    team_of = {p.name: config.team_of(p) or p.section for p in people}
    team_day = {t for t in set(team_of.values())
                if config.min_staff_mode_for_team(t) == PER_TEAM_DAY}
    cells_of = {p.name: PersonCells(schedule.get(p.name) or {}) for p in people
                if team_of[p.name] in team_day}
    india_people = [p for p in people if loc_of[p.name] in india]

    before, average = _seed_counters(counters, india_people, inherited_counters or {},
                                     pool_average_seats)
    now: Counters = dict(before)
    log.info("holiday engine: seed=%s cycle=%s..%s pool_average=%s", seed, start, end, average)

    edits: Edits = {}
    assignments: list[GroupAssignment] = []
    flags: list[HolidayFlag] = []
    coverage: set[tuple[str, date]] = set()
    flagged_groups: set[tuple[str, str, date]] = set()
    holiday_dates = sorted({h.date for h in matrix.holidays if start <= h.date <= end})

    for d in holiday_dates:
        todays = holidays_on(matrix, d)
        is_common = any(h.type is HolidayType.COMMON for h in todays)
        off_locations = {c for h in todays for c in h.off_locations}
        kind = _kind_of(todays)
        names = tuple(sorted({h.name for h in todays}))
        groups: dict[tuple[str, str], dict[str, list[str]]] = {}
        scheduled: dict[str, int] = {}  # per_team_day teams: members scheduled today
        for p in people:
            if team_of[p.name] in team_day and scheduled_on(cells_of[p.name], d):
                scheduled[team_of[p.name]] = scheduled.get(team_of[p.name], 0) + 1
        for p in people:
            text = (schedule.get(p.name) or {}).get(d)
            if text is None or not is_working_cell(text):
                continue  # weekly off, leave (PTO beats HOL), or no data
            loc = loc_of[p.name]
            shift_key = ALL_SHIFTS if team_of[p.name] in team_day else _group_key(text)
            slot = groups.setdefault((team_of[p.name], shift_key),
                                     {"pool": [], "straight": [], "outside": []})
            if loc is not None and loc == mex:
                slot["straight" if mex in off_locations else "outside"].append(p.name)
            elif loc in india:
                if is_common:
                    slot["pool"].append(p.name)
                elif loc in off_locations:
                    slot["straight"].append(p.name)
                else:
                    slot["outside"].append(p.name)
            else:
                slot["outside"].append(p.name)

        for (team, shift) in sorted(groups):
            slot = groups[(team, shift)]
            pool, straight, outside = slot["pool"], slot["straight"], slot["outside"]
            if not pool and not straight:
                continue
            minimum = effective_min(config, team, scheduled.get(team, 0))
            need = 0
            covering: list[str] = []
            fair_off: list[str] = []
            c_before: dict[str, OffCounter] = {}
            c_after: dict[str, OffCounter] = {}
            if pool:
                need = max(0, minimum - len(outside))
                ordered = sorted(pool, key=lambda n: (
                    -now[n].offs_taken,
                    -now[n].last_off_date.toordinal() if now[n].last_off_date else 0,
                    _tie_break(seed, d, team, shift, n)))
                covering, fair_off = ordered[:need], ordered[need:]
                c_before = {n: now[n] for n in pool}
                for n in covering:
                    coverage.add((n, d))
                for n in fair_off:
                    now[n] = OffCounter(now[n].offs_taken + 1, d)
                c_after = {n: now[n] for n in pool}
                if need > len(pool):
                    flagged_groups.add((team, shift, d))
                    flags.append(HolidayFlag(
                        "CANNOT_MEET_MINIMUM", d, team, shift, len(outside) + len(pool), minimum,
                        f"{team} {shift} on {d.isoformat()} ({', '.join(names)}): cannot meet "
                        f"the minimum of {minimum} (only {len(outside) + len(pool)} available); "
                        "nobody in the group gets a holiday off"))
                elif need == len(pool):
                    flags.append(HolidayFlag(
                        "NO_OFF_AT_MINIMUM", d, team, shift, len(outside) + len(pool), minimum,
                        f"{team} {shift} on {d.isoformat()} ({', '.join(names)}): the group is "
                        f"at its minimum of {minimum}, so everyone works and nobody gets a "
                        "holiday off"))
            off = [*fair_off, *straight]
            for n in off:
                edits[(n, d)] = HOL
            working = len(outside) + len(covering)
            assignments.append(GroupAssignment(
                d, names, kind, team, shift, minimum, bool(pool), tuple(off), tuple(straight),
                tuple(covering), tuple(outside), need, max(0, minimum - working),
                c_before, c_after, PER_TEAM_DAY if team in team_day else PER_SHIFT))

    result_schedule = apply_edits(schedule, edits)
    if holiday_dates:
        wanted = set(holiday_dates)
        for s in staffing_check(result_schedule, people, config, holiday_dates[0],
                                holiday_dates[-1], team_of=lambda p: team_of[p.name]):
            if s.date in wanted and (s.team, s.shift, s.date) not in flagged_groups:
                flags.append(HolidayFlag(
                    "STAFFING_SHORTAGE", s.date, s.team, s.shift, s.have, s.need,
                    f"{s.message} after holidays were applied"))
    flags.sort(key=lambda f: (f.date, f.team, f.shift, f.kind))
    return HolidayResult(edits, assignments, before, now, flags, seed, frozenset(coverage), average)
