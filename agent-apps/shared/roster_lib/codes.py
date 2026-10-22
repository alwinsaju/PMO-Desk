"""
Shift-code normalizer and code table.

People write the same code many ways ("Shift-3", "shift 3", "S3 ", "us cst").
`parse_code` maps any tolerated variant to a canonical code while KEEPING the
raw original string, so the program can write back exactly what a person used
previously. Anything it cannot recognise raises `UnknownCode` for the caller
to report - it never guesses.

Canonical codes
  Shifts:   S1 S2 S3 S4 S5 NS US-CST US-PST 11AM-8PM MX-8-5 (8am-5pm CST)
  Leave:    HOL P T SL COMP   (COMP is parsed but never generated)
  Other:    OC (on-call, also "On-call"), BLANK (weekly off / empty cell),
            CUSTOM (any time-range text such as "IST 6:00-3:00AM", kept verbatim)

Table (hours are IST)
  S1,S2 08:00-17:00   S3,S4 14:00-23:00   S5 11:30-20:30 (L3)
  NS 19:00-04:00   US-CST 21:00-06:00   US-PST 23:00-08:00   11AM-8PM 11:00-20:00
  MX-8-5 = Mexico business hours 8am-5pm CST. ASSUMPTION: CST = UTC-6, so
  19:30-04:30 IST. Its IST start (after 18:00) makes it a Night/US lane code.

Weekly-off patterns: Mon-Fri (off Sat+Sun) and Wed-Sun (off Mon+Tue; weeks run
Sunday-Saturday). A pattern belongs to a person-cycle, not a code: S2 and S4
always use Wed-Sun, every other code may use either by exception. Only the
DEFAULT pattern per code lives in the table.

Device Support, Lab and LNS 2.0 use their own timing legends, so the hours
table can be overridden per team with a `TimingKey` ({canonical code:
("HH:MM", "HH:MM")}); it only replaces hours, never behaviour.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, time
from enum import Enum
from typing import Mapping, Union


class Pattern(Enum):
    MON_FRI = "Mon-Fri"
    WED_SUN = "Wed-Sun"


class Lane(Enum):
    MORNING = "Morning"  # starts before 12:00 IST
    EVENING = "Evening"  # starts 12:00-18:00 IST inclusive
    NIGHT_US = "Night/US"  # starts after 18:00 IST


class Kind(Enum):
    SHIFT = "shift"
    LEAVE = "leave"
    ON_CALL = "on-call"
    OFF = "off"  # blank / weekly off
    CUSTOM = "custom"


class UnknownCode(ValueError):
    """Raised for cell text that is not a recognised code; carries the raw text."""

    def __init__(self, raw: str):
        super().__init__(f"Unrecognised shift code: {raw!r}")
        self.raw = raw


S1, S2, S3, S4, S5 = "S1", "S2", "S3", "S4", "S5"
NS, US_CST, US_PST = "NS", "US-CST", "US-PST"
ELEVEN_TO_EIGHT = "11AM-8PM"
MX_8_5 = "MX-8-5"
HOL, P, T, SL, COMP = "HOL", "P", "T", "SL", "COMP"
OC, BLANK, CUSTOM = "OC", "BLANK", "CUSTOM"

LEAVE_CODES = frozenset({HOL, P, T, SL, COMP})
_PARTNERS = {S1: S2, S2: S1, S3: S4, S4: S3}

# A timing key: canonical code -> (start, end) as "HH:MM" strings or `time`s.
TimingKey = Mapping[str, tuple[Union[str, time], Union[str, time]]]


@dataclass(frozen=True)
class CodeInfo:
    code: str
    kind: Kind
    start: time | None = None
    end: time | None = None
    default_pattern: Pattern | None = None
    description: str = ""


def _t(h: int, m: int = 0) -> time:
    return time(h, m)


def _shift(code, start, end, pattern, description=""):
    return CodeInfo(code, Kind.SHIFT, start, end, pattern, description)


DEFAULT_TABLE: dict[str, CodeInfo] = {
    c.code: c
    for c in (
        _shift(S1, _t(8), _t(17), Pattern.MON_FRI),
        _shift(S2, _t(8), _t(17), Pattern.WED_SUN),
        _shift(S3, _t(14), _t(23), Pattern.MON_FRI),
        _shift(S4, _t(14), _t(23), Pattern.WED_SUN),
        _shift(S5, _t(11, 30), _t(20, 30), Pattern.MON_FRI, "L3"),
        _shift(NS, _t(19), _t(4), Pattern.MON_FRI),
        _shift(US_CST, _t(21), _t(6), Pattern.MON_FRI),
        _shift(US_PST, _t(23), _t(8), Pattern.MON_FRI),
        _shift(ELEVEN_TO_EIGHT, _t(11), _t(20), Pattern.MON_FRI),
        _shift(MX_8_5, _t(19, 30), _t(4, 30), Pattern.MON_FRI, "Mexico business hours 8am-5pm CST"),
        CodeInfo(HOL, Kind.LEAVE, description="Holiday"),
        CodeInfo(P, Kind.LEAVE, description="Planned leave (PTO)"),
        CodeInfo(T, Kind.LEAVE),
        CodeInfo(SL, Kind.LEAVE, description="Sick leave"),
        CodeInfo(COMP, Kind.LEAVE, description="Comp off (parsed, never generated)"),
        CodeInfo(OC, Kind.ON_CALL, description="On-call"),
        CodeInfo(BLANK, Kind.OFF, description="Weekly off / empty"),
        CodeInfo(CUSTOM, Kind.CUSTOM, description="Custom time range, kept verbatim"),
    )
}

# S2/S4 are defined by the Wed-Sun pattern.
FORCED_PATTERN = {S2: Pattern.WED_SUN, S4: Pattern.WED_SUN}


@dataclass(frozen=True)
class ParsedCode:
    raw: str  # exactly what was in the cell
    canonical: str  # one of the canonical codes above
    custom: str | None = None  # verbatim stripped text when canonical == CUSTOM

    @property
    def is_custom(self) -> bool:
        return self.canonical == CUSTOM


# Alias lookup key = lower-case text with spaces, dashes, dots and underscores removed.
_ALIASES: dict[str, str] = {}


def _alias(code: str, *keys: str) -> None:
    for k in keys:
        _ALIASES[k] = code


for _n in "12345":
    _alias(f"S{_n}", f"s{_n}", f"shift{_n}")
_alias(NS, "ns", "nightshift")
_alias(US_CST, "uscst")
_alias(US_PST, "uspst")
_alias(ELEVEN_TO_EIGHT, "11am8pm")
_alias(MX_8_5, "8am5pmcst", "mx85", "mx8am5pm")
_alias(HOL, "hol", "holiday")
_alias(P, "p", "pto")
_alias(T, "t")
_alias(SL, "sl", "sick", "sickleave")
_alias(OC, "oc", "oncall")
_alias(COMP, "comp", "compoff")
_alias(BLANK, "off", "wo", "weeklyoff")

_DASHES = dict.fromkeys(map(ord, "‐‑‒–—−"), "-")
_STRIP = re.compile(r"[\s\-._]+")

# A time with an explicit marker (a colon or am/pm), so bare "3-4" is not custom.
_MARKED = r"\d{1,2}(?::\d{2}\s*(?:am|pm)?|\s*(?:am|pm))"
_BARE = r"\d{1,2}(?::\d{2})?\s*(?:am|pm)?"
_SEP = r"\s*(?:-|to)\s*"
_CUSTOM_RE = re.compile(
    rf"(?<![\d:]){_MARKED}{_SEP}{_BARE}(?![\d])|(?<![\d:])\d{{1,2}}{_SEP}{_MARKED}",
    re.IGNORECASE,
)


def alias_key(text: str) -> str:
    return _STRIP.sub("", text.translate(_DASHES).casefold())


def try_parse_code(text: str | None) -> ParsedCode | None:
    """Like `parse_code` but returns None instead of raising `UnknownCode`."""
    try:
        return parse_code(text)
    except UnknownCode:
        return None


def parse_code(text: str | None) -> ParsedCode:
    """Normalise raw cell text to a `ParsedCode`; raise `UnknownCode` for junk."""
    raw = "" if text is None else str(text)
    stripped = raw.strip()
    if not stripped:
        return ParsedCode(raw, BLANK)
    canonical = _ALIASES.get(alias_key(stripped))
    if canonical is not None:
        return ParsedCode(raw, canonical)
    if _CUSTOM_RE.search(stripped.translate(_DASHES)):
        return ParsedCode(raw, CUSTOM, custom=stripped)
    raise UnknownCode(raw)


def counts_as_code(text: str | None) -> bool:
    """True if the text is a shift or leave code (what the 'has data' check wants).

    Blank cells and unparseable text do not count.
    """
    parsed = try_parse_code(text)
    return parsed is not None and parsed.canonical != BLANK


# ---- hours / timing key ------------------------------------------------------

def _to_time(value: str | time) -> time:
    if isinstance(value, time):
        return value
    m = re.fullmatch(r"\s*(\d{1,2}):(\d{2})\s*", value)
    if not m or int(m[1]) > 23 or int(m[2]) > 59:
        raise ValueError(f"Bad time {value!r}; expected 'HH:MM'")
    return time(int(m[1]), int(m[2]))


def resolve_table(timing_key: TimingKey | None = None) -> dict[str, CodeInfo]:
    """The code table with a team's hour overrides applied (default table if None)."""
    if not timing_key:
        return DEFAULT_TABLE
    table = dict(DEFAULT_TABLE)
    for code, (start, end) in timing_key.items():
        info = table.get(code)
        if info is None or info.kind not in (Kind.SHIFT,):
            raise ValueError(f"Timing key can only override shift codes, got {code!r}")
        table[code] = CodeInfo(code, info.kind, _to_time(start), _to_time(end),
                               info.default_pattern, info.description)
    return table


