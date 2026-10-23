"""
Add worksheets to an existing xlsx at package level, without an object model.

Why: the summary sheets of a draft (and its hidden snapshot) must be added to a
COPY of the master. openpyxl cannot do that safely: loading and saving the
workbook drops threaded comments, persons, the sensitivity label, extLst
conditional formatting / validation and some drawings. So, like xlsx_patch,
the xlsx is handled as a zip of byte blobs and only these parts change:

    xl/workbook.xml              one <sheet> per new sheet appended to <sheets>
    xl/_rels/workbook.xml.rels   one worksheet relationship per sheet
    [Content_Types].xml          one Override per new sheet part
    xl/styles.xml                fonts / fills / borders / numFmt / cellXfs APPENDED
    docProps/app.xml             TitlesOfParts / HeadingPairs (only when it has them)
    xl/worksheets/sheetN.xml     NEW parts, one per sheet (inline strings)

Every other part is copied entry-for-entry (name, order, timestamp, compression)
and the new parts go at the end of the zip. New sheets are appended AFTER the
existing ones, so no existing sheet index changes (defined names with a
localSheetId, activeTab and so on keep pointing at the same sheets).

styles.xml is edited as text: existing fonts / fills / borders / cellXfs keep
their indices (append only) and the count attributes are updated. A style is
only appended when a sheet uses it. Style names (SheetSpec cells): header,
flag_red, flag_amber, info, wrap, bold, date.

Not verified in a real Excel here (none is available): the XML follows the
ECMA-376 element order and uses only constructs Excel itself writes.
"""

from __future__ import annotations

import math
import os
import posixpath
import re
import tempfile
import zipfile
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Mapping, Optional, Sequence, Union

from lxml import etree

from .xlsx_patch import (
    MAX_CELL_CHARS,
    MAX_COL,
    MAX_ROW,
    NS_MAIN,
    NS_REL,
    XlsxPatchError,
    _read_rels,
    _rels_path_for,
    _workbook_part,
    encode_text,
    format_ref,
    list_sheets,
    num_to_col,
    parse_ref,
)

CT_WORKSHEET = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"
REL_WORKSHEET = NS_REL + "/worksheet"
STATES = ("visible", "hidden", "veryHidden")
_FORBIDDEN_NAME_CHARS = set(':\\/?*[]')
STYLE_NAMES = ("header", "flag_red", "flag_amber", "info", "wrap", "bold", "date")

_EPOCH = date(1899, 12, 30)
CellValue = Union[str, int, float, bool, date, None]


class XlsxSheetsError(XlsxPatchError):
    """The sheets could not be added."""


class SheetNameError(XlsxSheetsError, ValueError):
    pass


@dataclass(frozen=True)
class Cell:
    """A cell value with an optional named style."""

    value: CellValue
    style: Optional[str] = None


@dataclass
class SheetSpec:
    """One worksheet to add.

    rows: list of rows, each a list of values (str, int, float, bool, date, None)
        or `Cell(value, style)`. A date value gets the "date" style unless told
        otherwise. None leaves the cell out (unless it carries a style).
    col_widths: width in characters per column starting at A (None = default).
    freeze: A1 reference of the first unfrozen cell, e.g. "A2" freezes row 1.
    row_styles: {0-based row index: style} applied to cells of that row that
        have no style of their own.
    """

    name: str
    rows: Sequence[Sequence[Any]]
    col_widths: Sequence[Optional[float]] = ()
    freeze: Optional[str] = None
    state: str = "visible"
    tab_color: Optional[str] = None  # "RRGGBB" or "AARRGGBB"
    row_styles: Mapping[int, str] = field(default_factory=dict)


@dataclass
class AddSheetsResult:
    sheet_names: list[str]
    sheet_parts: list[str]
    changed_parts: list[str]
    added_parts: list[str]


# ---------------------------------------------------------------------------
# Validation


