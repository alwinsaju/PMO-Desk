"""
Small shared types for the main winter plan: findings, the plan person and the
shift-code display table.

Shift codes inside the plan are the CANONICAL roster codes (`roster_lib.codes`:
S1..S5, NS, US-CST, US-PST, 11AM-8PM, MX-8-5); the workbook shows (and the
dropdown offers) the roster's display text (`Shift-1`, ..., `8am-5pm CST`).
`parse_code` reads any tolerated variant back.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Optional

from roster_lib import codes

# canonical -> text written into the workbook (the dropdown values), in dropdown order
DISPLAY: dict[str, str] = {
    codes.S1: "Shift-1",
    codes.S2: "Shift-2",
    codes.S3: "Shift-3",
    codes.S4: "Shift-4",
    codes.S5: "Shift-5",
    codes.NS: "NS",
    codes.US_CST: "US-CST",
    codes.US_PST: "US-PST",
    codes.ELEVEN_TO_EIGHT: "11AM-8PM",
    codes.MX_8_5: "8am-5pm CST",
}
LANES = (codes.Lane.MORNING, codes.Lane.EVENING, codes.Lane.NIGHT_US)
LANE_LABEL = {codes.Lane.MORNING: "Morning", codes.Lane.EVENING: "Evening", codes.Lane.NIGHT_US: "Night/US"}

ERROR, WARNING, INFO = "error", "warning", "info"
SEVERITIES = (ERROR, WARNING, INFO)


def display_code(canonical: Optional[str]) -> str:
    """Workbook text for a canonical shift code ("" for None / blank)."""
    if not canonical:
        return ""
    return DISPLAY.get(canonical, canonical)


def canonical_shift(text: Optional[str]) -> Optional[str]:
    """Canonical SHIFT code for any tolerated cell text; None for blank, other codes and junk."""
    parsed = codes.try_parse_code(text)
    if parsed is None or parsed.canonical not in DISPLAY:
        return None
    return parsed.canonical


def lane_name(canonical: Optional[str]) -> Optional[str]:
    """'Morning' / 'Evening' / 'Night/US' for a shift code (by IST start), None when it has no lane."""
    if not canonical:
        return None
    lane = codes.lane_of(canonical)
    return None if lane is None else LANE_LABEL[lane]


def lane_hours(canonical: str) -> str:
    h = codes.hours_of(canonical)
    return "" if h is None else f"{h[0]:%H:%M}-{h[1]:%H:%M} IST"


@dataclass(frozen=True)
class Finding:
    """One structured finding (input warning, audit result)."""

    severity: str  # error | warning | info
    code: str  # stable machine key, e.g. "team_min", "needs_shift"
    message: str
    team: Optional[str] = None
    person: Optional[str] = None
    date: Optional[date] = None

    def to_dict(self) -> dict[str, Any]:
        return {"severity": self.severity, "code": self.code, "message": self.message, "team": self.team,
                "person": self.person, "date": None if self.date is None else self.date.isoformat()}

    @staticmethod
    def from_dict(d: dict[str, Any]) -> "Finding":
        return Finding(d["severity"], d["code"], d["message"], d.get("team"), d.get("person"),
                       None if not d.get("date") else date.fromisoformat(d["date"]))


@dataclass(frozen=True)
class PlanPerson:
    """A person in the plan: who they are, where they sit, their usual shift."""

    name: str
    team: str  # configured team name (e.g. "DIS")
    location: str = ""  # short code, e.g. "Hyd"
    usual_shift: Optional[str] = None  # canonical code; None -> needs_shift
    subteam: Optional[str] = None  # e.g. "Complaints"
    shift_source: str = ""  # history | override | default | ""
    staff_name: str = ""  # spelling in the staff roster when different

    @property
    def lane(self) -> Optional[str]:
        return lane_name(self.usual_shift)

    def to_dict(self) -> dict[str, Any]:
        return {"name": self.name, "team": self.team, "location": self.location,
                "usual_shift": self.usual_shift, "subteam": self.subteam, "shift_source": self.shift_source,
                "staff_name": self.staff_name}

    @staticmethod
    def from_dict(d: dict[str, Any]) -> "PlanPerson":
        return PlanPerson(d["name"], d["team"], d.get("location", ""), d.get("usual_shift"), d.get("subteam"),
                          d.get("shift_source", ""), d.get("staff_name", ""))
