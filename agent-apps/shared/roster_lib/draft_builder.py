"""
Step 6 "Draft": a COPY of the master with the cycle's cells filled in, summary
sheets and a hidden snapshot of exactly what was written.

build_draft(master, draft, plan) does, in order:

1. patch the plan's in-file cells into a copy of the master (xlsx_patch: one
   sheet part rewritten, nothing else touched);
2. append sheets (xlsx_sheets: package level, no openpyxl save):
     Draft Summary, Shift changes, Holiday assignments, Flags, Run log   (visible)
     _snapshot                                                           (veryHidden)
3. write `<draft>.snapshot.json` next to the draft, same snapshot as the hidden
   sheet (plus the flags the plan raised) for a tamper cross-check.

The master is only read. `draft_path` must differ from `master_path`.

Snapshot design
    The snapshot is the exact (person, date, text) of every cell the draft
    wrote, plus a meta block: master sha256, plan content hash, cycle, the sheet
    name, the roster's first/last date, the summary sheet names, schema version.
    The PMO edits the draft and saves it (Excel re-saves the whole file: shared
    strings are reindexed, styles rewritten, cached values recomputed). The
    snapshot is plain text in a veryHidden sheet (it cannot be unhidden from the
    Excel UI), mirrored in the sidecar. draft_diff compares the saved draft with
    it cell by cell; final_build refuses when the two copies disagree. Dates are
    stored as ISO text, row/col as numbers, so nothing is reinterpreted by Excel.

Idempotence: the same master + plan gives the same cell content in every sheet;
the only run-dependent content (creation time, library commit) lives in Run log.

`plan` is duck-typed (see cycle_builder.Plan): cycle, edits, remainder_edits,
shift_changes, holiday_assignments, flags (each with kind/severity/message/
person/date, and key when available), run_info, existing_roster_findings,
to_json(), and optionally snapshot_cells() (the exact cells written into the
file; defaults to plan.edits).
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import zipfile
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Mapping, Optional, Union

from .audit import canonical_json, file_record, iso_utc, sha256_file, sha256_text, utc_now
from .roster_io import DEFAULT_SHEET, Roster, load_roster
from .xlsx_patch import list_sheets, load_sheet, patch_workbook
from .xlsx_sheets import Cell, SheetSpec, add_sheets, clean_text

SUMMARY_SHEET = "Draft Summary"
SHIFT_SHEET = "Shift changes"
HOLIDAY_SHEET = "Holiday assignments"
FLAGS_SHEET = "Flags"
RUNLOG_SHEET = "Run log"
SNAPSHOT_SHEET = "_snapshot"
SUMMARY_SHEETS = (SUMMARY_SHEET, SHIFT_SHEET, HOLIDAY_SHEET, FLAGS_SHEET, RUNLOG_SHEET)

SNAPSHOT_SCHEMA = "roster-draft-snapshot/1"
SIDECAR_SUFFIX = ".snapshot.json"
SNAPSHOT_MARK = "roster-draft-snapshot"
SNAPSHOT_HEADER = ("person", "date", "text", "row", "col")
FINDINGS_ROW_CAP = 1000

PathLike = Union[str, os.PathLike]
Cells = dict[tuple[str, date], str]


class DraftBuildError(Exception):
    """The draft could not be built (nothing is left behind)."""


class SnapshotError(Exception):
    """A snapshot sheet or sidecar could not be read."""


# ---------------------------------------------------------------------------
# Snapshot data


@dataclass(frozen=True)
class SnapshotCell:
    person: str
    date: date
    text: str
    row: int
    col: int

    def to_row(self) -> list[Any]:
        return [self.person, self.date.isoformat(), self.text, self.row, self.col]


@dataclass
class Snapshot:
    meta: dict[str, Any]
    cells: list[SnapshotCell]
    flags: list[dict[str, Any]] = field(default_factory=list)  # sidecar only

    def core(self) -> dict[str, Any]:
        """What the hidden sheet and the sidecar must agree on."""
        return {"meta": self.meta, "cells": [c.to_row() for c in self.cells]}

    def to_dict(self) -> dict[str, Any]:
        return {"schema": SNAPSHOT_SCHEMA, **self.core(), "flags": self.flags}

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), sort_keys=True, ensure_ascii=False, indent=1) + "\n"

    def digest(self) -> str:
        return sha256_text(canonical_json(self.core()))

    def cell_map(self) -> dict[tuple[str, date], SnapshotCell]:
        return {(c.person, c.date): c for c in self.cells}

    @staticmethod
    def from_dict(data: Mapping[str, Any]) -> "Snapshot":
        if data.get("schema") != SNAPSHOT_SCHEMA:
            raise SnapshotError(f"not a {SNAPSHOT_SCHEMA} document")
        try:
            cells = [SnapshotCell(p, date.fromisoformat(d), t or "", int(r), int(c))
                     for p, d, t, r, c in data["cells"]]
            return Snapshot(dict(data["meta"]), cells, list(data.get("flags", [])))
        except (KeyError, ValueError, TypeError) as e:
            raise SnapshotError(f"malformed snapshot: {e}") from None


def snapshot_rows(snap: Snapshot) -> list[list[Any]]:
    """The rows of the hidden `_snapshot` sheet (meta block, header, one row per cell)."""
    rows: list[list[Any]] = [[SNAPSHOT_MARK, SNAPSHOT_SCHEMA]]
    for k in sorted(snap.meta):
        rows.append([f"meta.{k}", json.dumps(snap.meta[k], sort_keys=True, ensure_ascii=False)])
    rows.append(list(SNAPSHOT_HEADER))
    for c in snap.cells:
        rows.append([c.person, c.date.isoformat(), c.text if c.text != "" else None, c.row, c.col])
    return rows


def read_snapshot_sheet(path: PathLike) -> Optional[Snapshot]:
    """The snapshot of a (possibly Excel re-saved) draft, None when it has no `_snapshot` sheet."""
    with zipfile.ZipFile(path) as z:
        if SNAPSHOT_SHEET not in [s.name for s in list_sheets(z)]:
            return None
    sheet = load_sheet(path, SNAPSHOT_SHEET)
    by_row: dict[int, dict[int, str]] = {}
    for (r, c), cell in sheet.cells.items():
        by_row.setdefault(r, {})[c] = cell.text
    if by_row.get(1, {}).get(1) != SNAPSHOT_MARK:
        raise SnapshotError("the _snapshot sheet does not start with the snapshot marker")
    if by_row[1].get(2) != SNAPSHOT_SCHEMA:
        raise SnapshotError(f"unsupported snapshot schema {by_row[1].get(2)!r}")
    meta: dict[str, Any] = {}
    cells: list[SnapshotCell] = []
    header_row = None
    for r in sorted(by_row):
        if r == 1:
            continue
        row = by_row[r]
        first = row.get(1, "")
        if header_row is None:
            if first.startswith("meta."):
                try:
                    meta[first[5:]] = json.loads(row.get(2, ""))
                except json.JSONDecodeError:
                    raise SnapshotError(f"unreadable meta value in row {r}") from None
            elif tuple(row.get(i, "") for i in range(1, 6)) == SNAPSHOT_HEADER:
                header_row = r
            else:
                raise SnapshotError(f"unexpected row {r} in the _snapshot meta block")
            continue
        try:
            cells.append(SnapshotCell(first, date.fromisoformat(row.get(2, "")), row.get(3, ""),
                                      int(float(row.get(4, ""))), int(float(row.get(5, "")))))
        except ValueError:
            raise SnapshotError(f"unreadable snapshot cell in row {r}") from None
    if header_row is None:
        raise SnapshotError("the _snapshot sheet has no header row")
    return Snapshot(meta, cells)


def read_snapshot_sidecar(path: PathLike) -> Optional[Snapshot]:
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return Snapshot.from_dict(json.load(f))
    except json.JSONDecodeError as e:
        raise SnapshotError(f"sidecar is not valid JSON: {e}") from None


def sidecar_path_for(draft_path: PathLike) -> str:
    return os.fspath(draft_path) + SIDECAR_SUFFIX


# ---------------------------------------------------------------------------
# Plan access (duck typed)


def plan_cells(plan: Any) -> Cells:
    """Exactly the in-file cells the plan writes (snapshot_cells() when the plan has it)."""
    fn = getattr(plan, "snapshot_cells", None)
    cells = fn() if callable(fn) else plan.edits
    return {(n, d): t for (n, d), t in cells.items()}


def plan_hash(plan: Any) -> str:
    return sha256_text(plan.to_json())


def _get(obj: Any, name: str, default: Any = None) -> Any:
    if isinstance(obj, Mapping):
        return obj.get(name, default)
    return getattr(obj, name, default)


def _iso(d: Any) -> Optional[str]:
    if d is None:
        return None
    return d.isoformat() if isinstance(d, date) else str(d)


def flag_key(flag: Any) -> str:
    """Flag.key when the flag has one, else a stable composite (kind, who, when, what)."""
    key = _get(flag, "key")
    if key:
        return str(key)
    return "|".join(str(x) for x in (
        _get(flag, "kind", ""), _get(flag, "person", ""), _iso(_get(flag, "date")) or "",
        _get(flag, "team", ""), _get(flag, "shift", ""), _get(flag, "message", "")))


def flag_dict(flag: Any) -> dict[str, Any]:
    return {"key": flag_key(flag), "kind": _get(flag, "kind", ""), "severity": _get(flag, "severity", ""),
            "message": _get(flag, "message", ""), "person": _get(flag, "person"),
            "date": _iso(_get(flag, "date")), "team": _get(flag, "team"), "shift": _get(flag, "shift")}


_SEV_RANK = {"ERROR": 0, "WARNING": 1, "INFO": 2}


def _to_date(v: Any) -> Any:
    if isinstance(v, str):
        try:
            return date.fromisoformat(v)
        except ValueError:
            return v
    return v


def _library_commit(plan: Any) -> Optional[str]:
    commit = (_get(plan, "run_info", {}) or {}).get("library_commit")
    if commit:
        return str(commit)
    try:
        out = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=os.path.dirname(os.path.abspath(__file__)),
                             capture_output=True, text=True, timeout=5)
        return out.stdout.strip() or None if out.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        return None


# ---------------------------------------------------------------------------
# Result


@dataclass
class DraftResult:
    draft_path: str
    sidecar_path: str
    master_path: str
    master_sha256: str
    draft_sha256: str
    snapshot_sha256: str
    plan_hash: str
    cycle_label: str
    sheet_names: list[str]
    cells_written: int
    people: int
    flags_by_severity: dict[str, int]
    changed_parts: list[str]
    added_parts: list[str]

    def to_dict(self) -> dict[str, Any]:
        return dict(self.__dict__)


# ---------------------------------------------------------------------------
# Sheets


def _kv(label: str, value: Any, style: Optional[str] = None) -> list[Any]:
    return [Cell(label, "bold"), Cell(value, style) if style else value]


def _table(title: str, headers: list[str], body: list[list[Any]], *, note: Optional[str] = None) -> list[list[Any]]:
    rows: list[list[Any]] = [[], [Cell(title, "bold")]]
    if note:
        rows.append([Cell(note, "info")])
    if not body:
        rows.append([Cell("(none)", "info")])
        return rows
    rows.append([Cell(h, "header") for h in headers])
    rows.extend(body)
    return rows


def _boundary_note(plan: Any, roster: Roster) -> str:
    yb = (_get(plan, "run_info", {}) or {}).get("year_boundary") or {}
    remainder = _get(plan, "remainder_edits", {}) or {}
    if yb.get("crosses") or remainder:
        rem = yb.get("remainder") or {}
        if rem:
            span = f"{rem.get('start')} to {rem.get('end')}"
        else:
            ds = sorted(d for _, d in remainder)
            span = f"{ds[0]} to {ds[-1]}" if ds else "?"
        return (f"The roster file ends on {roster.last_date.isoformat()}. This cycle continues beyond it ({span}); "
                f"{len(remainder)} cells for those dates are NOT in this file and go to the next-year file.")
    return f"The cycle ends inside the roster file (last column {roster.last_date.isoformat()}); nothing goes to a next-year file."


def _summary_sheet(plan: Any, roster: Roster, cells: Cells, flags: list[dict[str, Any]]) -> SheetSpec:
    cycle = plan.cycle
    sev = {"ERROR": 0, "WARNING": 0, "INFO": 0}
    by_kind: dict[str, int] = {}
    for f in flags:
        sev[f["severity"]] = sev.get(f["severity"], 0) + 1
        by_kind[f["kind"]] = by_kind.get(f["kind"], 0) + 1
    rows: list[list[Any]] = [
        [Cell(f"Draft summary - cycle {cycle.label}", "bold")],
        [Cell("Review the Flags sheet, fix cells in the roster sheet, save, then approve in the agent. "
              "The hidden snapshot is compared with this file afterwards: every changed cell is shown to you.", "info")],
        [],
        _kv("Cycle", cycle.label),
        _kv("Rotation Sunday", cycle.rotation_sunday),
        _kv("First day", cycle.start),
        _kv("Last day", cycle.end),
        _kv("Roster sheet", roster.sheet_name),
        _kv("Cells written into the roster", len(cells)),
        _kv("People", len({n for n, _ in cells})),
        _kv("Shift changes", len(_get(plan, "shift_changes", []) or [])),
        _kv("Holiday assignment groups", len(_get(plan, "holiday_assignments", []) or [])),
        _kv("Flags: errors", sev.get("ERROR", 0), "flag_red" if sev.get("ERROR") else None),
        _kv("Flags: warnings", sev.get("WARNING", 0), "flag_amber" if sev.get("WARNING") else None),
        _kv("Flags: info", sev.get("INFO", 0)),
        _kv("Year boundary", _boundary_note(plan, roster), "wrap"),
    ]
    rows += _table("Flags by kind", ["Kind", "Count"], [[k, v] for k, v in sorted(by_kind.items())])
    hol = {k: v for k, v in by_kind.items() if k.startswith("HOL_")}
    rows += _table("HOL check on the draft", ["Kind", "Count"], [[k, v] for k, v in sorted(hol.items())],
                   note="Result of the holiday check on the draft cycle (details on the Flags sheet).")
    ex = _get(plan, "existing_roster_findings", {}) or {}
    ex_hol = ex.get("hol") or []
    ex_staff = ex.get("staffing") or []
    year = ex.get("year", "")
    rows += _table(f"Existing roster findings {year} (before this draft)", ["Kind", "Count"],
                   [[k, v] for k, v in sorted((ex.get("hol_by_kind") or {}).items())]
                   + ([["STAFFING", len(ex_staff)]] if ex_staff else []),
                   note=f"HOL check and staffing check on the existing roster, {ex.get('start', '')} to {ex.get('end', '')}.")
    body = [[Cell(f.get("severity", ""), _sev_style(f.get("severity"))), f.get("kind", ""), _to_date(f.get("date")),
             f.get("person"), f.get("location"), clean_text(f.get("message", ""))] for f in ex_hol[:FINDINGS_ROW_CAP]]
    rows += _table("Existing roster: HOL findings", ["Severity", "Kind", "Date", "Person", "Location", "Message"], body,
                   note=(f"Showing the first {FINDINGS_ROW_CAP} of {len(ex_hol)}." if len(ex_hol) > FINDINGS_ROW_CAP else None))
    body = [[s.get("team"), s.get("shift"), _to_date(s.get("date")), s.get("have"), s.get("need"),
             clean_text(s.get("message", ""))] for s in ex_staff[:FINDINGS_ROW_CAP]]
    rows += _table("Existing roster: staffing shortages", ["Team", "Shift", "Date", "Have", "Need", "Message"], body,
                   note=(f"Showing the first {FINDINGS_ROW_CAP} of {len(ex_staff)}." if len(ex_staff) > FINDINGS_ROW_CAP else None))
    return SheetSpec(SUMMARY_SHEET, rows, col_widths=[34, 22, 14, 20, 16, 70], tab_color="1F3864")


def _sev_style(severity: Optional[str]) -> Optional[str]:
    return {"ERROR": "flag_red", "WARNING": "flag_amber"}.get(severity or "")


def _shift_sheet(plan: Any) -> SheetSpec:
    rows: list[list[Any]] = [[Cell(h, "header") for h in
                              ("Person", "Old shift", "New shift", "Effective (rotation Sunday)", "First worked",
                               "Old pattern", "New pattern")]]
    for c in _get(plan, "shift_changes", []) or []:
        rows.append([_get(c, "person"), _get(c, "old_shift"), _get(c, "new_shift"), _to_date(_get(c, "effective")),
                     _to_date(_get(c, "first_worked")), _get(c, "old_pattern"), _get(c, "new_pattern")])
    return SheetSpec(SHIFT_SHEET, rows, col_widths=[28, 12, 12, 26, 14, 14, 14], freeze="A2", tab_color="86BC25")


def _counters(before: Mapping[str, Any], after: Mapping[str, Any]) -> str:
    lines = []
    for name in sorted(set(before) | set(after)):
        b, a = before.get(name) or {}, after.get(name) or {}
        lines.append(f"{name}: {b.get('offs_taken', '-')} -> {a.get('offs_taken', '-')}")
    return "\n".join(lines)


def _holiday_sheet(plan: Any) -> SheetSpec:
    head = ("Date", "Holiday", "Kind", "Team", "Shift", "Min staff", "Need", "Off (fairness)", "Off (straight)",
            "Working (covering)", "Outside pool", "Shortage", "Counters (offs taken before -> after)")
    rows: list[list[Any]] = [[Cell(h, "header") for h in head]]
    for a in _get(plan, "holiday_assignments", []) or []:
        rows.append([
            _to_date(_get(a, "date")), "; ".join(_get(a, "holidays", []) or []), _get(a, "kind"), _get(a, "team"),
            _get(a, "shift"), _get(a, "min_staff"), _get(a, "need"),
            Cell("\n".join(_get(a, "off", []) or []), "wrap"), Cell("\n".join(_get(a, "straight_off", []) or []), "wrap"),
            Cell("\n".join(_get(a, "covering", []) or []), "wrap"), Cell("\n".join(_get(a, "outside", []) or []), "wrap"),
            _get(a, "shortage"), Cell(_counters(_get(a, "counters_before", {}) or {}, _get(a, "counters_after", {}) or {}), "wrap"),
        ])
    return SheetSpec(HOLIDAY_SHEET, rows, col_widths=[12, 28, 20, 14, 10, 10, 6, 26, 26, 26, 22, 9, 34],
                     freeze="A2", tab_color="86BC25")


def _flags_sheet(flags: list[dict[str, Any]]) -> SheetSpec:
    rows: list[list[Any]] = [[Cell(h, "header") for h in ("Severity", "Kind", "Person", "Date", "Message", "Team", "Shift", "Key")]]
    styles: dict[int, str] = {}
    for f in flags:
        style = _sev_style(f["severity"])
        if style:
            styles[len(rows)] = style
        rows.append([f["severity"], f["kind"], f["person"], _to_date(f["date"]), clean_text(f["message"]),
                     f["team"], f["shift"], f["key"]])
    return SheetSpec(FLAGS_SHEET, rows, col_widths=[10, 26, 26, 12, 90, 14, 10, 40], freeze="A2",
                     tab_color="C00000", row_styles=styles)


def _runlog_sheet(plan: Any, master_rec: dict, inputs: dict[str, Optional[dict]], snap_meta: Mapping[str, Any],
                  commit: Optional[str], now: datetime, extra: Optional[Mapping[str, Any]]) -> SheetSpec:
    ri = _get(plan, "run_info", {}) or {}
    cfg = ri.get("config") or {}
    rows: list[list[Any]] = [
        [Cell("Key", "header"), Cell("Value", "header"), Cell("Detail", "header")],
        _kv("Created (UTC)", iso_utc(now)),
        _kv("Cycle", plan.cycle.label),
        _kv("Cycle start", plan.cycle.start),
        _kv("Cycle end", plan.cycle.end),
        _kv("Rotation Sunday", plan.cycle.rotation_sunday),
        _kv("Config version", cfg.get("version")),
        _kv("Seed used", ri.get("seed_used")),
        _kv("Seed source", ri.get("seed_source")),
        _kv("Library version", ri.get("library_version")),
        _kv("Library commit", commit),
        _kv("Plan hash (sha256)", snap_meta["plan_hash"]),
        _kv("Snapshot cells", snap_meta["cell_count"]),
        _kv("Master file", master_rec["name"], None) + [master_rec["sha256"]],
    ]
    for label, rec in inputs.items():
        rows.append([Cell(label, "bold"), rec["name"] if rec else "(not used)", rec["sha256"] if rec else None])
    rows.append(_kv("Approver", "(pending: recorded when the final roster is built)"))
    for k, v in (extra or {}).items():
        rows.append([Cell(clean_text(k), "bold"), clean_text(v if isinstance(v, str) else json.dumps(v, default=str, sort_keys=True))])
    return SheetSpec(RUNLOG_SHEET, rows, col_widths=[26, 44, 70], freeze="A2", tab_color="7F7F7F")


# ---------------------------------------------------------------------------
# Build


def _resolve_cells(roster: Roster, cells: Cells) -> tuple[dict[tuple[int, int], str], list[SnapshotCell]]:
    problems: list[str] = []
    addr: dict[tuple[int, int], str] = {}
    out: list[SnapshotCell] = []
    seen_names: dict[str, Optional[Any]] = {}
    for (name, d), text in cells.items():
        if name not in seen_names:
            found = roster.find(name)
            seen_names[name] = found[0] if len(found) == 1 else None
            if len(found) != 1:
                problems.append(f"person {name!r}: {'not in the roster' if not found else 'ambiguous (several rows)'}")
        person = seen_names[name]
        if person is None:
            continue
        if d not in roster.date_to_col:
            problems.append(f"{name} {d}: date is outside the roster's dates (in-file cells only)")
            continue
        row, col = roster.address(person, d)
        addr[(row, col)] = text
        out.append(SnapshotCell(name, d, text, row, col))
    if problems:
        shown = sorted(set(problems))
        raise DraftBuildError(f"{len(shown)} problem(s) resolving plan cells: " + "; ".join(shown[:10]))
    out.sort(key=lambda c: (c.row, c.date))
    return addr, out


def build_draft(
    master_path: PathLike,
    draft_path: PathLike,
    plan: Any,
    *,
    matrix_path: Optional[PathLike] = None,
    pto_path: Optional[PathLike] = None,
    config_path: Optional[PathLike] = None,
    extra_run_log: Optional[Mapping[str, Any]] = None,
    sheet_name: str = DEFAULT_SHEET,
    roster: Optional[Roster] = None,
    now: Optional[datetime] = None,
) -> DraftResult:
    """Build the draft workbook and its sidecar (see the module docstring).

    pto_path / config_path / matrix_path are only hashed into the Run log.
    roster: the already loaded master roster (skips a second read).
    now: creation time for the Run log (tests); default the current UTC time.
    """
    master = os.path.abspath(os.fspath(master_path))
    draft = os.path.abspath(os.fspath(draft_path))
    if os.path.normcase(master) == os.path.normcase(draft):
        raise DraftBuildError("the draft must be written to a different file than the master")
    if not os.path.exists(master):
        raise DraftBuildError(f"master file not found: {master}")
    now = now or utc_now()
    master_sha = sha256_file(master)
    roster = roster or load_roster(master, sheet_name)
    cells = plan_cells(plan)
    edits, snap_cells = _resolve_cells(roster, cells)
    flags = sorted((flag_dict(f) for f in (_get(plan, "flags", []) or [])),
                   key=lambda f: (_SEV_RANK.get(f["severity"], 9), f["date"] or "", f["kind"], f["person"] or "", f["key"]))

    ri = _get(plan, "run_info", {}) or {}
    meta: dict[str, Any] = {
        "master_sha256": master_sha,
        "plan_hash": plan_hash(plan),
        "cycle": {"label": plan.cycle.label, "start": plan.cycle.start.isoformat(), "end": plan.cycle.end.isoformat(),
                  "rotation_sunday": plan.cycle.rotation_sunday.isoformat()},
        "sheet_name": roster.sheet_name,
        "roster": {"first_date": roster.first_date.isoformat(), "last_date": roster.last_date.isoformat()},
        "summary_sheets": list(SUMMARY_SHEETS),
        "cell_count": len(snap_cells),
        "library_version": ri.get("library_version"),
        "config_version": (ri.get("config") or {}).get("version"),
        "seed": ri.get("seed_used"),
    }
    snapshot = Snapshot(meta, snap_cells, [f for f in flags])

    inputs = {"Holiday matrix": file_record(matrix_path), "PTO import": file_record(pto_path),
              "Rotation config": file_record(config_path)}
    commit = _library_commit(plan)
    specs = [
        _summary_sheet(plan, roster, cells, flags),
        _shift_sheet(plan),
        _holiday_sheet(plan),
        _flags_sheet(flags),
        _runlog_sheet(plan, file_record(master), inputs, meta, commit, now, extra_run_log),
        SheetSpec(SNAPSHOT_SHEET, snapshot_rows(snapshot), state="veryHidden"),
    ]

    os.makedirs(os.path.dirname(draft) or ".", exist_ok=True)
    fd, tmp = tempfile.mkstemp(suffix=".patched.tmp", dir=os.path.dirname(draft) or ".")
    os.close(fd)
    sidecar = sidecar_path_for(draft)
    try:
        patched = patch_workbook(master, tmp, roster.sheet_name, edits)
        added = add_sheets(tmp, draft, specs)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    with open(sidecar, "w", encoding="utf-8", newline="\n") as f:
        f.write(snapshot.to_json())

    sev_counts: dict[str, int] = {}
    for f in flags:
        sev_counts[f["severity"]] = sev_counts.get(f["severity"], 0) + 1
    return DraftResult(
        draft_path=draft, sidecar_path=sidecar, master_path=master, master_sha256=master_sha,
        draft_sha256=sha256_file(draft), snapshot_sha256=snapshot.digest(), plan_hash=meta["plan_hash"],
        cycle_label=plan.cycle.label, sheet_names=added.sheet_names, cells_written=len(snap_cells),
        people=len({c.person for c in snap_cells}), flags_by_severity=dict(sorted(sev_counts.items())),
        changed_parts=sorted(set(added.changed_parts) | set(patched.changed_parts)), added_parts=added.added_parts)
