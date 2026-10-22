"""
Holiday Roster parser and classifier.

Input is a worksheet (or workbook path + sheet name) laid out as:
    Holiday name | Date | Bengaluru | Chennai | Gurgaon | Hyderabad | Kolkata | Pune | Mexico
An `X` (case-insensitive; also a tick mark, Y/Yes/1/True) in a location column
means that location is OFF that day. Headers are matched case-insensitively and
the header row may sit below a few banner/note rows. Bengaluru..Pune are
required columns; Mexico is optional (an absent column means never off).

Location names map to roster location codes via `DEFAULT_LOCATION_CODES`
(overridable). Every `Holiday.off_locations` holds those codes.

Classification from the X pattern (`HolidayType`):
- COMMON            all six India locations are off (`common_india_mexico` is
                    True when Mexico is also off);
- LOCATION_SPECIFIC only some India locations are off (including "all except
                    Bengaluru"), with or without Mexico (`mexico` is then
                    visible through off_locations);
- MEXICO_ONLY       only Mexico is off.
A row with no X at all is an error; so is anything unreadable. All problems are
collected in one `HolidayMatrixError` with row numbers.
"""

from __future__ import annotations

import datetime as _dt
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Iterable, Mapping

import openpyxl
from openpyxl.worksheet.worksheet import Worksheet

DEFAULT_SHEET_NAME = "Holiday Roster"
MEXICO_LOCATION = "Mexico"
DEFAULT_LOCATION_CODES: dict[str, str] = {
    "Bengaluru": "Blr",
    "Chennai": "Che",
    "Gurgaon": "Gur",
    "Hyderabad": "Hyd",
    "Kolkata": "Kol",
    "Pune": "Pun",
    "Mexico": "Mex",
}
_MAX_HEADER_SCAN_ROWS = 15

_OFF_MARKS = {"x", "✓", "✔", "✔️", "☑", "√", "y", "yes", "1", "true"}
_ON_MARKS = {"", "n", "no", "0", "false", "-"}
_NAME_HEADERS = {"holiday name", "holiday", "name"}
_DATE_FORMATS = ("%d-%b-%Y", "%d-%B-%Y", "%Y-%m-%d", "%d %b %Y", "%d %B %Y", "%Y/%m/%d")


class HolidayMatrixError(ValueError):
    """The Holiday Roster could not be read; `problems` lists every issue found."""

    def __init__(self, problems: list[str]):
        super().__init__("Holiday Roster problems:\n- " + "\n- ".join(problems))
        self.problems = list(problems)


class HolidayType(Enum):
    COMMON = "common"
    LOCATION_SPECIFIC = "location_specific"
    MEXICO_ONLY = "mexico_only"


@dataclass(frozen=True)
class Holiday:
    name: str
    date: _dt.date
    off_locations: frozenset[str]  # roster location codes
    type: HolidayType
    common_india_mexico: bool = False


@dataclass(frozen=True)
class HolidayMatrix:
    holidays: tuple[Holiday, ...]  # sorted by (date, name)
    location_codes: Mapping[str, str]  # location name -> roster code


def classify(off_codes: Iterable[str], location_codes: Mapping[str, str] | None = None,
             mexico_location: str = MEXICO_LOCATION) -> tuple[HolidayType, bool]:
    """(type, common_india_mexico) for a set of off location codes."""
    codes = location_codes or DEFAULT_LOCATION_CODES
    mex = codes.get(mexico_location)
    india = {c for n, c in codes.items() if n != mexico_location}
    off = set(off_codes)
    if not off:
        raise ValueError("a holiday needs at least one location off")
    off_india = off & india
    if not off_india:
        return HolidayType.MEXICO_ONLY, False
    if off_india == india:
        return HolidayType.COMMON, mex in off
    return HolidayType.LOCATION_SPECIFIC, False


def _to_date(value) -> _dt.date | None:
    if isinstance(value, _dt.datetime):
        return value.date()
    if isinstance(value, _dt.date):
        return value
    if isinstance(value, str):
        text = " ".join(value.split())
        for fmt in _DATE_FORMATS:
            try:
                return _dt.datetime.strptime(text, fmt).date()
            except ValueError:
                continue
    return None


def _norm(value) -> str:
    return " ".join(str(value).split()).casefold() if value is not None else ""


