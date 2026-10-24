"""Shared test helpers for draft / diff / final / next-year tests (synthetic data only)."""

from __future__ import annotations

import json
import zipfile
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

import pytest

from roster_lib import pkgdiff
from roster_lib.cycles import Cycle
from roster_lib.roster_io import load_roster
from xlsx_fixtures import SHEET, FixtureInfo, build_roster_workbook

REAL = Path(__file__).resolve().parents[2] / "roster-reference" / "Shiftroster_Takeda_Redesigned_v2.xlsx"
needs_real = pytest.mark.skipif(not REAL.exists(), reason="real roster reference file not present")

SHEET_PART = "xl/worksheets/sheet1.xml"
NOW = datetime(2026, 2, 1, 12, 0, 0, tzinfo=timezone.utc)

CYCLE = Cycle(first_month=date(2026, 1, 1), start=date(2026, 1, 4), end=date(2026, 1, 31), rotation_sunday=date(2026, 1, 4))

DRAFT_PARTS_CHANGED = {
    SHEET_PART,
    "xl/workbook.xml",
    "xl/_rels/workbook.xml.rels",
    "[Content_Types].xml",
    "xl/styles.xml",
    "docProps/app.xml",
}


@dataclass(frozen=True)
class FakeFlag:
    key: str
    kind: str
    severity: str
    message: str
    person: Optional[str] = None
    date: Optional[date] = None
    team: Optional[str] = None
    shift: Optional[str] = None
    origin: Optional[str] = None


@dataclass
class FakePlan:
    """Duck-typed stand-in for cycle_builder.Plan (the contract draft_builder codes against)."""

    cycle: Cycle
    edits: dict
    remainder_edits: dict = field(default_factory=dict)
    shift_changes: list = field(default_factory=list)
    holiday_assignments: list = field(default_factory=list)
    flags: list = field(default_factory=list)
    run_info: dict = field(default_factory=dict)
    existing_roster_findings: dict = field(default_factory=dict)
    with_snapshot_cells: bool = True

    def snapshot_cells(self):
        return dict(self.edits)

    def to_json(self) -> str:
        return json.dumps(
            {
                "cycle": self.cycle.label,
                "edits": [[n, d.isoformat(), t] for (n, d), t in sorted(self.edits.items())],
                "remainder": [[n, d.isoformat(), t] for (n, d), t in sorted(self.remainder_edits.items())],
                "flags": [f.key for f in self.flags],
            },
            sort_keys=True,
        )

    def __getattribute__(self, name):
        if name == "snapshot_cells" and not object.__getattribute__(self, "with_snapshot_cells"):
            raise AttributeError(name)
        return object.__getattribute__(self, name)


def make_master(tmp_path: Path, name: str = "master.xlsx", **kw) -> FixtureInfo:
    kw.setdefault("days", 45)
    kw.setdefault("start", date(2026, 1, 1))
    return build_roster_workbook(tmp_path / name, **kw)


def cycle_dates(start: date = date(2026, 1, 4), end: date = date(2026, 1, 24)) -> list[date]:
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


