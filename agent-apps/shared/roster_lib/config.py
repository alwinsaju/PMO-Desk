"""
Rotation config loader/validator.

The PMO edits this JSON between runs; the program reads it and (when asked)
writes it back deterministically. Schema (version 1):

    {
      "version": 1,
      "location_codes": {"Bengaluru": "Blr", ...},     # optional; default below
      "min_staff": {"DIS": 3, "DEP": 3, "L3": 3, "default": 2},   # keyed by TEAM
      "team_aliases": {"L2": "DIS", "L N S 2.0": "LNS 2.0"},     # roster section -> team
      "excluded_sections": ["Governance"],             # sections the program never touches
      "excluded_section_patterns": ["Leadership", "Governance", "PMO", "Analytics"],
      "disconnect_windows": [{"start": "2026-12-25", "end": "2027-01-01"}],   # ISO dates
      "has_data_threshold": 0.95,                      # share of weeks, (0, 1]
      "seed": 12345,                                   # int, for tie-breaks
      "people": [
        {"name": "Alice Test", "team": "Operate", "subteam": "DIS",   # subteam optional;
                                                 # it is the roster team (section) if given
         "location": "Blr",                      # a location name or its code
         "rotation": "PERMANENT",
         "shift": "S1",                          # optional except for AUTO_SWAP
         "partner": "S2"}                        # AUTO_SWAP only (S1<->S2, S3<->S4)
      ]
    }

`min_staff` is the minimum number of people WORKING per shift code per day, keyed
by TEAM (any key, matched case-insensitively; "default" is required and used for
every team not listed). Default: 3 for DIS, DEP and L3, 2 for every other team.
A per-team override may be any non-negative integer; 0 means "no minimum": the
team is not staffing-checked and holiday fairness lets everyone off a common
holiday. "Per shift" means per team, per shift code, per day, for the shifts
active that day (S2/S4 are not active Mon-Tue); that counting lives in `checks.py`.

`excluded_sections` / `excluded_section_patterns`: people in these roster sections
are NOT part of the rotation, PTO, holiday logic or staffing/HOL checks (the
cycle builder never edits their cells and never lists them as new or removed).
A section is excluded when its title (or its team after `team_aliases`) equals an
`excluded_sections` entry (case/space-insensitive) OR contains one of the
`excluded_section_patterns` as a case-insensitive substring. Defaults: section
"Governance" and the patterns Leadership, Governance, PMO, Analytics; a list in
the file REPLACES the default. `cfg.is_excluded_section(section | roster Person)`.

`disconnect_windows`: inclusive ISO date ranges (December Disconnect) that are
handled outside the program: their days are ignored by the HOL check, by the
holiday counters and by holiday assignment. Default none.
`cfg.disconnect_dates()` returns every date inside any window.

`team_aliases` maps a roster section title (or any raw team text) to the team
name used by `min_staff`; keys match case- and whitespace-insensitively. Default
`{"L2": "DIS"}`. A map given in the file REPLACES the default (so write every
alias you want). A section with no alias is its own team. `cfg.team_of(x)`
resolves a section string, a `roster_io.Person` (its `section`) or a config
`Person` (its `subteam`, else `team`); `cfg.min_staff_for_team(team)` resolves
aliases first, then looks the team up (falling back to "default").

Rotation categories (`Rotation`):
  PERMANENT    copy the shift forward unchanged;
  AUTO_SWAP    flip to the partner shift (S1<->S2, S3<->S4); the weekly-off
               pattern follows the new code (S2/S4 = Wed-Sun, S1/S3 = Mon-Fri);
  ASK_ME       the user is asked what to do for this person;
  UNCLASSIFIED not yet categorised; the user is asked every run.

`load_config` / `parse_config` raise `ConfigError` listing ALL problems found.
Names are matched case- and whitespace-insensitively via `name_key`.
`save_config` writes people sorted by name key with stable key order.
"""

from __future__ import annotations

import json
import unicodedata
from dataclasses import dataclass, field, replace
from datetime import date, timedelta
from enum import Enum
from pathlib import Path
from typing import Any, Mapping

