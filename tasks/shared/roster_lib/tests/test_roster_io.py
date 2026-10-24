import re
import zipfile
from datetime import date, timedelta
from pathlib import Path

import pytest

from roster_lib import roster_io
from roster_lib.pkgdiff import assert_only_changed, assert_sheet_only_changed
from roster_lib.roster_io import RosterFormatError, load_roster
from roster_lib.xlsx_patch import num_to_col, patch_workbook
from xlsx_fixtures import FIRST_DATE_COL, SHEET, build_roster_workbook, serial

SHEET_PART = "xl/worksheets/sheet1.xml"


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    info = build_roster_workbook(tmp_path_factory.mktemp("rio") / "roster.xlsx")
    return info, load_roster(info.path)


def edit_sheet_xml(src: Path, dst: Path, fn) -> Path:
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
        for zi in zin.infolist():
            data = zin.read(zi)
            if zi.filename == SHEET_PART:
                data = fn(data.decode("utf-8")).encode("utf-8")
            zout.writestr(zi.filename, data)
    return dst


def set_cached_serial(xml: str, row: int, col: int, value: int) -> str:
    ref = f"{num_to_col(col)}{row}"
    pat = re.compile(r'(<c r="%s"[^>]*>(?:<f[^>]*?(?:/>|>.*?</f>))?<v>)(\d+)(</v>)' % ref, re.S)
    assert pat.search(xml), ref
    return pat.sub(lambda m: f"{m.group(1)}{value}{m.group(3)}", xml, count=1)


# --- layout detection ---------------------------------------------------------


def test_detects_layout_from_content(built):
    info, r = built
    assert (r.holiday_row, r.date_row, r.weekday_row, r.header_row) == (
        info.holiday_row, info.date_row, info.weekday_row, info.header_row
    )
    assert (r.serial_col, r.name_col, r.location_col, r.team_col) == (1, 2, 3, 4)
    assert r.first_date_col == FIRST_DATE_COL and r.last_date_col == info.last_col
    assert r.first_date == info.start and r.last_date == info.start + timedelta(days=info.days - 1)
    assert list(r.dates) == info.dates()


def test_date_column_maps(built):
    info, r = built
    for d in info.dates():
        assert r.date_to_col[d] == info.date_col(d)
        assert r.col_to_date[info.date_col(d)] == d
    assert len(r.date_to_col) == info.days == len(r.col_to_date)


def test_people_match_ground_truth_exactly(built):
    info, r = built
    expected = [
        (p.name, p.location, p.team, "LNS 2.0" if p.section == "L N S 2.0" else p.section, p.row) for p in info.people
    ]
    got = [(p.name, p.location_code, p.team_label, p.section, p.row) for p in r.people]
    assert got == expected
    assert r.warnings == []


def test_team_labels_are_read_raw(built):
    _, r = built
    assert {p.team_label for p in r.people} >= {"L2 DIS USI", "L2 DIS US", "DIS USI", "L2 Infra USI", "Complaints"}


def test_sections_detected_generally_and_in_order(built):
    info, r = built
    assert [s.name for s in r.sections] == ["L2", "DEP", "L3", "Device Support", "Lab", "LNS 2.0", "Governance"]
    assert [s.raw_name for s in r.sections][5] == "L N S 2.0"
    assert [s.header_row for s in r.sections] == [row for _, row in info.section_headers]
    for s in r.sections:
        assert [r.person_at(x).section for x in s.person_rows] == [s.name] * len(s.person_rows)
    assert sum(len(s.person_rows) for s in r.sections) == len(info.people)


def test_section_aliases_are_configurable(built):
    info, _ = built
    r = load_roster(info.path, section_aliases={"device  support": "DS", "lab": "Lab Team"})
    names = [s.name for s in r.sections]
    assert "DS" in names and "Lab Team" in names and "LNS 2.0" in names  # default alias still applies
    assert [p.section for p in r.people_in("DS")] and r.people_in("Device Support") == []


def test_location_aliases(built):
    info, _ = built
    r = load_roster(info.path, location_aliases={"bengaluru": "BLR", " Mexico ": "MEX"})
    codes = {p.location_code for p in r.people}
    assert {"BLR", "MEX", "Hyderabad"} <= codes and "Bengaluru" not in codes


