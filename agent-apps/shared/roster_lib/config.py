"""
Rotation config loader/validator.

The PMO edits this JSON between runs; the program reads it and (when asked)
writes it back deterministically. Schema (version 1):

    {
      "version": 1,
      "location_codes": {"Bengaluru": "Blr", ...},     # optional; default below
      "min_staff": {"DIS": 3, "DEP": 3, "L3": 3, "default": 2},
      "has_data_threshold": 0.95,                      # share of weeks, (0, 1]
      "seed": 12345,                                   # int, for tie-breaks
      "people": [
        {"name": "Alice Test", "team": "Operate", "subteam": "DIS",   # subteam optional
         "location": "Blr",                      # a location name or its code
         "rotation": "PERMANENT",
         "shift": "S1",                          # optional except for AUTO_SWAP
         "partner": "S2"}                        # AUTO_SWAP only (S1<->S2, S3<->S4)
      ]
    }

`min_staff` is the default minimum people per shift per day, keyed by subteam
(any key; "default" is required and used for everything not listed).

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
from enum import Enum
from pathlib import Path
from typing import Any, Mapping

from .codes import DEFAULT_TABLE, Kind, partner_shift, try_parse_code
from .holiday_matrix import DEFAULT_LOCATION_CODES

CONFIG_VERSION = 1
DEFAULT_MIN_STAFF = {"DIS": 3, "DEP": 3, "L3": 3, "default": 2}
DEFAULT_HAS_DATA_THRESHOLD = 0.95
DEFAULT_SEED = 0

_TOP_KEYS = {"version", "location_codes", "min_staff", "has_data_threshold", "seed", "people"}
_PERSON_KEYS = ("name", "team", "subteam", "location", "rotation", "shift", "partner")


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

    def min_staff_for(self, subteam: str | None) -> int:
        if subteam is not None:
            for key, value in self.min_staff.items():
                if key.casefold() == subteam.casefold() and key != "default":
                    return value
        return self.min_staff["default"]

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
            min_staff = dict(raw)

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