from .codes import DEFAULT_TABLE, Kind, partner_shift, try_parse_code
from .holiday_matrix import DEFAULT_LOCATION_CODES

CONFIG_VERSION = 1
DEFAULT_MIN_STAFF = {"DIS": 3, "DEP": 3, "L3": 3, "default": 2}
DEFAULT_TEAM_ALIASES = {"L2": "DIS"}
DEFAULT_EXCLUDED_SECTIONS = ("Governance",)
DEFAULT_EXCLUDED_SECTION_PATTERNS = ("Leadership", "Governance", "PMO", "Analytics")
DEFAULT_HAS_DATA_THRESHOLD = 0.95
DEFAULT_SEED = 0

_TOP_KEYS = {"version", "location_codes", "min_staff", "team_aliases", "excluded_sections",
             "excluded_section_patterns", "disconnect_windows", "has_data_threshold", "seed",
             "people"}
_PERSON_KEYS = ("name", "team", "subteam", "location", "rotation", "shift", "partner")


@dataclass(frozen=True)
class DateWindow:
    """An inclusive run of dates handled outside the program (December Disconnect)."""

    start: date
    end: date

    def dates(self) -> list[date]:
        return [self.start + timedelta(days=i) for i in range((self.end - self.start).days + 1)]

    def to_dict(self) -> dict[str, str]:
        return {"start": self.start.isoformat(), "end": self.end.isoformat()}


class Rotation(Enum):
    PERMANENT = "PERMANENT"
    AUTO_SWAP = "AUTO_SWAP"
    ASK_ME = "ASK_ME"
    UNCLASSIFIED = "UNCLASSIFIED"


class ConfigError(ValueError):
    """The config is invalid; `problems` lists every issue found."""

    def __init__(self, problems: list[str]):
        super().__init__("Rotation config problems:\n- " + "\n- ".join(problems))
        self.problems = list(problems)


def name_key(name: str) -> str:
    """Case-, whitespace- and unicode-form-insensitive key for matching names."""
    return " ".join(unicodedata.normalize("NFKC", name).split()).casefold()


def _label_key(text: str) -> str:
    """Key for section / team text: same normalisation as `name_key`."""
    return name_key(text)


@dataclass(frozen=True)
class Person:
    name: str
    team: str
    location: str
    rotation: Rotation
    subteam: str | None = None
    shift: str | None = None
    partner: str | None = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for key in _PERSON_KEYS:
            value = getattr(self, key)
            if value is not None:
                out[key] = value.value if isinstance(value, Rotation) else value
        return out


def classify(person: Person) -> Rotation:
    """The person's rotation category."""
    return person.rotation


def next_shift(person: Person) -> str | None:
    """Shift to carry into the next cycle without asking: same (PERMANENT), partner
    (AUTO_SWAP); None when the user must be asked."""
    if person.rotation is Rotation.PERMANENT:
        return person.shift
    if person.rotation is Rotation.AUTO_SWAP:
        return person.partner
    return None


def _shift_code(value: Any) -> str | None:
    """Canonical code for a shift-kind value, else None."""
    if not isinstance(value, str):
        return None
    parsed = try_parse_code(value)
    if parsed is None or DEFAULT_TABLE[parsed.canonical].kind is not Kind.SHIFT:
        return None
    return parsed.canonical


