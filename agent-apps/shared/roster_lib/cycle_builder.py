"""
Cycle builder: wires the deterministic steps into two pure entry points.

    analyze_cycle(roster, config, cycle, ...) -> Analysis      what the UI must ask
    build_plan(roster, config, cycle, answers, ...) -> Plan    the draft, as plain data

Nothing here writes a file, edits a workbook, calls a service or uses randomness
(the holiday tie-break is a seeded SHA-256). Names appear in the output, which is
a gitignored artifact; the library code and its tests contain none.

Steps (the same order the PMO follows)
  0  roster changes      `roster_changes.detect_changes` / `apply_changes`
  1  ask-me form         `roster_changes.ask_me_list` + PTO name confirmations
  2  rotate              `rotation.rotate` (previous cycle -> new cycle)
  3  PTO                 `pto.apply_pto` (PTO beats HOL; no replacements)
  4  holidays            `holiday_engine.assign_holidays` (fair HOL, counters)
  5  checks              `checks.hol_check` + `checks.staffing_check` + headcount
  6  draft               the `Plan` (a later phase writes the workbook)

Who is in scope: `active_people(roster.people, config)`, i.e. everyone not in an
excluded section (`config.is_excluded_section`). Excluded people are never rotated,
never given PTO or HOL, never staffing-checked, never listed as new or removed and
never appear in `Plan.edits`.

Answers schema (`answers`, all keys optional):

    {"changes":  {"<new name>": {"replaces": "<old name>"}
                  | {"new_seat": {...}}},                 # see roster_changes
     "rotation": {"<name>": {"shift": "S3|KEEP|...", "pattern": "MON_FRI|WED_SUN",
                             "text": "Shift-3"}}}          # see rotation

`confirmed_pto` ({import name: roster name}) answers the PTO name questions. Missing
or unusable answers never crash and are never guessed: `build_plan` raises
`NeedsAnswers` (`.missing`, `.invalid`, `.to_dict()` -> `{"status": "needs_answers",
...}`) and `analyze_cycle` lists what is still needed in `required_answers`.

Cycle availability: a cycle is only built when the PREVIOUS cycle has data
(`cycles.cycle_availability`); otherwise `CycleUnavailable` is raised with the reason
unless `bootstrap=True` (the first ever cycle: every person then needs an answer).

Year boundary: when the roster's last date column falls inside the cycle, the whole
cycle is computed with the same logic, `Plan.edits` holds the dates inside the file
and `Plan.remainder_edits` the dates after it (for the next-year file). Holiday
fairness counters are per calendar year, so the engine runs once per calendar year of
the cycle and the new year starts from zero. Holidays after the file use the matrix
when it has rows for that year; otherwise a `HOLIDAY_MATRIX_NO_ROWS` flag says the
remainder has no HOL yet.

December Disconnect (`config.disconnect_windows`): those days are skipped by the
holiday assignment, ignored by the HOL check and by the counters.

Flags: every item the PMO must look at, `Flag(kind, severity, message, person, date,
team, shift)`; nothing flagged is ever fixed automatically. Kinds:
  STAFFING_SHORTAGE, CANNOT_MEET_MINIMUM, NO_OFF_AT_MINIMUM        (staffing / holidays)
  HOL_STRAY, HOL_MISSING, HOL_MISSING_UNVERIFIED, HOL_ON_WEEKLY_OFF, HOL_MISMATCH_NO_LABEL,
  HOL_MISMATCH_NO_MATRIX, HOL_UNKNOWN_LOCATION                      (HOL check)
  PTO_SWAP_SUNDAY, PTO_NEEDED, PTO_BELOW_MIN, PTO_OVERLAP, PTO_UNMATCHED, PTO_SKIPPED,
  PTO_NOTE                                                           (PTO)
  HEADCOUNT_CHANGED, HEADCOUNT_BELOW_MIN, ROTATION_WARNING, UNCLASSIFIED_PERSON,
  CHANGE_NOTE, CONFIG_NOT_UPDATED                                    (rotation / config)
  YEAR_BOUNDARY, HOLIDAY_MATRIX_NO_ROWS, DISCONNECT_HOLIDAY_SKIPPED, OVERWRITES_EXISTING,
  PRESERVED_LEAVE
Severity is ERROR, WARNING or INFO. Every flag has a stable `key` (`kind|person|date|team|
shift`); `flag_delta(before, after)` -> (new, resolved, remaining) compares two runs, and
`make_rechecker(...)` recomputes the check flags (HOL check, staffing, headcount per shift)
for an edited draft schedule.

Existing leave: a cell of the cycle that already holds a leave code (P, T, SL, COMP, or a HOL
typed by hand) in the file is PRESERVED: never rewritten (not in `Plan.edits`, listed in
`Plan.preserved`, one INFO `PRESERVED_LEAVE` flag each), the person is away that day (no
HOL), a PTO import on it keeps the existing code with a PTO_NOTE, and a preserved HOL of an
India person on a COMMON holiday they work is an off already taken (see `holiday_engine`).
Only shift/pattern cells (working codes, blanks, custom text) are rewritten;
OVERWRITES_EXISTING counts those non-blank, non-leave cells that change, by existing code.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Callable, Collection, Iterable, Mapping, Sequence

from .checks import (
    ALL_SHIFTS,
    FindingKind,
    daterange,
    hol_check,
    is_shift_canonical,
    schedule_from_roster,
    staffing_check,
)
from .codes import counts_as_code, is_leave_code, try_parse_code
from .config import PER_TEAM_DAY, Rotation, RotationConfig, name_key, parse_config
from .cycles import Availability, Cycle, cycle_availability, previous_cycle, split_at_year_boundary
from .holiday_engine import (
    OffCounter,
    apply_edits,
    assign_holidays,
    build_counters_from_schedule,
)
from .holiday_matrix import HolidayMatrix
from .pto import (
    PtoEntry,
    PtoImportError,
    apply_pto,
    match_names,
    read_pto_workbook,
    shift_group_rule,
)
from .roster_changes import (
    AppliedChanges,
    AskMeItem,
    ChangeSet,
    apply_changes,
    ask_me_list,
    detect_changes,
)
from .roster_io import Person as RosterPerson
from .rotation import InvalidAnswers, MissingAnswers, derive_state, rotate

LIBRARY_VERSION = "cycle-builder/1"
PLAN_FORMAT = "cycle-plan/1"

Schedule = dict[str, dict[date, str]]
Edits = dict[tuple[str, date], str]

_SEVERITY_RANK = {"ERROR": 0, "WARNING": 1, "INFO": 2}
_HEADCOUNT_RE = re.compile(r"^Headcount changed for team (.*): (.*) (\d+) -> (\d+)$")


# ---- errors ---------------------------------------------------------------------------

class CycleBuilderError(Exception):
    """Base class of the errors raised by this module."""


class CycleUnavailable(CycleBuilderError):
    """The cycle cannot be built (the previous cycle has no usable data)."""

    def __init__(self, reason: str, availability: Availability | None = None):
        super().__init__(reason)
        self.reason = reason
        self.availability = availability


class MissingInput(CycleBuilderError):
    """A required input (e.g. the holiday matrix) was not supplied."""


@dataclass(frozen=True)
class MissingAnswer:
    stage: str  # "changes" | "rotation" | "pto" | "answers"
    name: str
    reason: str


class NeedsAnswers(CycleBuilderError):
    """Answers are missing (`missing`) or unusable (`invalid`); nothing was guessed."""

    def __init__(self, missing: Sequence[MissingAnswer] = (), invalid: Sequence[str] = ()):
        self.missing = list(missing)
        self.invalid = list(invalid)
        parts = [f"{m.name} ({m.stage}: {m.reason})" for m in self.missing]
        parts += [f"invalid: {p}" for p in self.invalid]
        super().__init__("Answers needed: " + "; ".join(parts))

    def to_dict(self) -> dict[str, Any]:
        return {"status": "needs_answers",
                "missing": [{"stage": m.stage, "name": m.name, "reason": m.reason}
                            for m in self.missing],
                "invalid": list(self.invalid)}


# ---- small data types -----------------------------------------------------------------

@dataclass(frozen=True)
class Flag:
    kind: str
    severity: str  # ERROR | WARNING | INFO
    message: str
    person: str | None = None
    date: date | None = None
    team: str | None = None
    shift: str | None = None

    @property
    def key(self) -> str:
        """Stable identity for comparing two runs: `kind|person|date|team|shift` (empty where
        absent). A flag with none of person/date/team/shift (a general note) also carries a
        short digest of its message so two different notes never share a key."""
        parts = [self.kind, self.person or "", _iso(self.date) or "", self.team or "",
                 self.shift or ""]
        if not any(parts[1:]):
            parts.append(hashlib.sha256(self.message.encode("utf-8")).hexdigest()[:10])
        return "|".join(parts)

    def to_dict(self) -> dict[str, Any]:
        return {"key": self.key, "kind": self.kind, "severity": self.severity,
                "message": self.message, "person": self.person, "date": _iso(self.date),
                "team": self.team, "shift": self.shift}

    @staticmethod
    def from_dict(d: Mapping[str, Any]) -> "Flag":
        return Flag(d["kind"], d["severity"], d["message"], d.get("person"),
                    _date(d.get("date")), d.get("team"), d.get("shift"))


def flag_delta(before: Iterable[Any], after: Iterable[Any]
               ) -> tuple[list[Any], list[Any], list[Any]]:
    """Compare two flag lists by `Flag.key` -> (new, resolved, remaining): new = in `after`
    only, resolved = in `before` only, remaining = in both (the `after` objects). Accepts
    `Flag` objects or dicts carrying a `key` (or the Flag fields)."""
    def key_of(f: Any) -> str:
        if isinstance(f, Flag):
            return f.key
        if isinstance(f, Mapping):
            return f["key"] if f.get("key") else Flag.from_dict(f).key
        return f.key

    before, after = list(before), list(after)
    before_keys = {key_of(f) for f in before}
    after_keys = {key_of(f) for f in after}
    return ([f for f in after if key_of(f) not in before_keys],
            [f for f in before if key_of(f) not in after_keys],
            [f for f in after if key_of(f) in before_keys])


@dataclass(frozen=True)
class RequiredAnswer:
    """One thing the UI form must collect before `build_plan` can run."""

    stage: str  # "changes" | "rotation" | "pto"
    name: str
    kind: str  # NEW_PERSON | NO_HISTORY | ASK_ME | UNCLASSIFIED | NEW_SEAT | AUTO_SWAP | PTO_NAME
    reason: str
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {"stage": self.stage, "name": self.name, "kind": self.kind,
                "reason": self.reason, "details": self.details}


def _iso(d: date | None) -> str | None:
    return None if d is None else d.isoformat()


def _date(text: str | None) -> date | None:
    return None if text is None else date.fromisoformat(text)


def _dump(data: Any) -> str:
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


def _digest(data: Any) -> str:
    text = json.dumps(data, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


# ---- who is in scope ------------------------------------------------------------------

def active_people(roster_people: Iterable[RosterPerson], config: RotationConfig
                  ) -> list[RosterPerson]:
    """The roster people who are in scope: not in an excluded section (roster order)."""
    return [p for p in roster_people if not config.is_excluded_section(p)]


def _team_name(config: RotationConfig, person: RosterPerson) -> str:
    return config.team_of(person) or person.section


# ---- shared preparation ---------------------------------------------------------------

@dataclass
class _Prep:
    roster: Any
    config: RotationConfig
    cycle: Cycle
    prev: Cycle
    active: list[RosterPerson]
    excluded: list[RosterPerson]
    schedule: Schedule  # active people, every date of the roster file
    prev_schedule: Schedule  # active people, previous-cycle dates only
    availability: Availability
    changes: ChangeSet
    applied: AppliedChanges | None
    config_after: RotationConfig
    rotation_answers: dict[str, dict[str, Any]]
    ask_items: list[AskMeItem]
    missing: list[MissingAnswer]
    invalid: list[str]
    required: list[RequiredAnswer]


def _read_answers(answers: Mapping[str, Any] | None
                  ) -> tuple[dict[str, Any], dict[str, Any], list[str]]:
    if answers is None:
        return {}, {}, []
    problems: list[str] = []
    if not isinstance(answers, Mapping):
        return {}, {}, ["answers must be an object with 'changes' and/or 'rotation'"]
    for key in sorted(set(answers) - {"changes", "rotation"}):
        problems.append(f"unknown answers key {key!r} (use 'changes' and 'rotation')")
    out = []
    for key in ("changes", "rotation"):
        value = answers.get(key) or {}
        if not isinstance(value, Mapping):
            problems.append(f"answers[{key!r}] must be an object keyed by person name")
            value = {}
        out.append(dict(value))
    return out[0], out[1], problems


def _prepare(roster, config: RotationConfig, cycle: Cycle, answers, *, bootstrap: bool
             ) -> _Prep:
    people = list(roster.people)
    active = active_people(people, config)
    active_names = [p.name for p in active]
    excluded = [p for p in people if p not in active]
    full = schedule_from_roster(roster)
    schedule: Schedule = {n: dict(full[n]) for n in active_names}
    prev = previous_cycle(cycle)
    prev_schedule: Schedule = {n: {d: t for d, t in cells.items() if prev.contains(d)}
                               for n, cells in schedule.items()}

    availability = cycle_availability(cycle, schedule, active_names, counts_as_code,
                                      config.has_data_threshold, bootstrap)

    changes_answers, rotation_answers_in, problems = _read_answers(answers)
    changes = detect_changes(active, config, prev_schedule)
    roster_keys = {name_key(p.name) for p in people}
    # A configured person who sits in an excluded section is not "removed".
    changes.removed = [r for r in changes.removed if name_key(r.name) not in roster_keys]

    missing: list[MissingAnswer] = []
    invalid: list[str] = list(problems)
    required: list[RequiredAnswer] = []
    applied: AppliedChanges | None = None
    try:
        applied = apply_changes(config, changes_answers, changes, active)
    except MissingAnswers as exc:
        removed_names = [r.name for r in changes.removed]
        by_key = {name_key(n.name): n for n in changes.new}
        for name, reason in exc.reasons.items():
            missing.append(MissingAnswer("changes", name, reason))
            new = by_key.get(name_key(name))
            required.append(RequiredAnswer(
                "changes", name, "NO_HISTORY" if new and new.in_config else "NEW_PERSON",
                "in the config but has no previous-cycle code" if new and new.in_config
                else "in the roster but not in the rotation config",
                {"section": new.section if new else None,
                 "location": new.location_code if new else None,
                 "replaces_options": removed_names,
                 "new_seat_fields": ["rotation", "shift", "pattern", "team", "subteam",
                                     "location"]}))
    except InvalidAnswers as exc:
        invalid.extend(exc.problems)

    config_after = applied.config if applied is not None else config
    rotation_answers = dict(applied.rotation_answers) if applied is not None else {}
    rotation_answers.update(rotation_answers_in)
    answered = {name_key(n) for n in rotation_answers}

    ask_items = ask_me_list(config_after, active, prev_schedule, cycle,
                            replaces=applied.replaces if applied is not None else None)
    for item in ask_items:
        if name_key(item.name) in answered:
            continue
        missing.append(MissingAnswer("rotation", item.name, item.reason))
        required.append(RequiredAnswer(
            "rotation", item.name, item.category, item.reason,
            {"current_shift": item.current_shift, "current_pattern": item.current_pattern,
             "current_text": item.current_text,
             "answer_shape": {"shift": "S1-S5, NS, US-CST, US-PST, 11AM-8PM, MX-8-5 or KEEP",
                              "pattern": "MON_FRI or WED_SUN (optional)",
                              "text": "exact text to write (optional)"}}))

    return _Prep(roster, config, cycle, prev, active, excluded, schedule, prev_schedule,
                 availability, changes, applied, config_after, rotation_answers, ask_items,
                 missing, invalid, required)


@dataclass
class _PtoPrep:
    provided: bool
    entries: list[PtoEntry]  # entries that go to apply_pto
    excluded_entries: list[PtoEntry]  # exact match to an excluded person: dropped
    exact: dict[str, str]
    needs_confirmation: dict[str, list[tuple[str, str]]]
    unmatched: list[str]


def _pto_prepare(entries: Sequence[PtoEntry] | None, active: Sequence[RosterPerson],
                 excluded: Sequence[RosterPerson], confirmed: Mapping[str, str] | None
                 ) -> _PtoPrep:
    entries = list(entries or [])
    names = list(dict.fromkeys(e.name for e in entries))
    on_active = match_names(names, [p.name for p in active], confirmed)
    on_excluded = match_names(names, [p.name for p in excluded], confirmed)
    dropped = [e for e in entries if e.name not in on_active.exact and e.name in on_excluded.exact]
    dropped_ids = {id(e) for e in dropped}
    kept = [e for e in entries if id(e) not in dropped_ids]
    kept_names = set(e.name for e in kept)
    return _PtoPrep(
        provided=entries is not None and bool(entries),
        entries=kept,
        excluded_entries=dropped,
        exact={n: r for n, r in sorted(on_active.exact.items()) if n in kept_names},
        needs_confirmation={n: [(c.roster_name, c.reason) for c in cands]
                            for n, cands in sorted(on_active.needs_confirmation.items())
                            if n in kept_names},
        unmatched=[n for n in on_active.unmatched if n in kept_names])


def _pto_required(pto: _PtoPrep) -> list[RequiredAnswer]:
    return [RequiredAnswer("pto", name, "PTO_NAME",
                           "the PTO name is close to, but not exactly, a roster name",
                           {"candidates": [{"roster_name": r, "reason": why}
                                           for r, why in cands]})
            for name, cands in pto.needs_confirmation.items()]


def _matrix_summary(matrix: HolidayMatrix | None, errors: Sequence[str], cycle: Cycle,
                    last_date: date) -> dict[str, Any]:
    out: dict[str, Any] = {"present": matrix is not None, "errors": list(errors)}
    if matrix is None:
        return out
    rows = list(matrix.holidays)
    years = sorted({h.date.year for h in rows})
    in_cycle = [h for h in rows if cycle.start <= h.date <= cycle.end]
    out.update({
        "rows": len(rows), "years": years,
        "rows_in_cycle": len(in_cycle),
        "rows_in_file_part": sum(1 for h in in_cycle if h.date <= last_date),
        "rows_beyond_file": sum(1 for h in in_cycle if h.date > last_date),
        "years_without_rows": sorted({y for y in (cycle.start.year, cycle.end.year)
                                      if y not in years}),
    })
    return out


def _year_boundary(cycle: Cycle, last_date: date) -> dict[str, Any]:
    in_file, remainder = split_at_year_boundary(cycle, last_date)
    return {"roster_last_date": last_date.isoformat(),
            "crosses": remainder is not None,
            "wholly_beyond": in_file is None,
            "in_file": None if in_file is None else {"start": in_file.start.isoformat(),
                                                    "end": in_file.end.isoformat()},
            "remainder": None if remainder is None else {"start": remainder.start.isoformat(),
                                                         "end": remainder.end.isoformat()}}


def _cycle_dict(cycle: Cycle) -> dict[str, str]:
    return {"label": cycle.label, "first_month": cycle.first_month.isoformat(),
            "start": cycle.start.isoformat(), "end": cycle.end.isoformat(),
            "rotation_sunday": cycle.rotation_sunday.isoformat()}


def _cycle_from(d: Mapping[str, str]) -> Cycle:
    return Cycle(date.fromisoformat(d["first_month"]), date.fromisoformat(d["start"]),
                 date.fromisoformat(d["end"]), date.fromisoformat(d["rotation_sunday"]))


# ---- analyze --------------------------------------------------------------------------

@dataclass
class Analysis:
    """What the UI needs before building: availability, asks, PTO and matrix status."""

    cycle: Cycle
    previous_cycle: str
    availability: Availability
    changes: ChangeSet
    ask_me: list[AskMeItem]
    required_answers: list[RequiredAnswer]
    pto: dict[str, Any]
    year_boundary: dict[str, Any]
    holiday_matrix: dict[str, Any]
    active_count: int
    excluded_people: list[str]
    unclassified: list[str]
    blockers: list[str]

    @property
    def ready(self) -> bool:
        """True when `build_plan` can run with the answers supplied so far."""
        return not self.blockers

    def to_dict(self) -> dict[str, Any]:
        av = self.availability
        return {
            "cycle": _cycle_dict(self.cycle),
            "previous_cycle": self.previous_cycle,
            "ready": self.ready,
            "blockers": list(self.blockers),
            "availability": {"enabled": av.enabled, "reason": av.reason, "coverage": av.coverage,
                             "failing_people": list(av.failing_people)},
            "changes": {
                "new": [{"name": n.name, "location": n.location_code, "team_label": n.team_label,
                         "section": n.section, "in_config": n.in_config}
                        for n in self.changes.new],
                "removed": [{"name": r.name, "team": r.person.team,
                             "subteam": r.person.subteam,
                             "rotation": r.person.rotation.value} for r in self.changes.removed],
            },
            "ask_me": [{"name": a.name, "current_shift": a.current_shift,
                        "current_pattern": a.current_pattern, "category": a.category,
                        "current_text": a.current_text, "reason": a.reason}
                       for a in self.ask_me],
            "required_answers": [r.to_dict() for r in self.required_answers],
            "pto": self.pto,
            "year_boundary": self.year_boundary,
            "holiday_matrix": self.holiday_matrix,
            "active_people": self.active_count,
            "excluded_people": list(self.excluded_people),
            "unclassified": list(self.unclassified),
        }

    def to_json(self) -> str:
        return _dump(self.to_dict())


def analyze_cycle(
    roster, config: RotationConfig, cycle: Cycle, *,
    holiday_matrix: HolidayMatrix | None = None,
    holiday_matrix_errors: Sequence[str] = (),
    pto_path=None, pto_entries: Sequence[PtoEntry] | None = None,
    confirmed_pto: Mapping[str, str] | None = None,
    answers: Mapping[str, Any] | None = None,
    bootstrap: bool = False,
) -> Analysis:
    """Everything that can be known before building: see the module docstring.

    Pure: reads `pto_path` when given (never writes). `required_answers` lists what is
    STILL missing given `answers` and `confirmed_pto`; the analysis is `ready` when
    nothing blocks `build_plan`.
    """
    prep = _prepare(roster, config, cycle, answers, bootstrap=bootstrap)
    pto_error: list[str] | None = None
    entries = list(pto_entries) if pto_entries is not None else None
    if entries is None and pto_path is not None:
        try:
            entries = read_pto_workbook(pto_path)
        except PtoImportError as exc:
            pto_error = list(exc.problems)
    pto = _pto_prepare(entries, prep.active, prep.excluded, confirmed_pto)

    required = list(prep.required) + _pto_required(pto)
    blockers: list[str] = []
    if not prep.availability.enabled:
        blockers.append(prep.availability.reason)
    if holiday_matrix is None:
        blockers.append("the holiday matrix is missing"
                        + (": " + "; ".join(holiday_matrix_errors) if holiday_matrix_errors else ""))
    if pto_error:
        blockers.append("the PTO workbook has errors")
    blockers.extend(f"invalid answer: {p}" for p in prep.invalid)
    blockers.extend(f"answer needed ({r.stage}): {r.name}" for r in required)

    last_date = roster.last_date
    return Analysis(
        cycle=cycle,
        previous_cycle=prep.prev.label,
        availability=prep.availability,
        changes=prep.changes,
        ask_me=prep.ask_items,
        required_answers=required,
        pto={"provided": entries is not None, "entries": len(entries or []),
             "exact": pto.exact,
             "needs_confirmation": {n: [{"roster_name": r, "reason": why} for r, why in c]
                                    for n, c in pto.needs_confirmation.items()},
             "unmatched": pto.unmatched,
             "dropped_excluded": sorted({e.name for e in pto.excluded_entries}),
             "error": pto_error},
        year_boundary=_year_boundary(cycle, last_date),
        holiday_matrix=_matrix_summary(holiday_matrix, holiday_matrix_errors, cycle, last_date),
        active_count=len(prep.active),
        excluded_people=[p.name for p in prep.excluded],
        unclassified=[p.name for p in prep.active
                      if (cp := prep.config_after.find(p.name)) is not None
                      and cp.rotation is Rotation.UNCLASSIFIED],
        blockers=blockers)


# ---- headcount ------------------------------------------------------------------------

def headcount_table(schedule: Mapping[str, Mapping[date, str]], people: Iterable[RosterPerson],
                    config: RotationConfig, cycle: Cycle) -> dict[str, dict[str, Any]]:
    """Per team: headcount, people per shift code in `cycle` (the code the person works that
    cycle, from `rotation.derive_state`), the spec minimum, the minimum `mode`
    (`per_shift` / `per_team_day`) and whether that minimum is attainable: per shift (people
    on the shift >= minimum) for a per_shift team, for the whole team (key "ALL": people
    with a shift >= minimum) for a per_team_day team; a minimum of 0 always is."""
    table: dict[str, dict[str, Any]] = {}
    for p in people:
        team = _team_name(config, p)
        row = table.setdefault(team, {"headcount": 0, "per_shift": {}, "no_shift": 0})
        row["headcount"] += 1
        state = derive_state(
            {d: t for d, t in (schedule.get(p.name) or {}).items() if cycle.contains(d)}, cycle)
        if state is None:
            row["no_shift"] += 1
        else:
            row["per_shift"][state.label] = row["per_shift"].get(state.label, 0) + 1
    out: dict[str, dict[str, Any]] = {}
    for team in sorted(table):
        row = table[team]
        minimum = config.min_staff_for_team(team)
        mode = config.min_staff_mode_for_team(team)
        per_shift = dict(sorted(row["per_shift"].items()))
        attainable = ({ALL_SHIFTS: sum(per_shift.values()) >= minimum}
                      if mode == PER_TEAM_DAY
                      else {code: n >= minimum for code, n in per_shift.items()})
        out[team] = {
            "headcount": row["headcount"], "per_shift": per_shift, "no_shift": row["no_shift"],
            "spec_min": minimum, "mode": mode,
            "attainable": attainable,
            "lowest_shift_headcount": min(per_shift.values()) if per_shift else None,
        }
    return out


# ---- the plan -------------------------------------------------------------------------

@dataclass
class Plan:
    """The draft for one cycle as plain data (see the module docstring)."""

    cycle: Cycle
    edits: Edits  # every new-cycle cell written into the roster file: (name, date) -> text
    # (in-file dates only; existing leave cells, `preserved`, are not in it)
    remainder_edits: Edits  # the same for dates after roster.last_date (next-year file)
    shift_changes: list[dict[str, Any]]
    holiday_assignments: list[dict[str, Any]]
    flags: list[Flag]
    counters_before: dict[str, dict[str, Any]]
    counters_after: dict[str, dict[str, Any]]
    config_after: RotationConfig
    run_info: dict[str, Any]
    existing_roster_findings: dict[str, Any]
    next_year_counters: dict[str, dict[str, Any]] | None = None
    preserved: Edits = field(default_factory=dict)  # existing leave cells kept: (name, date) -> text

    def snapshot_cells(self) -> dict[tuple[str, date], str]:
        """Exactly the cells the plan writes into the roster file: `edits` (dates inside the
        file; preserved leave cells and next-year `remainder_edits` are not in it)."""
        return dict(self.edits)

    def flags_by_kind(self) -> dict[str, int]:
        out: dict[str, int] = {}
        for f in self.flags:
            out[f.kind] = out.get(f.kind, 0) + 1
        return dict(sorted(out.items()))

    def to_dict(self) -> dict[str, Any]:
        def edit_rows(edits: Edits) -> list[list[str]]:
            return [[n, d.isoformat(), t] for (n, d), t in sorted(edits.items())]

        return {
            "format": PLAN_FORMAT,
            "cycle": _cycle_dict(self.cycle),
            "edits": edit_rows(self.edits),
            "remainder_edits": edit_rows(self.remainder_edits),
            "preserved_leave": edit_rows(self.preserved),
            "shift_changes": self.shift_changes,
            "holiday_assignments": self.holiday_assignments,
            "flags": [f.to_dict() for f in self.flags],
            "counters_before": self.counters_before,
            "counters_after": self.counters_after,
            "next_year_counters": self.next_year_counters,
            "config_after": self.config_after.to_dict(),
            "run_info": self.run_info,
            "existing_roster_findings": self.existing_roster_findings,
        }

    def to_json(self) -> str:
        """Deterministic: the same inputs give byte-identical text."""
        return _dump(self.to_dict())

    @staticmethod
    def from_json(text: str) -> "Plan":
        data = json.loads(text)
        if data.get("format") != PLAN_FORMAT:
            raise ValueError(f"not a {PLAN_FORMAT} document")

        def edits_of(rows) -> Edits:
            return {(n, date.fromisoformat(d)): t for n, d, t in rows}

        return Plan(
            cycle=_cycle_from(data["cycle"]),
            edits=edits_of(data["edits"]),
            remainder_edits=edits_of(data["remainder_edits"]),
            shift_changes=data["shift_changes"],
            holiday_assignments=data["holiday_assignments"],
            flags=[Flag.from_dict(f) for f in data["flags"]],
            counters_before=data["counters_before"],
            counters_after=data["counters_after"],
            config_after=parse_config(data["config_after"]),
            run_info=data["run_info"],
            existing_roster_findings=data["existing_roster_findings"],
            next_year_counters=data.get("next_year_counters"),
            preserved=edits_of(data.get("preserved_leave", [])))


def _segments(cycle: Cycle) -> list[tuple[date, date]]:
    """The cycle cut at 1 January (fairness counters are per calendar year)."""
    if cycle.start.year == cycle.end.year:
        return [(cycle.start, cycle.end)]
    boundary = date(cycle.end.year, 1, 1)
    return [(cycle.start, boundary - timedelta(days=1)), (boundary, cycle.end)]


def _counter_dict(counters: Mapping[str, OffCounter]) -> dict[str, dict[str, Any]]:
    return {n: {"offs_taken": c.offs_taken, "last_off_date": _iso(c.last_off_date)}
            for n, c in sorted(counters.items())}


def _flag_order(f: Flag):
    return (_SEVERITY_RANK.get(f.severity, 9), f.date or date.min, f.kind, f.person or "",
            f.team or "", f.shift or "", f.message)


def _assignment_dict(a) -> dict[str, Any]:
    return {
        "date": a.date.isoformat(), "holidays": list(a.holidays), "kind": a.kind,
        "team": a.team, "shift": a.shift, "min_staff": a.min_staff, "fairness": a.fairness,
        "off": list(a.off), "straight_off": list(a.straight_off), "covering": list(a.covering),
        "outside": list(a.outside), "need": a.need, "shortage": a.shortage,
        "counters_before": _counter_dict(a.counters_before),
        "counters_after": _counter_dict(a.counters_after),
        "mode": a.mode, "preserved_off": list(a.preserved_off),
    }


def _shift_change_dict(c) -> dict[str, Any]:
    return {"person": c.person, "old_shift": c.old_shift, "new_shift": c.new_shift,
            "effective": c.effective.isoformat(), "first_worked": _iso(c.first_worked),
            "old_pattern": c.old_pattern.value if c.old_pattern else None,
            "new_pattern": c.new_pattern.value}


def _finding_dict(f) -> dict[str, Any]:
    return {"kind": f.kind.name, "severity": f.severity.value, "date": _iso(f.date),
            "person": f.person, "location": f.location, "message": f.message}


def _existing_findings(roster, active: Sequence[RosterPerson], config: RotationConfig,
                       matrix: HolidayMatrix, schedule: Schedule, year: int,
                       disconnect: Collection[date]) -> dict[str, Any]:
    start = max(date(year, 1, 1), roster.first_date)
    end = min(date(year, 12, 31), roster.last_date)
    out: dict[str, Any] = {"year": year, "start": start.isoformat(), "end": end.isoformat(),
                           "hol": [], "staffing": [], "hol_by_kind": {}, "staffing_count": 0}
    if start > end:
        return out
    hol = hol_check(schedule, active, matrix, roster.holiday_labels(expand_merges=True),
                    start, end, ignore_dates=disconnect)
    short = staffing_check(schedule, active, config, start, end)
    out["hol"] = [_finding_dict(f) for f in hol]
    by_kind: dict[str, int] = {}
    for f in hol:
        by_kind[f.kind.name] = by_kind.get(f.kind.name, 0) + 1
    out["hol_by_kind"] = dict(sorted(by_kind.items()))
    out["staffing"] = [{"team": s.team, "shift": s.shift, "date": s.date.isoformat(),
                        "have": s.have, "need": s.need, "severity": s.severity,
                        "message": s.message} for s in short]
    out["staffing_count"] = len(short)
    return out


def _draft_flags(roster, active: Sequence[RosterPerson], cfg: RotationConfig,
                 matrix: HolidayMatrix, draft: Schedule, cycle_schedule: Schedule, cycle: Cycle,
                 last_date: date, disconnect: Collection[date], coverage: frozenset,
                 cannot_meet: Collection[tuple]) -> list[Flag]:
    """The checks on a draft: HOL check, staffing check and headcount per shift. Shared by
    `build_plan` and the re-checker. `draft` = the existing roster overlaid with the new cycle
    (every date of the cycle), `cycle_schedule` = the cycle's cells only."""
    flags: list[Flag] = []
    in_file_end = min(cycle.end, last_date)
    hol_findings = []
    if cycle.start <= last_date:
        hol_findings += hol_check(draft, active, matrix, roster.holiday_labels(expand_merges=True),
                                  cycle.start, in_file_end, coverage_ok=coverage,
                                  ignore_dates=disconnect)
    if cycle.end > last_date:
        beyond_from = max(cycle.start, last_date + timedelta(days=1))
        hol_findings += [f for f in hol_check(draft, active, matrix, {}, beyond_from, cycle.end,
                                              coverage_ok=coverage, ignore_dates=disconnect)
                         if not f.kind.name.startswith("MISMATCH")]
    for f in hol_findings:
        flags.append(Flag("HOL_" + f.kind.name, f.severity.value, f.message, f.person, f.date))
    for s in staffing_check(draft, active, cfg, cycle.start, cycle.end):
        if (s.team, s.shift, s.date) in cannot_meet:
            continue  # already reported as CANNOT_MEET_MINIMUM by the holiday engine
        flags.append(Flag("STAFFING_SHORTAGE", s.severity, s.message, date=s.date, team=s.team,
                          shift=s.shift))
    table = headcount_table(cycle_schedule, active, cfg, cycle)
    for team, row in table.items():
        if row["spec_min"] <= 0 or row["mode"] == PER_TEAM_DAY:
            continue  # per_team_day teams use the effective minimum (see checks.effective_min)
        for code, n in row["per_shift"].items():
            if n < row["spec_min"]:
                flags.append(Flag(
                    "HEADCOUNT_BELOW_MIN", "WARNING",
                    f"team {team} has {n} people on {code}, below the minimum of "
                    f"{row['spec_min']} even before any leave", team=team, shift=code))
    return flags


