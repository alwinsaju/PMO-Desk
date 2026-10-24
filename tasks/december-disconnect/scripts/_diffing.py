"""Compare the two saved drafts with what the draft step wrote (shared by `diff_draft.py` and
`finalize.py`, so what the PMO confirms is exactly what is checked again before the final).

`compare_drafts(paths, analysis, meta)` reads the two saved workbooks (possibly re-saved by
Excel), the two snapshots (hidden sheet and sidecar), the plans and the effective configs and
returns a `Comparison`:

* `changes`    {person, date, before, after} rows. Main plan: the person's name, `before`/`after` the
               shift text of the Winter Plan cell ("" = not working). Analytics plan: `person` is
               `Analytics <slot label>` (e.g. `Analytics S2-A`, `Analytics On call`) and
               `before`/`after` are the assigned names.
* `blocking`   audit ERRORS in either saved file, tampered / missing snapshots, unreadable or
               missing files, a person row missing from the main plan, changed inputs or configs,
               a file that changed while it was being read.
* `issues`     `blocking` plus warnings (a person row added, a sheet snapshot that is gone, ...).
* `audit_flags` the audits of the SAVED files as flag dicts (keys assigned), compared by the
               caller with `flags.json` for new / resolved / remaining.
* `hashes`     sha256 of the two saved drafts.

Nothing is written. Names appear in the returned rows (they go to `output/` only); the scripts
print counts.
"""

from __future__ import annotations

import os
import warnings
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Any, Optional

import openpyxl

from _common import (
    ANALYTICS_TAG,
    MAIN_TAG,
    Paths,
    TaskError,
    analytics_flag,
    assign_keys,
    changed_inputs,
    load_analytics,
    load_winter,
    main_flag,
    parse_analytics,
    parse_winter,
    read_json,
    sha256_file,
)
from roster_lib.config import name_key
from winter_lib.analytics_audit import audit_analytics_plan, diff_against_snapshot
from winter_lib.analytics_plan import AnalyticsPlan
from winter_lib.analytics_workbook import (
    read_snapshot_sheet as read_analytics_snapshot_sheet,
    read_snapshot_sidecar as read_analytics_snapshot_sidecar,
)
from winter_lib.winter_audit import audit_winter_plan
from winter_lib.winter_plan import WinterPlan
from winter_lib.winter_snapshot import read_snapshot_sheet, read_snapshot_sidecar
from winter_lib.winter_types import canonical_shift, display_code
from winter_lib.winter_workbook import SHEET_PLAN

_HEADER_SCAN = 15


@dataclass
class Comparison:
    changes: list[dict[str, str]] = field(default_factory=list)
    blocking: list[dict[str, str]] = field(default_factory=list)
    issues: list[dict[str, Any]] = field(default_factory=list)
    audit_flags: list[dict[str, Any]] = field(default_factory=list)
    hashes: dict[str, Optional[str]] = field(default_factory=dict)
    names: dict[str, Optional[str]] = field(default_factory=dict)
    counts: dict[str, int] = field(default_factory=dict)
    snapshot_sources: dict[str, Optional[str]] = field(default_factory=dict)
    audits: dict[str, Any] = field(default_factory=dict)  # main / analytics audit summaries

    def block(self, kind: str, message: str) -> None:
        self.blocking.append({"kind": kind, "message": message})
        self.issues.append({"severity": "error", "kind": kind, "message": message})

    def warn(self, kind: str, message: str) -> None:
        self.issues.append({"severity": "warning", "kind": kind, "message": message})


# ---- the main plan's grid -------------------------------------------------------------------

def _norm(v: Any) -> str:
    return " ".join(str(v or "").split()).casefold()


def _as_date(v: Any) -> Optional[date]:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    return None


@dataclass
class GridPerson:
    name: str
    row: int
    cells: dict[date, str]


