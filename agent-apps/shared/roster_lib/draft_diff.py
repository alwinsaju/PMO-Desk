"""
Step 7 "Diff": what did the PMO change in the saved draft?

diff_draft(saved_draft) reads the draft the PMO edited and saved (most likely
RE-SAVED BY EXCEL: shared strings reindexed, styles rewritten, cached values
recomputed; sheet order and hidden state kept) with the tolerant text readers
(roster_io / xlsx_patch, no openpyxl) and compares it with the snapshot that
draft_builder stored:

* changes: every snapshot cell whose current text differs from the snapshot
  (person, date, before = the draft agent's value, after = what the PMO left),
  sorted by (row order, date);
* outside_snapshot_changes: cells inside the person x date grid that are NOT in
  the snapshot but differ from the master (only when master_path is given);
* issues: tamper, structure and non-grid problems (see DiffIssue codes below);
* flag delta: when `recheck` is given, the edited schedule of the in-scope
  people (the snapshot's people, the cycle's in-file dates) is re-checked and
  compared with `flags_before` by flag key: new / resolved / remaining.

Snapshot source: the veryHidden `_snapshot` sheet, else the sidecar
`<draft>.snapshot.json`. When both exist and disagree the diff carries the error
issue SNAPSHOT_TAMPERED (and compares against the sidecar, the copy the agent
wrote outside the workbook); final_build refuses while any error issue exists.

Issue codes. error (blocking): SNAPSHOT_MISSING, SNAPSHOT_TAMPERED,
ROSTER_UNREADABLE, MASTER_UNREADABLE, MASTER_CHANGED, PERSON_MISSING,
PERSON_AMBIGUOUS, DATES_CHANGED. warning: SNAPSHOT_SHEET_MISSING,
SNAPSHOT_SHEET_UNREADABLE, SIDECAR_MISSING, SIDECAR_UNREADABLE, NAME_CHANGED,
PERSON_ADDED, PERSON_ATTRIBUTES_CHANGED, SUMMARY_SHEET_MISSING, SHEET_MISSING,
SHEET_STATE_CHANGED, HOLIDAY_LABELS_CHANGED, FORMULA_IN_GRID. info:
FLAGS_BEFORE_UNKNOWN, OUTSIDE_NOT_CHECKED.

`recheck` and `flag_delta` are injected (see cycle_builder.make_rechecker /
flag_delta); a local equivalent keyed by Flag.key is the default for flag_delta.
"""

from __future__ import annotations

import json
import os
import zipfile
from dataclasses import dataclass, field
from datetime import date
from types import SimpleNamespace
from typing import Any, Callable, Iterable, Optional, Sequence, Union

from .audit import sha256_file
from .draft_builder import (
    Snapshot,
    SnapshotCell,
    SnapshotError,
    flag_dict,
    read_snapshot_sheet,
    read_snapshot_sidecar,
    sidecar_path_for,
)
from .roster_io import DEFAULT_SHEET, Roster, RosterFormatError, load_roster
from .xlsx_patch import list_sheets

DIFF_FORMAT = "draft-diff/1"
PathLike = Union[str, os.PathLike]
_SEV_RANK = {"ERROR": 0, "WARNING": 1, "INFO": 2}


def _nk(name: str) -> str:
    return " ".join(name.split()).casefold()


@dataclass(frozen=True)
class CellChange:
    person: str
    date: date
    before: str
    after: str
    row: int
    col: int

    def to_dict(self) -> dict[str, Any]:
        return {"person": self.person, "date": self.date.isoformat(), "before": self.before, "after": self.after,
                "row": self.row, "col": self.col}


@dataclass(frozen=True)
class DiffIssue:
    code: str
    severity: str  # "error" | "warning" | "info"
    message: str
    person: Optional[str] = None
    date: Optional[date] = None

    def to_dict(self) -> dict[str, Any]:
        return {"code": self.code, "severity": self.severity, "message": self.message, "person": self.person,
                "date": self.date.isoformat() if self.date else None}


def default_flag_delta(before: Iterable[Any], after: Iterable[Any]) -> tuple[list[Any], list[Any], list[Any]]:
    """(new, resolved, remaining) keyed by Flag.key; equivalent of cycle_builder.flag_delta."""
    bk = {f.key: f for f in before}
    ak = {f.key: f for f in after}
    return ([ak[k] for k in ak if k not in bk], [bk[k] for k in bk if k not in ak], [ak[k] for k in ak if k in bk])


