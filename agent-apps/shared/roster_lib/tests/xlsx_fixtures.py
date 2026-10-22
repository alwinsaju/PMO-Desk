"""
Synthetic roster workbook generator for the roster_lib workbook-I/O tests.

Produces a small but structurally realistic copy of the PMO's `PDT Operate`
workbook: title/legend preamble, holiday-label row, a date row (shared-formula
chain with cached values, like Excel writes), a weekday row, a column-header
row that doubles as the first section header, section header rows (merged
A:B), people rows with a serial formula chain in column A, per-section timing
legends, conditional formatting (including an extLst x14 block), data
validation, a hyperlink, a legacy + threaded comment with a persons part, a
sensitivity-label docProps/LabelInfo, a customXml item, a drawing, a calcChain
and a hidden second sheet.

The base is written with openpyxl; the parts openpyxl cannot produce are
injected at zip level so tests can prove the patcher keeps them byte-identical.
All names/values are synthetic ("Person 01", ...); no real roster data.
"""

from __future__ import annotations

import re
import zipfile
import zlib
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.formatting.rule import CellIsRule, Rule
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.styles.differential import DifferentialStyle
from openpyxl.worksheet.datavalidation import DataValidation

SHEET = "PDT Operate"
FIRST_DATE_COL = 5  # E
EXCEL_EPOCH = date(1899, 12, 30)

CODES = ["Shift-1", "Shift-2", "Shift-3", "NS", "US-CST", "P", "HOL", "On-call", "11AM-8PM"]


def serial(d: date) -> int:
    return (d - EXCEL_EPOCH).days


def col_letters(n: int) -> str:
    out = ""
    while n:
        n, r = divmod(n - 1, 26)
        out = chr(65 + r) + out
    return out


@dataclass
class _Sec:
    title: str
    people: list[tuple[str, str]]  # (team label, location)
    legend: list[tuple[str, str]] = field(default_factory=list)  # (col A, col B)
    data: bool = True
    header_team_text: Optional[str] = None


SPEC = [
    _Sec(
        "L2",
        [
            ("L2 DIS USI", "Bengaluru"),
            ("L2 DIS US", "Mexico"),
            ("DIS USI", "Hyderabad"),
            ("L2 Infra USI", "Hyderabad"),
            ("Complaints", "Hyderabad"),
        ],
    ),
    _Sec("DEP", [("DEP USI", "Bengaluru"), ("DIS USI", "Gurgaon")], header_team_text="Team"),
    _Sec(
        "L3",
        [("L3", "Kolkata"), ("L3", "Chennai")],
        legend=[
            ("Shift-1", "4:30 PM - 1:30 AM (M-F)"),
            ("Shift-3", "9:00 PM - 6:00 AM"),
            ("Deployment (D)", "9:00 AM -6:00 PM (Monday)"),
            ("", "7:30 PM - 4:30 AM (M-F)"),
        ],
    ),
    _Sec(
        "Device Support",
        [("Device Support", "Hyderabad"), ("Device Support", "Hyderabad")],
        legend=[("Shift-1", "2:00 PM -11:00 PM (M-F)"), ("Weekend(W)", "6:30 PM-3:30 AM")],
    ),
    _Sec("Lab", [("Lab", "Pune")]),
    _Sec("L N S 2.0", [("LNS 2.0", "Bengaluru"), ("LNS 2.0", "Mexico")]),
    _Sec("Governance", [("Governance", "US"), ("L2 DIS USI", "Hyderabad")], data=False),
]

OVERRIDES = {("Person 01", 2): "Shift Swap\nNS"}  # multi-line text cell, 3rd date column


@dataclass
class FixturePerson:
    name: str
    location: str
    team: str
    section: str  # section title exactly as written in the sheet
    row: int