def test_legends_detected_raw_with_rows_and_neighbours(built):
    info, r = built
    assert [(lg.first_row, lg.last_row) for lg in r.legends] == info.legend_ranges
    first, second = r.legends
    assert (first.after_section, first.before_section) == ("L3", "Device Support")
    assert (second.after_section, second.before_section) == ("Device Support", "Lab")
    assert first.lines_text() == [
        "Shift-1 | 4:30 PM - 1:30 AM (M-F)",
        "Shift-3 | 9:00 PM - 6:00 AM",
        "Deployment (D) | 9:00 AM -6:00 PM (Monday)",
        "7:30 PM - 4:30 AM (M-F)",  # continuation row: no key in column A
    ]
    assert first.lines[3].cells == ((2, "7:30 PM - 4:30 AM (M-F)"),)
    assert second.lines_text() == ["Shift-1 | 2:00 PM -11:00 PM (M-F)", "Weekend(W) | 6:30 PM-3:30 AM"]


def test_legend_rows_are_not_people_or_sections(built):
    info, r = built
    legend_rows = {x for a, b in info.legend_ranges for x in range(a, b + 1)}
    assert legend_rows.isdisjoint({p.row for p in r.people})
    assert legend_rows.isdisjoint({s.header_row for s in r.sections})


def test_preamble_block_is_exposed_raw(built):
    _, r = built
    assert r.preamble is not None and r.preamble.first_row == 1
    lines = r.preamble.lines_text()
    assert lines[0] == "PDT Operate\nRESOURCE SCHEDULE"
    assert "Shift-1 | 8:00 AM - 5:00 PM (Mon-Fri) | COMP | Comp off" in lines


# --- cell access ----------------------------------------------------------------


def test_every_person_date_cell_reads_as_written(built):
    info, r = built
    for p in r.people:
        for d in info.dates():
            assert r.cell(p, d) == info.expected(p.name, d), (p.name, d)


def test_row_texts_inclusive_range_blank_as_empty_and_multiline(built):
    info, r = built
    p = r.find("Person 01")[0]
    d0, d1 = info.start, info.start + timedelta(days=4)
    texts = r.row_texts(p, d0, d1)
    assert len(texts) == 5 and texts == [info.expected(p.name, info.start + timedelta(days=i)) for i in range(5)]
    assert texts[2] == "Shift Swap\nNS"
    assert "" in r.row_texts(p)  # blank cells are "" never None
    assert len(r.row_texts(p)) == info.days
    assert r.row_texts(p.row) == r.row_texts(p)  # a bare row number is accepted too


def test_date_outside_roster_and_non_person_row_raise(built):
    info, r = built
    p = r.people[0]
    with pytest.raises(ValueError, match="outside"):
        r.cell(p, info.start - timedelta(days=1))
    with pytest.raises(ValueError, match="before"):
        r.row_texts(p, info.start + timedelta(days=3), info.start)
    with pytest.raises(ValueError, match="not a person row"):
        r.cell(info.header_row, info.start)


def test_address_map_gives_row_col_for_every_date(built):
    info, r = built
    p = r.people[3]
    amap = r.address_map(p)
    assert set(amap) == set(info.dates())
    assert all(row == p.row and col == info.date_col(d) for d, (row, col) in amap.items())
    assert r.address(p, info.start) == (p.row, FIRST_DATE_COL)
    part = r.address_map(p, info.start + timedelta(days=2), info.start + timedelta(days=3))
    assert list(part.values()) == [(p.row, FIRST_DATE_COL + 2), (p.row, FIRST_DATE_COL + 3)]


def test_holiday_labels_raw_and_merge_expansion(built):
    info, r = built
    assert r.holiday_labels() == info.holiday_labels
    anchor, width = info.merged_holiday
    expanded = r.holiday_labels(expand_merges=True)
    for i in range(width):
        assert expanded[anchor + timedelta(days=i)] == "Winter Disconnect"
    assert len(expanded) == len(info.holiday_labels) + width - 1


def test_weekday_row_and_formula_flags(built):
    info, r = built
    assert r.weekday_label(info.start) == info.start.strftime("%a")
    assert not r.is_formula(r.people[0], info.start)
    assert r.find("  person 03 ")[0].row == info.person("Person 03").row
    assert r.find("nobody") == []


# --- robustness ----------------------------------------------------------------