def _open_sheet(source, sheet_name: str | None) -> Worksheet:
    if isinstance(source, Worksheet):
        return source
    try:
        wb = openpyxl.load_workbook(Path(source), data_only=True)
    except Exception as exc:  # noqa: BLE001 - surfaced as a clear matrix error
        raise HolidayMatrixError([f"Cannot open workbook {source}: {exc}"]) from exc
    name = sheet_name or (DEFAULT_SHEET_NAME if DEFAULT_SHEET_NAME in wb.sheetnames else None)
    if name is None:
        return wb.worksheets[0]
    if name not in wb.sheetnames:
        raise HolidayMatrixError([f"Sheet {name!r} not found (sheets: {', '.join(wb.sheetnames)})"])
    return wb[name]


def load_holiday_matrix(
    source: Worksheet | str | Path,
    sheet_name: str | None = None,
    location_codes: Mapping[str, str] | None = None,
    mexico_location: str = MEXICO_LOCATION,
) -> HolidayMatrix:
    """Parse the Holiday Roster; raises `HolidayMatrixError` listing all problems."""
    codes = dict(location_codes or DEFAULT_LOCATION_CODES)
    by_header = {k.casefold(): k for k in codes}
    ws = _open_sheet(source, sheet_name)
    rows = list(ws.iter_rows(values_only=True))

    header_idx = None
    for i, row in enumerate(rows[:_MAX_HEADER_SCAN_ROWS]):
        cells = [_norm(c) for c in row]
        if "date" in cells and any(c in _NAME_HEADERS for c in cells):
            header_idx = i
            break
    if header_idx is None:
        raise HolidayMatrixError(
            ["No header row found: expected 'Holiday name' and 'Date' columns "
             f"within the first {_MAX_HEADER_SCAN_ROWS} rows"])

    header_row = header_idx + 1  # 1-based sheet row number
    problems: list[str] = []
    name_col = date_col = None
    loc_cols: dict[int, str] = {}  # column index -> location name
    for j, cell in enumerate(rows[header_idx]):
        h = _norm(cell)
        if not h:
            continue
        if h in _NAME_HEADERS and name_col is None:
            name_col = j
        elif h == "date" and date_col is None:
            date_col = j
        elif h in by_header:
            loc = by_header[h]
            if loc in loc_cols.values():
                problems.append(f"Row {header_row}: duplicate location column {cell!r}")
            else:
                loc_cols[j] = loc
        else:
            problems.append(f"Row {header_row}: unknown column header {str(cell).strip()!r} "
                            f"(known locations: {', '.join(codes)})")
    required = [n for n in codes if n != mexico_location]
    missing = [n for n in required if n not in loc_cols.values()]
    if missing:
        problems.append(f"Row {header_row}: missing location columns: {', '.join(missing)}")
    if problems:
        raise HolidayMatrixError(problems)

    holidays: list[Holiday] = []
    seen: dict[tuple[_dt.date, str], int] = {}
    for i in range(header_idx + 1, len(rows)):
        row, rownum = rows[i], i + 1
        if all(c is None or (isinstance(c, str) and not c.strip()) for c in row):
            continue
        name_raw = row[name_col] if name_col < len(row) else None
        date_raw = row[date_col] if date_col < len(row) else None
        name = " ".join(str(name_raw).split()) if name_raw is not None else ""
        if not name:
            problems.append(f"Row {rownum}: missing holiday name")
        d = _to_date(date_raw)
        if d is None:
            shown = "empty" if date_raw in (None, "") else repr(date_raw)
            problems.append(f"Row {rownum}: unreadable date ({shown})")
        off: set[str] = set()
        for j, loc in loc_cols.items():
            mark = row[j] if j < len(row) else None
            if isinstance(mark, float) and mark.is_integer():
                mark = int(mark)
            token = _norm(mark)
            if token in _OFF_MARKS:
                off.add(codes[loc])
            elif token not in _ON_MARKS:
                problems.append(f"Row {rownum}: unreadable marker {str(mark).strip()!r} "
                                f"in column {loc}")
        if not off:
            problems.append(f"Row {rownum}: no location is marked off"
                            + (f" for {name!r}" if name else ""))
        if not name or d is None or not off:
            continue
        key = (d, name.casefold())
        if key in seen:
            problems.append(f"Row {rownum}: duplicate holiday {name!r} on {d.isoformat()} "
                            f"(first seen in row {seen[key]})")
            continue
        seen[key] = rownum
        h_type, both = classify(off, codes, mexico_location)
        holidays.append(Holiday(name, d, frozenset(off), h_type, both))

    if not problems and not holidays:
        problems.append("The matrix has no holiday rows")
    if problems:
        raise HolidayMatrixError(problems)
    holidays.sort(key=lambda h: (h.date, h.name))
    return HolidayMatrix(tuple(holidays), codes)


