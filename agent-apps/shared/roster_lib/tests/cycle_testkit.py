"""Synthetic multi-team roster for the cycle-builder tests (no real names or data)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from roster_lib.checks import daterange
from roster_lib.codes import Pattern, forced_pattern, partner_shift, works_on
from roster_lib.config import Person as ConfigPerson
from roster_lib.config import Rotation, RotationConfig
from roster_lib.cycles import cycle_for
from roster_lib.holiday_matrix import DEFAULT_LOCATION_CODES
from roster_lib.roster_io import Person

AUG = cycle_for(2026, 8)  # 2026-08-02 .. 2026-10-03
OCT = cycle_for(2026, 10)  # 2026-10-04 .. 2026-11-28
DEC = cycle_for(2026, 12)  # 2026-11-29 .. 2027-01-30
ROSTER_START = AUG.start
CITY = {code: name for name, code in DEFAULT_LOCATION_CODES.items()}


@dataclass(frozen=True)
class Spec:
    name: str
    section: str
    team_label: str
    loc: str  # location CODE (Blr, Hyd, ..., Mex)
    rotation: Rotation
    shift: str  # the shift worked in the FIRST filled cycle (AUG)


def _auto(prefix: str, section: str, label: str, shifts: str, locs: list[str]):
    return [Spec(f"{prefix} {i + 1:02d}", section, label, locs[i % len(locs)],
                 Rotation.AUTO_SWAP, "S" + shifts[i]) for i in range(len(shifts))]


INDIA = ["Blr", "Hyd", "Gur", "Che", "Kol", "Pun"]

SPECS: list[Spec] = (
    # DIS (roster section L2): 6 on S1<->S2, 6 on S3<->S4 -> 3 per shift code each cycle
    _auto("Dis Morning", "L2", "L2 DIS USI", "111222", INDIA)
    + _auto("Dis Evening", "L2", "L2 DIS USI", "333444", INDIA[::-1])
    + [Spec("Dis Us", "L2", "L2 DIS US", "Mex", Rotation.ASK_ME, "US-CST"),
       Spec("Dis New Hire", "L2", "L2 DIS USI", "Hyd", Rotation.UNCLASSIFIED, "S3")]
    + [Spec(f"Dep Person {i}", "DEP", "DEP USI", INDIA[i], Rotation.PERMANENT, "S1")
       for i in range(4)]
    + [Spec(f"Lead Three {i}", "L3", "L3", INDIA[i], Rotation.PERMANENT, "S5") for i in range(3)]
    + [Spec(f"Lab Person {i}", "Lab", "Lab", "Pun", Rotation.PERMANENT, "S1") for i in range(2)]
    + [Spec("Gov Person 0", "Governance", "Governance", "Blr", Rotation.PERMANENT, "S1"),
       Spec("Gov Person 1", "Governance", "Governance", "Hyd", Rotation.PERMANENT, "S3")]
)
EXCLUDED = {"Gov Person 0", "Gov Person 1"}


def code_text(code: str) -> str:
    return f"Shift-{code[1]}" if code in ("S1", "S2", "S3", "S4", "S5") else code


def shift_in_cycle(spec: Spec, k: int) -> str:
    """The shift of `spec` in the k-th cycle after AUG (0 = AUG)."""
    if spec.rotation is Rotation.AUTO_SWAP and k % 2 == 1:
        return partner_shift(spec.shift)
    return spec.shift


def pattern_of(code: str) -> Pattern:
    return forced_pattern(code) or Pattern.MON_FRI


def fill(cells: dict, spec: Spec, cycle, k: int) -> None:
    code = shift_in_cycle(spec, k)
    pattern = pattern_of(code)
    for d in daterange(cycle.start, cycle.end):
        cells[d] = code_text(code) if works_on(pattern, d) else ""


class FakeRoster:
    """The parts of `roster_io.Roster` the cycle builder uses."""

    def __init__(self, specs, schedule, first_date, last_date, labels):
        self.people = tuple(Person(s.name, CITY[s.loc], s.team_label, s.section, 16 + i)
                            for i, s in enumerate(specs))
        self._schedule = schedule
        self.first_date, self.last_date = first_date, last_date
        self._labels = dict(labels)

    def row_texts(self, person, start=None, end=None):
        start, end = start or self.first_date, end or self.last_date
        cells = self._schedule[person.name]
        return [cells.get(d, "") for d in daterange(start, end)]

    def holiday_labels(self, expand_merges=False):
        return dict(self._labels)


def make_roster(*, filled=(AUG,), last_date=date(2026, 12, 31), labels=None, specs=SPECS,
                hol_cells=None):
    """A roster file from AUG's first day to `last_date`; the cycles in `filled` hold data,
    everything else in the file is blank. `hol_cells` = {(name, date): "HOL"} history."""
    schedule: dict[str, dict] = {}
    for s in specs:
        cells = {d: "" for d in daterange(ROSTER_START, last_date)}
        for cycle in filled:
            k = {AUG.start: 0, OCT.start: 1, DEC.start: 2}[cycle.start]
            part = {}
            fill(part, s, cycle, k)
            cells.update({d: t for d, t in part.items() if d <= last_date})
        schedule[s.name] = cells
    for (name, d), text in (hol_cells or {}).items():
        schedule[name][d] = text
    return FakeRoster(specs, schedule, ROSTER_START, last_date, labels or {})


def make_config(k: int = 0, specs=SPECS, **min_staff) -> RotationConfig:
    """Config matching the roster as of the k-th cycle after AUG (the config shift is the
    shift each person worked in that cycle). Governance people are in the config too."""
    cfg = RotationConfig()
    cfg.min_staff.update(min_staff)
    for s in specs:
        cfg.add_person(ConfigPerson(
            s.name, "Operate", s.loc, s.rotation, subteam=s.section,
            shift=shift_in_cycle(s, k) if s.rotation is not Rotation.UNCLASSIFIED else None))
    return cfg


ANSWERS = {"rotation": {
    "Dis Us": {"shift": "KEEP"},
    "Dis New Hire": {"shift": "S3", "pattern": "MON_FRI"},
}}