def hours_of(code: str, timing_key: TimingKey | None = None) -> tuple[time, time] | None:
    """(start, end) in IST for a shift code, or None for non-shift codes."""
    info = resolve_table(timing_key).get(code)
    if info is None or info.start is None:
        return None
    return info.start, info.end


# ---- classification ----------------------------------------------------------

def lane_of_start(start: time) -> Lane:
    if start < time(12, 0):
        return Lane.MORNING
    if start <= time(18, 0):
        return Lane.EVENING
    return Lane.NIGHT_US


def lane_of(code: str, timing_key: TimingKey | None = None) -> Lane | None:
    """Lane by IST start time; None for codes with no fixed hours (leave, BLANK, OC, CUSTOM)."""
    hours = hours_of(code, timing_key)
    return None if hours is None else lane_of_start(hours[0])


def default_pattern(code: str) -> Pattern | None:
    info = DEFAULT_TABLE.get(code)
    return None if info is None else info.default_pattern


def forced_pattern(code: str) -> Pattern | None:
    """The pattern a code ALWAYS uses (S2/S4 -> Wed-Sun), else None (either is allowed)."""
    return FORCED_PATTERN.get(code)


def works_on(pattern: Pattern, d: date) -> bool:
    """Whether a person on `pattern` works on `d` (before leave/holidays are applied)."""
    wd = d.weekday()  # Mon=0 .. Sun=6
    if pattern is Pattern.MON_FRI:
        return wd <= 4
    return wd >= 2


def is_working_code(code: str) -> bool:
    """Shift codes, CUSTOM hours and OC (on-call duty) are working; leave and BLANK are not."""
    info = DEFAULT_TABLE.get(code)
    return info is not None and info.kind in (Kind.SHIFT, Kind.CUSTOM, Kind.ON_CALL)


def is_leave_code(code: str) -> bool:
    return code in LEAVE_CODES


def partner_shift(code: str) -> str | None:
    """S1<->S2 and S3<->S4; None for every other code."""
    return _PARTNERS.get(code)
