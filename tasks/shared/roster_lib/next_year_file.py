"""
The next-year roster file: a continuation of the roster after the source file's last date.

The roster file ends on a date (for example Fri 2027-01-01) while the cycle that
crosses it ends later (Dec-Jan: 2027-01-30). build_next_year_file(source, dst,
remainder_edits) clones the source package into a NEW file whose date columns
start the day after the source's last date and keep the same number of columns
(the span is computed by date arithmetic, not assumed: Jan 2 2027 + 365 columns
ends Jan 1 2028, but Jan 1 2028 + 365 columns ends Dec 30 2028 because 2028 is a
leap year; a warning says when the span is not a full year).

What changes (and nothing else: the check below proves it):
    date row        the cached <v> of every date cell (the first one is a literal in
                    the real file, the rest are `prev+1` formulas, which stay);
    weekday row     the cached text of every weekday cell (formulas stay);
    holiday row     all labels cleared, then `holiday_labels` ({date: label}) written;
                    merges that sit on the holiday row inside the date columns are
                    dropped (a stale merge would hide new labels);
    grid            every person x date cell cleared (blank styled cells stay, so
                    conditional formatting and validation keep working), then
                    `remainder_edits` ({(person, date): text}) written;
    workbook.xml    calcPr gets fullCalcOnLoad="1" so Excel recalculates everything
                    (other sheets that read the roster hold stale cached values).

Everything else is carried over untouched: people rows, sections, legends, title
and keys text, conditional formatting, validation, hidden sheets, threaded
comments, hyperlinks, drawings, label parts. That text and the comments may
mention the old year: they are listed in NextYearResult.warnings /
old_year_cells, never rewritten.

The source is only read (dst must differ). Two staged writes: the date and
weekday cached values plus calcPr (own text splice), then the cell edits through
xlsx_patch.patch_workbook (formula cells in the grid are refused, not erased).
"""

from __future__ import annotations

import os
import re
import tempfile
import zipfile
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Mapping, Optional, Union

from . import pkgdiff
from .audit import sha256_file
from .roster_io import DEFAULT_SHEET, Roster, load_roster
from .xlsx_patch import (
    SheetCell,
    XlsxPatchError,
    _workbook_part,
    format_ref,
    load_sheet,
    num_to_col,
    parse_ref,
    patch_workbook,
    resolve_sheet,
    split_sheet_xml,
)

PathLike = Union[str, os.PathLike]
EXCEL_EPOCH = date(1899, 12, 30)
_ABBR = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
_FULL = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
_YEAR_RE = re.compile(r"(?<!\d)((?:19|20)\d{2})(?!\d)")
_PLUS_ONE = re.compile(r"^\$?[A-Z]{1,3}\$?\d+\+1$")
_ROW_TMPL = r'<row\b[^>]*?(?<![\w:-])r="{row}"[^>]*?(?:/>|>(.*?)</row>)'
_CELL_RE = re.compile(r"<c\b([^>]*?)(?:/>|>(.*?)</c>)", re.S)
_T_ATTR_RE = re.compile(r'\s+(?<![\w:-])t="[^"]*"')
_F_RE = re.compile(r"<f\b[^>]*?(?:/>|>.*?</f>)", re.S)
_CELL_REF_RE = re.compile(r'(?<![\w:-])r="([A-Za-z]+)(\d+)"')


class NextYearError(Exception):
    """The next-year file could not be built or failed its checks (dst is removed)."""


@dataclass
class NextYearResult:
    dst_path: str
    sheet_name: str
    source_last_date: date
    start: date
    end: date
    date_count: int
    first_serial: int
    people: int
    cleared_cells: int
    cells_written: int
    labels_written: int
    merges_removed: int
    old_year_cells: list[dict[str, str]]
    warnings: list[str]
    changed_parts: list[str]
    calc_on_load: bool
    sha256: str
    weekday_cells_updated: int = 0
    date_cells_updated: int = 0
    stale_comment_parts: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------


