"""Synthetic fixtures for the Analytics winter plan tests (no real names or data)."""

from __future__ import annotations

import copy
import json
from pathlib import Path

from winter_lib.analytics_config import AnalyticsConfig, parse_analytics_config

EXAMPLE = Path(__file__).resolve().parent.parent / "examples" / "analytics_config.example.json"


def synthetic_dict() -> dict:
    return copy.deepcopy(json.loads(EXAMPLE.read_text(encoding="utf-8")))


def synthetic_config(**overrides) -> AnalyticsConfig:
    data = synthetic_dict()
    data.update(overrides)
    return parse_analytics_config(data)


def check_rules(config: AnalyticsConfig, assignments, on_call) -> list[str]:
    """Independent re-check of the hard rules on a plan; returns a list of violations."""
    bad: list[str] = []
    rows = {}
    for a in assignments:
        rows.setdefault(a.person, []).append(a)
    if len(assignments) != len(config.slots):
        bad.append("slot count")
    for d in config.dates:
        if d not in on_call:
            bad.append(f"no on-call {d}")
    for p in config.people:
        mine = rows.get(p.display, [])
        days = [a.date for a in mine]
        if len(days) != len(set(days)):
            bad.append(f"double slot {p.display}")
        for a in mine:
            if on_call.get(a.date) == p.display:
                bad.append(f"slot on on-call day {p.display}")
            if not p.is_available(a.date):
                bad.append(f"unavailable {p.display}")
        for d, who in on_call.items():
            if who == p.display and not p.is_available(d):
                bad.append(f"oc unavailable {p.display}")
    return bad