@dataclass
class FixtureInfo:
    path: Path
    sheet: str
    start: date
    days: int
    holiday_row: int
    date_row: int
    weekday_row: int
    header_row: int
    people: list[FixturePerson]
    section_headers: list[tuple[str, int]]  # (title as written, row)
    legend_ranges: list[tuple[int, int]]
    no_data_names: set[str]
    holiday_labels: dict[date, str]
    merged_holiday: tuple[date, int]  # (anchor date, width in days)
    comment_cell: tuple[int, int]
    hyperlink_cell: tuple[int, int]
    formula_cells: list[tuple[int, int]]  # col-A serial chain cells (people rows after the first)
    last_col: int

    def date_col(self, d: date) -> int:
        return FIRST_DATE_COL + (d - self.start).days

    def dates(self) -> list[date]:
        return [self.start + timedelta(days=i) for i in range(self.days)]

    def person(self, name: str) -> FixturePerson:
        return next(p for p in self.people if p.name == name)

    def expected(self, name: str, d: date) -> str:
        if name in self.no_data_names:
            return ""
        idx = (d - self.start).days
        if (name, idx) in OVERRIDES:
            return OVERRIDES[(name, idx)]
        if d.weekday() >= 5:
            return ""
        h = zlib.crc32(f"{name}|{d.isoformat()}".encode()) % 12
        return CODES[h] if h < len(CODES) else ""