def read_plan_grid(path: Path) -> tuple[list[GridPerson], list[str]]:
    """The people rows of the Winter Plan sheet: name -> {date: cell text}. The header is found by
    its text (`Team member`, the date cells), so inserted rows or moved columns do not matter.
    Returns (rows, problems); a formula cell is read through its cached value when there is one."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            wb = openpyxl.load_workbook(os.fspath(path), data_only=False)
            cached = openpyxl.load_workbook(os.fspath(path), data_only=True)
    except Exception as exc:  # noqa: BLE001 - unreadable / not an xlsx
        return [], [f"the workbook cannot be opened ({type(exc).__name__})"]
    try:
        if SHEET_PLAN not in wb.sheetnames:
            return [], [f"the workbook has no {SHEET_PLAN!r} sheet"]
        ws, cws = wb[SHEET_PLAN], cached[SHEET_PLAN]
        name_pos = None
        for r in range(1, _HEADER_SCAN + 1):
            for c in range(1, min(ws.max_column, 12) + 1):
                if _norm(ws.cell(r, c).value) == "team member":
                    name_pos = (r, c)
                    break
            if name_pos:
                break
        if name_pos is None:
            return [], ["the header cell 'Team member' was not found on the Winter Plan sheet"]
        hr, name_col = name_pos
        for mr in ws.merged_cells.ranges:  # the label sits in the first cell of a merged block
            if mr.min_row <= hr <= mr.max_row and mr.min_col <= name_col <= mr.max_col:
                name_col = mr.max_col
                break
        date_cols: list[tuple[int, date]] = []
        date_row = None
        for r in range(hr, hr + 3):
            found = [(c, _as_date(ws.cell(r, c).value)) for c in range(1, ws.max_column + 1)]
            found = [(c, d) for c, d in found if d is not None]
            if found:
                date_cols, date_row = found, r
                break
        if not date_cols:
            return [], ["the date columns of the Winter Plan were not found"]

        def value(r: int, c: int) -> str:
            v = ws.cell(r, c).value
            if isinstance(v, str) and v.startswith("="):
                cv = cws.cell(r, c).value
                v = cv if cv is not None else v
            return "" if v is None else " ".join(str(v).split())

        rows: list[GridPerson] = []
        for r in range(max(date_row + 1, hr + 3), ws.max_row + 1):
            a = _norm(ws.cell(r, 1).value)
            if a == "total on shift" or _norm(ws.cell(r, name_col).value) == "total on shift":
                break
            name = ws.cell(r, name_col).value
            if name is None or not str(name).strip():
                continue
            idx = ws.cell(r, name_col - 1).value if name_col > 1 else 1
            if isinstance(idx, str) and idx.strip() and not idx.strip().isdigit():
                continue  # a merged group header that spilled into the name column
            rows.append(GridPerson(" ".join(str(name).split()), r,
                                   {d: value(r, c) for c, d in date_cols}))
        return rows, []
    finally:
        wb.close()
        cached.close()


def _same_shift(a: str, b: str) -> bool:
    if _norm(a) == _norm(b):
        return True
    ca, cb = canonical_shift(a), canonical_shift(b)
    return ca is not None and ca == cb


# ---- the two comparisons ---------------------------------------------------------------------

def _compare_main(cmp: Comparison, path: Path, plan: WinterPlan, cfg, names: list[str]) -> None:
    if not path.exists():
        cmp.block("DRAFT_MISSING", f"the main plan {path.name} is missing from output/; save your edits "
                  "in that file (do not rename it)")
        return
    bad = unreadable_reason(path)
    if bad:
        cmp.block("DRAFT_UNREADABLE", f"the main plan {path.name} is not a valid .xlsx file ({bad}): "
                  "save it as an Excel workbook under the same name")
        return
    # --- the snapshot: hidden sheet + sidecar must agree with each other and with plan.json
    sheet = sidecar = None
    try:
        sheet = read_snapshot_sheet(path)
    except Exception as exc:  # noqa: BLE001
        cmp.block("SNAPSHOT_TAMPERED", f"the main plan's hidden _snapshot sheet cannot be read "
                  f"({type(exc).__name__})")
    try:
        sidecar = read_snapshot_sidecar(path)
    except Exception as exc:  # noqa: BLE001
        cmp.block("SNAPSHOT_TAMPERED", f"the main plan's snapshot file cannot be read ({type(exc).__name__})")
    chosen = sheet or sidecar
    if sheet is None and sidecar is not None:
        cmp.warn("SNAPSHOT_SHEET_MISSING", "the main plan's hidden _snapshot sheet is gone; the "
                 "snapshot file next to it is used")
    if sheet is not None and sidecar is not None and sheet.digest() != sidecar.digest():
        cmp.block("SNAPSHOT_TAMPERED", "the main plan's hidden snapshot differs from its snapshot file")
    if chosen is None:
        if not any(b["kind"] == "SNAPSHOT_TAMPERED" for b in cmp.blocking):
            cmp.block("SNAPSHOT_MISSING", "the main plan has no snapshot (neither the hidden sheet nor "
                      "the snapshot file): the changes cannot be listed")
        return
    cmp.snapshot_sources["main"] = "sheet" if sheet is not None else "sidecar"
    expected = {(p.name, d): display_code(plan.code(p.name, d)) for p in plan.people for d in plan.window}
    if (chosen.meta.get("plan_hash") != plan.plan_hash()
            or {(c.person, c.date): c.text for c in chosen.cells} != expected):
        cmp.block("SNAPSHOT_TAMPERED", "the main plan's snapshot does not match the plan the draft step wrote")
        return
    cmp.counts["snapshot_cells"] = len(chosen.cells)

    # --- the grid as saved
    rows, problems = read_plan_grid(path)
    if problems:
        cmp.block("DRAFT_UNREADABLE", f"the main plan cannot be read: {problems[0]}")
        return
    by_key = {name_key(r.name): r for r in rows}
    seen: set[str] = set()
    for p in plan.people:
        k = name_key(p.name)
        row = by_key.get(k)
        if row is None:
            cmp.block("PERSON_MISSING", f"{p.name} is no longer on the main plan sheet (row deleted or renamed)")
            for d in plan.window:
                before = display_code(plan.code(p.name, d))
                if before:
                    cmp.changes.append({"person": p.name, "date": d.isoformat(), "before": before,
                                        "after": ""})
            continue
        seen.add(k)
        for d in plan.window:
            before = display_code(plan.code(p.name, d))
            after = row.cells.get(d, "")
            if not _same_shift(before, after):
                cmp.changes.append({"person": p.name, "date": d.isoformat(), "before": before,
                                    "after": after})
    for row in rows:
        if name_key(row.name) in seen:
            continue
        cmp.warn("PERSON_ADDED", f"{row.name} was added to the main plan sheet (not in the draft)")
        for d, text in sorted(row.cells.items()):
            if text:
                cmp.changes.append({"person": row.name, "date": d.isoformat(), "before": "",
                                    "after": text})

    audit = audit_winter_plan(path, cfg, roster_names=names)
    cmp.audits["main"] = audit.summary
    for f in audit.findings:
        cmp.audit_flags.append(main_flag(f))
        if f.severity == "error":
            cmp.block("WINTER_" + f.code.upper(), f"{MAIN_TAG} {f.message}")


def _compare_analytics(cmp: Comparison, path: Path, acfg, aplan_json: dict) -> None:
    if not path.exists():
        cmp.block("DRAFT_MISSING", f"the Analytics plan {path.name} is missing from output/; save your "
                  "edits in that file (do not rename it)")
        return
    bad = unreadable_reason(path)
    if bad:
        cmp.block("DRAFT_UNREADABLE", f"the Analytics plan {path.name} is not a valid .xlsx file ({bad}): "
                  "save it as an Excel workbook under the same name")
        return
    sheet = sidecar = None
    try:
        sheet = read_analytics_snapshot_sheet(path)
    except Exception as exc:  # noqa: BLE001
        cmp.block("SNAPSHOT_TAMPERED", f"the Analytics plan's hidden _snapshot sheet cannot be read "
                  f"({type(exc).__name__})")
    try:
        sidecar = read_analytics_snapshot_sidecar(path)
    except Exception as exc:  # noqa: BLE001
        cmp.block("SNAPSHOT_TAMPERED", f"the Analytics plan's snapshot file cannot be read "
                  f"({type(exc).__name__})")
    chosen = sheet or sidecar
    if sheet is None and sidecar is not None:
        cmp.warn("SNAPSHOT_SHEET_MISSING", "the Analytics plan's hidden _snapshot sheet is gone; the "
                 "snapshot file next to it is used")
    if sheet is not None and sidecar is not None and sheet.digest() != sidecar.digest():
        cmp.block("SNAPSHOT_TAMPERED", "the Analytics plan's hidden snapshot differs from its snapshot file")
    if chosen is None:
        if not any(b["kind"] == "SNAPSHOT_TAMPERED" for b in cmp.blocking):
            cmp.block("SNAPSHOT_MISSING", "the Analytics plan has no snapshot (neither the hidden sheet nor "
                      "the snapshot file): the changes cannot be listed")
        return
    cmp.snapshot_sources["analytics"] = "sheet" if sheet is not None else "sidecar"
    if chosen.meta.get("plan_hash") != aplan_json.get("plan_hash"):
        cmp.block("SNAPSHOT_TAMPERED", "the Analytics plan's snapshot does not match the plan the draft "
                  "step wrote")
        return
    cmp.counts["analytics_snapshot_rows"] = len(chosen.rows)

    diff = diff_against_snapshot(path)
    unreadable = [x for x in diff.problems if "cannot be opened" in x or "no table" in x]
    if unreadable:  # (a snapshot problem was already reported above from the structured reads)
        cmp.block("DRAFT_UNREADABLE", "the Analytics plan cannot be read: " + _first(unreadable))
        return
    order = {(r[1], r[2]): i for i, r in enumerate(chosen.rows)}
    for ch in sorted(diff.changes, key=lambda c: (order.get((c.date.isoformat(), c.slot), 10 ** 6),
                                                  c.date, c.slot)):
        cmp.changes.append({"person": f"Analytics {ch.slot}", "date": ch.date.isoformat(),
                            "before": ch.was, "after": ch.now})

    audit = audit_analytics_plan(path, acfg)
    cmp.audits["analytics"] = {"filled": audit.filled, "total_slots": audit.total_slots,
                               "errors": len(audit.errors), "warnings": len(audit.warnings)}
    for f in audit.findings:
        cmp.audit_flags.append(analytics_flag(f))
        if f.severity == "error":
            cmp.block("ANALYTICS_" + f.rule.upper(), f"{ANALYTICS_TAG} {f.message}")


def _first(problems: list[str]) -> str:
    return problems[0].split("(")[0].strip()


def unreadable_reason(path: Path) -> Optional[str]:
    """None when `path` opens as a workbook, else the exception type name."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            openpyxl.load_workbook(os.fspath(path), read_only=True).close()
        return None
    except Exception as exc:  # noqa: BLE001
        return type(exc).__name__


