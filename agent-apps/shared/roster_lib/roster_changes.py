"""
Step 0 "Roster changes" and the "ask me" list for the rotation step.

`detect_changes(roster_people, config, prev_schedule)` compares the roster file
with the rotation config (names matched with `config.name_key`):
  NEW      in the roster but not in the config, OR in the config but with no
           shift/leave code anywhere in `prev_schedule` (a seat with no history);
  REMOVED  in the config but absent from the roster.

`apply_changes(config, answers, changes, roster_people=None)` -> `AppliedChanges`
(the config is a deep copy; nothing is saved). `answers` JSON, one entry per NEW
name, key = the new person's name (any case/spacing):

    {"<new name>": {"replaces": "<old name>"}}
    {"<new name>": {"new_seat": {"rotation": "PERMANENT|AUTO_SWAP|ASK_ME|UNCLASSIFIED",
                                 "shift": "S3",            # their shift THIS cycle (required)
                                 "pattern": "MON_FRI",     # or WED_SUN; optional (code default)
                                 "team": "Operate",        # required (config team)
                                 "subteam": "DIS",         # optional
                                 "location": "Hyd"}}}      # optional if the roster has the Loc

  replaces   the new person inherits the replaced person's rotation category,
             shift, partner, team and subteam (location comes from the roster).
             The replaced person must be one of the REMOVED people. The seat's
             previous-cycle cells are read from the old person at rotation time
             (`AppliedChanges.replaces`, pass it to `rotation.rotate`), and the
             holiday counter is inherited (`inherited_counters`, same mapping).
  new_seat   a new person; the holiday counter starts at the pool average
             (`pool_average_seats`). `rotation_answers` holds their
             {"shift", "pattern"} ready to merge into the rotation `answers`.

Every REMOVED person is dropped from the config. A new name with no answer raises
`rotation.MissingAnswers`; unusable answers raise `rotation.InvalidAnswers`.

`ask_me_list(config, roster_people, prev_schedule, cycle=None)` lists who the
ask-me form must ask: ASK_ME and UNCLASSIFIED people, people with no previous-cycle
data (category `NEW_SEAT`, unless covered by `replaces`), and AUTO_SWAP people whose
current shift has no partner. `cycle` is the NEW cycle (default: the cycle after the
one containing the last date in `prev_schedule`). Each `AskMeItem` carries the
current shift/pattern so the form can pre-fill it.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Mapping, Sequence

from .codes import counts_as_code, partner_shift
from .config import Person, Rotation, RotationConfig, name_key
from .cycles import Cycle, cycle_containing, next_cycle, previous_cycle
from .roster_io import Person as RosterPerson
from .rotation import InvalidAnswers, MissingAnswers, _read_answer, derive_state

Schedule = Mapping[str, Mapping[date, str]]


@dataclass(frozen=True)
class NewPerson:
    name: str  # as in the roster
    location_code: str
    team_label: str
    section: str
    in_config: bool  # True: already in the config but without any previous-cycle code


@dataclass(frozen=True)
class RemovedPerson:
    name: str  # as in the config
    person: Person


@dataclass
class ChangeSet:
    new: list[NewPerson] = field(default_factory=list)
    removed: list[RemovedPerson] = field(default_factory=list)

    @property
    def is_empty(self) -> bool:
        return not self.new and not self.removed


@dataclass
class AppliedChanges:
    config: RotationConfig
    inherited_counters: dict[str, str] = field(default_factory=dict)  # new name -> old name
    pool_average_seats: set[str] = field(default_factory=set)
    rotation_answers: dict[str, dict[str, str]] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)

    @property
    def replaces(self) -> dict[str, str]:
        """Same pairs as `inherited_counters`; the `replaces` argument of `rotate`."""
        return dict(self.inherited_counters)


@dataclass(frozen=True)
class AskMeItem:
    name: str
    current_shift: str | None  # canonical code, or the custom text; None if unknown
    current_pattern: str | None  # "MON_FRI" / "WED_SUN"; None if unknown
    category: str  # ASK_ME | UNCLASSIFIED | NEW_SEAT | AUTO_SWAP (needs an answer)
    current_text: str | None = None
    reason: str = ""


def _has_codes(cells: Mapping[date, str] | None) -> bool:
    return any(counts_as_code(t) for t in (cells or {}).values())


def detect_changes(
    roster_people: Sequence[RosterPerson], config: RotationConfig, prev_schedule: Schedule
) -> ChangeSet:
    """NEW and REMOVED people; see the module docstring."""
    out = ChangeSet()
    roster_keys = {name_key(p.name) for p in roster_people}
    prev_by_key = {name_key(n): cells for n, cells in prev_schedule.items()}
    for p in roster_people:
        in_config = config.find(p.name) is not None
        if not in_config or not _has_codes(prev_by_key.get(name_key(p.name))):
            out.new.append(NewPerson(p.name, p.location_code, p.team_label, p.section, in_config))
    for cp in config.people:
        if name_key(cp.name) not in roster_keys:
            out.removed.append(RemovedPerson(cp.name, cp))
    return out


def _rotation_of(value: Any) -> Rotation:
    try:
        return Rotation(str(value).strip().upper())
    except ValueError:
        raise ValueError(f"rotation must be one of {', '.join(r.value for r in Rotation)}, "
                         f"got {value!r}") from None


def apply_changes(
    config: RotationConfig,
    answers: Mapping[str, Mapping[str, Any]],
    changes: ChangeSet,
    roster_people: Sequence[RosterPerson] | None = None,
) -> AppliedChanges:
    """Return a new config with removed people dropped and new people added (see docstring)."""
    answers_by_key = {name_key(k): v for k, v in (answers or {}).items()}
    roster_by_key = {name_key(p.name): p for p in roster_people or ()}
    removed_by_key = {name_key(r.name): r for r in changes.removed}

    missing = {n.name: "answer with 'replaces' or 'new_seat'" for n in changes.new
               if name_key(n.name) not in answers_by_key}
    if missing:
        raise MissingAnswers(missing)

    new_config = copy.deepcopy(config)
    applied = AppliedChanges(new_config)
    problems: list[str] = []
    replaced_by: dict[str, str] = {}

    for removed in changes.removed:
        if new_config.find(removed.name) is not None:
            new_config.remove_person(removed.name)

    for new in changes.new:
        answer = answers_by_key[name_key(new.name)]
        roster_person = roster_by_key.get(name_key(new.name))
        raw_location = roster_person.location_code if roster_person else new.location_code
        location = new_config.resolve_location_code(raw_location) if raw_location else None
        label = new.name
        try:
            if "replaces" in answer:
                old_key = name_key(str(answer["replaces"]))
                old = removed_by_key.get(old_key)
                if old is None:
                    raise ValueError(f"replaces {answer['replaces']!r}, who is not a removed person")
                if old_key in replaced_by:
                    raise ValueError(f"{old.name} is already replaced by {replaced_by[old_key]}")
                replaced_by[old_key] = new.name
                fields = dict(team=old.person.team, subteam=old.person.subteam,
                              rotation=old.person.rotation, shift=old.person.shift,
                              location=location or old.person.location)
                _store(new_config, new, fields)
                applied.inherited_counters[new.name] = old.name
                applied.notes.append(f"{new.name} replaces {old.name}: inherits "
                                     f"{old.person.rotation.value} rotation and the holiday counter")
            elif "new_seat" in answer:
                seat = answer["new_seat"]
                if not isinstance(seat, Mapping):
                    raise ValueError("new_seat must be an object")
                rotation = _rotation_of(seat.get("rotation"))
                if not str(seat.get("team") or "").strip():
                    raise ValueError("new_seat needs a 'team'")
                loc = (new_config.resolve_location_code(str(seat["location"]))
                       if seat.get("location") else location)
                if loc is None:
                    raise ValueError("unknown location: give new_seat.location (a code or name)")
                code, pattern, _ = _read_answer(new.name, {"shift": seat.get("shift"),
                                                           "pattern": seat.get("pattern")}, None)
                subteam = str(seat["subteam"]).strip() if seat.get("subteam") else None
                _store(new_config, new, dict(team=str(seat["team"]).strip(), subteam=subteam,
                                             rotation=rotation, shift=code, location=loc))
                applied.pool_average_seats.add(new.name)
                applied.rotation_answers[new.name] = {"shift": code, "pattern": pattern.name}
                applied.notes.append(f"{new.name}: new seat; holiday counter starts at the pool "
                                     "average")
            else:
                raise ValueError("answer must have 'replaces' or 'new_seat'")
        except ValueError as exc:
            problems.append(f"{label}: {exc}")
    if problems:
        raise InvalidAnswers(problems)
    return applied


def _store(config: RotationConfig, new: NewPerson, fields: dict[str, Any]) -> None:
    if new.in_config:
        config.update_person(new.name, **fields)
    else:
        config.add_person(Person(name=new.name, **fields))


def ask_me_list(
    config: RotationConfig,
    roster_people: Sequence[RosterPerson],
    prev_schedule: Schedule,
    cycle: Cycle | None = None,
    replaces: Mapping[str, str] | None = None,
) -> list[AskMeItem]:
    """Who the ask-me form must ask, in roster order; see the module docstring."""
    if cycle is None:
        dates = [d for cells in prev_schedule.values() for d in cells]
        if not dates:
            raise ValueError("cannot infer the cycle from an empty previous schedule")
        cycle = next_cycle(cycle_containing(max(dates)))
    prev = previous_cycle(cycle)
    replaces_by_key = {name_key(k): v for k, v in (replaces or {}).items()}
    names = [p.name for p in roster_people] if roster_people else [p.name for p in config.people]

    def cells_of(name: str) -> dict[date, str]:
        return {d: t for d, t in prev_schedule.get(name, {}).items() if prev.contains(d)}

    items: list[AskMeItem] = []
    for name in names:
        cp = config.find(name)
        if cp is None:
            continue
        state = derive_state(cells_of(name), prev)
        shift = state.label if state else None
        pattern = state.pattern.name if state and state.pattern else None
        text = state.text if state else None
        if state is None:
            old = replaces_by_key.get(name_key(name))
            if old is not None and derive_state(cells_of(old), prev) is not None:
                continue
            items.append(AskMeItem(name, None, None, "NEW_SEAT", None,
                                   "no previous-cycle data"))
        elif cp.rotation in (Rotation.ASK_ME, Rotation.UNCLASSIFIED):
            items.append(AskMeItem(name, shift, pattern, cp.rotation.value, text,
                                   f"{cp.rotation.value} people are asked every cycle"))
        elif cp.rotation is Rotation.AUTO_SWAP and partner_shift(state.code) is None:
            items.append(AskMeItem(name, shift, pattern, cp.rotation.value, text,
                                   f"AUTO_SWAP but {shift} has no partner shift"))
    return items