def validate_sheet_name(name: str, existing: Sequence[str] = ()) -> None:
    """Excel's sheet-name rules; `existing` names collide case-insensitively."""
    if not isinstance(name, str) or not name.strip():
        raise SheetNameError("sheet name must not be blank")
    if len(name) > 31:
        raise SheetNameError(f"sheet name {name!r} is longer than 31 characters")
    bad = sorted(set(name) & _FORBIDDEN_NAME_CHARS)
    if bad:
        raise SheetNameError(f"sheet name {name!r} contains forbidden characters {bad}")
    if name[0] == "'" or name[-1] == "'":
        raise SheetNameError(f"sheet name {name!r} must not start or end with an apostrophe")
    if any(ord(ch) < 32 for ch in name):
        raise SheetNameError(f"sheet name {name!r} contains control characters")
    if name.casefold() == "history":
        raise SheetNameError("'History' is reserved by Excel")
    if name.casefold() in {e.casefold() for e in existing}:
        raise SheetNameError(f"a sheet named {name!r} already exists (names are case-insensitive)")


def clean_text(text: Any, limit: int = MAX_CELL_CHARS) -> str:
    """Make arbitrary text safe for a cell: drop control chars XML cannot hold, cap the length."""
    s = "" if text is None else str(text)
    s = re.sub("[\x00-\x08\x0b\x0c\x0e-\x1f￾￿\ud800-\udfff]", "", s)
    return s if len(s) <= limit else s[: limit - 1] + "…"


# ---------------------------------------------------------------------------
# Styles


@dataclass(frozen=True)
class _StyleDef:
    bold: bool = False
    italic: bool = False
    font_rgb: Optional[str] = None
    fill_rgb: Optional[str] = None
    wrap: bool = False
    border_bottom: bool = False
    numfmt: Optional[str] = None  # custom format code


_STYLE_DEFS: dict[str, _StyleDef] = {
    "header": _StyleDef(bold=True, font_rgb="FFFFFFFF", fill_rgb="FF1F3864", wrap=True, border_bottom=True),
    "flag_red": _StyleDef(font_rgb="FF9C0006", fill_rgb="FFFFC7CE", wrap=True),
    "flag_amber": _StyleDef(font_rgb="FF9C5700", fill_rgb="FFFFEB9C", wrap=True),
    "info": _StyleDef(italic=True, font_rgb="FF595959", wrap=True),
    "wrap": _StyleDef(wrap=True),
    "bold": _StyleDef(bold=True),
    "date": _StyleDef(numfmt="yyyy\\-mm\\-dd"),
}


def _count_children(root, local: str) -> Optional[int]:
    el = root.find(f"{{{NS_MAIN}}}{local}")
    return None if el is None else len(el)


def _section_re(tag: str) -> tuple[re.Pattern, re.Pattern]:
    return (
        re.compile(rf"<{tag}(?P<attrs>(?:\s[^>]*?)?)(?P<self>/?)>"),
        re.compile(rf"</{tag}\s*>"),
    )


def _append_to_section(text: str, tag: str, new_xml: str, new_total: int) -> str:
    """Append `new_xml` inside <tag> and set its count attribute to new_total."""
    open_re, close_re = _section_re(tag)
    m = open_re.search(text)
    if m is None:
        raise XlsxSheetsError(f"styles.xml has no <{tag}> section; cannot append styles")
    attrs = m.group("attrs") or ""
    if re.search(r'(?<![\w:-])count="\d+"', attrs):
        attrs = re.sub(r'(?<![\w:-])count="\d+"', f'count="{new_total}"', attrs, count=1)
    else:
        attrs += f' count="{new_total}"'
    if m.group("self"):  # <tag .../> -> <tag ...>new</tag>
        return text[: m.start()] + f"<{tag}{attrs}>{new_xml}</{tag}>" + text[m.end():]
    cm = close_re.search(text, m.end())
    if cm is None:
        raise XlsxSheetsError(f"styles.xml <{tag}> is not closed")
    return text[: m.start()] + f"<{tag}{attrs}>" + text[m.end(): cm.start()] + new_xml + text[cm.start():]