def _flag_obj(f: Any) -> Any:
    """Dicts (sidecar flags) get attribute access so key-based helpers can use them."""
    if isinstance(f, dict):
        d = dict(f)
        d.setdefault("key", flag_dict(f)["key"])
        return SimpleNamespace(**d)
    if not getattr(f, "key", None):
        return SimpleNamespace(**flag_dict(f))
    return f


def _flag_sort(f: dict[str, Any]):
    return (_SEV_RANK.get(f["severity"], 9), f["date"] or "", f["key"])


@dataclass
class DraftDiff:
    saved_draft: str
    saved_draft_sha256: str
    snapshot_source: Optional[str]  # "sheet" | "sidecar" | None
    snapshot_digest: Optional[str]
    meta: dict[str, Any]
    changes: list[CellChange] = field(default_factory=list)
    outside_snapshot_changes: list[CellChange] = field(default_factory=list)
    outside_checked: bool = False
    issues: list[DiffIssue] = field(default_factory=list)
    recheck_ran: bool = False
    flags_new: list[dict[str, Any]] = field(default_factory=list)
    flags_resolved: list[dict[str, Any]] = field(default_factory=list)
    flags_remaining: list[dict[str, Any]] = field(default_factory=list)
    snapshot: list[SnapshotCell] = field(default_factory=list, repr=False)  # not in to_dict (can be large)

    @property
    def blocking_issues(self) -> list[DiffIssue]:
        return [i for i in self.issues if i.severity == "error"]

    @property
    def has_changes(self) -> bool:
        return bool(self.changes or self.outside_snapshot_changes)

    def issue_codes(self) -> list[str]:
        return sorted({i.code for i in self.issues})

    def to_dict(self) -> dict[str, Any]:
        return {
            "format": DIFF_FORMAT,
            "saved_draft": os.path.basename(self.saved_draft),
            "saved_draft_sha256": self.saved_draft_sha256,
            "snapshot_source": self.snapshot_source,
            "snapshot_digest": self.snapshot_digest,
            "snapshot_cells": len(self.snapshot),
            "meta": self.meta,
            "counts": {"changes": len(self.changes), "outside_snapshot_changes": len(self.outside_snapshot_changes),
                       "issues": len(self.issues), "blocking": len(self.blocking_issues),
                       "flags_new": len(self.flags_new), "flags_resolved": len(self.flags_resolved),
                       "flags_remaining": len(self.flags_remaining)},
            "changes": [c.to_dict() for c in self.changes],
            "outside_snapshot_changes": [c.to_dict() for c in self.outside_snapshot_changes],
            "outside_checked": self.outside_checked,
            "issues": [i.to_dict() for i in self.issues],
            "recheck_ran": self.recheck_ran,
            "flags": {"new": self.flags_new, "resolved": self.flags_resolved, "remaining": self.flags_remaining},
        }

    def to_json(self) -> str:
        """Deterministic text for the UI diff view (same inputs, identical bytes)."""
        return json.dumps(self.to_dict(), sort_keys=True, ensure_ascii=False, indent=2) + "\n"


# ---------------------------------------------------------------------------