def _serial(d: date) -> int:
    return (d - EXCEL_EPOCH).days


def _rewrite_row_cells(body: str, row: int, col_lo: int, col_hi: int, fn) -> tuple[str, int]:
    """Apply fn(cell_attrs, inner, col) -> new cell xml to every <c> of `row` with col in [col_lo, col_hi]."""
    m = re.search(_ROW_TMPL.format(row=row), body, re.S)
    if m is None or m.group(1) is None:
        return body, 0
    inner = m.group(1)
    count = 0
    out: list[str] = []
    pos = 0
    for cm in _CELL_RE.finditer(inner):
        ref = _CELL_REF_RE.search(cm.group(1))
        if ref is None:
            raise NextYearError(f"row {row} has a cell without an r attribute")
        col = parse_ref(ref.group(1) + ref.group(2))[1]
        if not col_lo <= col <= col_hi:
            continue
        out.append(inner[pos: cm.start()])
        out.append(fn(cm.group(1), cm.group(2) or "", col))
        pos = cm.end()
        count += 1
    out.append(inner[pos:])
    new_inner = "".join(out)
    start, end = m.start(1), m.end(1)
    return body[:start] + new_inner + body[end:], count


def _drop_holiday_merges(suffix: bytes, holiday_row: int, first_col: int) -> tuple[bytes, int]:
    block = re.search(rb"<mergeCells\b[^>]*>(.*?)</mergeCells>", suffix, re.S)
    if block is None:
        return suffix, 0
    refs = re.findall(rb'<mergeCell\b[^>]*?ref="([^"]+)"[^>]*/>', block.group(1))
    keep: list[bytes] = []
    removed = 0
    for ref in refs:
        a, _, b = ref.decode("ascii").partition(":")
        r1, c1 = parse_ref(a)
        r2, c2 = parse_ref(b or a)
        if r1 == r2 == holiday_row and c1 >= first_col:
            removed += 1
        else:
            keep.append(ref)
    if not removed:
        return suffix, 0
    if keep:
        new = b"<mergeCells count=\"%d\">" % len(keep) + b"".join(b'<mergeCell ref="%s"/>' % r for r in keep) + b"</mergeCells>"
    else:
        new = b""
    return suffix[: block.start()] + new + suffix[block.end():], removed


def _set_full_calc_on_load(wb: bytes) -> bytes:
    text = wb.decode("utf-8")
    m = re.search(r"<calcPr\b([^>]*?)(/?)>", text)
    if m:
        attrs = m.group(1)
        if re.search(r'(?<![\w:-])fullCalcOnLoad="[^"]*"', attrs):
            attrs = re.sub(r'(?<![\w:-])fullCalcOnLoad="[^"]*"', 'fullCalcOnLoad="1"', attrs)
        else:
            attrs += ' fullCalcOnLoad="1"'
        return (text[: m.start()] + f"<calcPr{attrs}{m.group(2)}>" + text[m.end():]).encode("utf-8")
    # no calcPr: insert after the last of the elements that precede it in CT_Workbook
    pos = -1
    for tag in ("definedNames", "externalReferences", "functionGroups", "sheets"):
        em = re.search(rf"</{tag}\s*>", text)
        if em:
            pos = max(pos, em.end())
    if pos < 0:
        raise NextYearError("workbook.xml has no <sheets> element")
    return (text[:pos] + '<calcPr fullCalcOnLoad="1"/>' + text[pos:]).encode("utf-8")


def _rewrite_zip(src: str, dst: str, replacements: Mapping[str, bytes]) -> None:
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w") as zout:
        for zi in zin.infolist():
            data = replacements.get(zi.filename)
            if data is None:
                data = zin.read(zi)
            out = zipfile.ZipInfo(zi.filename, zi.date_time)
            out.compress_type = zi.compress_type
            out.external_attr = zi.external_attr
            out.create_system = zi.create_system
            out.comment = zi.comment
            out.extra = zi.extra
            zout.writestr(out, data)