def _extend_styles(data: bytes, used: Sequence[str]) -> tuple[bytes, dict[str, int]]:
    """Append the styles in `used`; return (new styles.xml, style name -> cellXfs index)."""
    if not used:
        return data, {}
    try:
        root = etree.fromstring(data)
    except etree.XMLSyntaxError as e:
        raise XlsxSheetsError(f"styles.xml is not well-formed: {e}") from None
    n_fonts, n_fills, n_borders, n_xfs = (_count_children(root, t) for t in ("fonts", "fills", "borders", "cellXfs"))
    if None in (n_fonts, n_fills, n_borders, n_xfs):
        raise XlsxSheetsError("styles.xml lacks fonts, fills, borders or cellXfs; cannot append styles")
    font_name, font_size = "Calibri", "11"
    first_font = root.find(f"{{{NS_MAIN}}}fonts/{{{NS_MAIN}}}font")
    if first_font is not None:
        nm = first_font.find(f"{{{NS_MAIN}}}name")
        sz = first_font.find(f"{{{NS_MAIN}}}sz")
        font_name = (nm.get("val") if nm is not None else None) or font_name
        font_size = (sz.get("val") if sz is not None else None) or font_size
    numfmts_el = root.find(f"{{{NS_MAIN}}}numFmts")
    n_numfmts = 0 if numfmts_el is None else len(numfmts_el)
    max_fmt_id = 163
    for nf in ([] if numfmts_el is None else numfmts_el):
        try:
            max_fmt_id = max(max_fmt_id, int(nf.get("numFmtId", "0")))
        except ValueError:
            pass

    text = data.decode("utf-8")
    fonts: list[str] = []
    fills: list[str] = []
    borders: list[str] = []
    numfmts: list[str] = []
    xfs: list[str] = []
    mapping: dict[str, int] = {}
    font_ids: dict[tuple, int] = {}
    fill_ids: dict[str, int] = {}
    fmt_ids: dict[str, int] = {}
    border_id: Optional[int] = None
    next_fmt = max_fmt_id + 1
    for name in used:
        if name in mapping:
            continue
        sd = _STYLE_DEFS[name]
        fkey = (sd.bold, sd.italic, sd.font_rgb)
        if fkey not in font_ids:
            color = f'<color rgb="{sd.font_rgb}"/>' if sd.font_rgb else ""
            fonts.append(
                "<font>" + ("<b/>" if sd.bold else "") + ("<i/>" if sd.italic else "")
                + f'<sz val="{font_size}"/>{color}<name val="{font_name}"/><family val="2"/></font>'
            )
            font_ids[fkey] = n_fonts + len(fonts) - 1
        if sd.fill_rgb and sd.fill_rgb not in fill_ids:
            fills.append(
                f'<fill><patternFill patternType="solid"><fgColor rgb="{sd.fill_rgb}"/>'
                '<bgColor indexed="64"/></patternFill></fill>'
            )
            fill_ids[sd.fill_rgb] = n_fills + len(fills) - 1
        if sd.border_bottom and border_id is None:
            borders.append(
                '<border><left/><right/><top/><bottom style="thin"><color auto="1"/></bottom><diagonal/></border>'
            )
            border_id = n_borders + len(borders) - 1
        if sd.numfmt and sd.numfmt not in fmt_ids:
            numfmts.append(f'<numFmt numFmtId="{next_fmt}" formatCode="{sd.numfmt}"/>')
            fmt_ids[sd.numfmt] = next_fmt
            next_fmt += 1
        attrs = [
            f'numFmtId="{fmt_ids[sd.numfmt] if sd.numfmt else 0}"',
            f'fontId="{font_ids[fkey]}"',
            f'fillId="{fill_ids[sd.fill_rgb] if sd.fill_rgb else 0}"',
            f'borderId="{border_id if sd.border_bottom else 0}"',
            'xfId="0"',
            'applyFont="1"',
        ]
        if sd.numfmt:
            attrs.append('applyNumberFormat="1"')
        if sd.fill_rgb:
            attrs.append('applyFill="1"')
        if sd.border_bottom:
            attrs.append('applyBorder="1"')
        if sd.wrap:
            attrs.append('applyAlignment="1"')
            xfs.append(f'<xf {" ".join(attrs)}><alignment vertical="top" wrapText="1"/></xf>')
        else:
            xfs.append(f'<xf {" ".join(attrs)}/>')
        mapping[name] = n_xfs + len(xfs) - 1

    if numfmts:
        if numfmts_el is None:
            m = re.search(r"<styleSheet\b[^>]*>", text)
            if m is None:
                raise XlsxSheetsError("styles.xml has no <styleSheet> root")
            text = text[: m.end()] + f'<numFmts count="{len(numfmts)}">{"".join(numfmts)}</numFmts>' + text[m.end():]
        else:
            text = _append_to_section(text, "numFmts", "".join(numfmts), n_numfmts + len(numfmts))
    if fonts:
        text = _append_to_section(text, "fonts", "".join(fonts), n_fonts + len(fonts))
    if fills:
        text = _append_to_section(text, "fills", "".join(fills), n_fills + len(fills))
    if borders:
        text = _append_to_section(text, "borders", "".join(borders), n_borders + len(borders))
    text = _append_to_section(text, "cellXfs", "".join(xfs), n_xfs + len(xfs))
    return text.encode("utf-8"), mapping


