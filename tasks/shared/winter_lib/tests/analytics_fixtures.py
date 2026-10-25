"""Synthetic fixtures for the Analytics winter plan tests (no real names or data)."""

from __future__ import annotations

import copy
import json
import shutil
import warnings
from datetime import date, datetime
from functools import lru_cache
from pathlib import Path

import openpyxl

from winter_lib.analytics_config import AnalyticsConfig, parse_analytics_config
from winter_lib.analytics_plan import AnalyticsPlan, solve_analytics_plan
from winter_lib.analytics_workbook import build_analytics_workbook

EXAMPLE = Path(__file__).resolve().parent.parent / "examples" / "analytics_config.example.json"


def synthetic_dict() -> dict:
    return copy.deepcopy(json.loads(EXAMPLE.read_text(encoding="utf-8")))


def synthetic_config(**overrides) -> AnalyticsConfig:
    data = synthetic_dict()
    data.update(overrides)
    return parse_analytics_config(data)


@lru_cache(maxsize=1)
def _cached_plan() -> tuple[AnalyticsConfig, AnalyticsPlan]:
    config = synthetic_config()
    return config, solve_analytics_plan(config)


def synthetic_plan() -> tuple[AnalyticsConfig, AnalyticsPlan]:
    """The solved synthetic plan (computed once per test run; treat as read-only)."""
    return _cached_plan()


def build_synthetic(path: Path) -> tuple[AnalyticsConfig, AnalyticsPlan]:
    config, plan = synthetic_plan()
    result = build_analytics_workbook(config, plan, path)
    assert result.formula_check.ok, result.formula_check
    return config, plan


def copy_with_sidecar(src: Path, dst: Path) -> Path:
    shutil.copyfile(src, dst)
    side = Path(str(src) + ".snapshot.json")
    if side.exists():
        shutil.copyfile(side, str(dst) + ".snapshot.json")
    return dst


def edit_workbook(src: Path, dst: Path, changes: dict[tuple[date, str], object], *, keep_sidecar: bool = True) -> Path:
    """Copy `src` to `dst` and set Winter Roster Assigned cells like a user (and a re-save by openpyxl).

    `changes` maps (date, slot label) -> new text (None clears the cell).
    """
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        wb = openpyxl.load_workbook(src)
    ws = wb["Winter Roster"]
    hdr = next(r for r in range(1, 20) if ws.cell(r, 1).value == "Date")
    todo = dict(changes)
    for r in range(hdr + 1, ws.max_row + 1):
        v = ws.cell(r, 1).value
        d = v.date() if isinstance(v, datetime) else v
        key = (d, ws.cell(r, 4).value)
        if key in todo:
            ws.cell(r, 8).value = todo.pop(key)
    assert not todo, f"cells not found: {todo}"
    wb.save(dst)
    if keep_sidecar:
        side = Path(str(src) + ".snapshot.json")
        if side.exists():
            shutil.copyfile(side, str(dst) + ".snapshot.json")
    return dst


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
