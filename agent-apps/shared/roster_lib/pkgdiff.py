"""
Package-diff utility for xlsx files: proves a patch touched only what it should.

diff_packages compares two .xlsx zips part by part (names, content hashes and,
for XML parts, canonical form so a harmless re-serialisation can be told apart
from a real change) and reports exactly which parts differ.
assert_only_changed is the pytest-friendly guard used after every patch.
diff_sheet_xml goes one level deeper into a worksheet part: which cells and
rows changed, and whether every sheet-level element outside sheetData
(conditionalFormatting, dataValidations, hyperlinks, extLst, ...) is intact.
"""

from __future__ import annotations

import hashlib
import os
import zipfile
from dataclasses import dataclass, field
from typing import Iterable, Optional, Union

from lxml import etree

from .xlsx_patch import parse_ref

PathLike = Union[str, os.PathLike]
_XML_SUFFIXES = (".xml", ".rels", ".vml")
_NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"


@dataclass
class PackageDiff:
    only_in_a: list[str] = field(default_factory=list)
    only_in_b: list[str] = field(default_factory=list)
    # parts whose bytes differ AND (for XML) whose canonical form differs
    changed: list[str] = field(default_factory=list)
    # XML parts whose bytes differ but whose canonical form is identical
    reserialised: list[str] = field(default_factory=list)
    # parts whose zip compression method differs (content may be identical)
    compression_changed: list[str] = field(default_factory=list)
    order_preserved: bool = True
    unchanged: int = 0

    @property
    def byte_changed(self) -> list[str]:
        """Every part whose bytes differ (changed + reserialised)."""
        return sorted(self.changed + self.reserialised)

    @property
    def identical(self) -> bool:
        return not (self.only_in_a or self.only_in_b or self.changed or self.reserialised)


def _canonical(name: str, data: bytes) -> Optional[bytes]:
    if not name.lower().endswith(_XML_SUFFIXES):
        return None
    try:
        root = etree.fromstring(data, etree.XMLParser(huge_tree=True, resolve_entities=False))
    except etree.XMLSyntaxError:
        return None
    return etree.tostring(root, method="c14n")


def diff_packages(a: PathLike, b: PathLike) -> PackageDiff:
    with zipfile.ZipFile(a) as za, zipfile.ZipFile(b) as zb:
        ia = {i.filename: i for i in za.infolist()}
        ib = {i.filename: i for i in zb.infolist()}
        out = PackageDiff()
        out.only_in_a = sorted(set(ia) - set(ib))
        out.only_in_b = sorted(set(ib) - set(ia))
        common = [n for n in ia if n in ib]
        out.order_preserved = [n for n in ia if n in ib] == [n for n in ib if n in ia] and not (
            out.only_in_a or out.only_in_b
        )
        for name in common:
            da, db = za.read(name), zb.read(name)
            if ia[name].compress_type != ib[name].compress_type:
                out.compression_changed.append(name)
            if hashlib.sha256(da).digest() == hashlib.sha256(db).digest():
                out.unchanged += 1
                continue
            ca, cb = _canonical(name, da), _canonical(name, db)
            if ca is not None and cb is not None and ca == cb:
                out.reserialised.append(name)
            else:
                out.changed.append(name)
    out.changed.sort()
    out.reserialised.sort()
    return out


def assert_only_changed(
    src: PathLike,
    dst: PathLike,
    allowed_parts: Iterable[str],
    *,
    strict: bool = True,
) -> PackageDiff:
    """Fail unless the only differences between two packages are `allowed_parts`.

    strict=True (default) also rejects allowed-less byte changes such as an
    XML part that was merely re-serialised, and any added, removed, reordered
    or recompressed entry. Parts in allowed_parts may or may not differ.
    """
    allowed = set(allowed_parts)
    d = diff_packages(src, dst)
    problems: list[str] = []
    changed = d.byte_changed if strict else d.changed
    unexpected = [p for p in changed if p not in allowed]
    if unexpected:
        problems.append(f"unexpected changed parts: {unexpected}")
    if d.only_in_a:
        problems.append(f"parts removed: {d.only_in_a}")
    if d.only_in_b:
        problems.append(f"parts added: {d.only_in_b}")
    if strict and not d.order_preserved:
        problems.append("zip entry order changed")
    if strict:
        recompressed = [p for p in d.compression_changed if p not in allowed]
        if recompressed:
            problems.append(f"compression method changed: {recompressed}")
    if problems:
        raise AssertionError("; ".join(problems))
    return d


# ---------------------------------------------------------------------------
# Inside a worksheet part