_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def build_roster_workbook(
    path: Path,
    *,
    preamble_rows: int = 11,
    days: int = 45,
    start: date = date(2026, 1, 1),
    insert_person_after: Optional[str] = None,
    date_formulas: bool = True,
    cache_values: bool = True,
    extras: bool = True,
    shared_strings: bool = True,
    extra_cf_rules: int = 0,
) -> FixtureInfo:
    """Write a synthetic roster workbook to `path` and describe it.

    preamble_rows: rows above the holiday-label row (11 mirrors the real file,
        putting dates on row 13); other values prove nothing is hard-coded.
    insert_person_after: add one extra person row right after the named person.
    date_formulas / cache_values: write the date and weekday rows as a
        shared-formula chain with cached values (like Excel), as formulas with
        no cached values (like openpyxl), or as plain literals.
    shared_strings: store text in xl/sharedStrings.xml (as Excel does) rather
        than openpyxl's inline strings; the hyperlink cell stays inline.
    extras: inject the non-openpyxl parts (threaded comments, label, drawing...).
    extra_cf_rules: append N throw-away conditionalFormatting blocks (to mimic
        the master's huge conditional-format section).
    """
    wb = Workbook()
    ws = wb.active
    ws.title = SHEET
    notes = wb.create_sheet("Notes")
    notes.sheet_state = "hidden"
    notes["A1"] = "hidden helper sheet"
    notes["A2"] = "=1+1"

    last_col = FIRST_DATE_COL + days - 1
    holiday_row = preamble_rows + 1
    date_row = holiday_row + 1
    weekday_row = date_row + 1
    header_row = weekday_row + 1

    bold = Font(bold=True)
    center = Alignment(horizontal="center", vertical="center")
    green = PatternFill("solid", fgColor="FF86BC25")

    # --- preamble: title + timing legend (A=shift code, B=timing, C=code, D=meaning)
    ws["C1"] = "PDT Operate\nRESOURCE SCHEDULE"
    ws.merge_cells("C1:D1")
    legend_top = [
        ("Shift-1", "8:00 AM - 5:00 PM (Mon-Fri)", "COMP", "Comp off"),
        ("Shift-2", "8:00 AM - 5:00 PM (Wed-Sun)", "OC", "On-call / holiday support"),
        ("Shift-3", "2:00 PM - 11:00 PM (Mon-Fri)", "", "Weekly off"),
    ]
    for i, (a, b, c, d) in enumerate(legend_top):
        r = 2 + i
        if r >= holiday_row:
            break
        ws.cell(r, 1, a)
        ws.cell(r, 2, b)
        if c:
            ws.cell(r, 3, c)
        ws.cell(r, 4, d)
    if holiday_row - 1 > 5:
        ws.cell(holiday_row - 1, 1, "Colors apply automatically based on the cell text")
        ws.merge_cells(start_row=holiday_row - 1, start_column=1, end_row=holiday_row - 1, end_column=4)

    # --- holiday labels / dates / weekdays
    ws.cell(holiday_row, 1, "Resource")
    ws.merge_cells(start_row=holiday_row, start_column=1, end_row=weekday_row, end_column=4)
    holiday_labels: dict[date, str] = {}
    hol_defs = {2: "Republic Day", 9: "Swap Day", 14: "Winter Disconnect"}
    merged_anchor = start + timedelta(days=14)
    merged_width = min(3, days - 14)
    for off, label in hol_defs.items():
        if off < days:
            ws.cell(holiday_row, FIRST_DATE_COL + off, label)
            holiday_labels[start + timedelta(days=off)] = label
    if days > 14 and merged_width > 1:
        ws.merge_cells(
            start_row=holiday_row,
            start_column=FIRST_DATE_COL + 14,
            end_row=holiday_row,
            end_column=FIRST_DATE_COL + 14 + merged_width - 1,
        )
    for i in range(days):
        c = FIRST_DATE_COL + i
        d = start + timedelta(days=i)
        cell = ws.cell(date_row, c)
        if date_formulas and i > 0:
            cell.value = f"={col_letters(c - 1)}{date_row}+1"
        else:
            cell.value = datetime(d.year, d.month, d.day)
        cell.number_format = "d-mmm"
        wk = ws.cell(weekday_row, c)
        wk.value = f'=TEXT({col_letters(c)}{date_row}, "ddd")' if date_formulas else d.strftime("%a")

    # --- header + body
    people: list[FixturePerson] = []
    section_headers: list[tuple[str, int]] = []
    legend_ranges: list[tuple[int, int]] = []
    formula_cells: list[tuple[int, int]] = []
    no_data: set[str] = set()
    r = header_row
    serial_no = 0
    prev_person_row = None
    person_counter = 0

    def add_person(sec: _Sec, name: str, team: str, loc: str, row: int) -> None:
        nonlocal prev_person_row, serial_no
        serial_no += 1
        if prev_person_row is None:
            ws.cell(row, 1, 1)
        else:
            ws.cell(row, 1, f"=A{prev_person_row}+1")
            formula_cells.append((row, 1))
        prev_person_row = row
        ws.cell(row, 2, name)
        ws.cell(row, 3, loc)
        ws.cell(row, 4, team)
        people.append(FixturePerson(name, loc, team, sec.title, row))
        if not sec.data:
            no_data.add(name)

    for si, sec in enumerate(SPEC):
        if si == 0:
            ws.cell(r, 1, "#")
            ws.cell(r, 2, sec.title)
            ws.cell(r, 3, "Loc")
            ws.cell(r, 4, "Team")
            for c in range(1, 5):
                ws.cell(r, c).font = bold
            section_headers.append((sec.title, r))
        else:
            ws.cell(r, 1, sec.title).font = bold
            ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=2)
            if sec.header_team_text:
                ws.cell(r, 4, sec.header_team_text)
            section_headers.append((sec.title, r))
        for c in range(1, last_col + 1):
            ws.cell(r, c).fill = green
        r += 1
        for team, loc in sec.people:
            person_counter += 1
            name = f"Person {person_counter:02d}"
            add_person(sec, name, team, loc, r)
            r += 1
            if insert_person_after == name:
                add_person(sec, "Person Inserted", team, loc, r)
                r += 1
        if sec.legend:
            r += 1  # thin spacer row, no content
            ws.row_dimensions[r - 1].height = 7.95
            first = r
            for a, b in sec.legend:
                if a:
                    ws.cell(r, 1, a)
                ws.cell(r, 2, b)
                r += 1
            legend_ranges.append((first, r - 1))
    last_row = r - 1

    # --- data cells (every data cell exists and is styled, like the real file)
    info_tmp = FixtureInfo(
        path=path, sheet=SHEET, start=start, days=days, holiday_row=holiday_row, date_row=date_row,
        weekday_row=weekday_row, header_row=header_row, people=people, section_headers=section_headers,
        legend_ranges=legend_ranges, no_data_names=no_data, holiday_labels=holiday_labels,
        merged_holiday=(merged_anchor, merged_width), comment_cell=(0, 0), hyperlink_cell=(0, 0),
        formula_cells=formula_cells, last_col=last_col,
    )
    body_rows = {p.row for p in people}
    for row in range(header_row + 1, last_row + 1):
        if row not in body_rows:
            continue
        name = ws.cell(row, 2).value
        for i in range(days):
            d = start + timedelta(days=i)
            cell = ws.cell(row, FIRST_DATE_COL + i)
            cell.alignment = center
            text = info_tmp.expected(name, d)
            if text:
                cell.value = text

    # --- conditional formatting, validation, comment, hyperlink
    yellow = DifferentialStyle(fill=PatternFill(bgColor="FFFFFF00"))
    first_l = col_letters(FIRST_DATE_COL)
    last_l = col_letters(last_col)
    hol_range = f"{first_l}{holiday_row}:{last_l}{holiday_row}"
    body_range = f"{first_l}{header_row + 1}:{last_l}{last_row}"
    ws.conditional_formatting.add(
        hol_range,
        Rule(type="containsText", operator="containsText", text="swap", dxf=yellow,
             formula=[f'NOT(ISERROR(SEARCH("swap",{first_l}{holiday_row})))']),
    )
    for k, token in enumerate(["shift-1", "ns", "hol", "pto", "am", "pm"]):
        ws.conditional_formatting.add(
            body_range,
            Rule(type="containsText", operator="containsText", text=token, dxf=yellow,
                 formula=[f'NOT(ISERROR(SEARCH("{token}",{first_l}{header_row + 1})))']),
        )
    ws.conditional_formatting.add(body_range, CellIsRule(operator="equal", formula=['"P"'], fill=PatternFill(bgColor="FF00B0F0")))
    dv = DataValidation(type="list", formula1='"Shift-1,Shift-2,Shift-3,NS,HOL,P,PTO,On-call"', allow_blank=True)
    dv.errorStyle = "information"
    ws.add_data_validation(dv)
    dv.add(body_range)

    comment_cell = (people[1].row, FIRST_DATE_COL + 3)
    ws.cell(*comment_cell).comment = Comment("[Threaded comment]\n\nsynthetic note", "Test Author")
    hyperlink_cell = (people[3].row, FIRST_DATE_COL + 5)
    ws.cell(*hyperlink_cell).hyperlink = "https://example.test/roster"
    if not ws.cell(*hyperlink_cell).value:
        ws.cell(*hyperlink_cell).value = "link"
    info_tmp.comment_cell = comment_cell
    info_tmp.hyperlink_cell = hyperlink_cell

    ws.freeze_panes = ws.cell(header_row + 1, FIRST_DATE_COL).coordinate
    ws.auto_filter.ref = f"A{header_row}:D{last_row}"
    ws.column_dimensions["B"].width = 26

    base = path.with_suffix(".base.xlsx")
    wb.save(base)
    _post_process(base, path, info_tmp, date_formulas=date_formulas, cache_values=cache_values,
                  extras=extras, shared_strings=shared_strings, extra_cf_rules=extra_cf_rules, last_row=last_row)
    base.unlink()
    return info_tmp