def _check_date_chain(cells: Mapping[tuple[int, int], SheetCell], roster: Roster) -> None:
    first = cells.get((roster.date_row, roster.first_date_col))
    if first is not None and first.is_formula:
        raise NextYearError("the first date cell is a formula: the date chain cannot be restarted safely")
    for col in range(roster.first_date_col + 1, roster.last_date_col + 1):
        c = cells.get((roster.date_row, col))
        if c is not None and c.is_formula and c.formula and not _PLUS_ONE.match(c.formula.strip()):
            raise NextYearError(f"{format_ref(roster.date_row, col)}: the date formula is not a 'previous cell + 1' chain")


def _old_year_cells(cells: Mapping[tuple[int, int], SheetCell], roster: Roster, old_years: set[int]) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for (r, c), cell in sorted(cells.items()):
        if r > roster.header_row or not cell.text:
            continue
        if cell.cell_type in (None, "n", "b", "e"):
            continue  # numbers (the date serials) are not text
        if roster.first_date_col <= c <= roster.last_date_col and r in (roster.holiday_row, roster.weekday_row, roster.date_row):
            continue  # cleared / rewritten anyway
        years = sorted({int(y) for y in _YEAR_RE.findall(cell.text)} & old_years)
        if years:
            text = " ".join(cell.text.split())
            out.append({"cell": format_ref(r, c), "text": text if len(text) <= 80 else text[:79] + "…",
                        "years": ", ".join(map(str, years))})
    return out