# ---------------------------------------------------------------------------
# Worksheet XML


def _normalise_color(rgb: str) -> str:
    c = rgb.strip().lstrip("#").upper()
    if re.fullmatch(r"[0-9A-F]{6}", c):
        return "FF" + c
    if re.fullmatch(r"[0-9A-F]{8}", c):
        return c
    raise XlsxSheetsError(f"bad tab colour {rgb!r}: use RRGGBB or AARRGGBB")


def _serial(d: date) -> int:
    return (d - _EPOCH).days


def _cell_parts(item: Any) -> tuple[CellValue, Optional[str]]:
    if isinstance(item, Cell):
        return item.value, item.style
    return item, None


def _used_styles(spec: SheetSpec) -> list[str]:
    used: list[str] = []

    def add(s: Optional[str]) -> None:
        if s is None:
            return
        if s not in _STYLE_DEFS:
            raise XlsxSheetsError(f"unknown style {s!r}; known: {list(STYLE_NAMES)}")
        if s not in used:
            used.append(s)

    for s in spec.row_styles.values():
        add(s)
    for row in spec.rows:
        for item in row:
            v, s = _cell_parts(item)
            add(s)
            if isinstance(v, date) and s is None:
                add("date")
    return used


def _pane_xml(freeze: str) -> str:
    row, col = parse_ref(freeze)
    xs, ys = col - 1, row - 1
    if xs == 0 and ys == 0:
        return ""
    if xs and ys:
        return (
            f'<pane xSplit="{xs}" ySplit="{ys}" topLeftCell="{freeze}" activePane="bottomRight" state="frozen"/>'
            '<selection pane="topRight"/><selection pane="bottomLeft"/>'
            f'<selection pane="bottomRight" activeCell="{freeze}" sqref="{freeze}"/>'
        )
    if ys:
        return (
            f'<pane ySplit="{ys}" topLeftCell="{freeze}" activePane="bottomLeft" state="frozen"/>'
            f'<selection pane="bottomLeft" activeCell="{freeze}" sqref="{freeze}"/>'
        )
    return (
        f'<pane xSplit="{xs}" topLeftCell="{freeze}" activePane="topRight" state="frozen"/>'
        f'<selection pane="topRight" activeCell="{freeze}" sqref="{freeze}"/>'
    )


