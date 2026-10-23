"""Synthetic builders for the winter tests: a shift roster, a staff roster, a config and people.
No real names or data anywhere."""

from __future__ import annotations

import copy
import json
import os
from datetime import date, timedelta

import openpyxl

from winter_lib.winter_config import parse_config
from winter_lib.winter_types import PlanPerson

EXAMPLE = os.path.join(os.path.dirname(__file__), "..", "examples", "winter_config.example.json")
EPOCH = date(1899, 12, 30)

WINDOW_START = date(2026, 12, 25)
ROSTER_START = date(2026, 1, 2)
ROSTER_DAYS = 365


def example_dict():
    with open(EXAMPLE, encoding="utf-8") as f:
        return json.load(f)


def make_config(**changes):
    d = copy.deepcopy(example_dict())
    d["availability"] = {}
    d["exclusions"] = {"team_patterns": ["Leadership", "Governance", "PMO", "Analytics"], "people": [],
                       "name_patterns": []}
    d["shift_overrides"] = {}
    d["name_aliases"] = {}
    d["solver"]["time_limit_s"] = 30
    for k, v in changes.items():
        d[k] = v
    return parse_config(d)


def make_shift_roster(path, sections, *, start=ROSTER_START, days=ROSTER_DAYS):
    """sections: [(section title, [(name, location, team label, {date: raw text} or callable(date)->text)])].

    Layout mirrors the real sheet `PDT Operate`: holiday-label row, date serial row, weekday row, column
    header row (# | first section title | Loc | Team | dates...), section header rows (title in col A)."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "PDT Operate"
    first_col = 5
    ws["C1"] = "PDT Operate"
    for i in range(days):
        d = start + timedelta(days=i)
        ws.cell(row=3, column=first_col + i, value=(d - EPOCH).days)
        ws.cell(row=4, column=first_col + i, value=d.strftime("%a"))
    ws["A5"], ws["C5"], ws["D5"] = "#", "Loc", "Team"
    ws.cell(row=5, column=2, value=sections[0][0])
    r = 5
    n = 0
    for si, (title, people) in enumerate(sections):
        if si > 0:
            r += 1
            ws.cell(row=r, column=1, value=title)
        for name, loc, team, cells in people:
            r += 1
            n += 1
            ws.cell(row=r, column=1, value=n)
            ws.cell(row=r, column=2, value=name)
            ws.cell(row=r, column=3, value=loc)
            ws.cell(row=r, column=4, value=team)
            for i in range(days):
                d = start + timedelta(days=i)
                v = cells(d) if callable(cells) else cells.get(d, "")
                if v:
                    ws.cell(row=r, column=first_col + i, value=v)
    wb.save(path)
    return path


def constant(code):
    """Cell source: `code` every weekday, blank on weekends."""
    return lambda d: code if d.weekday() < 5 else ""


def make_staff_roster(path, rows, *, with_full_name=True):
    """rows: [(team label, name, secondary team label, city, country)]. Mirrors the real header shape:
    two `Team` columns, First/Last/Full name, Roll-off date, Location, India -Location, Contract End Date."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Takeda PDT Operate Team"
    ws.append(["Team", "S. No", "First Name", "Last Name", "Full Name", "Roll-off date", "Location",
               "India -Location", "Team", "Contract End Date"])
    for i, (team, name, team2, city, country) in enumerate(rows, 1):
        parts = name.split(" ", 1)
        first, last = parts[0], parts[1] if len(parts) > 1 else ""
        ws.append([team, i, first, last, name if with_full_name else None, date(2026, 9, 26), country, city, team2,
                   date(2027, 3, 31)])
    hidden = wb.create_sheet("Contact-duplicate")
    hidden.sheet_state = "hidden"
    hidden["A1"] = "ignore"
    wb.save(path)
    return path


def person(name, team, shift="S1", loc="Hyd", subteam=None):
    return PlanPerson(name, team, loc, shift, subteam, "history")


def window_days(cfg=None):
    cfg = cfg or make_config()
    return list(cfg.days)