def test_inserting_a_person_row_mid_sheet_still_reads_correctly(tmp_path):
    info = build_roster_workbook(tmp_path / "ins.xlsx", insert_person_after="Person 02")
    r = load_roster(info.path)
    base = build_roster_workbook(tmp_path / "base.xlsx")
    assert len(r.people) == len(base.people) + 1
    new = r.find("Person Inserted")[0]
    assert new.section == "L2" and new.row == info.person("Person 02").row + 1
    assert [p.name for p in r.people][:4] == ["Person 01", "Person 02", "Person Inserted", "Person 03"]
    # everything below shifted by exactly one row and still reads the same
    assert r.find("Person 03")[0].row == base.person("Person 03").row + 1
    assert r.find("Person 16")[0].row == base.person("Person 16").row + 1
    assert [lg.first_row for lg in r.legends] == [a for a, _ in info.legend_ranges]
    for p in r.people:
        for d in info.dates():
            assert r.cell(p, d) == info.expected(p.name, d)


def test_nothing_is_hard_coded_to_row_13(tmp_path):
    info = build_roster_workbook(tmp_path / "short.xlsx", preamble_rows=5)
    r = load_roster(info.path)
    assert (r.holiday_row, r.date_row, r.weekday_row, r.header_row) == (6, 7, 8, 9)
    assert [p.row for p in r.people] == [p.row for p in info.people]
    for p in r.people:
        assert r.row_texts(p) == [info.expected(p.name, d) for d in info.dates()]


@pytest.mark.parametrize("kw", [{"cache_values": False}, {"date_formulas": False}, {"extras": False}, {"shared_strings": False}])
def test_reads_workbooks_written_other_ways(tmp_path, kw):
    """No cached formula values (openpyxl style), plain literal dates, inline strings, no extra parts."""
    info = build_roster_workbook(tmp_path / "v.xlsx", **kw)
    r = load_roster(info.path)
    assert list(r.dates) == info.dates()
    assert [p.name for p in r.people] == [p.name for p in info.people]
    assert r.row_texts(r.people[0]) == [info.expected(r.people[0].name, d) for d in info.dates()]
    if kw.get("date_formulas") is False:
        assert r.weekday_label(info.start) == info.start.strftime("%a")


def test_roster_without_weekday_row(tmp_path):
    info = build_roster_workbook(tmp_path / "nw.xlsx", date_formulas=False)

    def drop_weekdays(xml: str) -> str:
        return re.sub(r'<c r="[A-Z]+%d"[^>]*?(?:/>|>.*?</c>)' % info.weekday_row, "", xml, flags=re.S)

    out = edit_sheet_xml(info.path, tmp_path / "nw2.xlsx", drop_weekdays)
    r = load_roster(out)
    assert r.weekday_row is None and r.weekday_label(info.start) is None
    assert r.holiday_row == info.holiday_row  # still the row above the date row, not above a missing weekday row
    assert r.date_row == info.date_row


# --- errors ----------------------------------------------------------------------


def test_missing_sheet_is_a_roster_format_error(built):
    info, _ = built
    with pytest.raises(RosterFormatError, match="Nope"):
        load_roster(info.path, sheet_name="Nope")
    assert load_roster(info.path, sheet_name=SHEET).sheet_name == SHEET


def test_hidden_other_sheet_is_not_mistaken_for_the_roster(built):
    info, _ = built
    with pytest.raises(RosterFormatError, match="date row not found"):
        load_roster(info.path, sheet_name="Notes")


def test_duplicate_dates_error(tmp_path, built):
    info, _ = built
    day = 10  # cell for day 10 repeats day 11's serial
    c = FIRST_DATE_COL + day
    src = edit_sheet_xml(
        info.path,
        tmp_path / "dup.xlsx",
        lambda x: set_cached_serial(x, info.date_row, c, serial(info.start) + day + 1),
    )
    with pytest.raises(RosterFormatError, match="duplicate dates"):
        load_roster(src)


def test_non_contiguous_dates_error(tmp_path, built):
    info, _ = built

    def gap(xml: str) -> str:
        for i in range(10, info.days):
            xml = set_cached_serial(xml, info.date_row, FIRST_DATE_COL + i, serial(info.start) + i + 1)
        return xml

    src = edit_sheet_xml(info.path, tmp_path / "gap.xlsx", gap)
    with pytest.raises(RosterFormatError, match="not contiguous"):
        load_roster(src)