def _sheet_xml(spec: SheetSpec, xf_of: Mapping[str, int]) -> bytes:
    if len(spec.rows) > MAX_ROW:
        raise XlsxSheetsError(f"sheet {spec.name!r}: too many rows")
    row_xml: list[str] = []
    max_row = max_col = 0
    for ri, row in enumerate(spec.rows):
        default_style = spec.row_styles.get(ri)
        if len(row) > MAX_COL:
            raise XlsxSheetsError(f"sheet {spec.name!r}: too many columns")
        cells: list[str] = []
        for ci, item in enumerate(row):
            v, style = _cell_parts(item)
            if isinstance(v, datetime):
                v = v.date()
            if style is None:
                style = default_style
            if isinstance(v, date) and style is None:
                style = "date"
            sattr = f' s="{xf_of[style]}"' if style is not None else ""
            ref = format_ref(ri + 1, ci + 1)
            if v is None:
                if style is None:
                    continue
                cells.append(f'<c r="{ref}"{sattr}/>')
            elif isinstance(v, bool):
                cells.append(f'<c r="{ref}"{sattr} t="b"><v>{int(v)}</v></c>')
            elif isinstance(v, int):
                cells.append(f'<c r="{ref}"{sattr}><v>{v}</v></c>')
            elif isinstance(v, float):
                if not math.isfinite(v):
                    raise XlsxSheetsError(f"{ref}: non-finite number")
                cells.append(f'<c r="{ref}"{sattr}><v>{v!r}</v></c>')
            elif isinstance(v, date):
                cells.append(f'<c r="{ref}"{sattr}><v>{_serial(v)}</v></c>')
            elif isinstance(v, str):
                if len(v) > MAX_CELL_CHARS:
                    raise XlsxSheetsError(f"{ref}: text longer than {MAX_CELL_CHARS} characters")
                try:
                    enc = encode_text(v)
                except ValueError as e:
                    raise XlsxSheetsError(f"{ref}: {e}") from None
                cells.append(f'<c r="{ref}"{sattr} t="inlineStr"><is><t xml:space="preserve">{enc}</t></is></c>')
            else:
                raise XlsxSheetsError(f"{ref}: unsupported value type {type(v).__name__}")
            max_col = max(max_col, ci + 1)
        if cells:
            max_row = ri + 1
            row_xml.append(f'<row r="{ri + 1}">{"".join(cells)}</row>')
    dim = f'<dimension ref="A1:{format_ref(max_row, max_col)}"/>' if max_row else '<dimension ref="A1"/>'
    sheet_pr = f'<sheetPr><tabColor rgb="{_normalise_color(spec.tab_color)}"/></sheetPr>' if spec.tab_color else ""
    pane = _pane_xml(spec.freeze) if spec.freeze else ""
    views = f'<sheetViews><sheetView workbookViewId="0">{pane}</sheetView></sheetViews>'
    cols = ""
    widths = [(i + 1, w) for i, w in enumerate(spec.col_widths) if w is not None]
    if widths:
        cols = "<cols>" + "".join(
            f'<col min="{i}" max="{i}" width="{w!r}" customWidth="1"/>' for i, w in widths
        ) + "</cols>"
    xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        f'<worksheet xmlns="{NS_MAIN}" xmlns:r="{NS_REL}">'
        f'{sheet_pr}{dim}{views}<sheetFormatPr defaultRowHeight="15"/>{cols}'
        f'<sheetData>{"".join(row_xml)}</sheetData></worksheet>'
    )
    return xml.encode("utf-8")


# ---------------------------------------------------------------------------
# Package parts


def _next_part_number(names: Sequence[str]) -> int:
    used = [int(m.group(1)) for n in names if (m := re.fullmatch(r"xl/worksheets/sheet(\d+)\.xml", n))]
    return max(used, default=0) + 1


def _register_in_workbook(wb: bytes, entries: list[tuple[str, int, str, str]]) -> bytes:
    """Append <sheet name sheetId state r:id/> elements (entries: name, sheet_id, state, rid)."""
    text = wb.decode("utf-8")
    m = re.search(r"</sheets\s*>", text)
    if m is None:
        raise XlsxSheetsError("workbook.xml has no <sheets> element to extend")
    root_open = re.search(r"<workbook\b[^>]*>", text)
    prefix = None
    if root_open:
        pm = re.search(r'xmlns:(\w+)="' + re.escape(NS_REL) + '"', root_open.group(0))
        prefix = pm.group(1) if pm else None
    out = []
    for name, sheet_id, state, rid in entries:
        esc = encode_text(name).replace('"', "&quot;")
        state_attr = "" if state == "visible" else f' state="{state}"'
        if prefix:
            out.append(f'<sheet name="{esc}" sheetId="{sheet_id}"{state_attr} {prefix}:id="{rid}"/>')
        else:
            out.append(f'<sheet name="{esc}" sheetId="{sheet_id}"{state_attr} xmlns:r="{NS_REL}" r:id="{rid}"/>')
    return (text[: m.start()] + "".join(out) + text[m.start():]).encode("utf-8")