def make_rechecker(roster, config: RotationConfig, cycle: Cycle, holiday_matrix: HolidayMatrix,
                   plan: "Plan") -> Callable[[Mapping[str, Mapping[date, str]]], list[Flag]]:
    """A function `recheck(edited_schedule) -> list[Flag]` for the draft-diff step.

    `edited_schedule` is the COMPLETE edited schedule of the cycle: `{name: {date: raw
    text}}` for all in-scope people and the cycle's dates inside the roster file (people
    or dates it lacks keep the roster's own cells). It returns the full flag list recomputed
    with the same checks as `build_plan` (HOL check with the plan's coverage set, staffing
    check and headcount per shift); rotation warnings, PTO and other plan-time flags are not
    recomputed. The plan's next-year `remainder_edits` complete the cycle. Compare with
    `flag_delta(plan.flags, recheck(schedule))`; every `Flag.key` is stable across runs.
    Pure: nothing is written."""
    active = active_people(roster.people, config)
    last_date = roster.last_date
    disconnect = config.disconnect_dates()
    coverage = frozenset((n, date.fromisoformat(a["date"]))
                         for a in plan.holiday_assignments for n in a["covering"])
    cannot_meet = {(f.team, f.shift, f.date) for f in plan.flags
                   if f.kind == "CANNOT_MEET_MINIMUM"}
    base = schedule_from_roster(roster)
    cycle_dates = daterange(cycle.start, cycle.end)

    def recheck(edited: Mapping[str, Mapping[date, str]]) -> list[Flag]:
        draft: Schedule = {p.name: dict(base[p.name]) for p in active}
        for name, cells in edited.items():
            if name in draft:
                draft[name].update({d: t for d, t in cells.items() if d <= last_date})
        for (name, d), text in plan.remainder_edits.items():
            if name in draft:
                draft[name][d] = text
        cycle_schedule = {n: {d: cells[d] for d in cycle_dates if d in cells}
                          for n, cells in draft.items()}
        flags = _draft_flags(roster, active, config, holiday_matrix, draft, cycle_schedule,
                             cycle, last_date, disconnect, coverage, cannot_meet)
        return sorted(flags, key=_flag_order)

    return recheck