def test_no_date_row_error(tmp_path):
    from openpyxl import Workbook

    wb = Workbook()
    wb.active.title = SHEET
    wb.active["A1"] = "hello"
    wb.save(tmp_path / "empty.xlsx")
    with pytest.raises(RosterFormatError, match="date row not found"):
        load_roster(tmp_path / "empty.xlsx")


def test_missing_column_header_error(tmp_path, built):
    info, _ = built
    # remove the Loc label cell
    src = edit_sheet_xml(
        info.path,
        tmp_path / "noloc.xlsx",
        lambda x: re.sub(r'<c r="C%d"[^>]*?(?:/>|>.*?</c>)' % info.header_row, "", x, count=1, flags=re.S),
    )
    with pytest.raises(RosterFormatError, match="column header row not found"):
        load_roster(src)


def test_person_without_location_is_kept_with_a_warning(tmp_path):
    info = build_roster_workbook(tmp_path / "noloc.xlsx")
    p = info.people[2]
    out = tmp_path / "noloc2.xlsx"
    patch_workbook(info.path, out, SHEET, {(p.row, 3): None})
    r = load_roster(out)
    assert r.person_at(p.row).location_code == "" and len(r.people) == len(info.people)
    assert any(f"row {p.row}" in w for w in r.warnings)


# --- integration with the patcher ---------------------------------------------------


def test_reader_addresses_drive_the_patcher_and_read_back(tmp_path):
    info = build_roster_workbook(tmp_path / "w.xlsx")
    r = load_roster(info.path)
    p = r.find("Person 05")[0]
    amap = r.address_map(p, info.start, info.start + timedelta(days=6))
    edits = {rc: "Shift-3" for rc in amap.values()}
    out = tmp_path / "w_out.xlsx"
    patch_workbook(info.path, out, SHEET, edits)
    assert_only_changed(info.path, out, {SHEET_PART})
    assert_sheet_only_changed(info.path, out, SHEET_PART, set(edits))
    r2 = load_roster(out)
    assert r2.row_texts(p, info.start, info.start + timedelta(days=6)) == ["Shift-3"] * 7
    # structure and every other person unchanged
    assert [(q.name, q.row) for q in r2.people] == [(q.name, q.row) for q in r.people]
    for q in r.people:
        if q.row != p.row:
            assert r.row_texts(q) == r2.row_texts(q)


# --- real-file smoke tests -------------------------------------------------------------

REAL = Path(__file__).resolve().parents[2] / "roster-reference" / "Shiftroster_Takeda_Redesigned_v2.xlsx"
needs_real = pytest.mark.skipif(not REAL.exists(), reason="real roster reference file not present")


@needs_real
def test_real_roster_structure_only():
    import time

    t0 = time.perf_counter()
    r = load_roster(REAL)
    elapsed = time.perf_counter() - t0
    assert elapsed < 10
    assert len(r.dates) >= 360 and (r.last_date - r.first_date).days == len(r.dates) - 1
    assert r.first_date_col == 5 and r.date_row > r.holiday_row and r.weekday_row == r.date_row + 1
    assert len(r.people) > 40 and len({s.name for s in r.sections}) >= 6
    assert all(p.name and p.location_code for p in r.people)
    assert len(r.legends) >= 2 and r.preamble is not None
    assert len(r.holiday_labels()) > 10
    # every person row's date cells are addressable and read as text
    for p in r.people:
        assert len(r.row_texts(p)) == len(r.dates)
    assert r.warnings == []


@needs_real
def test_real_roster_patch_touches_only_the_roster_sheet(tmp_path):
    r = load_roster(REAL)
    # first blank cell in the first person's row; written then removed again (structure only)
    p = r.people[0]
    d = next(d for d in r.dates if r.cell(p, d) == "")
    out = tmp_path / "real_patched.xlsx"
    res = patch_workbook(REAL, out, SHEET, {r.address(p, d): "Shift-3"})
    assert res.changed_parts == (SHEET_PART,)
    diff = assert_only_changed(REAL, out, {SHEET_PART})
    assert diff.byte_changed == [SHEET_PART]
    assert_sheet_only_changed(REAL, out, SHEET_PART, {r.address(p, d)})
    r2 = load_roster(out)
    assert r2.cell(p, d) == "Shift-3"
    assert [(q.row, q.section) for q in r2.people] == [(q.row, q.section) for q in r.people]