def _load_snapshot(saved: str, sidecar_path: Optional[PathLike], issues: list[DiffIssue]) -> tuple[Optional[Snapshot], Optional[str], Optional[Snapshot]]:
    """-> (snapshot to compare against, its source, the sidecar snapshot)."""
    sheet_snap = side_snap = None
    try:
        sheet_snap = read_snapshot_sheet(saved)
    except SnapshotError as e:
        issues.append(DiffIssue("SNAPSHOT_SHEET_UNREADABLE", "warning", f"the _snapshot sheet is unreadable: {e}"))
    side_path = os.fspath(sidecar_path) if sidecar_path else sidecar_path_for(saved)
    try:
        side_snap = read_snapshot_sidecar(side_path)
    except SnapshotError as e:
        issues.append(DiffIssue("SIDECAR_UNREADABLE", "warning", f"the snapshot sidecar is unreadable: {e}"))

    if sheet_snap is not None and side_snap is not None:
        if sheet_snap.core() == side_snap.core():
            return sheet_snap, "sheet", side_snap
        issues.append(DiffIssue("SNAPSHOT_TAMPERED", "error", "the hidden _snapshot sheet and the sidecar disagree: "
                                + _describe_mismatch(sheet_snap, side_snap) + "; comparing against the sidecar"))
        return side_snap, "sidecar", side_snap
    if sheet_snap is not None:
        if side_snap is None and not any(i.code == "SIDECAR_UNREADABLE" for i in issues):
            issues.append(DiffIssue("SIDECAR_MISSING", "warning", "no snapshot sidecar next to the draft to cross-check the hidden sheet"))
        return sheet_snap, "sheet", None
    if side_snap is not None:
        if not any(i.code == "SNAPSHOT_SHEET_UNREADABLE" for i in issues):
            issues.append(DiffIssue("SNAPSHOT_SHEET_MISSING", "warning", "the hidden _snapshot sheet is gone; using the sidecar"))
        return side_snap, "sidecar", side_snap
    issues.append(DiffIssue("SNAPSHOT_MISSING", "error", "neither the _snapshot sheet nor the sidecar is available: cannot tell which cells the draft wrote"))
    return None, None, None


def _describe_mismatch(a: Snapshot, b: Snapshot) -> str:
    keys = sorted(k for k in set(a.meta) | set(b.meta) if a.meta.get(k) != b.meta.get(k))
    ca = {(c.person, c.date): c.to_row() for c in a.cells}
    cb = {(c.person, c.date): c.to_row() for c in b.cells}
    diff_cells = sum(1 for k in set(ca) | set(cb) if ca.get(k) != cb.get(k))
    parts = []
    if keys:
        parts.append("meta differs in " + ", ".join(keys))
    if diff_cells:
        parts.append(f"{diff_cells} snapshot cell(s) differ")
    return "; ".join(parts) or "content differs"


def _sheet_states(path: str) -> dict[str, str]:
    with zipfile.ZipFile(path) as z:
        return {s.name: s.state for s in list_sheets(z)}


def diff_draft(
    saved_draft_path: PathLike,
    *,
    master_path: Optional[PathLike] = None,
    recheck: Optional[Callable[[dict[str, dict[date, str]]], Sequence[Any]]] = None,
    flags_before: Optional[Sequence[Any]] = None,
    sidecar_path: Optional[PathLike] = None,
    flag_delta: Optional[Callable[[Sequence[Any], Sequence[Any]], tuple]] = None,
) -> DraftDiff:
    saved = os.path.abspath(os.fspath(saved_draft_path))
    issues: list[DiffIssue] = []
    snapshot, source, side_snap = _load_snapshot(saved, sidecar_path, issues)
    diff = DraftDiff(saved_draft=saved, saved_draft_sha256=sha256_file(saved), snapshot_source=source,
                     snapshot_digest=snapshot.digest() if snapshot else None,
                     meta=dict(snapshot.meta) if snapshot else {}, issues=issues,
                     snapshot=list(snapshot.cells) if snapshot else [])
    if snapshot is None:
        return diff
    meta = snapshot.meta
    sheet = meta.get("sheet_name") or DEFAULT_SHEET

    master = os.path.abspath(os.fspath(master_path)) if master_path else None
    if master and sha256_file(master) != meta.get("master_sha256"):
        issues.append(DiffIssue("MASTER_CHANGED", "error", "the master file changed since the draft was built (sha256 differs from the snapshot)"))

    try:
        droster = load_roster(saved, sheet)
    except RosterFormatError as e:
        issues.append(DiffIssue("ROSTER_UNREADABLE", "error", f"the saved draft's roster sheet {sheet!r} cannot be read: {e}"))
        return diff

    mroster: Optional[Roster] = None
    if master:
        try:
            mroster = load_roster(master, sheet)
        except RosterFormatError as e:
            issues.append(DiffIssue("MASTER_UNREADABLE", "error", f"the master's roster sheet {sheet!r} cannot be read: {e}"))

    _check_dates(droster, mroster, meta, issues)
    if mroster is not None:
        _check_holiday_labels(droster, mroster, issues)
    _check_sheets(saved, master, meta, issues)

    reported: set[str] = set()
    changes = _compare_snapshot(droster, snapshot, issues, reported)
    diff.changes = changes
    if mroster is not None:
        diff.outside_checked = True
        diff.outside_snapshot_changes = _compare_outside(droster, mroster, snapshot, issues, reported)
    else:
        issues.append(DiffIssue("OUTSIDE_NOT_CHECKED", "info", "no master given: edits outside the snapshot cells were not looked for"))

    if recheck is not None:
        _run_recheck(diff, droster, snapshot, recheck, flags_before, side_snap, flag_delta)
    diff.issues.sort(key=lambda i: ({"error": 0, "warning": 1, "info": 2}[i.severity], i.code, i.person or "", i.date or date.min, i.message))
    return diff


