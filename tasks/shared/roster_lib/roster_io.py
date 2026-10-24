"""
Read-only reader for the PMO's shift-roster workbook (sheet `PDT Operate`).

Nothing here writes: it parses the sheet XML at text level (see xlsx_patch) and
returns RAW cell text plus structure. Interpreting the text (shift codes, PTO,
holidays) is done elsewhere. No row or column number is hard-coded; every
position is detected from content so people can be inserted and the preamble
can grow without breaking the reader.

Detection cues (all documented here so a layout change fails loudly):

date row
    The row holding the longest run of consecutive date serials (numeric cells
    in the 2000-2100 serial range, each exactly +1 from the previous column,
    minimum MIN_DATES). The run's first column is the first date column.
    Formula cells use their cached value; if Excel never cached one and the
    formula is exactly `<left cell>+1` the value is inferred. Any further
    date-like cell on that row outside the run means duplicate / non-contiguous
    dates and is an error rather than a guess.
weekday row
    The row within two rows of the date row whose texts match the weekday of
    each date (Mon / Monday ...). Optional.
holiday-label row
    The row directly above the topmost of date/weekday rows. Labels are returned
    exactly as typed, keyed by the date column they sit in (a label merged over
    several days sits in the left-most cell; expand_merges=True spreads it).
column-header row
    The first row below the date block with a `Loc`/`Location` label and a
    `Team` label in the columns left of the dates. These fix the location and
    team columns; the name column is the one immediately left of Loc and the
    serial (#) column the one before it. The first section's title is the text
    in the name column of this row (the header row doubles as the first
    section header in the real workbook).
row classification below the column header
    person   - name present and (location present, or a numeric/formula serial,
               or shift data in the date columns)
    header   - no name, no location, title text in the serial column (sections
               are merged A:B so the title sits in the first cell), or a title
               in a merged serial..name range. Extra stray text such as a
               'Team' label in the team column does not matter.
    legend   - everything else with text in the label columns and no person
               cues: a timing key such as `Shift-1 | 4:30 PM - 1:30 AM`. Runs of
               consecutive legend rows form one Legend, remembered with the
               section it follows and the section header that comes next.
    spacer   - no label text: ignored.
    Rows above the holiday row are the preamble (title and top legend), also
    returned as a raw Legend.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Iterable, Mapping, Optional, Union

from .xlsx_patch import (
    LoadedSheet,
    SheetCell,
    SheetNotFoundError,
    col_to_num,
    load_sheet,
    num_to_col,
)

DEFAULT_SHEET = "PDT Operate"
MIN_DATES = 7
EXCEL_EPOCH = date(1899, 12, 30)
SERIAL_MIN = (date(2000, 1, 1) - EXCEL_EPOCH).days
SERIAL_MAX = (date(2100, 12, 31) - EXCEL_EPOCH).days

# Keys are matched case-insensitively with whitespace collapsed.
DEFAULT_SECTION_ALIASES: dict[str, str] = {"L N S 2.0": "LNS 2.0"}

_WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
_LOC_LABEL = re.compile(r"^loc(ation)?$", re.I)
_TEAM_LABEL = re.compile(r"^team$", re.I)
_INFER_PLUS_ONE = re.compile(r"^\$?([A-Z]{1,3})\$?(\d+)\+1$")

PersonRef = Union["Person", int]


class RosterFormatError(Exception):
    """The workbook does not look like the shift roster (or is ambiguous)."""


@dataclass(frozen=True)
class Person:
    name: str
    location_code: str  # raw "Loc" column text (a city name in the real file) after location_aliases
    team_label: str  # raw "Team" column text, e.g. "L2 DIS USI", "Complaints"
    section: str  # normalised section name
    row: int  # 1-based sheet row


@dataclass(frozen=True)
class Section:
    name: str  # normalised
    raw_name: str  # as typed
    header_row: int
    person_rows: tuple[int, ...]


@dataclass(frozen=True)
class LegendLine:
    row: int
    cells: tuple[tuple[int, str], ...]  # (column, raw text) for non-empty cells

    @property
    def text(self) -> str:
        return " | ".join(t for _, t in self.cells)


@dataclass(frozen=True)
class Legend:
    """A raw block of key/legend lines. Content is not interpreted."""

    first_row: int
    last_row: int
    lines: tuple[LegendLine, ...]
    after_section: Optional[str]  # section whose people precede the block (None for the preamble)
    before_section: Optional[str]  # next section header after the block (None at end of sheet)

    def lines_text(self) -> list[str]:
        return [ln.text for ln in self.lines]


def _norm_key(s: str) -> str:
    return " ".join(s.split()).casefold()


def _clean(s: str) -> str:
    return s.strip()


def _serial_of(cell: Optional[SheetCell]) -> Optional[int]:
    if cell is None or cell.cell_type not in (None, "n") or not cell.text:
        return None
    try:
        f = float(cell.text)
    except ValueError:
        return None
    if f != int(f):
        return None
    n = int(f)
    return n if SERIAL_MIN <= n <= SERIAL_MAX else None


class Roster:
    """Parsed view of one roster sheet. Build with load_roster()."""

    def __init__(
        self,
        *,
        path: str,
        sheet_name: str,
        sheet: LoadedSheet,
        date_row: int,
        weekday_row: Optional[int],
        holiday_row: int,
        header_row: int,
        first_date_col: int,
        dates: tuple[date, ...],
        serial_col: Optional[int],
        name_col: int,
        location_col: int,
        team_col: int,
        people: tuple[Person, ...],
        sections: tuple[Section, ...],
        legends: tuple[Legend, ...],
        preamble: Optional[Legend],
        warnings: list[str],
    ):
        self.path = path
        self.sheet_name = sheet_name
        self._sheet = sheet
        self.date_row = date_row
        self.weekday_row = weekday_row
        self.holiday_row = holiday_row
        self.header_row = header_row
        self.first_date_col = first_date_col
        self.last_date_col = first_date_col + len(dates) - 1
        self.dates = dates
        self.serial_col = serial_col
        self.name_col = name_col
        self.location_col = location_col
        self.team_col = team_col
        self.people = people
        self.sections = sections
        self.legends = legends
        self.preamble = preamble
        self.warnings = warnings
        self.date_to_col: dict[date, int] = {d: first_date_col + i for i, d in enumerate(dates)}
        self.col_to_date: dict[int, date] = {c: d for d, c in self.date_to_col.items()}
        self._by_row = {p.row: p for p in people}

    # -- dates ------------------------------------------------------------

    @property
    def first_date(self) -> date:
        return self.dates[0]

    @property
    def last_date(self) -> date:
        return self.dates[-1]

    def _col(self, d: date) -> int:
        try:
            return self.date_to_col[d]
        except KeyError:
            raise ValueError(f"{d} is outside the roster's dates {self.first_date}..{self.last_date}") from None

    def _row(self, person: PersonRef) -> int:
        row = person if isinstance(person, int) else person.row
        if row not in self._by_row:
            raise ValueError(f"row {row} is not a person row")
        return row

    # -- people -----------------------------------------------------------

    def person_at(self, row: int) -> Person:
        return self._by_row[row]

    def find(self, name: str) -> list[Person]:
        """People whose name equals `name` ignoring case and extra whitespace."""
        key = _norm_key(name)
        return [p for p in self.people if _norm_key(p.name) == key]

    def people_in(self, section: str) -> list[Person]:
        return [p for p in self.people if p.section == section]

    # -- cells ------------------------------------------------------------

    def address(self, person: PersonRef, d: date) -> tuple[int, int]:
        """(row, col) of a person x date cell, for xlsx_patch.patch_workbook."""
        return self._row(person), self._col(d)

    def address_map(
        self, person: PersonRef, start: Optional[date] = None, end: Optional[date] = None
    ) -> dict[date, tuple[int, int]]:
        row = self._row(person)
        return {d: (row, self._col(d)) for d in self._range(start, end)}

    def cell(self, person: PersonRef, d: date) -> str:
        """Raw text of one cell ("" when blank). Formula cells give their cached text."""
        return self._sheet.text(self._row(person), self._col(d))

    def is_formula(self, person: PersonRef, d: date) -> bool:
        c = self._sheet.cells.get((self._row(person), self._col(d)))
        return bool(c and c.is_formula)

    def row_texts(self, person: PersonRef, start: Optional[date] = None, end: Optional[date] = None) -> list[str]:
        """Raw texts for start..end inclusive (default: the whole roster), in date order."""
        row = self._row(person)
        return [self._sheet.text(row, self._col(d)) for d in self._range(start, end)]

    def _range(self, start: Optional[date], end: Optional[date]) -> list[date]:
        start = start or self.first_date
        end = end or self.last_date
        if end < start:
            raise ValueError(f"end {end} is before start {start}")
        self._col(start)
        self._col(end)
        return [start + timedelta(days=i) for i in range((end - start).days + 1)]

    def holiday_labels(self, expand_merges: bool = False) -> dict[date, str]:
        """Raw holiday-label row text by date (blank cells omitted)."""
        out: dict[date, str] = {}
        for d, col in self.date_to_col.items():
            text = self._sheet.text(self.holiday_row, col)
            if text.strip():
                out[d] = text
        if expand_merges:
            for r1, c1, r2, c2 in self._sheet.merges:
                if r1 == self.holiday_row == r2:
                    anchor = self.col_to_date.get(c1)
                    if anchor in out:
                        for c in range(c1 + 1, c2 + 1):
                            d = self.col_to_date.get(c)
                            if d is not None:
                                out.setdefault(d, out[anchor])
        return out

    def weekday_label(self, d: date) -> Optional[str]:
        """Raw text of the weekday row for a date, if the sheet has such a row."""
        if self.weekday_row is None:
            return None
        return self._sheet.text(self.weekday_row, self._col(d))


# ---------------------------------------------------------------------------
# Loading


def _group_by_row(sheet: LoadedSheet) -> dict[int, dict[int, SheetCell]]:
    rows: dict[int, dict[int, SheetCell]] = {}
    for (r, c), cell in sheet.cells.items():
        rows.setdefault(r, {})[c] = cell
    return rows


def _find_date_row(sheet: LoadedSheet, rows: dict[int, dict[int, SheetCell]]) -> tuple[int, int, list[int]]:
    """-> (row, first_col, serials of the run)."""
    best: Optional[tuple[int, int, list[int]]] = None
    for r in sorted(rows):
        cells = rows[r]
        values: dict[int, int] = {}
        for c in sorted(cells):
            cell = cells[c]
            v = _serial_of(cell)
            if v is None and cell.is_formula and not cell.text and cell.cell_type in (None, "n"):
                m = _INFER_PLUS_ONE.match(cell.formula.strip())
                left = values.get(c - 1)
                if m and left is not None and col_to_num(m.group(1)) == c - 1 and int(m.group(2)) == r:
                    v = left + 1
            if v is not None:
                values[c] = v
        if len(values) < MIN_DATES:
            continue
        run_start = prev_c = None
        run: list[int] = []
        best_run: list[int] = []
        best_start = 0
        for c in sorted(values):
            if prev_c is not None and c == prev_c + 1 and values[c] == values[prev_c] + 1:
                run.append(values[c])
            else:
                run, run_start = [values[c]], c
            prev_c = c
            if len(run) > len(best_run):
                best_run, best_start = list(run), run_start
        if len(best_run) >= MIN_DATES and (best is None or len(best_run) > len(best[2])):
            best = (r, best_start, best_run)
    if best is None:
        raise RosterFormatError(
            f"date row not found: no row has {MIN_DATES}+ consecutive date cells on sheet {sheet.info.name!r}"
        )
    return best


def _check_date_row_clean(r: int, first_col: int, run: list[int], rows: dict[int, dict[int, SheetCell]]) -> None:
    cols_in_run = set(range(first_col, first_col + len(run)))
    seen = set(run)
    stray: list[int] = []
    dupes: list[int] = []
    # Every date-like cell on the row must be in the run, including ones left of
    # it: otherwise a broken chain would silently shorten the roster.
    for c, cell in rows[r].items():
        if c in cols_in_run:
            continue
        v = _serial_of(cell)
        if v is None and cell.is_formula and not cell.text and c >= first_col:
            stray.append(c)  # a date-row formula with no usable cached value
            continue
        if v is not None:
            (dupes if v in seen else stray).append(c)
    if dupes:
        raise RosterFormatError(
            f"duplicate dates on row {r}: columns {[num_to_col(c) for c in sorted(dupes)[:5]]} repeat an earlier date"
        )
    if stray:
        raise RosterFormatError(
            f"dates on row {r} are not contiguous: unexpected date cells in columns "
            f"{[num_to_col(c) for c in sorted(stray)[:5]]} outside the run {num_to_col(first_col)}.."
            f"{num_to_col(first_col + len(run) - 1)}"
        )


def _find_weekday_row(
    sheet: LoadedSheet, rows: dict[int, dict[int, SheetCell]], date_row: int, first_col: int, dates: tuple[date, ...]
) -> Optional[int]:
    need = min(MIN_DATES, len(dates))
    best_row, best_hits = None, 0
    for r in range(max(1, date_row - 2), date_row + 3):
        if r == date_row or r not in rows:
            continue
        hits = 0
        for i, d in enumerate(dates):
            text = sheet.text(r, first_col + i).strip().lower()
            if text[:3] == _WEEKDAYS[d.weekday()] and text in (_WEEKDAYS[d.weekday()], _full(d)):
                hits += 1
        if hits > best_hits:
            best_row, best_hits = r, hits
    return best_row if best_hits >= need else None


def _full(d: date) -> str:
    return d.strftime("%A").lower()


def _find_header_row(
    sheet: LoadedSheet, rows: dict[int, dict[int, SheetCell]], after_row: int, first_date_col: int
) -> tuple[int, int, int]:
    """-> (header_row, location_col, team_col)."""
    for r in sorted(rows):
        if r <= after_row:
            continue
        loc = team = None
        for c, cell in rows[r].items():
            if c >= first_date_col:
                continue
            t = cell.text.strip()
            if _LOC_LABEL.match(t):
                loc = c
            elif _TEAM_LABEL.match(t):
                team = c
        if loc is not None and team is not None:
            return r, loc, team
    raise RosterFormatError(
        "column header row not found: expected a row below the dates with 'Loc' and 'Team' labels left of the date columns"
    )


def load_roster(
    path: Union[str, os.PathLike],
    sheet_name: str = DEFAULT_SHEET,
    *,
    section_aliases: Optional[Mapping[str, str]] = None,
    location_aliases: Optional[Mapping[str, str]] = None,
) -> Roster:
    """Read the roster sheet of `path` (see module docstring for the detection rules).

    section_aliases is merged over DEFAULT_SECTION_ALIASES; keys match
    case-insensitively with whitespace collapsed. location_aliases maps the raw
    Loc text (same matching) to the value stored in Person.location_code.
    """
    sec_alias = {_norm_key(k): v for k, v in {**DEFAULT_SECTION_ALIASES, **(section_aliases or {})}.items()}
    loc_alias = {_norm_key(k): v for k, v in (location_aliases or {}).items()}

    try:
        sheet = load_sheet(path, sheet_name)
    except SheetNotFoundError as e:
        raise RosterFormatError(str(e)) from e
    rows = _group_by_row(sheet)

    date_row, first_col, run = _find_date_row(sheet, rows)
    _check_date_row_clean(date_row, first_col, run, rows)
    dates = tuple(EXCEL_EPOCH + timedelta(days=n) for n in run)

    weekday_row = _find_weekday_row(sheet, rows, date_row, first_col, dates)
    top = min(date_row, weekday_row or date_row)
    holiday_row = top - 1
    block_bottom = max(date_row, weekday_row or date_row)
    header_row, loc_col, team_col = _find_header_row(sheet, rows, block_bottom, first_col)
    name_col = loc_col - 1
    if name_col < 1:
        raise RosterFormatError("no column to the left of the Loc column for names")
    serial_col = name_col - 1 if name_col > 1 else None
    last_label_col = first_col - 1  # every column left of the dates carries labels

    def text(r: int, c: Optional[int]) -> str:
        return _clean(sheet.text(r, c)) if c else ""

    def normalise_section(raw: str) -> str:
        collapsed = " ".join(raw.split())
        return sec_alias.get(_norm_key(raw), collapsed)

    merged_title_rows = {
        r1
        for r1, c1, r2, c2 in sheet.merges
        if r1 == r2 and serial_col is not None and c1 <= serial_col and c2 >= name_col and c2 < first_col
    }

    warnings: list[str] = []
    people: list[Person] = []
    sections: list[Section] = []
    legends: list[Legend] = []
    cur_name = cur_raw = ""
    cur_header = header_row
    cur_rows: list[int] = []
    pending_legend: list[LegendLine] = []

    first_raw = text(header_row, name_col)
    cur_raw = first_raw
    cur_name = normalise_section(first_raw)

    def close_section() -> None:
        sections.append(Section(cur_name, cur_raw, cur_header, tuple(cur_rows)))

    def flush_legend() -> None:
        nonlocal pending_legend
        if pending_legend:
            legends.append(
                Legend(
                    first_row=pending_legend[0].row,
                    last_row=pending_legend[-1].row,
                    lines=tuple(pending_legend),
                    after_section=cur_name,
                    before_section=None,  # filled in once every header is known
                )
            )
            pending_legend = []

    # rows with no text at all (spacers) never appear in `rows`; they only matter
    # as gaps, which end a legend block (see the legend branch below)
    for r in sorted(x for x in rows if x > header_row):
        serial_cell = sheet.cells.get((r, serial_col)) if serial_col else None
        serial_text = text(r, serial_col)
        name = text(r, name_col)
        loc = text(r, loc_col)
        team = text(r, team_col)
        serial_numeric = bool(serial_cell and (serial_cell.is_formula or serial_text.replace(".", "", 1).isdigit()))
        has_data = any(
            sheet.text(r, c).strip() for c in range(first_col, first_col + len(dates))
        )
        label_cells = tuple(
            (c, sheet.text(r, c).strip()) for c in range(1, last_label_col + 1) if sheet.text(r, c).strip()
        )

        is_person = bool(name) and (bool(loc) or serial_numeric or has_data)
        is_header = (
            not is_person
            and not name
            and not loc
            and bool(serial_text)
            and (not serial_numeric or r in merged_title_rows)
        )
        if is_person:
            flush_legend()
            if not loc:
                warnings.append(f"row {r}: person without a location")
            cur_rows.append(r)
            people.append(
                Person(
                    name=name,
                    location_code=loc_alias.get(_norm_key(loc), loc),
                    team_label=team,
                    section=cur_name,
                    row=r,
                )
            )
        elif is_header:
            raw = serial_text
            flush_legend()
            close_section()
            cur_name, cur_raw, cur_header, cur_rows = normalise_section(raw), raw, r, []
        elif loc and not name:
            warnings.append(f"row {r}: location without a name (skipped)")
        elif label_cells:
            if pending_legend and r != pending_legend[-1].row + 1:
                flush_legend()  # a blank row between two key blocks
            pending_legend.append(LegendLine(row=r, cells=label_cells))
    flush_legend()
    close_section()

    if not people:
        raise RosterFormatError(f"no people rows found below the column header on row {header_row}")

    legends = _fill_before_sections(legends, sections)

    preamble = _preamble(sheet, rows, holiday_row, last_label_col)

    return Roster(
        path=os.fspath(path),
        sheet_name=sheet_name,
        sheet=sheet,
        date_row=date_row,
        weekday_row=weekday_row,
        holiday_row=holiday_row,
        header_row=header_row,
        first_date_col=first_col,
        dates=dates,
        serial_col=serial_col,
        name_col=name_col,
        location_col=loc_col,
        team_col=team_col,
        people=tuple(people),
        sections=tuple(sections),
        legends=tuple(legends),
        preamble=preamble,
        warnings=warnings,
    )


def _fill_before_sections(legends: list[Legend], sections: list[Section]) -> list[Legend]:
    """Set each legend's before_section to the next section header below it."""
    out = []
    for lg in legends:
        nxt = next((s.name for s in sections if s.header_row > lg.last_row), None)
        out.append(Legend(lg.first_row, lg.last_row, lg.lines, lg.after_section, nxt))
    return out


def _preamble(sheet: LoadedSheet, rows: dict[int, dict[int, SheetCell]], holiday_row: int, last_label_col: int) -> Optional[Legend]:
    lines = []
    for r in sorted(x for x in rows if x < holiday_row):
        cells = tuple(
            (c, sheet.text(r, c).strip()) for c in range(1, last_label_col + 1) if sheet.text(r, c).strip()
        )
        if cells:
            lines.append(LegendLine(r, cells))
    if not lines:
        return None
    return Legend(lines[0].row, lines[-1].row, tuple(lines), None, None)