def _update_app_xml(data: bytes, new_names: Sequence[str]) -> Optional[bytes]:
    """Extend docProps/app.xml worksheet titles; None when its layout is not the usual one."""
    text = data.decode("utf-8")
    pm = re.search(r"<(\w+):lpstr>Worksheets</\1:lpstr></\1:variant>\s*<\1:variant><\1:i4>(\d+)</\1:i4>", text)
    tm = re.search(r"<TitlesOfParts>\s*<(\w+):vector size=\"(\d+)\" baseType=\"lpstr\">(.*?)</\1:vector>", text, re.S)
    if pm is None or tm is None:
        return None
    vt = tm.group(1)
    n_ws = int(pm.group(2))
    titles = list(re.finditer(rf"<{vt}:lpstr>.*?</{vt}:lpstr>|<{vt}:lpstr/>", tm.group(3), re.S))
    if n_ws > len(titles) or int(tm.group(2)) != len(titles):
        return None
    inner = tm.group(3)
    cut = titles[n_ws - 1].end() if n_ws else 0
    add = "".join(f"<{vt}:lpstr>{encode_text(n)}</{vt}:lpstr>" for n in new_names)
    new_inner = inner[:cut] + add + inner[cut:]
    new_vec = tm.group(0).replace(
        f'size="{tm.group(2)}"', f'size="{len(titles) + len(new_names)}"', 1
    ).replace(tm.group(3), new_inner, 1)
    # replace the later match first so the earlier offsets stay valid
    text = text[: tm.start()] + new_vec + text[tm.end():]
    pm = re.search(r"<(\w+):lpstr>Worksheets</\1:lpstr></\1:variant>\s*<\1:variant><\1:i4>(\d+)</\1:i4>", text)
    assert pm is not None
    text = text[: pm.start(2)] + str(n_ws + len(new_names)) + text[pm.end(2):]
    return text.encode("utf-8")


