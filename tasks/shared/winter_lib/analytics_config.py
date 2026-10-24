"""
Configuration for the Analytics winter plan (December Disconnect, Analytics team).

Analytics has its own shift process and its own workbook: a fixed grid of slots
over the window (30 IST slots S1-S3 plus one Mexico slot S4 per disconnect day),
people who each work a set number of slots, and two on-call people who share the
on-call duty so exactly one person is on call every day.

Everything that can change from year to year is an input here, not code:

* window dates and the title
* the people (names, usual shift, role, availability, who may take an extra slot)
* the slot grid (an explicit list of {date, code, start}, or a generated default)
* which dates count as holiday / weekend days
* the soft-preference weights and solver seed

Plain JSON on disk (see examples/analytics_config.example.json). Real names live
only in the gitignored real config; this module never contains any.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any, Iterable, Mapping, Optional

from roster_lib.config import name_key

IST = "IST"
MEXICO = "Mexico"
ON_CALL_LABEL = "On call"
ON_CALL_CODE = "OC"

ROLE_SUPPORT = "support"
ROLE_ON_CALL = "on_call"
ROLE_MEXICO = "mexico"
ROLES = (ROLE_SUPPORT, ROLE_ON_CALL, ROLE_MEXICO)

# Order matters: the index is the "distance" scale for the usual-shift preference.
IST_CODES = ("S1", "S2", "S3")

DEFAULT_TITLE = "Analytics · Winter Holiday Coverage"
DEFAULT_SHIFT_HOURS: dict[str, tuple[str, str]] = {
    "S1": ("08:00", "17:00"),
    "S2": ("11:00", "20:00"),
    "S3": ("14:00", "23:00"),
    "S4": ("22:00", "07:00"),
    "OC": ("06:00", "08:00"),
}
DEFAULT_CODE_ZONE = {"S1": IST, "S2": IST, "S3": IST, "S4": MEXICO}

# Default slots per day, used by the generator when no explicit slot list is given.
STANDARD_DAY = {"S1": 1, "S2": 2, "S3": 1}
LEAN_DAY = {"S1": 1, "S3": 1}  # weekend days
HEAVY_DAY = {"S1": 2, "S2": 2, "S3": 2}  # first working day after the holidays

_TOP_KEYS = {
    "version", "title", "window", "people", "slots", "slot_profile", "holiday_dates",
    "day_labels", "shift_hours", "slots_per_person", "on_call_slots_each", "weights",
    "solver", "logo",
}
_PERSON_KEYS = {"name", "short_name", "location", "usual_shift", "role", "available",
                "can_take_extra", "note"}
_WEIGHT_KEYS = ("usual_shift", "holiday", "block", "oncall_block", "turnaround", "extra_slot")


class AnalyticsConfigError(ValueError):
    """The config is invalid; `problems` lists every issue found."""

    def __init__(self, problems: list[str]):
        super().__init__("Analytics config problems:\n- " + "\n- ".join(problems))
        self.problems = list(problems)


@dataclass(frozen=True)
class SlotSpec:
    """One slot of the template: a date, a shift code and its start time."""

    date: date
    code: str
    start: time
    zone: str = IST

    def to_dict(self) -> dict[str, str]:
        return {"date": self.date.isoformat(), "code": self.code,
                "start": self.start.strftime("%H:%M"), "zone": self.zone}


@dataclass(frozen=True)
class PersonCfg:
    name: str
    short_name: str = ""
    location: str = ""
    usual_shift: Optional[str] = None
    role: str = ROLE_SUPPORT
    available: Optional[frozenset[date]] = None  # None = every day of the window
    can_take_extra: Optional[bool] = None  # None = default for the role
    note: str = ""

    @property
    def display(self) -> str:
        """The name written into the workbook and its dropdowns."""
        return self.short_name or self.name

    @property
    def key(self) -> str:
        return name_key(self.display)

    def is_available(self, d: date) -> bool:
        return self.available is None or d in self.available

    @property
    def extra_eligible(self) -> bool:
        if self.can_take_extra is not None:
            return self.can_take_extra
        return self.role == ROLE_SUPPORT


@dataclass(frozen=True)
class Weights:
    """Soft-preference weights (cost per violation). Hard rules are never weighed."""

    usual_shift: float = 3.0  # per step away from the usual shift (S1<->S2<->S3)
    holiday: float = 4.0  # per day below 1 / above 2 holiday-or-weekend duty days
    block: float = 2.0  # per separate block of slot days beyond the first
    oncall_block: float = 3.0  # per separate block of on-call days beyond the first
    turnaround: float = 6.0  # S3 followed by S1 the next day
    extra_slot: float = 1.0  # taking a slot beyond the person's standard count

    def to_dict(self) -> dict[str, float]:
        return {k: getattr(self, k) for k in _WEIGHT_KEYS}


@dataclass
class AnalyticsConfig:
    dates: list[date]
    people: list[PersonCfg]
    slots: list[SlotSpec]
    holiday_dates: frozenset[date]
    day_labels: dict[date, str]
    title: str = DEFAULT_TITLE
    shift_hours: dict[str, tuple[str, str]] = field(default_factory=lambda: dict(DEFAULT_SHIFT_HOURS))
    slots_per_person: int = 4
    on_call_slots_each: int = 1
    weights: Weights = field(default_factory=Weights)
    seed: int = 0
    time_limit_s: float = 120.0
    logo: Optional[str] = None  # optional path override for the logo tile

    # ---- lookups ----
    def person(self, name: str) -> Optional[PersonCfg]:
        """Find by display name or full name (case/space-insensitive)."""
        k = name_key(name)
        for p in self.people:
            if k in (name_key(p.display), name_key(p.name)):
                return p
        return None

    def people_with_role(self, role: str) -> list[PersonCfg]:
        return [p for p in self.people if p.role == role]

    @property
    def on_call_people(self) -> list[PersonCfg]:
        return self.people_with_role(ROLE_ON_CALL)

    @property
    def support_people(self) -> list[PersonCfg]:
        return self.people_with_role(ROLE_SUPPORT)

    @property
    def mexico_people(self) -> list[PersonCfg]:
        return self.people_with_role(ROLE_MEXICO)

    @property
    def ist_people(self) -> list[PersonCfg]:
        """Everyone who competes for IST slots (support + on-call)."""
        return [p for p in self.people if p.role != ROLE_MEXICO]

    @property
    def ist_slots(self) -> list[SlotSpec]:
        return [s for s in self.slots if s.zone != MEXICO]

    @property
    def mexico_slots(self) -> list[SlotSpec]:
        return [s for s in self.slots if s.zone == MEXICO]

    def is_holiday(self, d: date) -> bool:
        return d in self.holiday_dates

    def day_label(self, d: date) -> str:
        return self.day_labels.get(d, "")

    def hours_text(self, code: str) -> str:
        """`8AM-5PM` style text for a code, from shift_hours (en dash)."""
        pair = self.shift_hours.get(code)
        if not pair:
            return ""
        return f"{_ampm(pair[0])}–{_ampm(pair[1])}"

    def slot_distribution(self) -> dict[date, dict[str, int]]:
        """{date: {code: count}} of the slot template (for reporting)."""
        out: dict[date, dict[str, int]] = {d: {} for d in self.dates}
        for s in self.slots:
            out.setdefault(s.date, {})
            out[s.date][s.code] = out[s.date].get(s.code, 0) + 1
        return out

    def to_dict(self) -> dict[str, Any]:
        people = []
        for p in self.people:
            d: dict[str, Any] = {"name": p.name}
            if p.short_name:
                d["short_name"] = p.short_name
            if p.location:
                d["location"] = p.location
            if p.usual_shift:
                d["usual_shift"] = p.usual_shift
            d["role"] = p.role
            if p.available is not None:
                d["available"] = sorted(x.isoformat() for x in p.available)
            if p.can_take_extra is not None:
                d["can_take_extra"] = p.can_take_extra
            if p.note:
                d["note"] = p.note
            people.append(d)
        return {
            "version": 1,
            "title": self.title,
            "window": {"start": self.dates[0].isoformat(), "end": self.dates[-1].isoformat()},
            "people": people,
            "slots": [s.to_dict() for s in self.slots],
            "holiday_dates": sorted(d.isoformat() for d in self.holiday_dates),
            "day_labels": {d.isoformat(): v for d, v in sorted(self.day_labels.items())},
            "shift_hours": {k: list(v) for k, v in self.shift_hours.items()},
            "slots_per_person": self.slots_per_person,
            "on_call_slots_each": self.on_call_slots_each,
            "weights": self.weights.to_dict(),
            "solver": {"seed": self.seed, "time_limit_s": self.time_limit_s},
        }


# ---- helpers -----------------------------------------------------------------

def _ampm(hhmm: str) -> str:
    t = _parse_time(hhmm)
    h = t.hour % 12 or 12
    suffix = "AM" if t.hour < 12 else "PM"
    return f"{h}{suffix}" if t.minute == 0 else f"{h}:{t.minute:02d}{suffix}"


_TIME_RE = re.compile(r"^\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*$")


def _parse_time(value: Any) -> time:
    if isinstance(value, time):
        return value.replace(second=0, microsecond=0)
    if isinstance(value, str):
        m = _TIME_RE.match(value)
        if m and int(m.group(1)) < 24 and int(m.group(2)) < 60:
            return time(int(m.group(1)), int(m.group(2)))
    raise ValueError(f"not a HH:MM time: {value!r}")


def _parse_date(value: Any) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        return date.fromisoformat(value.strip())
    raise ValueError(f"not an ISO date: {value!r}")


def _daterange(start: date, end: date) -> list[date]:
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


def default_holiday_dates(dates: list[date]) -> frozenset[date]:
    """Weekend days plus the first and last day of the window (Dec 25, Jan 1 in 2026)."""
    out = {d for d in dates if d.weekday() >= 5}
    if dates:
        out.add(dates[0])
        out.add(dates[-1])
    return frozenset(out)


def default_day_labels(dates: list[date], holiday_dates: Iterable[date]) -> dict[date, str]:
    """Christmas / Weekend / Winter Disconnect / New Year style labels."""
    hol = set(holiday_dates)
    out: dict[date, str] = {}
    for i, d in enumerate(dates):
        if d.month == 12 and d.day == 25:
            out[d] = "Christmas"
        elif d.month == 1 and d.day == 1:
            out[d] = "New Year"
        elif d.weekday() >= 5:
            out[d] = "Weekend"
        elif d in hol:
            out[d] = "Holiday"
        else:
            out[d] = "Winter Disconnect"
    return out


def default_slot_template(
    dates: list[date],
    holiday_dates: Iterable[date],
    *,
    per_day: Optional[Mapping[date, Mapping[str, int]]] = None,
    mexico_dates: Optional[Iterable[date]] = None,
    shift_hours: Optional[Mapping[str, tuple[str, str]]] = None,
) -> list[SlotSpec]:
    """Generate the default slot grid (derived from the previous year's layout).

    * weekend days (Sat/Sun): S1 + S3 (2 slots)
    * the first day that is not a holiday/weekend day (Mon 28 Dec): S1 x2, S2 x2, S3 x2
    * every other day: S1, S2 x2, S3 (4 slots)
    * one S4 Mexico slot on each day that is not a holiday/weekend day

    `per_day` overrides individual dates ({date: {code: n}}); `mexico_dates`
    overrides the S4 days.
    """
    hol = set(holiday_dates)
    hours = {**DEFAULT_SHIFT_HOURS, **(shift_hours or {})}
    first_working = next((d for d in dates if d not in hol), None)
    slots: list[SlotSpec] = []
    for d in dates:
        if per_day and d in per_day:
            counts = dict(per_day[d])
        elif d.weekday() >= 5:
            counts = dict(LEAN_DAY)
        elif d == first_working:
            counts = dict(HEAVY_DAY)
        else:
            counts = dict(STANDARD_DAY)
        for code in IST_CODES:
            for _ in range(int(counts.get(code, 0))):
                slots.append(SlotSpec(d, code, _parse_time(hours[code][0]), IST))
    mex = sorted(set(mexico_dates)) if mexico_dates is not None else [d for d in dates if d not in hol]
    for d in mex:
        slots.append(SlotSpec(d, "S4", _parse_time(hours["S4"][0]), MEXICO))
    return sorted(slots, key=_slot_sort_key)


def _slot_sort_key(s: SlotSpec):
    return (s.date, s.start, s.code, s.zone)


# ---- parsing -----------------------------------------------------------------

def _available_set(raw: Any, dates: list[date], label: str, problems: list[str]) -> Optional[frozenset[date]]:
    if raw is None:
        return None
    out: set[date] = set()
    try:
        if isinstance(raw, Mapping):
            lo, hi = _parse_date(raw["from"]), _parse_date(raw["to"])
            if hi < lo:
                raise ValueError("'to' is before 'from'")
            out = set(_daterange(lo, hi))
        elif isinstance(raw, list):
            out = {_parse_date(x) for x in raw}
        else:
            raise ValueError("expected {from, to} or a list of dates")
    except (KeyError, ValueError, TypeError) as e:
        problems.append(f"{label}: bad availability ({e})")
        return None
    return frozenset(d for d in out if d in set(dates))


def parse_analytics_config(data: Any) -> AnalyticsConfig:
    """Validate a decoded JSON object and return an AnalyticsConfig (raises AnalyticsConfigError)."""
    problems: list[str] = []
    if not isinstance(data, Mapping):
        raise AnalyticsConfigError(["the config must be a JSON object"])
    unknown = sorted(set(data) - _TOP_KEYS)
    if unknown:
        problems.append(f"unknown top-level keys: {', '.join(unknown)}")

    # window
    dates: list[date] = []
    win = data.get("window")
    try:
        if not isinstance(win, Mapping):
            raise ValueError("missing")
        start, end = _parse_date(win["start"]), _parse_date(win["end"])
        if end < start:
            raise ValueError("end is before start")
        dates = _daterange(start, end)
        if len(dates) > 31:
            raise ValueError("more than 31 days")
    except (KeyError, ValueError, TypeError) as e:
        problems.append(f"window must be {{start, end}} ISO dates ({e})")
    dateset = set(dates)

    # shift hours
    hours = dict(DEFAULT_SHIFT_HOURS)
    raw_hours = data.get("shift_hours")
    if raw_hours is not None:
        if not isinstance(raw_hours, Mapping):
            problems.append("shift_hours must be an object {code: [start, end]}")
        else:
            for code, pair in raw_hours.items():
                try:
                    a, b = pair
                    _parse_time(a), _parse_time(b)
                    hours[str(code)] = (str(a), str(b))
                except (ValueError, TypeError):
                    problems.append(f"shift_hours[{code}] must be [HH:MM, HH:MM]")

    # people
    people: list[PersonCfg] = []
    seen: dict[str, str] = {}
    raw_people = data.get("people")
    if not isinstance(raw_people, list) or not raw_people:
        problems.append("people must be a non-empty list")
        raw_people = []
    for i, rp in enumerate(raw_people):
        label = f"people[{i}]"
        if not isinstance(rp, Mapping):
            problems.append(f"{label} must be an object")
            continue
        bad = sorted(set(rp) - _PERSON_KEYS)
        if bad:
            problems.append(f"{label}: unknown keys {', '.join(bad)}")
        name = rp.get("name")
        if not isinstance(name, str) or not name.strip():
            problems.append(f"{label}: name is required")
            continue
        label = f"people[{i}] ({name!r})"
        role = rp.get("role", ROLE_SUPPORT)
        if role not in ROLES:
            problems.append(f"{label}: role must be one of {', '.join(ROLES)}")
            role = ROLE_SUPPORT
        usual = rp.get("usual_shift")
        if usual is not None and usual not in IST_CODES and not (role == ROLE_MEXICO and usual == "S4"):
            problems.append(f"{label}: usual_shift must be one of {', '.join(IST_CODES)} (or null)")
            usual = None
        cte = rp.get("can_take_extra")
        if cte is not None and not isinstance(cte, bool):
            problems.append(f"{label}: can_take_extra must be true/false")
            cte = None
        avail = _available_set(rp.get("available"), dates, label, problems)
        p = PersonCfg(
            name=name.strip(),
            short_name=str(rp.get("short_name") or "").strip(),
            location=str(rp.get("location") or "").strip(),
            usual_shift=usual,
            role=role,
            available=avail,
            can_take_extra=cte,
            note=str(rp.get("note") or "").strip(),
        )
        for k in {name_key(p.display), name_key(p.name)}:
            if k in seen and seen[k] != p.name:
                problems.append(f"{label}: name clashes with {seen[k]!r}")
        seen[name_key(p.display)] = p.name
        seen[name_key(p.name)] = p.name
        people.append(p)
    if people and not [p for p in people if p.role == ROLE_ON_CALL]:
        problems.append("at least one person must have role 'on_call'")

    # holidays and labels
    hol_raw = data.get("holiday_dates")
    if hol_raw is None:
        holiday_dates = default_holiday_dates(dates)
    else:
        try:
            holiday_dates = frozenset(_parse_date(x) for x in hol_raw)
        except (ValueError, TypeError):
            problems.append("holiday_dates must be a list of ISO dates")
            holiday_dates = frozenset()
        outside = sorted(d.isoformat() for d in holiday_dates if d not in dateset)
        if outside:
            problems.append(f"holiday_dates outside the window: {', '.join(outside)}")
    labels = default_day_labels(dates, holiday_dates)
    raw_labels = data.get("day_labels")
    if isinstance(raw_labels, Mapping):
        for k, v in raw_labels.items():
            try:
                labels[_parse_date(k)] = str(v)
            except ValueError:
                problems.append(f"day_labels key {k!r} is not an ISO date")
    elif raw_labels is not None:
        problems.append("day_labels must be an object {date: label}")

    # slots
    slots: list[SlotSpec] = []
    raw_slots = data.get("slots")
    if raw_slots is not None:
        if not isinstance(raw_slots, list) or not raw_slots:
            problems.append("slots must be a non-empty list of {date, code, start}")
        else:
            for i, rs in enumerate(raw_slots):
                try:
                    d = _parse_date(rs["date"])
                    code = str(rs["code"]).strip().upper()
                    zone = str(rs.get("zone") or DEFAULT_CODE_ZONE.get(code, IST))
                    start = _parse_time(rs.get("start") or hours[code][0])
                    if d not in dateset:
                        raise ValueError(f"date {d.isoformat()} is outside the window")
                    if zone not in (IST, MEXICO):
                        raise ValueError("zone must be IST or Mexico")
                    if zone == IST and code not in IST_CODES:
                        raise ValueError(f"IST slot code must be one of {', '.join(IST_CODES)}")
                    slots.append(SlotSpec(d, code, start, zone))
                except (KeyError, ValueError, TypeError) as e:
                    problems.append(f"slots[{i}]: {e}")
    elif dates:
        prof = data.get("slot_profile") or {}
        per_day = None
        mex = None
        try:
            if "per_day" in prof:
                per_day = {_parse_date(k): dict(v) for k, v in prof["per_day"].items()}
            if "mexico_dates" in prof:
                mex = [_parse_date(x) for x in prof["mexico_dates"]]
            slots = default_slot_template(dates, holiday_dates, per_day=per_day, mexico_dates=mex,
                                          shift_hours=hours)
        except (ValueError, TypeError, AttributeError, KeyError) as e:
            problems.append(f"slot_profile is invalid ({e})")

    def _int(key: str, default: int, lo: int) -> int:
        v = data.get(key, default)
        if isinstance(v, bool) or not isinstance(v, int) or v < lo:
            problems.append(f"{key} must be an integer >= {lo}")
            return default
        return v

    slots_pp = _int("slots_per_person", 4, 0)
    oc_slots = _int("on_call_slots_each", 1, 0)

    weights = Weights()
    raw_w = data.get("weights")
    if raw_w is not None:
        if not isinstance(raw_w, Mapping):
            problems.append("weights must be an object")
        else:
            kw: dict[str, float] = {}
            for k, v in raw_w.items():
                if k not in _WEIGHT_KEYS:
                    problems.append(f"unknown weight {k!r}")
                elif isinstance(v, bool) or not isinstance(v, (int, float)) or v < 0:
                    problems.append(f"weights[{k}] must be a number >= 0")
                else:
                    kw[k] = float(v)
            weights = Weights(**kw)

    seed, tl = 0, 120.0
    raw_s = data.get("solver")
    if raw_s is not None:
        if not isinstance(raw_s, Mapping):
            problems.append("solver must be an object")
        else:
            seed = int(raw_s.get("seed", 0)) if isinstance(raw_s.get("seed", 0), int) else 0
            v = raw_s.get("time_limit_s", 120.0)
            if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0:
                tl = float(v)
            else:
                problems.append("solver.time_limit_s must be a positive number")

    if slots and any(s.zone == MEXICO for s in slots) and not [p for p in people if p.role == ROLE_MEXICO]:
        problems.append("there are Mexico slots but nobody has role 'mexico'")

    if problems:
        raise AnalyticsConfigError(problems)

    title = str(data.get("title") or DEFAULT_TITLE)
    return AnalyticsConfig(
        dates=dates, people=people, slots=sorted(slots, key=_slot_sort_key), holiday_dates=holiday_dates,
        day_labels=labels, title=title, shift_hours=hours, slots_per_person=slots_pp,
        on_call_slots_each=oc_slots, weights=weights, seed=seed, time_limit_s=tl,
        logo=data.get("logo"),
    )


def load_analytics_config(path: str | Path) -> AnalyticsConfig:
    """Read and validate a JSON config file."""
    p = Path(path)
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise AnalyticsConfigError([f"{p.name} is not valid JSON ({e})"]) from e
    return parse_analytics_config(data)


def save_analytics_config(config: AnalyticsConfig, path: str | Path) -> None:
    Path(path).write_text(json.dumps(config.to_dict(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