# ---------------------------------------------------------------------------
# zip-level post-processing


def _sub_cell(xml: str, ref: str, builder) -> str:
    """Replace one <c> with builder(ref, attrs_without_t)."""
    pat = re.compile(r'<c r="%s"([^>]*?)(?:/>|>.*?</c>)' % ref, re.S)
    m = pat.search(xml)
    if not m:
        raise AssertionError(f"cell {ref} not found in generated sheet")
    attrs = re.sub(r'\s+t="[^"]*"', "", m.group(1))
    return xml[: m.start()] + builder(ref, attrs) + xml[m.end():]


def _inject_formula_chain(xml: str, info: FixtureInfo, *, cache: bool) -> str:
    """Rewrite date/weekday formula cells as Excel-style shared formulas with cached values."""
    chunk = 10
    si = 0
    for row, kind in ((info.date_row, "date"), (info.weekday_row, "weekday")):
        start_i = 1 if kind == "date" else 0
        i = start_i
        while i < info.days:
            j = min(i + chunk, info.days)
            c0, c1 = FIRST_DATE_COL + i, FIRST_DATE_COL + j - 1
            for k in range(i, j):
                c = FIRST_DATE_COL + k
                d = info.start + timedelta(days=k)
                if kind == "date":
                    value, tattr = str(serial(d)), ""
                    master = f"{col_letters(c - 1)}{row}+1"
                else:
                    value, tattr = d.strftime("%a"), ' t="str"'
                    master = f'TEXT({col_letters(c)}{row}, "ddd")'
                if k == i:
                    f = f'<f t="shared" ref="{col_letters(c0)}{row}:{col_letters(c1)}{row}" si="{si}">{master}</f>'
                else:
                    f = f'<f t="shared" si="{si}"/>'
                v = f"<v>{value}</v>" if cache else ""
                xml = _sub_cell(
                    xml, f"{col_letters(c)}{row}",
                    lambda ref, a, f=f, v=v, t=tattr: f'<c r="{ref}"{a}{t}>{f}{v}</c>',
                )
            si += 1
            i = j
    return xml