@dataclass
class SheetXmlDiff:
    changed_cells: set[tuple[int, int]] = field(default_factory=set)
    added_cells: set[tuple[int, int]] = field(default_factory=set)
    removed_cells: set[tuple[int, int]] = field(default_factory=set)
    added_rows: set[int] = field(default_factory=set)
    removed_rows: set[int] = field(default_factory=set)
    row_attrs_changed: set[int] = field(default_factory=set)
    # tags of top-level elements other than sheetData whose canonical form differs
    other_elements_changed: list[str] = field(default_factory=list)

    @property
    def touched_cells(self) -> set[tuple[int, int]]:
        return self.changed_cells | self.added_cells | self.removed_cells


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _row_map(sheet_data) -> tuple[dict[int, dict], dict[int, dict[int, bytes]]]:
    rows_attrs: dict[int, dict] = {}
    cells: dict[int, dict[int, bytes]] = {}
    for row in sheet_data:
        r = int(row.get("r"))
        rows_attrs[r] = dict(row.attrib)
        cmap: dict[int, bytes] = {}
        for c in row:
            _, col = parse_ref(c.get("r"))
            cmap[col] = etree.tostring(c, method="c14n")
        cells[r] = cmap
    return rows_attrs, cells


def diff_sheet_xml(a: bytes, b: bytes) -> SheetXmlDiff:
    """Compare two worksheet parts at cell level, ignoring serialisation noise."""
    parser = etree.XMLParser(huge_tree=True, resolve_entities=False)
    ra, rb = etree.fromstring(a, parser), etree.fromstring(b, parser)
    out = SheetXmlDiff()

    def by_tag(root) -> dict[str, list[bytes]]:
        d: dict[str, list[bytes]] = {}
        for ch in root:
            if _local(ch.tag) == "sheetData":
                continue
            d.setdefault(_local(ch.tag), []).append(etree.tostring(ch, method="c14n"))
        return d

    ta, tb = by_tag(ra), by_tag(rb)
    for tag in sorted(set(ta) | set(tb)):
        if ta.get(tag) != tb.get(tag):
            out.other_elements_changed.append(tag)

    sda, sdb = ra.find(f"{{{_NS_MAIN}}}sheetData"), rb.find(f"{{{_NS_MAIN}}}sheetData")
    attrs_a, cells_a = _row_map(sda)
    attrs_b, cells_b = _row_map(sdb)
    out.added_rows = set(cells_b) - set(cells_a)
    out.removed_rows = set(cells_a) - set(cells_b)
    for r in set(cells_a) & set(cells_b):
        if attrs_a[r] != attrs_b[r]:
            out.row_attrs_changed.add(r)
        ca, cb = cells_a[r], cells_b[r]
        for col in set(ca) | set(cb):
            if col not in ca:
                out.added_cells.add((r, col))
            elif col not in cb:
                out.removed_cells.add((r, col))
            elif ca[col] != cb[col]:
                out.changed_cells.add((r, col))
    for r in out.added_rows:
        out.added_cells |= {(r, col) for col in cells_b[r]}
    for r in out.removed_rows:
        out.removed_cells |= {(r, col) for col in cells_a[r]}
    return out


def assert_sheet_only_changed(
    src: PathLike,
    dst: PathLike,
    part: str,
    allowed_cells: Iterable[tuple[int, int]],
    *,
    allow_dimension_change: bool = True,
    allow_row_attr_changes: Iterable[int] = (),
) -> SheetXmlDiff:
    """Fail unless the worksheet differs only in `allowed_cells`.

    Everything outside sheetData (conditionalFormatting, dataValidations,
    hyperlinks, mergeCells, extLst, views, cols, ...) must be canonically
    identical; <dimension> may grow because new cells can extend the used range.
    """
    with zipfile.ZipFile(src) as za, zipfile.ZipFile(dst) as zb:
        d = diff_sheet_xml(za.read(part), zb.read(part))
    problems: list[str] = []
    allowed = set(allowed_cells)
    extra = d.touched_cells - allowed
    if extra:
        problems.append(f"unexpected cell changes: {sorted(extra)[:10]}")
    other = [t for t in d.other_elements_changed if not (allow_dimension_change and t == "dimension")]
    if other:
        problems.append(f"sheet-level elements changed: {other}")
    bad_attrs = d.row_attrs_changed - set(allow_row_attr_changes)
    if bad_attrs:
        problems.append(f"row attributes changed: {sorted(bad_attrs)[:10]}")
    if problems:
        raise AssertionError("; ".join(problems))
    return d