def make_plan(info: FixtureInfo, *, n_people: int = 6, start=date(2026, 1, 4), end=date(2026, 1, 24), flags=None, **kw) -> FakePlan:
    """New-cycle cells for the first n_people: weekdays on a shift (some new strings), weekends blank."""
    edits = {}
    for i, p in enumerate(info.people[:n_people]):
        shift = ["Shift-1", "Shift-2", "Shift-4", "Shift-1", "Shift-3", "Shift-2"][i % 6]
        for d in cycle_dates(start, end):
            if d.weekday() >= 5:
                edits[(p.name, d)] = ""
            elif d == date(2026, 1, 14) and i == 0:
                edits[(p.name, d)] = "HOL"
            elif d == date(2026, 1, 16) and i == 1:
                edits[(p.name, d)] = "PTO"
            else:
                edits[(p.name, d)] = shift
    edits[(info.people[0].name, date(2026, 1, 20))] = "Shift Swap\nNS"
    if flags is None:
        flags = [
            FakeFlag("k-err", "STAFFING_SHORTAGE", "ERROR", "Team DIS has 2 of 3 on Shift-1", None, date(2026, 1, 14), "DIS", "S1"),
            FakeFlag("k-warn", "HOL_ON_WEEKLY_OFF", "WARNING", "HOL on a weekly off", info.people[1].name, date(2026, 1, 17),
                     origin="master"),
            FakeFlag("k-info", "CHANGE_NOTE", "INFO", "note"),
        ]
    plan = FakePlan(
        cycle=CYCLE,
        edits=edits,
        flags=flags,
        shift_changes=[
            {"person": info.people[0].name, "old_shift": "S1", "new_shift": "S2", "effective": "2026-01-04",
             "first_worked": "2026-01-07", "old_pattern": "MON_FRI", "new_pattern": "WED_SUN"}
        ],
        holiday_assignments=[
            {"date": "2026-01-14", "holidays": ["Test Day"], "kind": "COMMON", "team": "DIS", "shift": "S1", "min_staff": 3,
             "fairness": True, "off": [info.people[0].name], "straight_off": [], "covering": [info.people[2].name],
             "outside": [], "need": 1, "shortage": False,
             "counters_before": {info.people[0].name: {"offs_taken": 1, "last_off_date": None}},
             "counters_after": {info.people[0].name: {"offs_taken": 2, "last_off_date": "2026-01-14"}}}
        ],
        run_info={"library_version": "test/1", "library_commit": "abc1234", "config": {"version": 3},
                  "seed_used": 42, "seed_source": "config",
                  "year_boundary": {"crosses": False}},
        existing_roster_findings={"year": 2026, "start": "2026-01-01", "end": "2026-02-14",
                                  "hol": [{"kind": "MISSING", "severity": "ERROR", "date": "2026-01-02",
                                           "person": info.people[2].name, "location": "Hyd", "message": "no HOL"}],
                                  "staffing": [], "hol_by_kind": {"MISSING": 1}, "staffing_count": 0},
        **kw,
    )
    return plan


def local_flag_delta(before, after):
    """Tiny local equivalent of cycle_builder.flag_delta (keyed by .key)."""
    bk = {f.key: f for f in before}
    ak = {f.key: f for f in after}
    new = [ak[k] for k in ak if k not in bk]
    resolved = [bk[k] for k in bk if k not in ak]
    remaining = [ak[k] for k in ak if k in bk]
    return new, resolved, remaining


def grid(path, sheet: str = SHEET) -> dict[tuple[str, date], str]:
    """Every person x date text of a roster file."""
    r = load_roster(path, sheet)
    return {(p.name, d): r.cell(p, d) for p in r.people for d in r.dates}


def assert_draft_package(master, draft, new_parts, allowed_changed=DRAFT_PARTS_CHANGED):
    d = pkgdiff.diff_packages(master, draft)
    assert d.only_in_a == []
    assert sorted(d.only_in_b) == sorted(new_parts)
    assert set(d.byte_changed) <= set(allowed_changed), d.byte_changed
    assert d.compression_changed == []
    with zipfile.ZipFile(master) as za, zipfile.ZipFile(draft) as zb:
        old = za.namelist()
        assert zb.namelist()[: len(old)] == old
    return d


def resave_with_openpyxl(src: Path, dst: Path) -> None:
    """Simulate an Excel re-save: openpyxl load + save reindexes shared strings and rewrites styles."""
    from openpyxl import load_workbook

    wb = load_workbook(src)
    wb.save(dst)


def edit_cells_with_openpyxl(src: Path, dst: Path, edits: dict[str, Any], sheet: str = SHEET) -> None:
    """Edit cells via an openpyxl round trip (like a PMO editing then Excel saving)."""
    from openpyxl import load_workbook

    wb = load_workbook(src)
    ws = wb[sheet]
    for ref, value in edits.items():
        ws[ref].value = value
    wb.save(dst)


def pmo_save(draft_path: Path, dst: Path, edits: dict, *, sidecar: bool = True, sheet: str = SHEET) -> Path:
    """The PMO edits cells of the draft and saves it as `dst` (text-level patch; sidecar copied alongside)."""
    import shutil

    from roster_lib.xlsx_patch import patch_workbook

    roster = load_roster(draft_path, sheet)
    resolved = {}
    for (name, d), text in edits.items():
        resolved[roster.address(roster.find(name)[0], d)] = text
    patch_workbook(draft_path, dst, sheet, resolved)
    side = Path(str(draft_path) + ".snapshot.json")
    if sidecar and side.exists():
        shutil.copyfile(side, str(dst) + ".snapshot.json")
    return dst


def a1(info: FixtureInfo, name: str, d: date) -> str:
    from roster_lib.xlsx_patch import format_ref

    p = info.person(name)
    return format_ref(p.row, info.date_col(d))