def _inject_cached_serial_chain(xml: str, info: FixtureInfo) -> str:
    """Add cached <v> to the column-A '=A{prev}+1' formulas."""
    for row, col in info.formula_cells:
        ref = f"A{row}"
        n = [p.row for p in info.people].index(row) + 1
        xml = _sub_cell(
            xml, ref,
            lambda ref, a, n=n, row=row: f'<c r="{ref}"{a}><f>A{_prev_person_row(info, row)}+1</f><v>{n}</v></c>',
        )
    return xml


def _prev_person_row(info: FixtureInfo, row: int) -> int:
    rows = [p.row for p in info.people]
    return rows[rows.index(row) - 1]


_EXT_LST = (
    '<extLst><ext uri="{78C0D931-6437-4328-A41B-8F8EB75A4E96}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main">'
    '<x14:conditionalFormattings><x14:conditionalFormatting xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main">'
    '<x14:cfRule type="containsText" priority="90" operator="containsText" text="lean" id="{11111111-2222-3333-4444-555555555555}">'
    '<xm:f>NOT(ISERROR(SEARCH("lean",E9)))</xm:f><x14:dxf><fill><patternFill><bgColor rgb="FFFFC000"/></patternFill></fill></x14:dxf></x14:cfRule>'
    '<xm:sqref>E9:H9</xm:sqref></x14:conditionalFormatting></x14:conditionalFormattings></ext>'
    '<ext uri="{CCE6A557-97BC-4b89-ADB6-D9C93CAAB3DF}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main">'
    '<x14:dataValidations xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main" count="1">'
    '<x14:dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1"><x14:formula1><xm:f>Notes!$A$1:$A$2</xm:f></x14:formula1>'
    '<xm:sqref>A1:A2</xm:sqref></x14:dataValidation></x14:dataValidations></ext></extLst>'
)

_DRAWING = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
    '<xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>'
    '<xdr:ext cx="914400" cy="457200"/><xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="2" name="Banner"/><xdr:cNvSpPr/></xdr:nvSpPr>'
    '<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>'
    '<xdr:txBody><a:bodyPr/><a:p><a:r><a:t>synthetic banner</a:t></a:r></a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>'
)

_PERSON_ID = "{AAAAAAAA-0000-4000-8000-000000000001}"
_THREAD_ID = "{BBBBBBBB-0000-4000-8000-000000000002}"


_INLINE_CELL_RE = re.compile(r'<c r="([A-Z]+[0-9]+)"([^>]*?) t="inlineStr"><is><t>(.*?)</t></is></c>', re.S)


def _to_shared_strings(sheets: dict[str, str], keep_inline: set[str]) -> tuple[dict[str, str], str]:
    """Turn openpyxl's inline strings into an Excel-style sharedStrings table.

    Index 0 is a rich-text lookalike of "Shift-1" (must never be reused for a
    plain write); the Republic Day label is stored as two rich runs (reading
    must concatenate them). `keep_inline` cell refs stay t="inlineStr".
    """
    si = ['<si><r><t xml:space="preserve">Shift-</t></r><r><rPr><b/></rPr><t>1</t></r></si>']
    index: dict[str, int] = {}
    refs = 0

    def repl(m: re.Match) -> str:
        nonlocal refs
        ref, attrs, raw = m.group(1), m.group(2), m.group(3)
        if ref in keep_inline:
            return m.group(0)
        refs += 1
        if raw == "Republic Day":
            if "RICH" not in index:
                index["RICH"] = len(si)
                si.append(
                    '<si><r><t xml:space="preserve">Republic </t></r><r><rPr><b/></rPr><t>Day</t></r></si>'
                )
            return f'<c r="{ref}"{attrs} t="s"><v>{index["RICH"]}</v></c>'
        if raw not in index:
            index[raw] = len(si)
            si.append(f'<si><t xml:space="preserve">{raw}</t></si>')
        return f'<c r="{ref}"{attrs} t="s"><v>{index[raw]}</v></c>'

    out = {name: _INLINE_CELL_RE.sub(repl, xml) for name, xml in sheets.items()}
    sst = (
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        f'<sst xmlns="{_MAIN}" count="{refs}" uniqueCount="{len(si)}">' + "".join(si) + "</sst>"
    )
    return out, sst