def build_next_year_file(
    master_or_final_path: PathLike,
    dst_path: PathLike,
    remainder_edits: Mapping[tuple[str, date], str],
    *,
    holiday_labels: Optional[Mapping[date, str]] = None,
    start: Optional[date] = None,
    sheet_name: str = DEFAULT_SHEET,
) -> NextYearResult:
    """Build the next-year file (see the module docstring); returns what was done and what to look at."""
    src = os.path.abspath(os.fspath(master_or_final_path))
    dst = os.path.abspath(os.fspath(dst_path))
    if os.path.normcase(src) == os.path.normcase(dst):
        raise NextYearError("dst_path must differ from the source; the source is never modified")
    roster = load_roster(src, sheet_name)
    n = len(roster.dates)
    start = start or roster.last_date + timedelta(days=1)
    new_dates = [start + timedelta(days=i) for i in range(n)]
    end = new_dates[-1]
    new_col = {d: roster.first_date_col + i for i, d in enumerate(new_dates)}

    problems: list[str] = []
    for (name, d), text in remainder_edits.items():
        found = roster.find(name)
        if len(found) != 1:
            problems.append(f"person {name!r}: {'not in the file' if not found else 'on several rows'}")
        if d not in new_col:
            problems.append(f"{name} {d}: outside the new file's dates {start}..{end}")
        if not isinstance(text, str):
            problems.append(f"{name} {d}: text must be a string")
    for d in (holiday_labels or {}):
        if d not in new_col:
            problems.append(f"holiday label {d}: outside the new file's dates {start}..{end}")
    if problems:
        raise NextYearError(f"{len(problems)} problem(s): " + "; ".join(sorted(set(problems))[:10]))

    sheet = load_sheet(src, sheet_name)
    _check_date_chain(sheet.cells, roster)

    with zipfile.ZipFile(src) as zin:
        info = resolve_sheet(zin, sheet_name)
        wb_part = _workbook_part(zin)
        sheet_bytes = zin.read(info.part)
        wb_bytes = zin.read(wb_part)
        names = zin.namelist()
    prefix, body, suffix = split_sheet_xml(sheet_bytes)

    # stage 1: cached date / weekday values, holiday-row merges, calcPr
    def date_cell(attrs: str, inner: str, col: int) -> str:
        f = _F_RE.search(inner)
        return f"<c{_T_ATTR_RE.sub('', attrs)}>{f.group(0) if f else ''}<v>{_serial(new_dates[col - roster.first_date_col])}</v></c>"

    body, n_dates = _rewrite_row_cells(body, roster.date_row, roster.first_date_col, roster.last_date_col, date_cell)
    n_weekdays = 0
    if roster.weekday_row is not None:
        full_names = len(roster.weekday_label(roster.first_date) or "") > 3

        def weekday_cell(attrs: str, inner: str, col: int) -> str:
            d = new_dates[col - roster.first_date_col]
            text = (_FULL if full_names else _ABBR)[d.weekday()]
            base = _T_ATTR_RE.sub("", attrs)
            f = _F_RE.search(inner)
            if f:
                return f'<c{base} t="str">{f.group(0)}<v>{text}</v></c>'
            return f'<c{base} t="inlineStr"><is><t>{text}</t></is></c>'

        body, n_weekdays = _rewrite_row_cells(body, roster.weekday_row, roster.first_date_col, roster.last_date_col, weekday_cell)
    suffix, merges_removed = _drop_holiday_merges(suffix, roster.holiday_row, roster.first_date_col)

    fd, stage = tempfile.mkstemp(suffix=".stage.tmp", dir=os.path.dirname(dst) or ".")
    os.close(fd)
    try:
        os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
        _rewrite_zip(src, stage, {info.part: prefix + body.encode("utf-8") + suffix, wb_part: _set_full_calc_on_load(wb_bytes)})

        # stage 2: clear the grid and holiday row, then write the remainder cells and labels
        edits: dict[tuple[int, int], str] = {}
        cleared = 0
        for p in roster.people:
            for d, col in roster.date_to_col.items():
                if roster.cell(p, d) != "":
                    edits[(p.row, col)] = ""
                    cleared += 1
        for d in roster.holiday_labels():
            edits[(roster.holiday_row, roster.date_to_col[d])] = ""
            cleared += 1
        written = 0
        for (name, d), text in remainder_edits.items():
            edits[(roster.find(name)[0].row, new_col[d])] = text
            written += 1 if text != "" else 0
        labels = 0
        for d, text in (holiday_labels or {}).items():
            edits[(roster.holiday_row, new_col[d])] = text
            labels += 1 if text != "" else 0
        try:
            patch_workbook(stage, dst, sheet_name, edits)
        except XlsxPatchError as e:
            raise NextYearError(f"could not clear/fill the cells: {e}") from None
    finally:
        if os.path.exists(stage):
            os.remove(stage)

    try:
        extra_cells = {(roster.date_row, c) for c in range(roster.first_date_col, roster.last_date_col + 1)}
        if roster.weekday_row is not None:
            extra_cells |= {(roster.weekday_row, c) for c in range(roster.first_date_col, roster.last_date_col + 1)}
        _verify(src, dst, sheet_name, info.part, wb_part, roster, new_dates, remainder_edits, holiday_labels or {},
                set(edits) | extra_cells)
    except BaseException:
        if os.path.exists(dst):
            os.remove(dst)
        raise

    warnings: list[str] = []
    expected_end = date(start.year + 1, start.month, start.day) - timedelta(days=1) if not (start.month == 2 and start.day == 29) else None
    if expected_end is not None and end != expected_end:
        off = (expected_end - end).days
        warnings.append(
            f"the new file keeps {n} date columns and so ends on {end}, {abs(off)} day(s) "
            f"{'short of' if off > 0 else 'beyond'} a full year ending {expected_end}")
    old_years = {d.year for d in roster.dates} - {d.year for d in new_dates}
    old_cells = _old_year_cells(sheet.cells, roster, old_years) if old_years else []
    warnings.append("the title and key text, the legends, hyperlinks and comments are carried over unchanged")
    if old_cells:
        warnings.append(
            f"{len(old_cells)} cell(s) in rows 1..{roster.header_row} mention the old year ({', '.join(map(str, sorted(old_years)))}): "
            + ", ".join(c["cell"] for c in old_cells[:10]) + (" ..." if len(old_cells) > 10 else "") + "; not rewritten")
    comment_parts = [x for x in names if x.startswith("xl/threadedComments/") or re.fullmatch(r"xl/comments\d*\.xml", x)]
    if comment_parts:
        warnings.append(f"{len(comment_parts)} comment part(s) refer to cells of the old roster and are kept as they are")
    if holiday_labels is None:
        warnings.append("no holiday labels were given: the holiday row is empty")
    warnings.append("Excel recalculates on open (fullCalcOnLoad): other sheets that read the roster hold stale values until then")

    return NextYearResult(
        dst_path=dst, sheet_name=sheet_name, source_last_date=roster.last_date, start=start, end=end, date_count=n,
        first_serial=_serial(start), people=len(roster.people), cleared_cells=cleared, cells_written=written,
        labels_written=labels, merges_removed=merges_removed, old_year_cells=old_cells, warnings=warnings,
        changed_parts=pkgdiff.diff_packages(src, dst).byte_changed, calc_on_load=True, sha256=sha256_file(dst),
        weekday_cells_updated=n_weekdays, date_cells_updated=n_dates, stale_comment_parts=comment_parts)