def build_plan(
    roster, config: RotationConfig, cycle: Cycle, answers: Mapping[str, Any] | None = None, *,
    holiday_matrix: HolidayMatrix | None,
    pto_entries: Sequence[PtoEntry] | None = None,
    confirmed_pto: Mapping[str, str] | None = None,
    seed: int | None = None,
    history: Mapping[str, Mapping[date, str]] | None = None,
    bootstrap: bool = False,
    library_commit: str | None = None,
) -> Plan:
    """Build the draft for `cycle`; raises `CycleUnavailable`, `MissingInput` or
    `NeedsAnswers` instead of guessing. See the module docstring."""
    if holiday_matrix is None:
        raise MissingInput("the holiday matrix is required to build the holiday step")
    prep = _prepare(roster, config, cycle, answers, bootstrap=bootstrap)
    if not prep.availability.enabled:
        raise CycleUnavailable(prep.availability.reason, prep.availability)
    pto = _pto_prepare(pto_entries, prep.active, prep.excluded, confirmed_pto)
    missing = list(prep.missing) + [
        MissingAnswer("pto", n, "the PTO name needs confirmation: "
                      + ", ".join(r for r, _ in cands)) for n, cands in pto.needs_confirmation.items()]
    if missing or prep.invalid:
        raise NeedsAnswers(missing, prep.invalid)

    active, cfg = prep.active, prep.config_after
    cycle_dates = daterange(cycle.start, cycle.end)
    last_date = roster.last_date
    disconnect = cfg.disconnect_dates()

    # ---- step 2: rotate --------------------------------------------------------------
    hist: Schedule = {n: {d: t for d, t in cells.items() if d < prep.prev.start}
                      for n, cells in prep.schedule.items()}
    for n, cells in (history or {}).items():
        hist.setdefault(n, {}).update(cells)
    try:
        rotated = rotate(prep.schedule, cfg, cycle, prep.rotation_answers, people=active,
                         history=hist, replaces=prep.applied.replaces if prep.applied else None)
    except MissingAnswers as exc:
        raise NeedsAnswers([MissingAnswer("rotation", n, r) for n, r in exc.reasons.items()]) from exc
    except InvalidAnswers as exc:
        raise NeedsAnswers(invalid=exc.problems) from exc

    # ---- step 3: PTO -----------------------------------------------------------------
    by_name = {p.name: p for p in active}
    team_of_name = {n: _team_name(cfg, p) for n, p in by_name.items()}

    def minimum_for(name: str) -> int | None:
        minimum = cfg.min_staff_for_team(team_of_name[name])
        return minimum if minimum > 0 else None

    # Leave codes already typed in the master for this cycle are PRESERVED: the person is away
    # that day (never rewritten, never given HOL, PTO does not replace them).
    preserved: Edits = {}
    for p in active:
        cells = prep.schedule[p.name]
        for d in cycle_dates:
            if d > last_date:
                break
            parsed = try_parse_code(cells.get(d, "") or "")
            if parsed is not None and is_leave_code(parsed.canonical):
                preserved[(p.name, d)] = cells[d]
    base = apply_edits(rotated.schedule, preserved)

    rule = shift_group_rule(
        base, lambda n: team_of_name[n], minimum_for,
        lambda n: cfg.min_staff_mode_for_team(team_of_name[n]) == PER_TEAM_DAY)
    pto_result = apply_pto(base, pto.entries, cycle, confirmed_pto, min_staff_for=rule,
                           preserved=preserved)
    with_pto = apply_edits(base, pto_result.edits)

    # ---- step 4: holidays (per calendar year, December Disconnect days skipped) --------
    matrix_eff = HolidayMatrix(tuple(h for h in holiday_matrix.holidays if h.date not in disconnect),
                               holiday_matrix.location_codes)
    skipped_days = sorted({h.date for h in holiday_matrix.holidays
                           if h.date in disconnect and cycle.contains(h.date)})
    seed_used = cfg.seed if seed is None else seed
    inherited = prep.applied.inherited_counters if prep.applied else {}
    average_seats = prep.applied.pool_average_seats if prep.applied else set()
    hol_edits: Edits = {}
    assignments: list[dict[str, Any]] = []
    engine_flags = []
    coverage: set[tuple[str, date]] = set()
    counters_before: dict[str, dict[str, Any]] = {}
    counters_after: dict[str, dict[str, Any]] = {}
    next_year_counters = None
    segments = _segments(cycle)
    flags: list[Flag] = []
    for i, (seg_start, seg_end) in enumerate(segments):
        counters = build_counters_from_schedule(prep.schedule, active, holiday_matrix,
                                                seg_start.year, cfg, seg_start, disconnect)
        result = assign_holidays(with_pto, active, matrix_eff, counters, cfg, seg_start, seg_end,
                                 seed=seed_used, inherited_counters=inherited,
                                 pool_average_seats=average_seats)
        hol_edits.update(result.edits)
        assignments.extend(_assignment_dict(a) for a in result.assignments)
        engine_flags.extend(result.flags)
        coverage |= set(result.coverage)
        if i == 0:
            counters_before = _counter_dict(result.counters_before)
            counters_after = _counter_dict(result.counters_after)
        else:
            next_year_counters = _counter_dict(result.counters_after)
        if not any(h.date.year == seg_start.year for h in holiday_matrix.holidays):
            in_file = seg_start <= last_date
            flags.append(Flag(
                "HOLIDAY_MATRIX_NO_ROWS", "ERROR" if in_file else "WARNING",
                f"the holiday matrix has no rows for {seg_start.year}: no HOL was assigned "
                f"for {seg_start.isoformat()}..{seg_end.isoformat()}"
                + ("" if in_file else " (after the end of the roster file; apply it when the "
                   "new year's matrix is supplied)"), date=seg_start))
    for d in skipped_days:
        flags.append(Flag("DISCONNECT_HOLIDAY_SKIPPED", "INFO",
                          f"{d.isoformat()} is inside a December Disconnect window: no HOL "
                          "assigned or checked by the program", date=d))

    final = apply_edits(with_pto, hol_edits)

    # ---- step 5: checks on the draft (existing roster overlaid with the new cycle) ------
    draft: Schedule = {n: dict(cells) for n, cells in prep.schedule.items()}
    for n in draft:
        draft[n].update(final[n])
    cannot_meet = {(f.team, f.shift, f.date) for f in engine_flags if f.kind == "CANNOT_MEET_MINIMUM"}
    flags += _draft_flags(roster, active, cfg, holiday_matrix, draft, final, cycle, last_date,
                          disconnect, frozenset(coverage), cannot_meet)
    for f in engine_flags:
        if f.kind == "STAFFING_SHORTAGE":
            continue  # reported by the staffing check below
        flags.append(Flag(f.kind, "WARNING" if f.kind == "CANNOT_MEET_MINIMUM" else "INFO",
                          f.message, date=f.date, team=f.team, shift=f.shift))

    for c in pto_result.clashes:
        flags.append(Flag("PTO_" + c.kind, "WARNING", f"{c.person} {c.date.isoformat()}: {c.detail}",
                          c.person, c.date))
    for note in pto_result.notes:
        if "skipped until the name is confirmed" in note:
            continue  # covered by PTO_UNMATCHED below
        flags.append(Flag("PTO_NOTE", "INFO", note))
    for name in pto.unmatched:
        flags.append(Flag("PTO_UNMATCHED", "ERROR",
                          f"PTO entries for {name!r} match nobody in the roster and were not "
                          "applied", name))
    for e in pto.excluded_entries:
        flags.append(Flag("PTO_SKIPPED", "INFO",
                          f"PTO row {e.row} ({e.name}) belongs to an excluded section and was "
                          "ignored", e.name))

    for w in rotated.warnings:
        m = _HEADCOUNT_RE.match(w)
        if m:
            flags.append(Flag("HEADCOUNT_CHANGED", "WARNING", w, team=m.group(1), shift=m.group(2)))
            continue
        person = next((n for n in by_name if w.startswith(n + ":")), None)
        flags.append(Flag("ROTATION_WARNING", "WARNING", w, person))
    for p in active:
        cp = cfg.find(p.name)
        if cp is not None and cp.rotation is Rotation.UNCLASSIFIED:
            flags.append(Flag("UNCLASSIFIED_PERSON", "WARNING",
                              f"{p.name} is UNCLASSIFIED: asked every cycle until given a rotation "
                              "category", p.name))
    if prep.applied is not None:
        for note in prep.applied.notes:
            flags.append(Flag("CHANGE_NOTE", "INFO", note))

    # ---- step 6: assemble --------------------------------------------------------------
    edits: Edits = {}
    remainder: Edits = {}
    for n in sorted(final):
        for d in cycle_dates:
            if (n, d) in preserved:
                continue  # an existing leave code stays exactly as typed
            (edits if d <= last_date else remainder)[(n, d)] = final[n].get(d, "")
    if remainder:
        first_beyond = min(d for _, d in remainder)
        flags.append(Flag(
            "YEAR_BOUNDARY", "INFO",
            f"{cycle.label} extends past the roster's last date ({last_date.isoformat()}): "
            f"{len(edits)} cell edits are in the file, {len(remainder)} belong to the next-year "
            f"file (from {first_beyond.isoformat()})", date=first_beyond))
    for (n, d), raw in sorted(preserved.items()):
        flags.append(Flag("PRESERVED_LEAVE", "INFO",
                          f"{n} {d.isoformat()}: the existing {raw.strip()!r} is leave and was "
                          "kept; the draft does not rewrite this cell", n, d))
    overwritten: dict[str, int] = {}
    for (n, d), t in edits.items():
        existing = prep.schedule[n].get(d, "") or ""
        if existing.strip() and existing != t:
            parsed = try_parse_code(existing)
            label = ("unrecognised" if parsed is None
                     else "custom hours" if parsed.is_custom else parsed.canonical)
            overwritten[label] = overwritten.get(label, 0) + 1
    if overwritten:
        flags.append(Flag("OVERWRITES_EXISTING", "INFO",
                          f"{sum(overwritten.values())} non-blank, non-leave cell(s) already in "
                          "the file for this cycle differ from the draft and would be "
                          "overwritten (" + ", ".join(f"{k}: {v}" for k, v in
                                                       sorted(overwritten.items())) + ")"))

    config_out = copy.deepcopy(cfg)
    for p in active:
        state = derive_state({d: t for d, t in final[p.name].items()}, cycle)
        cp = config_out.find(p.name)
        if state is None or cp is None or state.code == cp.shift:
            continue
        if not is_shift_canonical(state.code):
            continue
        try:
            config_out.update_person(p.name, shift=state.code)
        except Exception:  # ConfigError: e.g. AUTO_SWAP with a shift that has no partner
            flags.append(Flag("CONFIG_NOT_UPDATED", "INFO",
                              f"{p.name}: the config shift was not updated to {state.code}", p.name))

    existing = _existing_findings(roster, active, cfg, holiday_matrix, prep.schedule,
                                  cycle.first_month.year, disconnect)

    run_info = {
        "library_version": LIBRARY_VERSION, "library_commit": library_commit,
        "cycle": _cycle_dict(cycle),
        "previous_cycle": prep.prev.label,
        "roster": {"first_date": roster.first_date.isoformat(),
                   "last_date": last_date.isoformat(), "people": len(roster.people),
                   "active": len(active), "excluded": len(prep.excluded)},
        "config": {"version": config.version, "seed": config.seed,
                   "digest": _digest(config.to_dict())},
        "seed_used": seed_used, "seed_source": "parameter" if seed is not None else "config",
        "inputs": {"answers_digest": _digest(answers or {}),
                   "pto_entries": len(pto.entries), "pto_entries_excluded": len(pto.excluded_entries),
                   "confirmed_pto": len(confirmed_pto or {}),
                   "holiday_rows": len(holiday_matrix.holidays),
                   "history_supplied": history is not None, "bootstrap": bootstrap},
        "availability": {"enabled": prep.availability.enabled, "reason": prep.availability.reason,
                         "coverage": prep.availability.coverage},
        "year_boundary": _year_boundary(cycle, last_date),
        "segments": [{"start": s.isoformat(), "end": e.isoformat()} for s, e in segments],
        "disconnect_days": len(disconnect),
        "counts": {"edits": len(edits), "remainder_edits": len(remainder),
                   "holiday_edits": len(hol_edits), "pto_edits": len(pto_result.edits),
                   "preserved_leave": len(preserved)},
    }
    return Plan(
        cycle=cycle, edits=edits, remainder_edits=remainder,
        shift_changes=[_shift_change_dict(c) for c in rotated.changes],
        holiday_assignments=assignments,
        flags=sorted(flags, key=_flag_order),
        counters_before=counters_before, counters_after=counters_after,
        config_after=config_out, run_info=run_info, existing_roster_findings=existing,
        next_year_counters=next_year_counters, preserved=preserved)
