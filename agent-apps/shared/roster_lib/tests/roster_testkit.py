"""Synthetic builders shared by the holiday-engine and checks tests (no real names)."""

from datetime import date, timedelta

from roster_lib.codes import Pattern, forced_pattern, works_on
from roster_lib.config import RotationConfig
from roster_lib.holiday_matrix import DEFAULT_LOCATION_CODES, Holiday, HolidayMatrix, classify
from roster_lib.roster_io import Person

INDIA = ["Blr", "Che", "Gur", "Hyd", "Kol", "Pun"]
MEX = "Mex"
START = date(2026, 10, 25)  # a Sunday
END = date(2026, 11, 28)  # a Saturday (5 whole weeks)


def days(start=START, end=END):
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


def person(name, loc="Blr", section="L2", row=16):
    return Person(name, loc, f"{section} team", section, row)


def row_for(shift, start=START, end=END, pattern=None):
    """Cells for one person: `shift` on working days, blank on weekly offs."""
    pattern = forced_pattern(shift) or pattern or Pattern.MON_FRI
    return {d: (shift if works_on(pattern, d) else "") for d in days(start, end)}


def build(specs, start=START, end=END):
    """specs: [(name, location, section, shift)] -> (people, schedule)."""
    people, schedule = [], {}
    for i, (name, loc, section, shift) in enumerate(specs):
        people.append(person(name, loc, section, 16 + i))
        schedule[name] = row_for(shift, start, end)
    return people, schedule


def matrix_of(rows):
    """rows: [(holiday name, date, [location codes])] -> HolidayMatrix."""
    holidays = []
    for name, d, locs in rows:
        h_type, both = classify(locs)
        holidays.append(Holiday(name, d, frozenset(locs), h_type, both))
    holidays.sort(key=lambda h: (h.date, h.name))
    return HolidayMatrix(tuple(holidays), dict(DEFAULT_LOCATION_CODES))


def config(**min_staff):
    cfg = RotationConfig()
    cfg.min_staff.update(min_staff)
    return cfg