def add_sheets(
    src_path: Union[str, os.PathLike],
    dst_path: Union[str, os.PathLike],
    sheets: Sequence[SheetSpec],
) -> AddSheetsResult:
    """Copy `src_path` to `dst_path` with `sheets` appended (see the module docstring).

    Raises XlsxSheetsError (SheetNameError for a bad or colliding name) before
    anything is written. dst must differ from src; the output is written to a
    temp file and moved into place at the end.
    """
    src = os.path.abspath(os.fspath(src_path))
    dst = os.path.abspath(os.fspath(dst_path))
    if os.path.normcase(src) == os.path.normcase(dst):
        raise XlsxSheetsError("dst_path must differ from src_path; the source is never modified in place")
    if not sheets:
        raise ValueError("no sheets to add")
    for s in sheets:
        if s.state not in STATES:
            raise XlsxSheetsError(f"sheet {s.name!r}: state must be one of {STATES}, got {s.state!r}")

    with zipfile.ZipFile(src) as zin:
        names = zin.namelist()
        existing = [si.name for si in list_sheets(zin)]
        taken = list(existing)
        for s in sheets:
            validate_sheet_name(s.name, taken)
            taken.append(s.name)

        wb_part = _workbook_part(zin)
        rels_part = _rels_path_for(wb_part)
        if rels_part not in names:
            raise XlsxSheetsError(f"{rels_part} is missing")
        rels = _read_rels(zin, rels_part)
        used_rids = {r.get("Id", "") for r in rels}
        wb_bytes = zin.read(wb_part)
        sheet_ids = [int(m) for m in re.findall(rb'<sheet\b[^>]*?\bsheetId="(\d+)"', wb_bytes)]
        next_sheet_id = max(sheet_ids, default=0) + 1

        styles_part = _styles_part(zin, wb_part, rels)
        used_styles: list[str] = []
        for s in sheets:
            for u in _used_styles(s):
                if u not in used_styles:
                    used_styles.append(u)
        new_styles, xf_of = _extend_styles(zin.read(styles_part), used_styles) if used_styles else (None, {})

        n = _next_part_number(names)
        new_parts: dict[str, bytes] = {}
        entries: list[tuple[str, int, str, str]] = []
        rel_xml: list[str] = []
        ct_xml: list[str] = []
        rid_n = 1
        for i, s in enumerate(sheets):
            part = f"xl/worksheets/sheet{n + i}.xml"
            new_parts[part] = _sheet_xml(s, xf_of)
            while f"rId{rid_n}" in used_rids:
                rid_n += 1
            rid = f"rId{rid_n}"
            used_rids.add(rid)
            entries.append((s.name, next_sheet_id + i, s.state, rid))
            target = posixpath.relpath(part, posixpath.dirname(wb_part) or ".")
            rel_xml.append(f'<Relationship Id="{rid}" Type="{REL_WORKSHEET}" Target="{target}"/>')
            ct_xml.append(f'<Override PartName="/{part}" ContentType="{CT_WORKSHEET}"/>')

        replacements: dict[str, bytes] = {}
        replacements[wb_part] = _register_in_workbook(wb_bytes, entries)
        rels_text = zin.read(rels_part).decode("utf-8")
        if not re.search(r"</Relationships\s*>", rels_text):
            raise XlsxSheetsError(f"{rels_part} has no closing </Relationships>")
        replacements[rels_part] = re.sub(
            r"</Relationships\s*>", lambda _: "".join(rel_xml) + "</Relationships>", rels_text, count=1
        ).encode("utf-8")
        ct_text = zin.read("[Content_Types].xml").decode("utf-8")
        if "</Types>" not in ct_text:
            raise XlsxSheetsError("[Content_Types].xml has no closing </Types>")
        replacements["[Content_Types].xml"] = ct_text.replace("</Types>", "".join(ct_xml) + "</Types>", 1).encode("utf-8")
        if new_styles is not None:
            replacements[styles_part] = new_styles
        if "docProps/app.xml" in names:
            app = _update_app_xml(zin.read("docProps/app.xml"), [s.name for s in sheets])
            if app is not None:
                replacements["docProps/app.xml"] = app

        ct_info = zin.getinfo("[Content_Types].xml")
        fd, tmp = tempfile.mkstemp(suffix=".xlsx.tmp", dir=os.path.dirname(dst) or ".")
        os.close(fd)
        try:
            with zipfile.ZipFile(tmp, "w") as zout:
                for zi in zin.infolist():
                    data = replacements.get(zi.filename)
                    if data is None:
                        data = zin.read(zi)
                    out_info = zipfile.ZipInfo(zi.filename, zi.date_time)
                    out_info.compress_type = zi.compress_type
                    out_info.external_attr = zi.external_attr
                    out_info.create_system = zi.create_system
                    out_info.comment = zi.comment
                    out_info.extra = zi.extra
                    zout.writestr(out_info, data)
                for part, data in new_parts.items():
                    out_info = zipfile.ZipInfo(part, ct_info.date_time)
                    out_info.compress_type = zipfile.ZIP_DEFLATED
                    out_info.external_attr = ct_info.external_attr
                    out_info.create_system = ct_info.create_system
                    zout.writestr(out_info, data)
            os.replace(tmp, dst)
        except BaseException:
            if os.path.exists(tmp):
                os.remove(tmp)
            raise
    return AddSheetsResult(
        sheet_names=[s.name for s in sheets],
        sheet_parts=list(new_parts),
        changed_parts=sorted(replacements),
        added_parts=list(new_parts),
    )


def _styles_part(zf: zipfile.ZipFile, wb_part: str, rels: list[dict[str, str]]) -> str:
    for r in rels:
        if r.get("Type") == NS_REL + "/styles":
            target = r["Target"]
            part = target[1:] if target.startswith("/") else posixpath.normpath(
                posixpath.join(posixpath.dirname(wb_part), target)
            )
            if part in zf.namelist():
                return part
    if "xl/styles.xml" in zf.namelist():
        return "xl/styles.xml"
    raise XlsxSheetsError("workbook has no styles part")
