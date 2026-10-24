from datetime import date, datetime
from pathlib import Path

import openpyxl
import pytest

from roster_lib import holiday_matrix as hm
from roster_lib.holiday_matrix import (
    DEFAULT_LOCATION_CODES,
    HolidayMatrixError,
    HolidayType,
    holiday_on,
    holidays_in_range,
    holidays_on,
    is_off,
    label_mismatches,
    load_holiday_matrix,
    write_template,
)

HEADER = ["Holiday name", "Date", "Bengaluru", "Chennai", "Gurgaon", "Hyderabad",
          "Kolkata", "Pune", "Mexico"]
INDIA = HEADER[2:8]


def make_ws(rows, header=HEADER, banner_rows=0):
    wb = openpyxl.Workbook()
    ws = wb.active
    for i in range(banner_rows):
        ws.cell(i + 1, 1, "banner text")
    r = banner_rows + 1
    for j, h in enumerate(header, start=1):
        ws.cell(r, j, h)
    for row in rows:
        r += 1
        for j, v in enumerate(row, start=1):
            if v is not None:
                ws.cell(r, j, v)
    return ws


def row(name, d, offs, mark="X"):
    cells = [name, d] + [None] * 7
    for loc in offs:
        cells[HEADER.index(loc)] = mark
    return cells


def problems_of(ws, **kw):
    with pytest.raises(HolidayMatrixError) as err:
        load_holiday_matrix(ws, **kw)
    return err.value.problems


def test_classification_of_each_type():
    ws = make_ws([
        row("Common Day", date(2026, 8, 15), INDIA),
        row("Common Plus Mex", date(2027, 1, 1), INDIA + ["Mexico"]),
        row("Some Day", date(2026, 10, 20), ["Chennai", "Pune"]),
        row("Not Bengaluru", date(2026, 11, 1), INDIA[1:]),
        row("Some Plus Mex", date(2026, 12, 12), ["Chennai", "Mexico"]),
        row("Mex Day", date(2026, 9, 16), ["Mexico"]),
        row("One Place", date(2026, 7, 7), ["Kolkata"]),
    ])
    m = load_holiday_matrix(ws)
    by = {h.name: h for h in m.holidays}
    assert by["Common Day"].type is HolidayType.COMMON and not by["Common Day"].common_india_mexico
    assert by["Common Plus Mex"].type is HolidayType.COMMON and by["Common Plus Mex"].common_india_mexico
    assert by["Some Day"].type is HolidayType.LOCATION_SPECIFIC
    assert by["Not Bengaluru"].type is HolidayType.LOCATION_SPECIFIC
    assert "Blr" not in by["Not Bengaluru"].off_locations
    assert by["Some Plus Mex"].type is HolidayType.LOCATION_SPECIFIC
    assert not by["Some Plus Mex"].common_india_mexico
    assert by["Some Plus Mex"].off_locations == frozenset({"Che", "Mex"})
    assert by["Mex Day"].type is HolidayType.MEXICO_ONLY
    assert by["Mex Day"].off_locations == frozenset({"Mex"})
    assert by["One Place"].off_locations == frozenset({"Kol"})
    assert by["Common Day"].off_locations == frozenset(
        {"Blr", "Che", "Gur", "Hyd", "Kol", "Pun"})


def test_holidays_sorted_chronologically():
    m = load_holiday_matrix(make_ws([
        row("B", date(2026, 3, 1), ["Pune"]),
        row("A", date(2026, 1, 1), ["Pune"]),
        row("C", date(2026, 1, 1), ["Chennai"]),
    ]))
    assert [(h.date, h.name) for h in m.holidays] == [
        (date(2026, 1, 1), "A"), (date(2026, 1, 1), "C"), (date(2026, 3, 1), "B")]


@pytest.mark.parametrize("mark", ["x", "X", " x ", "✓", "✔", "y", "Y", "yes", "1", 1, 1.0, True])
def test_off_mark_synonyms(mark):
    m = load_holiday_matrix(make_ws([row("H", date(2026, 1, 1), ["Pune"], mark=mark)]))
    assert m.holidays[0].off_locations == frozenset({"Pun"})


@pytest.mark.parametrize("mark", ["n", "no", "0", "-", False, " "])
def test_working_marks_mean_not_off(mark):
    cells = row("H", date(2026, 1, 1), ["Pune"])
    cells[HEADER.index("Chennai")] = mark
    m = load_holiday_matrix(make_ws([cells]))
    assert m.holidays[0].off_locations == frozenset({"Pun"})


