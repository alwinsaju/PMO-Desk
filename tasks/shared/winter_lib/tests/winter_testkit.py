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


def small_cfg(**over):
    """The example configuration without any real-world exclusions/availability, 30 s solver limit."""
    d = example_dict()
    d["availability"], d["shift_overrides"], d["name_aliases"] = {}, {}, {}
    d["exclusions"] = {"team_patterns": [], "people": [], "name_patterns": []}
    d["solver"]["time_limit_s"] = 30
    for k, v in over.items():
        d[k] = v
    return parse_config(d)


def make_people(n_dis=6, n_dep=4, n_l3=3, n_cms=2, n_lns=2, n_hub=2):
    shifts = ["S1", "S3", "S2", "NS", "S4", "US-CST"]
    out = []
    for team, n in (("DIS", n_dis), ("DEP", n_dep), ("L3", n_l3), ("CMS 2.0", n_cms), ("LNS 2.0", n_lns),
                    ("Integration HUB", n_hub)):
        for i in range(n):
            out.append(person(f"{team[:3].upper()}{i} Tester", team, shifts[i % len(shifts)]))
    return out


def make_sample_files(tmp_path, *, dis=8, dep=6, l3=3, cms=2, lns=2, hub=3, with_new=True):
    """A plannable synthetic staff roster + shift roster (usual shifts from the 4 months before the window;
    the window itself holds HOL placeholders). Returns (staff_path, roster_path, names_by_team)."""
    shifts = ["Shift-1", "Shift-3", "Shift-2", "NS", "Shift-4", "US-CST", "11AM-8PM", "Shift-5"]
    lb0, lb1 = date(2026, 8, 25), date(2026, 12, 24)

    def cells(code):
        out, d = {}, lb0
        while d <= lb1:
            if d.weekday() < 5:
                out[d] = code
            d += timedelta(days=1)
        for i in range(8):
            out[WINDOW_START + timedelta(days=i)] = "HOL"
        return out

    sections, staff_rows, names = [], [], {}
    spec = [("L2", "DIS L2", "DIS", dis, "L2 DIS USI"), ("DEP", "DEP", "DEP", dep, "DEP USI"),
            ("L3", "L3", "L3", l3, "L3"), ("CMS 2.0", "CMS 2.0", "CMS 2.0", cms, "CMS 2.0"),
            ("L N S 2.0", "LNS 2.0", "LNS 2.0", lns, "LNS 2.0")]
    for section, staff_label, team, n, label in spec:
        people = []
        for i in range(n):
            name = f"{team.split()[0]}{i:02d} Sample"
            people.append((name, ["Hyderabad", "Pune", "Mexico", "Bengaluru"][i % 4], label,
                           cells(shifts[i % len(shifts)])))
            staff_rows.append((staff_label, name, "L2", ["Hyderabad", "Pune", "Mexico", "Bengaluru"][i % 4], "India"))
            names.setdefault(team, []).append(name)
        sections.append((section, people))
    sections.append(("Governance", [("Gov00 Sample", "US", "Governance", cells("Shift-1"))]))
    staff_rows.append(("Leadership", "Gov00 Sample", "Tech M", "NY", "US"))
    staff_rows.append(("Analytics", "Ana00 Sample", "L2", "Pune", "India"))
    if with_new:
        for i in range(hub):
            staff_rows.append(("Integration HUB", f"Hub{i:02d} Sample", "L2", "Hyderabad", "India"))
            names.setdefault("Integration HUB", []).append(f"Hub{i:02d} Sample")
    staff = make_staff_roster(tmp_path / "staff.xlsx", staff_rows)
    roster = make_shift_roster(tmp_path / "shift.xlsx", sections)
    return staff, roster, names