# ---- queries ------------------------------------------------------------------

def holidays_in_range(matrix: HolidayMatrix, start: _dt.date, end: _dt.date) -> list[Holiday]:
    """Holidays with start <= date <= end, chronological."""
    return [h for h in matrix.holidays if start <= h.date <= end]


def holidays_on(matrix: HolidayMatrix, d: _dt.date) -> list[Holiday]:
    return [h for h in matrix.holidays if h.date == d]


def holiday_on(matrix: HolidayMatrix, d: _dt.date) -> Holiday | None:
    """The first holiday on `d` (by name) or None; see `holidays_on` for several."""
    found = holidays_on(matrix, d)
    return found[0] if found else None


def is_off(matrix: HolidayMatrix, location_code: str, d: _dt.date) -> bool:
    """Whether the location (roster code, case-insensitive) is off on `d`."""
    wanted = location_code.strip().casefold()
    return any(wanted == c.casefold() for h in holidays_on(matrix, d) for c in h.off_locations)


def label_mismatches(
    matrix: HolidayMatrix,
    row12_labels: Mapping[_dt.date, str],
    start: _dt.date | None = None,
    end: _dt.date | None = None,
) -> tuple[list[_dt.date], list[_dt.date]]:
    """Compare the matrix with the roster's row-12 holiday labels (supplied by caller).

    Returns (matrix dates with no roster label, labelled dates with no matrix entry),
    each sorted. Blank labels count as no label. `start`/`end` optionally restrict both
    sides to a date window (e.g. the cycle being built).
    """
    def in_window(d: _dt.date) -> bool:
        return (start is None or d >= start) and (end is None or d <= end)

    labelled = {d for d, text in row12_labels.items()
                if text is not None and str(text).strip() and in_window(d)}
    in_matrix = {h.date for h in matrix.holidays if in_window(h.date)}
    return sorted(in_matrix - labelled), sorted(labelled - in_matrix)


# ---- example template ------------------------------------------------------------

def write_template(path: str | Path) -> Path:
    """Write an EXAMPLE Holiday Roster workbook (synthetic rows, one per holiday type)."""
    from openpyxl.styles import Font, PatternFill

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = DEFAULT_SHEET_NAME
    locations = list(DEFAULT_LOCATION_CODES)
    ws.cell(1, 1, "EXAMPLE - illustrative rows only; replace with the real Holiday Roster. "
                  "Mark a location that is OFF with X.").font = Font(bold=True, color="C00000")
    for j, title in enumerate(["Holiday name", "Date", *locations], start=1):
        c = ws.cell(2, j, title)
        c.font = Font(bold=True)
        c.fill = PatternFill("solid", fgColor="D9D9D9")
    india = locations[:-1]
    examples = [
        ("New Year", _dt.date(2027, 1, 1), india + ["Mexico"]),  # common, India + Mexico
        ("Independence Day", _dt.date(2026, 8, 15), india),  # common India
        ("Regional Festival", _dt.date(2026, 10, 20), ["Chennai", "Hyderabad"]),  # some locations
        ("State Foundation Day", _dt.date(2026, 11, 1), [n for n in india if n != "Bengaluru"]),
        ("Mexico Independence Day", _dt.date(2026, 9, 16), ["Mexico"]),  # Mexico only
    ]
    for i, (name, d, off) in enumerate(examples, start=3):
        ws.cell(i, 1, name)
        ws.cell(i, 2, d).number_format = "dd-mmm-yyyy"
        for j, loc in enumerate(locations, start=3):
            if loc in off:
                ws.cell(i, j, "X")
    ws.column_dimensions["A"].width = 28
    ws.column_dimensions["B"].width = 14
    notes = wb.create_sheet("Notes")
    for i, line in enumerate([
        "EXAMPLE FILE - synthetic data, not a real holiday list.",
        "One row per holiday. Columns: Holiday name, Date, then one column per location.",
        "X (or a tick, Y, 1) = that location is OFF. Blank = working day.",
        "All six India locations marked = common holiday (Mexico may also be marked).",
        "Only some India locations marked = location-specific holiday.",
        "Only Mexico marked = Mexico-only holiday.",
        "Every row needs at least one X. Dates may be real dates, dd-mmm-yyyy or yyyy-mm-dd.",
    ], start=1):
        notes.cell(i, 1, line)
    notes.column_dimensions["A"].width = 90
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(path)
    return path


if __name__ == "__main__":
    print(write_template(Path(__file__).parent / "examples" / "holiday_roster_template.xlsx"))