def _check_dates(droster: Roster, mroster: Optional[Roster], meta: dict[str, Any], issues: list[DiffIssue]) -> None:
    expected: Optional[tuple[str, str, int]] = None
    if mroster is not None:
        expected = (mroster.first_date.isoformat(), mroster.last_date.isoformat(), len(mroster.dates))
    elif isinstance(meta.get("roster"), dict):
        r = meta["roster"]
        expected = (r.get("first_date"), r.get("last_date"), None)
    if expected is None:
        return
    got = (droster.first_date.isoformat(), droster.last_date.isoformat(), len(droster.dates))
    if got[:2] != expected[:2] or (expected[2] is not None and got[2] != expected[2]):
        issues.append(DiffIssue("DATES_CHANGED", "error",
                                f"the roster's dates changed: draft {got[0]}..{got[1]} ({got[2]} columns), expected {expected[0]}..{expected[1]}"))


def _check_holiday_labels(droster: Roster, mroster: Roster, issues: list[DiffIssue]) -> None:
    before, after = mroster.holiday_labels(), droster.holiday_labels()
    changed = sorted(d for d in (set(before) | set(after)) if d in droster.date_to_col and before.get(d, "") != after.get(d, ""))
    if changed:
        shown = ", ".join(d.isoformat() for d in changed[:5]) + (" ..." if len(changed) > 5 else "")
        issues.append(DiffIssue("HOLIDAY_LABELS_CHANGED", "warning", f"the holiday label row changed on {len(changed)} date(s): {shown}"))


def _check_sheets(saved: str, master: Optional[str], meta: dict[str, Any], issues: list[DiffIssue]) -> None:
    now = _sheet_states(saved)
    folded = {n.casefold() for n in now}
    for name in meta.get("summary_sheets") or []:
        if name.casefold() not in folded:
            issues.append(DiffIssue("SUMMARY_SHEET_MISSING", "warning", f"the summary sheet {name!r} is missing or was renamed"))
    if master:
        for name, state in _sheet_states(master).items():
            if name not in now:
                issues.append(DiffIssue("SHEET_MISSING", "warning", f"sheet {name!r} of the master is missing or was renamed in the draft"))
            elif now[name] != state:
                issues.append(DiffIssue("SHEET_STATE_CHANGED", "warning", f"sheet {name!r} was {state}, now {now[name]}"))


def _compare_snapshot(droster: Roster, snapshot: Snapshot, issues: list[DiffIssue], reported: set[str]) -> list[CellChange]:
    out: list[tuple[tuple[int, date], CellChange]] = []
    missing_dates: set[date] = set()
    for sc in snapshot.cells:
        found = droster.find(sc.person)
        if len(found) != 1:
            key = _nk(sc.person)
            if key not in reported:
                reported.add(key)
                if not found:
                    issues.append(DiffIssue("PERSON_MISSING", "error", f"{sc.person}: the person's row is missing or was renamed in the draft", sc.person))
                else:
                    issues.append(DiffIssue("PERSON_AMBIGUOUS", "error", f"{sc.person}: appears on {len(found)} rows in the draft", sc.person))
            continue
        if sc.date not in droster.date_to_col:
            if sc.date not in missing_dates:
                missing_dates.add(sc.date)
                issues.append(DiffIssue("DATES_CHANGED", "error", f"snapshot date {sc.date} is not a column of the saved draft", None, sc.date))
            continue
        p = found[0]
        after = droster.cell(p, sc.date)
        if droster.is_formula(p, sc.date):
            issues.append(DiffIssue("FORMULA_IN_GRID", "warning", f"{sc.person} {sc.date}: the cell holds a formula (its calculated text is compared)", sc.person, sc.date))
        if after != sc.text:
            out.append(((p.row, sc.date), CellChange(sc.person, sc.date, sc.text, after, p.row, droster.date_to_col[sc.date])))
    out.sort(key=lambda t: t[0])
    return [c for _, c in out]