def test_unreadable_marker_is_reported():
    cells = row("H", date(2026, 1, 1), ["Pune"])
    cells[HEADER.index("Chennai")] = "maybe"
    ps = problems_of(make_ws([cells]))
    assert any("Row 2" in p and "maybe" in p and "Chennai" in p for p in ps)


def test_date_formats():
    m = load_holiday_matrix(make_ws([
        row("A", datetime(2026, 1, 1, 0, 0), ["Pune"]),
        row("B", "15-Aug-2026", ["Pune"]),
        row("C", "2026-10-02", ["Pune"]),
        row("D", " 26-Jan-2027 ", ["Pune"]),
        row("E", "5 March 2027", ["Pune"]),
        row("F", date(2027, 5, 1), ["Pune"]),
    ]))
    assert [h.date for h in m.holidays] == [
        date(2026, 1, 1), date(2026, 8, 15), date(2026, 10, 2),
        date(2027, 1, 26), date(2027, 3, 5), date(2027, 5, 1)]


def test_headers_case_insensitive_and_reordered_and_banner():
    header = ["date", "HOLIDAY", "pune", "MEXICO", "Bengaluru", "chennai", "GURGAON",
              "hyderabad", "KOLKATA"]
    ws = make_ws([[date(2026, 1, 1), "X Day", "x", None, None, None, None, None, None]],
                 header=header, banner_rows=3)
    m = load_holiday_matrix(ws)
    assert m.holidays[0].name == "X Day"
    assert m.holidays[0].off_locations == frozenset({"Pun"})


def test_mexico_column_optional():
    header = HEADER[:-1]
    ws = make_ws([["H", date(2026, 1, 1)] + ["X"] * 6], header=header)
    h = load_holiday_matrix(ws).holidays[0]
    assert h.type is HolidayType.COMMON and not h.common_india_mexico


def test_blank_rows_skipped():
    ws = make_ws([row("A", date(2026, 1, 1), ["Pune"]), [None] * 9,
                  row("B", date(2026, 1, 2), ["Pune"])])
    assert len(load_holiday_matrix(ws).holidays) == 2


def test_error_missing_required_columns():
    ws = make_ws([["H", date(2026, 1, 1), "X"]], header=["Holiday name", "Date", "Pune"])
    ps = problems_of(ws)
    assert any("missing location columns" in p and "Bengaluru" in p for p in ps)


def test_error_no_header():
    ws = openpyxl.Workbook().active
    ws["A1"] = "nothing"
    ps = problems_of(ws)
    assert ps and "No header row" in ps[0]


def test_error_missing_date_column():
    ps = problems_of(make_ws([], header=["Holiday name", "When"] + HEADER[2:]))
    assert "No header row" in ps[0]


def test_error_unknown_location_header():
    ws = make_ws([row("H", date(2026, 1, 1), ["Pune"]) + ["X"]], header=HEADER + ["Atlantis"])
    ps = problems_of(ws)
    assert any("Atlantis" in p and "Row 1" in p for p in ps)


def test_error_duplicate_location_header():
    ws = make_ws([], header=HEADER + ["pune"])
    assert any("duplicate location column" in p for p in problems_of(ws))


def test_error_duplicate_date_and_name_with_row_numbers():
    ws = make_ws([row("Same", date(2026, 1, 1), ["Pune"]),
                  row("same", date(2026, 1, 1), ["Chennai"])])
    ps = problems_of(ws)
    assert any("Row 3" in p and "duplicate" in p and "row 2" in p for p in ps)


def test_same_date_different_names_allowed():
    ws = make_ws([row("One", date(2026, 1, 1), ["Pune"]),
                  row("Two", date(2026, 1, 1), ["Chennai"])])
    m = load_holiday_matrix(ws)
    assert [h.name for h in holidays_on(m, date(2026, 1, 1))] == ["One", "Two"]
    assert holiday_on(m, date(2026, 1, 1)).name == "One"
    assert is_off(m, "Pun", date(2026, 1, 1)) and is_off(m, "Che", date(2026, 1, 1))


def test_error_row_without_x():
    ws = make_ws([row("Nothing Off", date(2026, 1, 1), [])])
    ps = problems_of(ws)
    assert any("Row 2" in p and "no location is marked off" in p for p in ps)


def test_error_bad_date_and_missing_name_collected_together():
    ws = make_ws([row("Bad Date", "not a date", ["Pune"]),
                  row(None, date(2026, 1, 2), ["Pune"]),
                  row("No Date", None, ["Pune"]),
                  row("Fine", date(2026, 1, 3), ["Pune"])])
    ps = problems_of(ws)
    assert len(ps) == 3
    assert any("Row 2" in p and "unreadable date" in p for p in ps)
    assert any("Row 3" in p and "missing holiday name" in p for p in ps)
    assert any("Row 4" in p and "empty" in p for p in ps)