@dataclass
class RotationConfig:
    people: list[Person] = field(default_factory=list)
    location_codes: dict[str, str] = field(default_factory=lambda: dict(DEFAULT_LOCATION_CODES))
    min_staff: dict[str, int] = field(default_factory=lambda: dict(DEFAULT_MIN_STAFF))
    team_aliases: dict[str, str] = field(default_factory=lambda: dict(DEFAULT_TEAM_ALIASES))
    excluded_sections: list[str] = field(default_factory=lambda: list(DEFAULT_EXCLUDED_SECTIONS))
    excluded_section_patterns: list[str] = field(
        default_factory=lambda: list(DEFAULT_EXCLUDED_SECTION_PATTERNS))
    disconnect_windows: list[DateWindow] = field(default_factory=list)
    has_data_threshold: float = DEFAULT_HAS_DATA_THRESHOLD
    seed: int = DEFAULT_SEED
    version: int = CONFIG_VERSION

    # -- lookups ---------------------------------------------------------------
    def find(self, name: str) -> Person | None:
        key = name_key(name)
        return next((p for p in self.people if name_key(p.name) == key), None)

    def resolve_location_code(self, location: str) -> str | None:
        """Roster code for a location given as a name or a code (case-insensitive)."""
        wanted = location.strip().casefold()
        for loc_name, code in self.location_codes.items():
            if wanted in (loc_name.casefold(), code.casefold()):
                return code
        return None

    def people_by_rotation(self, rotation: Rotation) -> list[Person]:
        return [p for p in self.people if p.rotation is rotation]

    def team_of(self, subject: Any) -> str | None:
        """Team name for a section title (str), a `roster_io.Person` (its `section`) or a
        config `Person` (its `subteam`, else `team`), after `team_aliases`. None if the
        subject carries no text."""
        if isinstance(subject, str):
            text = subject
        elif hasattr(subject, "section"):
            text = subject.section
        else:
            text = getattr(subject, "subteam", None) or getattr(subject, "team", None)
        if not isinstance(text, str) or not text.strip():
            return None
        key = _label_key(text)
        for alias, team in self.team_aliases.items():
            if _label_key(alias) == key:
                return team
        return " ".join(text.split())

    def is_excluded_section(self, subject: Any) -> bool:
        """True if the section (a title, a `roster_io.Person` or a config `Person`) is
        excluded by `excluded_sections` / `excluded_section_patterns` (see docstring)."""
        if isinstance(subject, str):
            text = subject
        elif hasattr(subject, "section"):
            text = subject.section
        else:
            text = getattr(subject, "subteam", None) or getattr(subject, "team", None)
        if not isinstance(text, str) or not text.strip():
            return False
        candidates = {_label_key(text), _label_key(self.team_of(text) or text)}
        if candidates & {_label_key(s) for s in self.excluded_sections}:
            return True
        patterns = [_label_key(p) for p in self.excluded_section_patterns if p.strip()]
        return any(pat in c for pat in patterns for c in candidates)

    def disconnect_dates(self) -> frozenset[date]:
        """Every date inside any `disconnect_windows` entry."""
        return frozenset(d for w in self.disconnect_windows for d in w.dates())

    def min_staff_for_team(self, team: str | None) -> int:
        """Minimum people working per shift per day for a team (aliases resolved; teams
        not listed use "default")."""
        resolved = self.team_of(team) if team is not None else None
        if resolved is not None:
            key = _label_key(resolved)
            for name, value in self.min_staff.items():
                if name != "default" and _label_key(name) == key:
                    return value
        return self.min_staff["default"]

    def min_staff_for(self, subteam: str | None) -> int:
        """Backward-compatible name for `min_staff_for_team`."""
        return self.min_staff_for_team(subteam)

    # -- editing -----------------------------------------------------------------
    def add_person(self, person: Person) -> Person:
        """Validate and add; raises ConfigError if invalid or the name already exists."""
        problems = self._person_problems(person, "new person")
        if self.find(person.name) is not None:
            problems.append(f"new person: name {person.name!r} already exists")
        if problems:
            raise ConfigError(problems)
        normalized = self._normalized(person)
        self.people.append(normalized)
        return normalized

    def update_person(self, name: str, /, **changes: Any) -> Person:
        """Replace fields of an existing person (looked up by `name_key`)."""
        current = self.find(name)
        if current is None:
            raise ConfigError([f"unknown person {name!r}"])
        bad = set(changes) - set(_PERSON_KEYS)
        if bad:
            raise ConfigError([f"unknown person field(s): {', '.join(sorted(bad))}"])
        if isinstance(changes.get("rotation"), str):
            try:
                changes["rotation"] = Rotation(changes["rotation"].strip().upper())
            except ValueError:
                raise ConfigError([f"{name}: invalid rotation {changes['rotation']!r}"]) from None
        # The partner is derived from the shift, so never let a stale one survive an edit.
        changes.setdefault("partner", None)
        updated = replace(current, **changes)
        problems = self._person_problems(updated, current.name)
        if (name_key(updated.name) != name_key(current.name)
                and self.find(updated.name) is not None):
            problems.append(f"{current.name}: new name {updated.name!r} already exists")
        if problems:
            raise ConfigError(problems)
        updated = self._normalized(updated)
        self.people[self.people.index(current)] = updated
        return updated

    def remove_person(self, name: str) -> Person:
        current = self.find(name)
        if current is None:
            raise ConfigError([f"unknown person {name!r}"])
        self.people.remove(current)
        return current

    # -- serialisation -----------------------------------------------------------
    def to_dict(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "location_codes": dict(sorted(self.location_codes.items())),
            "min_staff": {**dict(sorted((k, v) for k, v in self.min_staff.items()
                                        if k != "default")),
                          "default": self.min_staff["default"]},
            "team_aliases": dict(sorted(self.team_aliases.items(),
                                        key=lambda kv: (_label_key(kv[0]), kv[0]))),
            "excluded_sections": sorted(self.excluded_sections,
                                        key=lambda v: (_label_key(v), v)),
            "excluded_section_patterns": sorted(self.excluded_section_patterns,
                                                key=lambda v: (_label_key(v), v)),
            "disconnect_windows": [w.to_dict() for w in sorted(
                self.disconnect_windows, key=lambda w: (w.start, w.end))],
            "has_data_threshold": self.has_data_threshold,
            "seed": self.seed,
            "people": [p.to_dict() for p in sorted(self.people,
                                                   key=lambda p: (name_key(p.name), p.name))],
        }

    # -- validation helpers --------------------------------------------------------
    def _person_problems(self, p: Person, label: str) -> list[str]:
        problems: list[str] = []
        if not isinstance(p.name, str) or not p.name.strip():
            problems.append(f"{label}: name is required")
        if not isinstance(p.team, str) or not p.team.strip():
            problems.append(f"{label}: team is required")
        if p.subteam is not None and (not isinstance(p.subteam, str) or not p.subteam.strip()):
            problems.append(f"{label}: subteam must be a non-empty string when given")
        if not isinstance(p.location, str) or self.resolve_location_code(p.location) is None:
            problems.append(f"{label}: unknown location {p.location!r} "
                            f"(known: {', '.join(self.location_codes)})")
        if not isinstance(p.rotation, Rotation):
            problems.append(f"{label}: invalid rotation {p.rotation!r}")
            return problems
        if p.shift is not None and _shift_code(p.shift) is None:
            problems.append(f"{label}: invalid shift {p.shift!r}")
        if p.rotation is Rotation.AUTO_SWAP:
            shift = _shift_code(p.shift)
            if shift is None:
                problems.append(f"{label}: AUTO_SWAP needs a shift of S1, S2, S3 or S4")
            elif partner_shift(shift) is None:
                problems.append(f"{label}: AUTO_SWAP shift {shift} has no partner "
                                "(only S1<->S2 and S3<->S4 swap)")
            elif p.partner is not None and _shift_code(p.partner) != partner_shift(shift):
                problems.append(f"{label}: partner {p.partner!r} does not match shift {shift} "
                                f"(expected {partner_shift(shift)})")
        elif p.partner is not None:
            problems.append(f"{label}: partner is only valid for AUTO_SWAP")
        return problems

    def _normalized(self, p: Person) -> Person:
        """Canonicalise names' whitespace, shift/partner codes and location text."""
        shift = _shift_code(p.shift) if p.shift is not None else None
        partner = None
        if p.rotation is Rotation.AUTO_SWAP and shift:
            partner = partner_shift(shift)
        return replace(
            p,
            name=" ".join(p.name.split()),
            team=p.team.strip(),
            subteam=p.subteam.strip() if p.subteam else None,
            location=p.location.strip(),
            shift=shift,
            partner=partner,
        )


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _string_list(raw: Any, label: str, problems: list[str], fallback: list[str]) -> list[str]:
    """A list of non-empty, distinct (case/space-insensitive) strings."""
    if not isinstance(raw, list) or not all(isinstance(v, str) and v.strip() for v in raw):
        problems.append(f"{label} must be a list of non-empty strings")
        return fallback
    cleaned = [" ".join(v.split()) for v in raw]
    keys = [_label_key(v) for v in cleaned]
    if len(set(keys)) != len(keys):
        problems.append(f"{label} has duplicate entries (matched case-insensitively)")
    return cleaned