def _add_override(ct: str, part: str, ctype: str) -> str:
    return ct.replace("</Types>", f'<Override PartName="/{part}" ContentType="{ctype}"/></Types>')


def _add_rel(rels: str, rid: str, rtype: str, target: str) -> str:
    return rels.replace("</Relationships>", f'<Relationship Id="{rid}" Type="{rtype}" Target="{target}"/></Relationships>')


def _post_process(base: Path, dst: Path, info: FixtureInfo, *, date_formulas, cache_values, extras, shared_strings, extra_cf_rules, last_row) -> None:
    with zipfile.ZipFile(base) as z:
        parts = {zi.filename: z.read(zi) for zi in z.infolist()}
        order = [zi.filename for zi in z.infolist()]

    sheet_name = "xl/worksheets/sheet1.xml"
    xml = parts[sheet_name].decode("utf-8")

    if date_formulas and cache_values:
        xml = _inject_formula_chain(xml, info, cache=True)
    xml = _inject_cached_serial_chain(xml, info) if cache_values else xml

    if extra_cf_rules:
        blob = "".join(
            f'<conditionalFormatting sqref="A{i % 900 + 1}"><cfRule type="expression" dxfId="0" priority="{100 + i}">'
            f"<formula>A{i % 900 + 1}=TODAY()</formula></cfRule></conditionalFormatting>"
            for i in range(extra_cf_rules)
        )
        assert "<dataValidations" in xml
        xml = xml.replace("<dataValidations", blob + "<dataValidations", 1)

    if extras:
        xml = xml.replace("</worksheet>", _EXT_LST + "</worksheet>")
        assert "<legacyDrawing" in xml
        xml = re.sub(r"(<legacyDrawing)", f'<drawing xmlns:r="{_R}" r:id="rIdDrw1"/>\\1', xml, count=1)
    parts[sheet_name] = xml.encode("utf-8")

    sst_xml = None
    if shared_strings:
        hl = info.hyperlink_cell
        converted, sst_xml = _to_shared_strings(
            {
                "xl/worksheets/sheet1.xml": xml,
                "xl/worksheets/sheet2.xml": parts["xl/worksheets/sheet2.xml"].decode("utf-8"),
            },
            keep_inline={f"{col_letters(hl[1])}{hl[0]}"},
        )
        for name, text in converted.items():
            parts[name] = text.encode("utf-8")

    ct = parts["[Content_Types].xml"].decode("utf-8")
    sheet_rels_name = "xl/worksheets/_rels/sheet1.xml.rels"
    srels = parts[sheet_rels_name].decode("utf-8")
    wb_rels = parts["xl/_rels/workbook.xml.rels"].decode("utf-8")
    root_rels = parts["_rels/.rels"].decode("utf-8")
    new_parts: dict[str, bytes] = {}
    if sst_xml is not None:
        new_parts["xl/sharedStrings.xml"] = sst_xml.encode("utf-8")
        ct = _add_override(ct, "xl/sharedStrings.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml")
        wb_rels = _add_rel(wb_rels, "rIdSst", _R + "/sharedStrings", "sharedStrings.xml")

    # calcChain: sheet 1 formulas then the hidden sheet's formula (i is inherited between entries)
    sheet_formula_cells = list(info.formula_cells)
    if date_formulas and cache_values:
        sheet_formula_cells += [(info.date_row, FIRST_DATE_COL + k) for k in range(1, info.days)]
        sheet_formula_cells += [(info.weekday_row, FIRST_DATE_COL + k) for k in range(info.days)]
    entries = []
    for n, (row, col) in enumerate(sheet_formula_cells):
        entries.append(f'<c r="{col_letters(col)}{row}"' + (' i="1"' if n == 0 else "") + "/>")
    entries.append('<c r="A2" i="2"/>')
    new_parts["xl/calcChain.xml"] = (
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<calcChain xmlns="{_MAIN}">' + "".join(entries) + "</calcChain>"
    ).encode()
    ct = _add_override(ct, "xl/calcChain.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml")
    wb_rels = _add_rel(wb_rels, "rIdCalc", _R + "/calcChain", "calcChain.xml")

    if extras:
        new_parts["xl/drawings/drawing1.xml"] = _DRAWING.encode()
        ct = _add_override(ct, "xl/drawings/drawing1.xml", "application/vnd.openxmlformats-officedocument.drawing+xml")
        srels = _add_rel(srels, "rIdDrw1", _R + "/drawing", "../drawings/drawing1.xml")

        row, col = info.comment_cell
        ref = f"{col_letters(col)}{row}"
        new_parts["xl/threadedComments/threadedComment1.xml"] = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<ThreadedComments xmlns="http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments">'
            f'<threadedComment ref="{ref}" dT="2026-01-05T10:00:00.00" personId="{_PERSON_ID}" id="{_THREAD_ID}"><text>synthetic note</text></threadedComment>'
            "</ThreadedComments>"
        ).encode()
        new_parts["xl/persons/person.xml"] = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<personList xmlns="http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments">'
            f'<person displayName="Test Author" id="{_PERSON_ID}" userId="test.author" providerId="None"/></personList>'
        ).encode()
        ct = _add_override(ct, "xl/threadedComments/threadedComment1.xml", "application/vnd.ms-excel.threadedcomments+xml")
        ct = _add_override(ct, "xl/persons/person.xml", "application/vnd.ms-excel.person+xml")
        srels = _add_rel(srels, "rIdTc1", "http://schemas.microsoft.com/office/2017/10/relationships/threadedComment", "../threadedComments/threadedComment1.xml")
        wb_rels = _add_rel(wb_rels, "rIdPers", "http://schemas.microsoft.com/office/2017/10/relationships/person", "persons/person.xml")

        new_parts["docProps/custom.xml"] = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" '
            'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
            '<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="MSIP_Label_00000000-0000-0000-0000-000000000000_Enabled"><vt:lpwstr>true</vt:lpwstr></property>'
            '<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="3" name="MSIP_Label_00000000-0000-0000-0000-000000000000_Name"><vt:lpwstr>Synthetic</vt:lpwstr></property>'
            "</Properties>"
        ).encode()
        new_parts["docMetadata/LabelInfo.xml"] = (
            '<?xml version="1.0" encoding="utf-8" standalone="yes"?>'
            '<clbl:labelList xmlns:clbl="http://schemas.microsoft.com/office/2020/mipLabelMetadata">'
            '<clbl:label id="{00000000-0000-0000-0000-000000000000}" enabled="1" method="Privileged" siteId="{00000000-0000-0000-0000-000000000001}" removed="0" />'
            "</clbl:labelList>"
        ).encode()
        ct = _add_override(ct, "docProps/custom.xml", "application/vnd.openxmlformats-officedocument.custom-properties+xml")
        ct = _add_override(ct, "docMetadata/LabelInfo.xml", "application/vnd.ms-office.classificationlabels+xml")
        root_rels = _add_rel(root_rels, "rIdCust", _R + "/custom-properties", "docProps/custom.xml")
        root_rels = _add_rel(root_rels, "rIdLbl", "http://schemas.microsoft.com/office/2020/02/relationships/classificationlabels", "docMetadata/LabelInfo.xml")

        new_parts["customXml/item1.xml"] = b'<?xml version="1.0" encoding="UTF-8"?><synthetic>item</synthetic>'
        new_parts["customXml/itemProps1.xml"] = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<ds:datastoreItem xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml" ds:itemID="{00000000-0000-0000-0000-0000000000AA}"><ds:schemaRefs/></ds:datastoreItem>'
        ).encode()
        new_parts["customXml/_rels/item1.xml.rels"] = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{_R}/customXmlProps" Target="itemProps1.xml"/></Relationships>'
        ).encode()
        ct = _add_override(ct, "customXml/itemProps1.xml", "application/vnd.openxmlformats-officedocument.customXmlProperties+xml")
        wb_rels = _add_rel(wb_rels, "rIdCx", _R + "/customXml", "../customXml/item1.xml")

    parts["[Content_Types].xml"] = ct.encode()
    parts[sheet_rels_name] = srels.encode()
    parts["xl/_rels/workbook.xml.rels"] = wb_rels.encode()
    parts["_rels/.rels"] = root_rels.encode()
    if "docProps/custom.xml" in new_parts and "docProps/custom.xml" in parts:
        raise AssertionError("openpyxl already wrote docProps/custom.xml")

    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as out:
        for name in order:
            out.writestr(name, parts[name])
        for name, data in new_parts.items():
            out.writestr(name, data)
