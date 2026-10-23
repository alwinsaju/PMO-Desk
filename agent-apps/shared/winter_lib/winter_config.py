"""
Winter-coverage (December Disconnect) configuration: schema, loader, validator.

Everything the PMO may change from one year to the next is an INPUT here, never
hard-coded: the window dates, the per-team rules table, the objective weights,
who is excluded, who is unavailable on which day and the solver settings.

Schema (version 1; every key but `version`, `window` and `teams` is optional)

    {
      "version": 1,
      "window": {"start": "2026-12-25", "end": "2027-01-01"},          # inclusive
      "holidays": {"2026-12-25": "Christmas", "2027-01-01": "New Year"},   # day labels
      "weekend_label": "Weekend", "default_day_label": "Winter Disconnect",
      "fair_days": ["2026-12-25", "2026-12-26", "2026-12-27", "2027-01-01"],  # default: holidays + weekend days
      "teams": [                      # order = display order
        {"name": "DIS", "label": "DIS (L2)", "min_per_day": 2, "best_effort": false},
        {"name": "L3",  "min_per_day": 0, "best_effort": true},          # best effort: no minimum
        ...
      ],
      "team_aliases":   {"L2": "DIS"},                        # shift-roster section -> team
      "staff_team_map": {"DIS L2": "DIS", "Device": "Device Support"},   # staff-roster label -> team
      "subteams": ["Complaints", "Loyalty"],                  # roster team-column labels that are sub-teams
      "rules": {"min_days": 3, "max_days": 5, "best_effort_max_days": 3},
      "exclusions": {"team_patterns": ["Leadership", "Governance", "PMO", "Analytics"],
                     "people": ["Name"], "name_patterns": []},
      "availability": {"Name": {"unavailable": ["2026-12-25", "2026-12-26..2026-12-27"]},
                       "Other": {"allowed": ["2026-12-28..2026-12-31"]}},
      "shift_overrides": {"Name": "S1"},          # usual shift when history is missing / wrong
      "default_new_person_shift": null,           # e.g. "S1": used (with a warning) for needs_shift people
      "name_aliases": {"Staff Name": "Shift Roster Name"},     # confirmed name spelling differences
      "lookback_months": 4,                       # usual shift = modal shift over the N months before the window
      "weights": {...},                           # see `Weights`
      "solver": {"time_limit_s": 120, "mip_rel_gap": 0.0, "seed": 20261225}
    }

Rules semantics
  - `min_per_day` (int >= 0): people required on shift on every day of the window. A shortfall is
    penalised (weights.shortfall x day weight) and reported, never silently accepted.
  - `best_effort: true`: no minimum is demanded; a day with nobody costs weights.best_effort_nobody x day
    weight. The members of such a team work at most `best_effort_max_days` (3) days: no extra days are added.
  - `rules.min_days`: every person works at least this many days; `max_days` is the hard ceiling; days beyond
    min_days cost weights.extra_day[k] (the 4th, the 5th) and are only worth it when a team needs the slot.
  - A per-team `max_days` overrides the ceiling for that team.
Day weights: weekday 3, a holiday (Dec 25 / Jan 1) 2, a weekend day 1 (weights.day_weight).

`load_config` / `parse_config` raise `ConfigError` listing ALL problems found. `save_config` writes
deterministically. `cfg.config_hash()` is the sha256 of the canonical JSON.

Names in `exclusions.people`, `availability`, `shift_overrides` and `name_aliases` are matched case-,
whitespace- and unicode-form-insensitively (`roster_lib.config.name_key`). A real configuration holds real
names, so keep it out of git (the repo ignores `agent-apps/**/config/`); the example uses synthetic names.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Mapping, Optional, Union

from roster_lib.codes import DEFAULT_TABLE, Kind, try_parse_code
from roster_lib.config import name_key

CONFIG_VERSION = 1
DEFAULT_TEAM_ALIASES = {"L2": "DIS", "L N S 2.0": "LNS 2.0"}
DEFAULT_EXCLUDED_TEAM_PATTERNS = ("Leadership", "Governance", "PMO", "Analytics")
MAX_WINDOW_DAYS = 31


class ConfigError(ValueError):
    """The configuration is invalid; `problems` lists every issue found."""

    def __init__(self, problems: list[str]):
        super().__init__("; ".join(problems))
        self.problems = list(problems)


def label_key(text: str) -> str:
    return name_key(text)


@dataclass(frozen=True)
class TeamRule:
    name: str
    label: str  # shown in the workbook, e.g. "DIS (L2)"
    min_per_day: int
    best_effort: bool
    max_days: Optional[int] = None  # None -> rules.max_days (or best_effort_max_days)


@dataclass(frozen=True)
class Weights:
    shortfall: float = 1000.0
    best_effort_nobody: float = 100.0
    day_weekday: float = 3.0
    day_holiday: float = 2.0
    day_weekend: float = 1.0
    extra_day: tuple[float, ...] = (400.0, 600.0)  # cost of the 4th, the 5th day
    lane: float = 60.0
    subteam: float = 40.0
    fairness: float = 5.0
    block: float = 1.0
    stability: float = 30.0
    days_shortfall: float = 5000.0  # a person below min_days (only when availability makes it unavoidable)

    def to_dict(self) -> dict[str, Any]:
        return {
            "shortfall": self.shortfall,
            "best_effort_nobody": self.best_effort_nobody,
            "day_weight": {"weekday": self.day_weekday, "holiday": self.day_holiday, "weekend": self.day_weekend},
            "extra_day": list(self.extra_day),
            "lane": self.lane,
            "subteam": self.subteam,
            "fairness": self.fairness,
            "block": self.block,
            "stability": self.stability,
            "days_shortfall": self.days_shortfall,
        }


@dataclass(frozen=True)
class Availability:
    unavailable: frozenset[date] = frozenset()
    allowed: Optional[frozenset[date]] = None  # None = every day not unavailable

    def is_available(self, d: date) -> bool:
        if d in self.unavailable:
            return False
        return self.allowed is None or d in self.allowed


@dataclass(frozen=True)
class WinterConfig:
    start: date
    end: date
    holidays: Mapping[date, str]
    weekend_label: str
    default_day_label: str
    fair_days: tuple[date, ...]
    teams: tuple[TeamRule, ...]
    team_aliases: Mapping[str, str]
    staff_team_map: Mapping[str, str]
    subteams: tuple[str, ...]
    min_days: int
    max_days: int
    best_effort_max_days: int
    excluded_team_patterns: tuple[str, ...]
    excluded_people: tuple[str, ...]
    excluded_name_patterns: tuple[str, ...]
    availability: Mapping[str, Availability]  # keyed by name_key
    shift_overrides: Mapping[str, str]  # name_key -> canonical code
    default_new_person_shift: Optional[str]
    name_aliases: Mapping[str, str]  # name_key(staff name) -> shift-roster name (as given)
    lookback_months: int
    weights: Weights
    time_limit_s: float
    mip_rel_gap: float
    seed: int
    fair_min: int = 1
    fair_max: int = 2
    raw: Mapping[str, Any] = field(default_factory=dict, compare=False, hash=False, repr=False)

    # -- window -----------------------------------------------------------

    @property
    def days(self) -> tuple[date, ...]:
        return tuple(self.start + timedelta(days=i) for i in range((self.end - self.start).days + 1))

    def is_weekend(self, d: date) -> bool:
        return d.weekday() >= 5

    def day_label(self, d: date) -> str:
        if d in self.holidays:
            return self.holidays[d]
        if self.is_weekend(d):
            return self.weekend_label
        return self.default_day_label

    def day_weight(self, d: date) -> float:
        if d in self.holidays:
            return self.weights.day_holiday
        if self.is_weekend(d):
            return self.weights.day_weekend
        return self.weights.day_weekday

    def lookback_range(self) -> tuple[date, date]:
        """(first, last) day of the usual-shift lookback; it ends the day BEFORE the window starts."""
        return add_months(self.start, -self.lookback_months), self.start - timedelta(days=1)

    # -- teams ------------------------------------------------------------

    @property
    def team_names(self) -> tuple[str, ...]:
        return tuple(t.name for t in self.teams)

    def team(self, name: str) -> TeamRule:
        for t in self.teams:
            if t.name == name:
                return t
        raise KeyError(name)

    def max_days_for(self, team: str) -> int:
        t = self.team(team)
        if t.max_days is not None:
            return t.max_days
        return self.best_effort_max_days if t.best_effort else self.max_days

    def resolve_team(self, raw: Optional[str]) -> Optional[str]:
        """Team name for a roster section / staff-roster team label, or None when it is not a winter team."""
        if raw is None or not str(raw).strip():
            return None
        k = label_key(str(raw))
        for lab, team in self.staff_team_map.items():
            if label_key(lab) == k:
                return team
        for lab, team in self.team_aliases.items():
            if label_key(lab) == k:
                return team
        for t in self.teams:
            if label_key(t.name) == k or label_key(t.label) == k:
                return t.name
        return None

    def is_excluded_label(self, raw: Optional[str]) -> bool:
        if raw is None:
            return False
        low = str(raw).casefold()
        return any(p.casefold() in low for p in self.excluded_team_patterns)

    def is_excluded_name(self, name: str) -> bool:
        k = name_key(name)
        if any(name_key(n) == k for n in self.excluded_people):
            return True
        low = name.casefold()
        return any(p.casefold() in low for p in self.excluded_name_patterns)

    def available_dates(self, name: str) -> tuple[date, ...]:
        av = self.availability.get(name_key(name))
        if av is None:
            return self.days
        return tuple(d for d in self.days if av.is_available(d))

    # -- serialisation ----------------------------------------------------

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "version": CONFIG_VERSION,
            "window": {"start": self.start.isoformat(), "end": self.end.isoformat()},
            "holidays": {d.isoformat(): v for d, v in sorted(self.holidays.items())},
            "weekend_label": self.weekend_label,
            "default_day_label": self.default_day_label,
            "fair_days": [d.isoformat() for d in self.fair_days],
            "fair_range": {"min": self.fair_min, "max": self.fair_max},
            "teams": [
                {k: v for k, v in {
                    "name": t.name, "label": t.label, "min_per_day": t.min_per_day,
                    "best_effort": t.best_effort, "max_days": t.max_days}.items() if v is not None}
                for t in self.teams
            ],
            "team_aliases": dict(self.team_aliases),
            "staff_team_map": dict(self.staff_team_map),
            "subteams": list(self.subteams),
            "rules": {"min_days": self.min_days, "max_days": self.max_days,
                      "best_effort_max_days": self.best_effort_max_days},
            "exclusions": {"team_patterns": list(self.excluded_team_patterns),
                           "people": list(self.excluded_people),
                           "name_patterns": list(self.excluded_name_patterns)},
            "availability": {
                k: {kk: vv for kk, vv in {
                    "unavailable": [d.isoformat() for d in sorted(v.unavailable)] or None,
                    "allowed": None if v.allowed is None else [d.isoformat() for d in sorted(v.allowed)],
                }.items() if vv is not None}
                for k, v in sorted(self.availability.items())
            },
            "shift_overrides": dict(sorted(self.shift_overrides.items())),
            "default_new_person_shift": self.default_new_person_shift,
            "name_aliases": dict(self.name_aliases),
            "lookback_months": self.lookback_months,
            "weights": self.weights.to_dict(),
            "solver": {"time_limit_s": self.time_limit_s, "mip_rel_gap": self.mip_rel_gap, "seed": self.seed},
        }
        return out

    def config_hash(self) -> str:
        return hashlib.sha256(
            json.dumps(self.to_dict(), sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        ).hexdigest()


# ---------------------------------------------------------------------------
# helpers


def add_months(d: date, months: int) -> date:
    """`d` shifted by whole months (day clipped to the target month's length)."""
    idx = d.year * 12 + (d.month - 1) + months
    y, m = divmod(idx, 12)
    m += 1
    for day in (d.day, 30, 29, 28):
        try:
            return date(y, m, day)
        except ValueError:
            continue
    raise ValueError("unreachable")  # pragma: no cover


_RANGE = re.compile(r"^\s*(\d{4}-\d{2}-\d{2})\s*(?:\.\.|/|to)\s*(\d{4}-\d{2}-\d{2})\s*$")


def _parse_date(text: Any, where: str, problems: list[str]) -> Optional[date]:
    try:
        return date.fromisoformat(str(text).strip())
    except ValueError:
        problems.append(f"{where}: {text!r} is not an ISO date (YYYY-MM-DD)")
        return None


def _parse_dates(items: Any, where: str, problems: list[str]) -> set[date]:
    out: set[date] = set()
    if not isinstance(items, list):
        problems.append(f"{where}: expected a list of dates or 'start..end' ranges")
        return out
    for it in items:
        m = _RANGE.match(str(it))
        if m:
            a, b = _parse_date(m.group(1), where, problems), _parse_date(m.group(2), where, problems)
            if a and b:
                if b < a:
                    problems.append(f"{where}: range {it!r} ends before it starts")
                else:
                    out.update(a + timedelta(days=i) for i in range((b - a).days + 1))
        else:
            d = _parse_date(it, where, problems)
            if d:
                out.add(d)
    return out


def _num(value: Any, where: str, problems: list[str], *, minimum: float = 0.0, integer: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        problems.append(f"{where}: expected a number, got {value!r}")
        return minimum
    if value < minimum:
        problems.append(f"{where}: must be >= {minimum}, got {value}")
    if integer and int(value) != value:
        problems.append(f"{where}: must be a whole number, got {value}")
    return int(value) if integer else float(value)


def _canonical_shift(text: Any, where: str, problems: list[str]) -> Optional[str]:
    parsed = try_parse_code(None if text is None else str(text))
    info = DEFAULT_TABLE.get(parsed.canonical) if parsed else None
    if parsed is None or info is None or info.kind is not Kind.SHIFT:
        problems.append(f"{where}: {text!r} is not a shift code (S1-S5, NS, US-CST, US-PST, 11AM-8PM, MX-8-5)")
        return None
    return parsed.canonical


_TOP = {"version", "window", "holidays", "weekend_label", "default_day_label", "fair_days", "fair_range", "teams",
        "team_aliases", "staff_team_map", "subteams", "rules", "exclusions", "availability", "shift_overrides",
        "default_new_person_shift", "name_aliases", "lookback_months", "weights", "solver"}


def parse_config(data: Mapping[str, Any]) -> WinterConfig:
    problems: list[str] = []
    if not isinstance(data, Mapping):
        raise ConfigError(["the configuration must be a JSON object"])
    unknown = sorted(set(data) - _TOP)
    if unknown:
        problems.append(f"unknown top-level keys: {unknown}")
    if data.get("version") != CONFIG_VERSION:
        problems.append(f"version must be {CONFIG_VERSION}, got {data.get('version')!r}")

    # window
    win = data.get("window") or {}
    start = _parse_date(win.get("start"), "window.start", problems) if win.get("start") else None
    end = _parse_date(win.get("end"), "window.end", problems) if win.get("end") else None
    if not win.get("start") or not win.get("end"):
        problems.append("window.start and window.end are required")
    if start and end:
        if end < start:
            problems.append("window.end is before window.start")
        elif (end - start).days + 1 > MAX_WINDOW_DAYS:
            problems.append(f"window is longer than {MAX_WINDOW_DAYS} days")
    start = start or date(2000, 1, 1)
    end = end if (end and end >= start) else start
    window_days = {start + timedelta(days=i) for i in range((end - start).days + 1)}

    # day labels
    if "holidays" in data:
        hol_raw = data["holidays"]
        holidays: dict[date, str] = {}
        if not isinstance(hol_raw, Mapping):
            problems.append("holidays: expected {date: label}")
        else:
            for k, v in hol_raw.items():
                d = _parse_date(k, "holidays", problems)
                if d:
                    if d not in window_days:
                        problems.append(f"holidays: {k} is outside the window")
                    holidays[d] = str(v)
    else:
        holidays = {}
        for d in sorted(window_days):
            if (d.month, d.day) == (12, 25):
                holidays[d] = "Christmas"
            elif (d.month, d.day) == (1, 1):
                holidays[d] = "New Year"
    weekend_label = str(data.get("weekend_label", "Weekend"))
    default_label = str(data.get("default_day_label", "Winter Disconnect"))

    if "fair_days" in data:
        fair = sorted(_parse_dates(data["fair_days"], "fair_days", problems))
        for d in fair:
            if d not in window_days:
                problems.append(f"fair_days: {d} is outside the window")
    else:
        fair = sorted(d for d in window_days if d in holidays or d.weekday() >= 5)
    fr = data.get("fair_range", {})
    fair_min = int(_num(fr.get("min", 1), "fair_range.min", problems, integer=True))
    fair_max = int(_num(fr.get("max", 2), "fair_range.max", problems, integer=True))
    if fair_max < fair_min:
        problems.append("fair_range.max is below fair_range.min")

    # teams
    teams: list[TeamRule] = []
    seen: set[str] = set()
    teams_raw = data.get("teams")
    if not isinstance(teams_raw, list) or not teams_raw:
        problems.append("teams: a non-empty list of team rules is required")
        teams_raw = []
    for i, t in enumerate(teams_raw):
        where = f"teams[{i}]"
        if not isinstance(t, Mapping) or not str(t.get("name", "")).strip():
            problems.append(f"{where}: each team needs a name")
            continue
        name = str(t["name"]).strip()
        if label_key(name) in seen:
            problems.append(f"{where}: duplicate team {name!r}")
        seen.add(label_key(name))
        bad = sorted(set(t) - {"name", "label", "min_per_day", "best_effort", "max_days"})
        if bad:
            problems.append(f"{where} ({name}): unknown keys {bad}")
        best = bool(t.get("best_effort", False))
        if "best_effort" in t and not isinstance(t["best_effort"], bool):
            problems.append(f"{where} ({name}): best_effort must be true or false")
        mpd = int(_num(t.get("min_per_day", 0), f"{where} ({name}).min_per_day", problems, integer=True))
        if best and mpd:
            problems.append(f"{where} ({name}): a best-effort team has no minimum (min_per_day must be 0)")
        if not best and mpd < 1:
            problems.append(f"{where} ({name}): a team that is not best-effort needs min_per_day >= 1")
        md = t.get("max_days")
        if md is not None:
            md = int(_num(md, f"{where} ({name}).max_days", problems, minimum=1, integer=True))
        teams.append(TeamRule(name, str(t.get("label") or name), mpd, best, md))
    team_names = {label_key(t.name): t.name for t in teams}

    def _check_team_map(key: str, default: Mapping[str, str]) -> dict[str, str]:
        raw = data.get(key, default)
        out: dict[str, str] = {}
        if not isinstance(raw, Mapping):
            problems.append(f"{key}: expected an object")
            return out
        for k, v in raw.items():
            if label_key(str(v)) not in team_names:
                if key not in data:
                    continue  # a built-in default for a team this configuration does not have
                problems.append(f"{key}: {k!r} maps to {v!r}, which is not a configured team")
            else:
                out[str(k)] = team_names[label_key(str(v))]
        return out

    team_aliases = _check_team_map("team_aliases", DEFAULT_TEAM_ALIASES)
    staff_team_map = _check_team_map("staff_team_map", {})
    subteams = tuple(str(s) for s in data.get("subteams", []))

    # rules
    rules = data.get("rules", {})
    min_days = int(_num(rules.get("min_days", 3), "rules.min_days", problems, minimum=0, integer=True))
    max_days = int(_num(rules.get("max_days", 5), "rules.max_days", problems, minimum=1, integer=True))
    be_max = int(_num(rules.get("best_effort_max_days", min_days), "rules.best_effort_max_days", problems,
                      minimum=0, integer=True))
    n_days = len(window_days)
    if max_days < min_days:
        problems.append("rules.max_days is below rules.min_days")
    if min_days > n_days:
        problems.append(f"rules.min_days ({min_days}) exceeds the window length ({n_days} days)")
    if be_max < min_days:
        problems.append("rules.best_effort_max_days is below rules.min_days")
    for t in teams:
        if t.max_days is not None and t.max_days < min_days:
            problems.append(f"team {t.name}: max_days is below rules.min_days")

    # exclusions
    ex = data.get("exclusions", {})
    patterns = tuple(str(p) for p in ex.get("team_patterns", DEFAULT_EXCLUDED_TEAM_PATTERNS))
    people = tuple(str(p) for p in ex.get("people", []))
    name_patterns = tuple(str(p) for p in ex.get("name_patterns", []))
    bad = sorted(set(ex) - {"team_patterns", "people", "name_patterns"})
    if bad:
        problems.append(f"exclusions: unknown keys {bad}")

    # availability
    avail: dict[str, Availability] = {}
    av_raw = data.get("availability", {})
    if not isinstance(av_raw, Mapping):
        problems.append("availability: expected {name: {unavailable|allowed: [...]}}")
        av_raw = {}
    for name, spec in av_raw.items():
        where = f"availability[{name!r}]"
        if not isinstance(spec, Mapping) or not (set(spec) <= {"unavailable", "allowed"}) or not spec:
            problems.append(f"{where}: expected an object with `unavailable` and/or `allowed`")
            continue
        un = _parse_dates(spec.get("unavailable", []), where + ".unavailable", problems)
        al = _parse_dates(spec["allowed"], where + ".allowed", problems) if "allowed" in spec else None
        for d in un | (al or set()):
            if d not in window_days:
                problems.append(f"{where}: {d} is outside the window")
        key = name_key(str(name))
        if key in avail:
            problems.append(f"{where}: listed twice")
        avail[key] = Availability(frozenset(un), None if al is None else frozenset(al))

    # shifts
    overrides: dict[str, str] = {}
    for name, code in (data.get("shift_overrides") or {}).items():
        c = _canonical_shift(code, f"shift_overrides[{name!r}]", problems)
        if c:
            overrides[name_key(str(name))] = c
    dns = data.get("default_new_person_shift")
    default_shift = _canonical_shift(dns, "default_new_person_shift", problems) if dns else None
    aliases = {name_key(str(k)): str(v) for k, v in (data.get("name_aliases") or {}).items()}

    lookback = int(_num(data.get("lookback_months", 4), "lookback_months", problems, minimum=1, integer=True))

    # weights
    w = data.get("weights", {})
    dw = w.get("day_weight", {})
    extra = w.get("extra_day", [400, 600])
    if not isinstance(extra, list) or not all(isinstance(x, (int, float)) and x >= 0 for x in extra):
        problems.append("weights.extra_day: expected a list of non-negative numbers (cost of the 4th, 5th, ... day)")
        extra = [400, 600]
    if max_days > min_days and len(extra) < max_days - min_days:
        problems.append(f"weights.extra_day needs {max_days - min_days} entries (one per day beyond rules.min_days)")
    defaults = Weights()
    weights = Weights(
        shortfall=_num(w.get("shortfall", defaults.shortfall), "weights.shortfall", problems),
        best_effort_nobody=_num(w.get("best_effort_nobody", defaults.best_effort_nobody),
                                "weights.best_effort_nobody", problems),
        day_weekday=_num(dw.get("weekday", defaults.day_weekday), "weights.day_weight.weekday", problems),
        day_holiday=_num(dw.get("holiday", defaults.day_holiday), "weights.day_weight.holiday", problems),
        day_weekend=_num(dw.get("weekend", defaults.day_weekend), "weights.day_weight.weekend", problems),
        extra_day=tuple(float(x) for x in extra),
        lane=_num(w.get("lane", defaults.lane), "weights.lane", problems),
        subteam=_num(w.get("subteam", defaults.subteam), "weights.subteam", problems),
        fairness=_num(w.get("fairness", defaults.fairness), "weights.fairness", problems),
        block=_num(w.get("block", defaults.block), "weights.block", problems),
        stability=_num(w.get("stability", defaults.stability), "weights.stability", problems),
        days_shortfall=_num(w.get("days_shortfall", defaults.days_shortfall), "weights.days_shortfall", problems),
    )
    bad = sorted(set(w) - {"shortfall", "best_effort_nobody", "day_weight", "extra_day", "lane", "subteam",
                           "fairness", "block", "stability", "days_shortfall"})
    if bad:
        problems.append(f"weights: unknown keys {bad}")

    # solver
    sv = data.get("solver", {})
    time_limit = _num(sv.get("time_limit_s", 120), "solver.time_limit_s", problems, minimum=1.0)
    gap = _num(sv.get("mip_rel_gap", 0.0), "solver.mip_rel_gap", problems, minimum=0.0)
    seed = int(_num(sv.get("seed", 0), "solver.seed", problems, integer=True))

    if problems:
        raise ConfigError(problems)
    return WinterConfig(
        start=start, end=end, holidays=holidays, weekend_label=weekend_label, default_day_label=default_label,
        fair_days=tuple(fair), teams=tuple(teams), team_aliases=team_aliases, staff_team_map=staff_team_map,
        subteams=subteams, min_days=min_days, max_days=max_days, best_effort_max_days=be_max,
        excluded_team_patterns=patterns, excluded_people=people, excluded_name_patterns=name_patterns,
        availability=avail, shift_overrides=overrides, default_new_person_shift=default_shift,
        name_aliases=aliases, lookback_months=lookback, weights=weights, time_limit_s=float(time_limit),
        mip_rel_gap=float(gap), seed=seed, fair_min=fair_min, fair_max=fair_max, raw=dict(data),
    )


def load_config(path: Union[str, Path]) -> WinterConfig:
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        raise ConfigError([f"{path}: not valid JSON ({e})"]) from None
    return parse_config(data)


def save_config(cfg: WinterConfig, path: Union[str, Path]) -> None:
    """Write the configuration deterministically (sorted availability, fixed key order)."""
    text = json.dumps(cfg.to_dict(), indent=2, ensure_ascii=False) + "\n"
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(text, encoding="utf-8")