def _verify(src, dst, sheet_name, sheet_part, wb_part, roster, new_dates, remainder_edits, labels, allowed_cells) -> None:
    try:
        pkgdiff.assert_only_changed(src, dst, {sheet_part, wb_part}, strict=True)
    except AssertionError as e:
        raise NextYearError(f"verification failed (package level): {e}") from None
    with zipfile.ZipFile(src) as za, zipfile.ZipFile(dst) as zb:
        sd = pkgdiff.diff_sheet_xml(za.read(sheet_part), zb.read(sheet_part))
        wb_new = zb.read(wb_part).decode("utf-8")
    extra = sd.touched_cells - allowed_cells
    if extra:
        raise NextYearError(f"verification failed: unexpected cell changes {sorted(extra)[:5]}")
    other = [t for t in sd.other_elements_changed if t not in ("dimension", "mergeCells")]
    if other or sd.row_attrs_changed or sd.added_rows or sd.removed_rows:
        raise NextYearError(f"verification failed: sheet-level changes {other} {sorted(sd.row_attrs_changed)[:5]}")
    if 'fullCalcOnLoad="1"' not in wb_new:
        raise NextYearError("verification failed: fullCalcOnLoad is not set")
    nr = load_roster(dst, sheet_name)
    if nr.dates != tuple(new_dates):
        raise NextYearError(f"verification failed: dates are {nr.first_date}..{nr.last_date}, expected {new_dates[0]}..{new_dates[-1]}")
    if [(p.name, p.row, p.section) for p in nr.people] != [(p.name, p.row, p.section) for p in roster.people]:
        raise NextYearError("verification failed: the people rows differ from the source")
    expected = {}
    for (name, d), text in remainder_edits.items():
        if text != "":
            expected[(roster.find(name)[0].name, d)] = text
    got = {(p.name, d): nr.cell(p, d) for p in nr.people for d in nr.dates if nr.cell(p, d) != ""}
    if got != expected:
        raise NextYearError(f"verification failed: the grid holds {len(got)} non-blank cells, expected {len(expected)} (or different values)")
    if nr.holiday_labels() != {d: t for d, t in labels.items() if t.strip()}:
        raise NextYearError("verification failed: the holiday label row differs from the labels given")
    if roster.weekday_row is not None:
        if nr.weekday_row is None:
            raise NextYearError("verification failed: the weekday row is no longer recognised")
        for d in new_dates:
            if nr.weekday_label(d) not in (_ABBR[d.weekday()], _FULL[d.weekday()]):
                raise NextYearError(f"verification failed: weekday text for {d} is {nr.weekday_label(d)!r}")