def test_error_empty_matrix():
    ps = problems_of(make_ws([]))
    assert any("no holiday rows" in p for p in ps)


def test_error_message_lists_problems():
    ws = make_ws([row("A", "garbage", ["Pune"])])
    with pytest.raises(HolidayMatrixError, match="Row 2"):
        load_holiday_matrix(ws)


def test_custom_location_codes():
    codes = {"North": "N", "South": "S", "Mexico": "Mex"}
    ws = make_ws([["H", date(2026, 1, 1), "X", None, None]],
                 header=["Holiday name", "Date", "North", "South", "Mexico"])
    h = load_holiday_matrix(ws, location_codes=codes).holidays[0]
    assert h.type is HolidayType.LOCATION_SPECIFIC and h.off_locations == frozenset({"N"})


def test_holidays_in_range_and_queries():
    m = load_holiday_matrix(make_ws([
        row("A", date(2026, 1, 1), INDIA),
        row("B", date(2026, 2, 1), ["Pune"]),
        row("C", date(2026, 3, 1), ["Mexico"]),
    ]))
    assert [h.name for h in holidays_in_range(m, date(2026, 1, 1), date(2026, 2, 1))] == ["A", "B"]
    assert holidays_in_range(m, date(2026, 1, 2), date(2026, 1, 31)) == []
    assert holiday_on(m, date(2026, 2, 1)).name == "B"
    assert holiday_on(m, date(2026, 2, 2)) is None
    assert is_off(m, "Pun", date(2026, 2, 1))
    assert is_off(m, " pun ", date(2026, 2, 1))
    assert not is_off(m, "Blr", date(2026, 2, 1))
    assert is_off(m, "Blr", date(2026, 1, 1))
    assert not is_off(m, "Mex", date(2026, 1, 1))
    assert is_off(m, "Mex", date(2026, 3, 1))
    assert not is_off(m, "Pun", date(2026, 3, 2))


def test_label_mismatches():
    m = load_holiday_matrix(make_ws([
        row("A", date(2026, 1, 1), ["Pune"]),
        row("B", date(2026, 2, 1), ["Pune"]),
        row("C", date(2026, 3, 1), ["Pune"]),
    ]))
    labels = {date(2026, 1, 1): "New Year", date(2026, 4, 1): "Stray", date(2026, 2, 1): "  ",
              date(2026, 3, 1): "C"}
    missing, stray = label_mismatches(m, labels)
    assert missing == [date(2026, 2, 1)]  # blank label counts as missing
    assert stray == [date(2026, 4, 1)]
    missing, stray = label_mismatches(m, labels, start=date(2026, 1, 1), end=date(2026, 2, 28))
    assert missing == [date(2026, 2, 1)] and stray == []
    assert label_mismatches(m, {d.date: d.name for d in m.holidays}) == ([], [])


def test_matrix_from_path_and_sheet_name(tmp_path):
    wb = openpyxl.Workbook()
    wb.active.title = "Other"
    ws = wb.create_sheet("Holiday Roster")
    for j, h in enumerate(HEADER, start=1):
        ws.cell(1, j, h)
    ws.append(row("H", date(2026, 1, 1), ["Pune"]))
    path = tmp_path / "h.xlsx"
    wb.save(path)
    assert len(load_holiday_matrix(path).holidays) == 1  # default sheet name found
    assert len(load_holiday_matrix(str(path), sheet_name="Holiday Roster").holidays) == 1
    with pytest.raises(HolidayMatrixError, match="not found"):
        load_holiday_matrix(path, sheet_name="Nope")
    with pytest.raises(HolidayMatrixError, match="Cannot open"):
        load_holiday_matrix(tmp_path / "missing.xlsx")


def test_template_round_trips_and_covers_all_types(tmp_path):
    path = write_template(tmp_path / "t.xlsx")
    m = load_holiday_matrix(path)
    types = {h.type for h in m.holidays}
    assert types == {HolidayType.COMMON, HolidayType.LOCATION_SPECIFIC, HolidayType.MEXICO_ONLY}
    assert any(h.common_india_mexico for h in m.holidays)
    assert "EXAMPLE" in openpyxl.load_workbook(path)["Holiday Roster"]["A1"].value


def test_committed_example_template_is_loadable():
    path = Path(hm.__file__).parent / "examples" / "holiday_roster_template.xlsx"
    m = load_holiday_matrix(path)
    assert len(m.holidays) >= 5
    assert set(DEFAULT_LOCATION_CODES.values()) >= set().union(*(h.off_locations for h in m.holidays))
