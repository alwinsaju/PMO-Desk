"""
Snapshot of exactly what the winter workbook wrote into the editable plan grid, so a later step can diff the
user's edits (same idea and conventions as `roster_lib.draft_builder`).

    sheet `_snapshot` (veryHidden)         + sidecar `<file>.snapshot.json` (same content)
        row 1                 winter-plan-snapshot | winter-plan-snapshot/1
        meta.<key> | <json>   one row per meta key, sorted: plan_hash, config_hash, window, sheet, people, ...
        header                person | date | text | row | col
        one row per plan-grid cell (every person x every window date, blank cells included), in plan order:
            person, ISO date (text), the text as written ("" -> empty cell), 1-based sheet row and column.

The snapshot is plain text (dates as ISO text, row/col as numbers) so Excel reinterprets nothing when the file is
re-saved. `digest()` is the sha256 of the canonical JSON of meta + cells: the sheet and the sidecar must agree.
"""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Mapping, Optional, Union

import openpyxl

SNAPSHOT_SHEET = "_snapshot"
SNAPSHOT_MARK = "winter-plan-snapshot"
SNAPSHOT_SCHEMA = "winter-plan-snapshot/1"
SIDECAR_SUFFIX = ".snapshot.json"
SNAPSHOT_HEADER = ("person", "date", "text", "row", "col")
PathLike = Union[str, os.PathLike]


class SnapshotError(Exception):
    """A snapshot sheet or sidecar could not be read."""


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

    def core(self) -> dict[str, Any]:
        return {"meta": self.meta, "cells": [c.to_row() for c in self.cells]}

    def to_dict(self) -> dict[str, Any]:
        return {"schema": SNAPSHOT_SCHEMA, **self.core()}

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), sort_keys=True, ensure_ascii=False, indent=1) + "\n"

    def digest(self) -> str:
        return hashlib.sha256(
            json.dumps(self.core(), sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        ).hexdigest()

    def cell_map(self) -> dict[tuple[str, date], SnapshotCell]:
        return {(c.person, c.date): c for c in self.cells}

    @staticmethod
    def from_dict(data: Mapping[str, Any]) -> "Snapshot":
        if data.get("schema") != SNAPSHOT_SCHEMA:
            raise SnapshotError(f"not a {SNAPSHOT_SCHEMA} document")
        try:
            cells = [SnapshotCell(p, date.fromisoformat(d), t or "", int(r), int(c)) for p, d, t, r, c in data["cells"]]
            return Snapshot(dict(data["meta"]), cells)
        except (KeyError, ValueError, TypeError) as e:
            raise SnapshotError(f"malformed snapshot: {e}") from None


def snapshot_rows(snap: Snapshot) -> list[list[Any]]:
    """The rows of the hidden `_snapshot` sheet."""
    rows: list[list[Any]] = [[SNAPSHOT_MARK, SNAPSHOT_SCHEMA]]
    for k in sorted(snap.meta):
        rows.append([f"meta.{k}", json.dumps(snap.meta[k], sort_keys=True, ensure_ascii=False)])
    rows.append(list(SNAPSHOT_HEADER))
    for c in snap.cells:
        rows.append([c.person, c.date.isoformat(), c.text if c.text != "" else None, c.row, c.col])
    return rows


def sidecar_path_for(path: PathLike) -> str:
    return os.fspath(path) + SIDECAR_SUFFIX


def read_snapshot_sheet(path: PathLike) -> Optional[Snapshot]:
    """The snapshot of a (possibly Excel re-saved) workbook; None when it has no `_snapshot` sheet."""
    wb = openpyxl.load_workbook(os.fspath(path), data_only=True)
    try:
        if SNAPSHOT_SHEET not in wb.sheetnames:
            return None
        ws = wb[SNAPSHOT_SHEET]
        rows = [list(r) for r in ws.iter_rows(values_only=True)]
    finally:
        wb.close()

    def s(v: Any) -> str:
        if v is None:
            return ""
        if isinstance(v, float) and v == int(v):
            return str(int(v))
        return str(v)

    if not rows or s(rows[0][0]) != SNAPSHOT_MARK:
        raise SnapshotError("the _snapshot sheet does not start with the snapshot marker")
    if s(rows[0][1] if len(rows[0]) > 1 else None) != SNAPSHOT_SCHEMA:
        raise SnapshotError("unsupported snapshot schema")
    meta: dict[str, Any] = {}
    cells: list[SnapshotCell] = []
    header_seen = False
    for n, row in enumerate(rows[1:], start=2):
        row = row + [None] * (5 - len(row))
        first = s(row[0])
        if not header_seen:
            if first.startswith("meta."):
                try:
                    meta[first[5:]] = json.loads(s(row[1]))
                except json.JSONDecodeError:
                    raise SnapshotError(f"unreadable meta value in row {n}") from None
            elif tuple(s(c) for c in row[:5]) == SNAPSHOT_HEADER:
                header_seen = True
            else:
                raise SnapshotError(f"unexpected row {n} in the _snapshot meta block")
            continue
        if not first and not s(row[1]):
            continue  # trailing empty row
        try:
            cells.append(SnapshotCell(first, date.fromisoformat(s(row[1])), s(row[2]), int(float(s(row[3]))),
                                      int(float(s(row[4])))))
        except ValueError:
            raise SnapshotError(f"unreadable snapshot cell in row {n}") from None
    if not header_seen:
        raise SnapshotError("the _snapshot sheet has no header row")
    return Snapshot(meta, cells)


def read_snapshot_sidecar(path: PathLike) -> Optional[Snapshot]:
    """The sidecar next to a workbook (pass the workbook path or the sidecar path); None when absent."""
    p = os.fspath(path)
    if not p.endswith(SIDECAR_SUFFIX):
        p = sidecar_path_for(p)
    if not os.path.exists(p):
        return None
    try:
        with open(p, encoding="utf-8") as f:
            return Snapshot.from_dict(json.load(f))
    except json.JSONDecodeError as e:
        raise SnapshotError(f"sidecar is not valid JSON: {e}") from None