def _windows(raw: Any, problems: list[str]) -> list[DateWindow]:
    if not isinstance(raw, list):
        problems.append('disconnect_windows must be a list of {"start", "end"} objects')
        return []
    out: list[DateWindow] = []
    for i, entry in enumerate(raw, start=1):
        label = f"disconnect_windows[{i}]"
        if not isinstance(entry, dict) or set(entry) != {"start", "end"}:
            problems.append(f"{label}: must be an object with exactly 'start' and 'end'")
            continue
        try:
            start, end = (date.fromisoformat(entry[k]) for k in ("start", "end"))
        except (TypeError, ValueError):
            problems.append(f"{label}: start and end must be ISO dates (YYYY-MM-DD)")
            continue
        if end < start:
            problems.append(f"{label}: end {entry['end']} is before start {entry['start']}")
            continue
        out.append(DateWindow(start, end))
    ordered = sorted(out, key=lambda w: (w.start, w.end))
    for a, b in zip(ordered, ordered[1:]):
        if b.start <= a.end:
            problems.append(f"disconnect_windows overlap: {a.start}..{a.end} and {b.start}..{b.end}")
    return out


def parse_config(data: Any) -> RotationConfig:
    """Validate a decoded JSON document into a `RotationConfig` (all problems at once)."""
    problems: list[str] = []
    if not isinstance(data, dict):
        raise ConfigError(["top level must be a JSON object"])
    for key in sorted(set(data) - _TOP_KEYS):
        problems.append(f"unknown top-level key {key!r}")

    version = data.get("version")
    if version != CONFIG_VERSION or not _is_int(version):
        problems.append(f"version must be {CONFIG_VERSION}, got {version!r}")

    location_codes = dict(DEFAULT_LOCATION_CODES)
    if "location_codes" in data:
        raw = data["location_codes"]
        if (not isinstance(raw, dict) or not raw
                or not all(isinstance(k, str) and k.strip() and isinstance(v, str) and v.strip()
                           for k, v in raw.items())):
            problems.append("location_codes must be a non-empty object of name -> code strings")
        else:
            codes_lower = [v.casefold() for v in raw.values()]
            if len(set(codes_lower)) != len(codes_lower):
                problems.append("location_codes has duplicate codes")
            location_codes = dict(raw)

    min_staff = dict(DEFAULT_MIN_STAFF)
    if "min_staff" in data:
        raw = data["min_staff"]
        if not isinstance(raw, dict):
            problems.append("min_staff must be an object")
        else:
            if "default" not in raw:
                problems.append("min_staff must include a 'default' entry")
            for k, v in raw.items():
                if not _is_int(v) or v < 0:
                    problems.append(f"min_staff[{k!r}] must be a non-negative integer, got {v!r}")
            lowered = [k.casefold() for k in raw if isinstance(k, str)]
            if len(set(lowered)) != len(lowered):
                problems.append("min_staff has duplicate team keys (keys are case-insensitive)")
            min_staff = dict(raw)

    team_aliases = dict(DEFAULT_TEAM_ALIASES)
    if "team_aliases" in data:
        raw = data["team_aliases"]
        if (not isinstance(raw, dict)
                or not all(isinstance(k, str) and k.strip() and isinstance(v, str) and v.strip()
                           for k, v in raw.items())):
            problems.append("team_aliases must be an object of section -> team strings")
        else:
            keys = [_label_key(k) for k in raw]
            if len(set(keys)) != len(keys):
                problems.append("team_aliases has duplicate sections (keys match "
                                "case- and whitespace-insensitively)")
            team_aliases = {k: " ".join(v.split()) for k, v in raw.items()}

    excluded_sections = list(DEFAULT_EXCLUDED_SECTIONS)
    if "excluded_sections" in data:
        excluded_sections = _string_list(data["excluded_sections"], "excluded_sections", problems,
                                         excluded_sections)
    patterns = list(DEFAULT_EXCLUDED_SECTION_PATTERNS)
    if "excluded_section_patterns" in data:
        patterns = _string_list(data["excluded_section_patterns"], "excluded_section_patterns",
                                problems, patterns)
    windows: list[DateWindow] = []
    if "disconnect_windows" in data:
        windows = _windows(data["disconnect_windows"], problems)

    threshold = data.get("has_data_threshold", DEFAULT_HAS_DATA_THRESHOLD)
    if (isinstance(threshold, bool) or not isinstance(threshold, (int, float))
            or not 0 < threshold <= 1):
        problems.append(f"has_data_threshold must be a number in (0, 1], got {threshold!r}")
        threshold = DEFAULT_HAS_DATA_THRESHOLD

    seed = data.get("seed", DEFAULT_SEED)
    if not _is_int(seed):
        problems.append(f"seed must be an integer, got {seed!r}")
        seed = DEFAULT_SEED

    cfg = RotationConfig(
        people=[], location_codes=location_codes,
        min_staff=min_staff if "default" in min_staff else {**min_staff, "default": 2},
        team_aliases=team_aliases, excluded_sections=excluded_sections,
        excluded_section_patterns=patterns, disconnect_windows=windows,
        has_data_threshold=float(threshold), seed=seed,
        version=CONFIG_VERSION,
    )

    raw_people = data.get("people")
    if not isinstance(raw_people, list):
        problems.append("people must be a list")
        raw_people = []
    seen: dict[str, int] = {}
    for i, entry in enumerate(raw_people, start=1):
        label = f"people[{i}]"
        if not isinstance(entry, dict):
            problems.append(f"{label}: must be an object")
            continue
        if isinstance(entry.get("name"), str) and entry["name"].strip():
            label = f"people[{i}] ({entry['name'].strip()})"
        for key in sorted(set(entry) - set(_PERSON_KEYS)):
            problems.append(f"{label}: unknown field {key!r}")
        rotation_raw = entry.get("rotation")
        rotation = None
        if isinstance(rotation_raw, str):
            try:
                rotation = Rotation(rotation_raw.strip().upper())
            except ValueError:
                pass
        if rotation is None:
            problems.append(f"{label}: rotation must be one of "
                            f"{', '.join(r.value for r in Rotation)}, got {rotation_raw!r}")
            rotation = Rotation.UNCLASSIFIED  # keep going to report other problems
        person = Person(
            name=entry.get("name") if isinstance(entry.get("name"), str) else "",
            team=entry.get("team") if isinstance(entry.get("team"), str) else "",
            location=entry.get("location") if isinstance(entry.get("location"), str) else "",
            rotation=rotation,
            subteam=entry.get("subteam"),
            shift=entry.get("shift"),
            partner=entry.get("partner"),
        )
        person_problems = cfg._person_problems(person, label)
        problems.extend(person_problems)
        if person.name.strip():
            key = name_key(person.name)
            if key in seen:
                problems.append(f"{label}: duplicate name (same as people[{seen[key]}])")
            else:
                seen[key] = i
        if not person_problems:
            cfg.people.append(cfg._normalized(person))

    if problems:
        raise ConfigError(problems)
    return cfg


def load_config(path: str | Path) -> RotationConfig:
    """Read and validate a rotation config file."""
    path = Path(path)
    try:
        text = path.read_text(encoding="utf-8-sig")
    except OSError as exc:
        raise ConfigError([f"cannot read {path}: {exc}"]) from exc
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ConfigError([f"{path} is not valid JSON: {exc}"]) from exc
    return parse_config(data)


def save_config(config: RotationConfig, path: str | Path) -> Path:
    """Write the config deterministically (sorted people, fixed key order, 2-space indent, LF)."""
    # Re-validate by round-tripping so a bad in-memory edit can never be saved.
    data = config.to_dict()
    parse_config(data)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    return path