def compare_drafts(paths: Paths, analysis: dict, meta: dict) -> Comparison:
    """See the module docstring. Raises `TaskError` only when the comparison cannot be made at all
    (a plan or an effective config of the draft step is missing)."""
    cmp = Comparison()
    for msg in changed_inputs(paths, analysis["inputs"]):
        cmp.block("INPUT_CHANGED", msg + "; start the task again")
    plan_text = paths.plan
    if not plan_text.exists():
        raise TaskError("the plan is missing (output/plan.json); run the 'Build the draft plans' step first")
    try:
        plan = WinterPlan.from_json(plan_text.read_text(encoding="utf-8"))
    except (OSError, ValueError, KeyError):
        raise TaskError("the plan (plan.json) cannot be read") from None
    aplan = read_json(paths.analytics_plan, "the Analytics plan")
    if plan.plan_hash() != meta["plan_hashes"]["main"] or aplan.get("plan_hash") != meta["plan_hashes"]["analytics"]:
        cmp.block("PLAN_CHANGED", "plan.json or analytics-plan.json differs from the one the draft step wrote")
    for key, path in (("winter", paths.winter_effective), ("analytics", paths.analytics_effective)):
        if not path.exists():
            raise TaskError(f"{path.name} is missing; run the 'Build the draft plans' step first")
        if sha256_file(path) != meta["effective_configs"][key]:
            cmp.block("CONFIG_CHANGED", f"{path.name} changed after the draft step wrote it")
    cfg, _ = load_winter(paths, paths.winter_effective)
    acfg, _ = load_analytics(paths, paths.analytics_effective)

    main_path, an_path = paths.root / meta["files"]["main"], paths.root / meta["files"]["analytics"]
    for key, p in (("main", main_path), ("analytics", an_path)):
        cmp.names[key] = p.name
        cmp.hashes[key] = sha256_file(p) if p.exists() else None
    _compare_main(cmp, main_path, plan, cfg, list(meta["roster_names"]))
    _compare_analytics(cmp, an_path, acfg, aplan)
    for key, p in (("main", main_path), ("analytics", an_path)):
        after = sha256_file(p) if p.exists() else None
        if after != cmp.hashes[key]:
            cmp.block("FILE_CHANGED", f"{p.name} changed while it was being compared (is it open and "
                      "being saved?): run the comparison again")
    cmp.audit_flags = assign_keys(cmp.audit_flags)
    return cmp