def _compare_outside(droster: Roster, mroster: Roster, snapshot: Snapshot, issues: list[DiffIssue], reported: set[str]) -> list[CellChange]:
    in_snapshot = {(_nk(c.person), c.date) for c in snapshot.cells}
    master_names = {_nk(p.name) for p in mroster.people}
    added = [p for p in droster.people if _nk(p.name) not in master_names]
    added_by_row = {p.row: p for p in added}
    paired: set[str] = set()
    out: list[tuple[tuple[int, date], CellChange]] = []
    common_dates = [d for d in mroster.dates if d in droster.date_to_col]
    for mp in mroster.people:
        key = _nk(mp.name)
        found = droster.find(mp.name)
        if not found:
            if key not in reported:
                reported.add(key)
                twin = added_by_row.get(mp.row)
                if twin is not None:
                    paired.add(_nk(twin.name))
                    issues.append(DiffIssue("NAME_CHANGED", "warning", f"row {mp.row}: the name {mp.name!r} was changed to {twin.name!r}", mp.name))
                else:
                    issues.append(DiffIssue("PERSON_MISSING", "error", f"{mp.name}: the person's row is missing from the draft", mp.name))
            continue
        if len(found) > 1:
            if key not in reported:
                reported.add(key)
                issues.append(DiffIssue("PERSON_AMBIGUOUS", "error", f"{mp.name}: appears on {len(found)} rows in the draft", mp.name))
            continue
        dp = found[0]
        if (dp.location_code, dp.team_label, dp.section) != (mp.location_code, mp.team_label, mp.section):
            issues.append(DiffIssue("PERSON_ATTRIBUTES_CHANGED", "warning", f"{mp.name}: location, team or section differs from the master", mp.name))
        for d in common_dates:
            if (key, d) in in_snapshot:
                continue
            before, after = mroster.cell(mp, d), droster.cell(dp, d)
            if before != after:
                out.append(((dp.row, d), CellChange(mp.name, d, before, after, dp.row, droster.date_to_col[d])))
    for p in added:
        if _nk(p.name) not in paired:
            issues.append(DiffIssue("PERSON_ADDED", "warning", f"{p.name}: a person row that is not in the master", p.name))
    out.sort(key=lambda t: t[0])
    return [c for _, c in out]


def _run_recheck(diff: DraftDiff, droster: Roster, snapshot: Snapshot, recheck, flags_before, side_snap: Optional[Snapshot], flag_delta) -> None:
    cyc = snapshot.meta.get("cycle") or {}
    try:
        start, end = date.fromisoformat(cyc["start"]), date.fromisoformat(cyc["end"])
    except (KeyError, ValueError, TypeError):
        diff.issues.append(DiffIssue("SNAPSHOT_MISSING", "error", "the snapshot has no cycle dates: cannot re-check"))
        return
    dates = [d for d in droster.dates if start <= d <= end]
    people: dict[str, Any] = {}
    for sc in snapshot.cells:
        found = droster.find(sc.person)
        if len(found) == 1:
            people.setdefault(sc.person, found[0])
    ordered = sorted(people.items(), key=lambda kv: kv[1].row)
    schedule = {name: {d: droster.cell(p, d) for d in dates} for name, p in ordered}
    after = [_flag_obj(f) for f in recheck(schedule)]
    if flags_before is None and side_snap is not None and side_snap.flags:
        flags_before = side_snap.flags
    if flags_before is None:
        flags_before = []
        diff.issues.append(DiffIssue("FLAGS_BEFORE_UNKNOWN", "info", "flags_before was not given and the sidecar has none: every flag counts as new"))
    before = [_flag_obj(f) for f in flags_before]
    new, resolved, remaining = (flag_delta or default_flag_delta)(before, after)
    diff.recheck_ran = True
    diff.flags_new = sorted((flag_dict(f) for f in new), key=_flag_sort)
    diff.flags_resolved = sorted((flag_dict(f) for f in resolved), key=_flag_sort)
    diff.flags_remaining = sorted((flag_dict(f) for f in remaining), key=_flag_sort)
