"""Small helpers that read a drafted task folder and pick safe / rule-breaking PMO edits."""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import date

from winter_lib.winter_types import display_code

MIN_PER_DAY = {"DIS": 2, "DEP": 2, "CMS 2.0": 1, "LNS 2.0": 1, "Integration HUB": 1}


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def main_plan(p):
    """({person: {date: canonical code}}, {person: team}, {person: usual shift display text})"""
    plan = load(p.paths.plan)
    cells: dict[str, dict[date, str]] = defaultdict(dict)
    for name, d, code in plan["cells"]:
        cells[name][date.fromisoformat(d)] = code
    team = {x["name"]: x["team"] for x in plan["people"]}
    usual = {x["name"]: display_code(x["usual_shift"]) for x in plan["people"]}
    return cells, team, usual


def safe_main_edit(p):
    """A valid edit: a person with 3 days also works a 4th day on their usual shift (allowed, up to 5).
    -> ({(person, date): usual shift text}, (person, date))"""
    cells, team, usual = main_plan(p)
    all_days = sorted({d for days in cells.values() for d in days})
    for name, days in sorted(cells.items()):
        if len(days) == 3 and team[name] in ("DIS", "DEP"):
            d = next(x for x in all_days if x not in days)
            return {(name, d): usual[name]}, (name, d)
    raise AssertionError("no 3-day person in the synthetic plan")


def breaking_main_edit(p):
    """An edit that breaks a rule: a person with exactly 3 days drops one (below 3 days)."""
    cells, team, usual = main_plan(p)
    for name, days in sorted(cells.items()):
        if len(days) == 3 and team[name] == "DIS":
            d = sorted(days)[0]
            return {(name, d): ""}, (name, d)
    raise AssertionError("no 3-day DIS person")


def wrong_shift_edit(p):
    """A person works a day on a shift that is not their usual one."""
    cells, team, usual = main_plan(p)
    name = sorted(n for n in cells if team[n] == "DEP")[0]
    d = sorted(cells[name])[0]
    other = "Shift-2" if usual[name] != "Shift-2" else "Shift-1"
    return {(name, d): other}, (name, d, usual[name], other)


def an_plan(p):
    return load(p.paths.analytics_plan)


def safe_analytics_swap(p):
    """Swap the people of two IST slots on one day (counts, double slots and on-call all stay valid).
    -> ({(date, label): name}, (date, label_a, name_a, label_b, name_b))"""
    plan = an_plan(p)
    by_day = defaultdict(list)
    for a in plan["assignments"]:
        if a["zone"] == "IST":
            by_day[a["date"]].append(a)
    for day, rows in sorted(by_day.items()):
        for i, a in enumerate(rows):
            for b in rows[i + 1:]:
                if a["person"] != b["person"]:
                    d = date.fromisoformat(day)
                    return ({(d, a["label"]): b["person"], (d, b["label"]): a["person"]},
                            (d, a["label"], a["person"], b["label"], b["person"]))
    raise AssertionError("no swappable analytics slots")


def double_slot_analytics_edit(p):
    """Give a person a second slot on a day: a hard-rule error."""
    plan = an_plan(p)
    by_day = defaultdict(list)
    for a in plan["assignments"]:
        if a["zone"] == "IST":
            by_day[a["date"]].append(a)
    for day, rows in sorted(by_day.items()):
        if len(rows) >= 2 and rows[0]["person"] != rows[1]["person"]:
            d = date.fromisoformat(day)
            return {(d, rows[1]["label"]): rows[0]["person"]}, (d, rows[1]["label"], rows[0]["person"])
    raise AssertionError("no day with two IST slots")
