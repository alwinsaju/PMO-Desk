import hashlib
import re
import shutil
import zipfile
from datetime import date, timedelta
from pathlib import Path

import pytest
from openpyxl import load_workbook

from roster_lib import pkgdiff
from roster_lib.next_year_file import NextYearError, build_next_year_file
from roster_lib.roster_io import EXCEL_EPOCH, load_roster
from roster_lib.xlsx_patch import load_sheet, patch_workbook
from draft_testkit import REAL, SHEET_PART, needs_real
from xlsx_fixtures import SHEET, build_roster_workbook

WB = "xl/workbook.xml"


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def make_source(tmp_path, start=date(2026, 1, 2), days=365, name="source.xlsx", **kw):
    return build_roster_workbook(tmp_path / name, start=start, days=days, **kw)


def remainder_for(info, first, n_days=4, n_people=3):
    out = {}
    for p in info.people[:n_people]:
        for i in range(n_days):
            d = first + timedelta(days=i)
            out[(p.name, d)] = "" if d.weekday() >= 5 else f"Shift-{1 + i % 3}"
    return out


def rewrite_zip(src, dst, replace):
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
        for zi in zin.infolist():
            data = zin.read(zi)
            if zi.filename in replace:
                data = replace[zi.filename](data)
            zout.writestr(zi.filename, data)


def test_year_span_arithmetic_and_roster_reading(tmp_path):
    info = make_source(tmp_path)
    src_roster = load_roster(info.path)
    assert src_roster.last_date == date(2027, 1, 1) and len(src_roster.dates) == 365
    rem = remainder_for(info, date(2027, 1, 2))
    labels = {date(2027, 1, 18): "Test Holiday", date(2027, 1, 26): "Another"}
    res = build_next_year_file(info.path, tmp_path / "next.xlsx", rem, holiday_labels=labels)
    assert (res.start, res.end, res.date_count) == (date(2027, 1, 2), date(2028, 1, 1), 365)
    assert res.start == src_roster.last_date + timedelta(days=1)
    assert res.first_serial == (date(2027, 1, 2) - EXCEL_EPOCH).days
    assert (res.end - res.start).days + 1 == 365  # Jan 2 2027 .. Jan 1 2028: 2027 is not a leap year
    assert not any("short of" in w or "beyond" in w for w in res.warnings)

    nr = load_roster(res.dst_path)
    assert nr.first_date == src_roster.last_date + timedelta(days=1)
    assert nr.dates == tuple(date(2027, 1, 2) + timedelta(days=i) for i in range(365))  # contiguous
    assert [(p.name, p.row, p.section, p.location_code, p.team_label) for p in nr.people] == [
        (p.name, p.row, p.section, p.location_code, p.team_label) for p in src_roster.people]
    assert [(s.name, s.header_row) for s in nr.sections] == [(s.name, s.header_row) for s in src_roster.sections]
    non_blank = {(p.name, d): nr.cell(p, d) for p in nr.people for d in nr.dates if nr.cell(p, d)}
    assert non_blank == {k: v for k, v in rem.items() if v}
    assert nr.holiday_labels() == labels
    assert nr.weekday_row == src_roster.weekday_row
    for d in nr.dates:
        assert nr.weekday_label(d) == d.strftime("%a")
    assert nr.legends == src_roster.legends and nr.preamble == src_roster.preamble
    assert res.people == len(src_roster.people) and res.cells_written == sum(1 for v in rem.values() if v)
    assert res.labels_written == 2 and res.cleared_cells > 0


def test_cached_values_updated_and_calc_on_load(tmp_path):
    info = make_source(tmp_path)

    def strip_calc(data):
        return re.sub(rb"<calcPr[^>]*/>", b"", data)

    stripped = tmp_path / "nocalc.xlsx"
    rewrite_zip(info.path, stripped, {WB: strip_calc})
    assert b"calcPr" not in zipfile.ZipFile(stripped).read(WB)
    res = build_next_year_file(stripped, tmp_path / "next.xlsx", {})
    with zipfile.ZipFile(res.dst_path) as z:
        wb = z.read(WB).decode()
        sheet = z.read(SHEET_PART).decode()
    assert re.search(r'<calcPr fullCalcOnLoad="1"/>', wb) and wb.index("</definedNames>") < wb.index("<calcPr")
    first = (date(2027, 1, 2) - EXCEL_EPOCH).days
    assert f'<v>{first}</v>' in sheet and f"<v>{first + 364}</v>" in sheet
    # formulas stay formulas (shared chain), only the cached value moved; the old serial is gone
    assert '<f t="shared"' in sheet and f"<v>{(date(2026, 1, 2) - EXCEL_EPOCH).days}</v>" not in sheet
    assert res.calc_on_load and res.date_cells_updated == 365 and res.weekday_cells_updated == 365
    # a calcPr without the attribute gets it added, an existing value is forced to 1
    plain = tmp_path / "plain.xlsx"
    rewrite_zip(info.path, plain, {WB: lambda d: re.sub(rb' fullCalcOnLoad="1"', b"", d)})
    out = build_next_year_file(plain, tmp_path / "next2.xlsx", {})
    assert 'fullCalcOnLoad="1"' in zipfile.ZipFile(out.dst_path).read(WB).decode()
    zero = tmp_path / "zero.xlsx"
    rewrite_zip(info.path, zero, {WB: lambda d: d.replace(b'fullCalcOnLoad="1"', b'fullCalcOnLoad="0"')})
    out = build_next_year_file(zero, tmp_path / "next3.xlsx", {})
    assert 'fullCalcOnLoad="1"' in zipfile.ZipFile(out.dst_path).read(WB).decode()


def test_only_sheet_and_workbook_parts_change_and_features_survive(tmp_path):
    info = make_source(tmp_path)
    res = build_next_year_file(info.path, tmp_path / "next.xlsx", remainder_for(info, date(2027, 1, 2)),
                               holiday_labels={date(2027, 1, 18): "X"})
    d = pkgdiff.assert_only_changed(info.path, res.dst_path, {SHEET_PART, WB})
    assert set(d.byte_changed) <= {SHEET_PART, WB} and SHEET_PART in d.byte_changed
    with zipfile.ZipFile(info.path) as za, zipfile.ZipFile(res.dst_path) as zb:
        for part in ("xl/threadedComments/threadedComment1.xml", "xl/persons/person.xml", "docMetadata/LabelInfo.xml",
                     "docProps/custom.xml", "xl/worksheets/sheet2.xml", "xl/sharedStrings.xml", "xl/calcChain.xml",
                     "xl/styles.xml", "xl/drawings/drawing1.xml"):
            assert za.read(part) == zb.read(part), part
        sd = pkgdiff.diff_sheet_xml(za.read(SHEET_PART), zb.read(SHEET_PART))
    # CF, validation, extLst, hyperlinks, views, cols are canonically identical; only merges may differ
    assert set(sd.other_elements_changed) <= {"mergeCells", "dimension"}
    assert sd.row_attrs_changed == set() and sd.added_rows == set() and sd.removed_rows == set()
    assert SHEET_PART in res.changed_parts and set(res.changed_parts) <= {SHEET_PART, WB}
    wb = load_workbook(res.dst_path)
    assert wb.sheetnames == [SHEET, "Notes"] and wb["Notes"].sheet_state == "hidden"


def test_holiday_row_merges_dropped_title_merges_kept(tmp_path):
    info = make_source(tmp_path)
    before = load_sheet(info.path, SHEET).merges
    res = build_next_year_file(info.path, tmp_path / "next.xlsx", {})
    after = load_sheet(res.dst_path, SHEET).merges
    hol = [m for m in before if m[0] == m[2] == info.holiday_row and m[1] >= 5]
    assert len(hol) == 1 and res.merges_removed == 1
    assert sorted(after) == sorted(m for m in before if m not in hol)


def test_grid_and_labels_cleared_but_styles_kept(tmp_path):
    info = make_source(tmp_path)
    res = build_next_year_file(info.path, tmp_path / "next.xlsx", {})
    old, new = load_sheet(info.path, SHEET), load_sheet(res.dst_path, SHEET)
    nr = load_roster(res.dst_path)
    for p in nr.people:
        for c in range(5, 5 + 365):
            assert new.text(p.row, c) == ""
    assert nr.holiday_labels() == {}
    with zipfile.ZipFile(info.path) as za, zipfile.ZipFile(res.dst_path) as zb:
        a, b = za.read(SHEET_PART).decode(), zb.read(SHEET_PART).decode()
    style_of = lambda xml: dict(re.findall(r'<c r="([A-Z]+\d+)"[^>]*? s="(\d+)"', xml))
    sa, sb = style_of(a), style_of(b)
    assert sa == sb  # every cell keeps its style (conditional formatting / validation keep working)
    assert any("holiday row is empty" in w for w in res.warnings)


@pytest.mark.parametrize("kw", [dict(), dict(date_formulas=False), dict(cache_values=False)])
def test_formula_literal_and_uncached_variants(tmp_path, kw):
    info = make_source(tmp_path, days=60, start=date(2026, 11, 3), **kw)
    last = load_roster(info.path).last_date
    res = build_next_year_file(info.path, tmp_path / "next.xlsx", remainder_for(info, last + timedelta(days=1)))
    nr = load_roster(res.dst_path)
    assert nr.first_date == last + timedelta(days=1) and len(nr.dates) == 60
    if kw.get("cache_values", True):
        assert [nr.weekday_label(d) for d in nr.dates] == [d.strftime("%a") for d in nr.dates]
    else:  # no cached weekday text in the source: the row is not recognised, Excel recalculates on open
        assert nr.weekday_row is None and res.calc_on_load


def test_leap_year_boundaries(tmp_path):
    # source ends 2027-12-31: 365 columns from 2028-01-01 end on 2028-12-30 (2028 is a leap year)
    a = make_source(tmp_path, start=date(2027, 1, 1), days=365, name="a.xlsx")
    ra = build_next_year_file(a.path, tmp_path / "na.xlsx", {})
    assert (ra.start, ra.end) == (date(2028, 1, 1), date(2028, 12, 30))
    assert any("1 day(s) short of a full year ending 2028-12-31" in w for w in ra.warnings)
    nra = load_roster(ra.dst_path)
    assert date(2028, 2, 29) in nra.dates and nra.weekday_label(date(2028, 2, 29)) == "Tue"
    # source ends 2028-12-31 (366 columns): the next file keeps 366 columns, 2029-01-01 .. 2030-01-01
    b = make_source(tmp_path, start=date(2028, 1, 1), days=366, name="b.xlsx")
    rb = build_next_year_file(b.path, tmp_path / "nb.xlsx", {})
    assert (rb.start, rb.end, rb.date_count) == (date(2029, 1, 1), date(2030, 1, 1), 366)
    assert any("1 day(s) beyond a full year ending 2029-12-31" in w for w in rb.warnings)
    # a source that ends on a leap day continues on 1 March
    c = make_source(tmp_path, start=date(2028, 1, 1), days=60, name="c.xlsx")
    assert load_roster(c.path).last_date == date(2028, 2, 29)
    rc = build_next_year_file(c.path, tmp_path / "nc.xlsx", {})
    assert rc.start == date(2028, 3, 1)


def test_old_year_text_is_listed_not_rewritten(tmp_path):
    info = make_source(tmp_path, name="base.xlsx")
    titled = tmp_path / "titled.xlsx"
    patch_workbook(info.path, titled, SHEET, {"C1": "Roster 2026 (draft)", "B3": "valid until 31 Dec 2027", "A4": "see 2025 notes"})
    res = build_next_year_file(titled, tmp_path / "next.xlsx", {})
    cells = {c["cell"]: c for c in res.old_year_cells}
    assert set(cells) == {"C1"} and cells["C1"]["years"] == "2026" and cells["C1"]["text"] == "Roster 2026 (draft)"
    assert any("mention the old year (2026)" in w and "C1" in w for w in res.warnings)
    assert load_sheet(res.dst_path, SHEET).text(1, 3) == "Roster 2026 (draft)"  # carried over unchanged
    assert any("comment part(s)" in w for w in res.warnings) and res.stale_comment_parts
    assert any("carried over unchanged" in w for w in res.warnings)


def test_source_untouched_and_deterministic(tmp_path):
    info = make_source(tmp_path)
    before = sha(info.path)
    rem = remainder_for(info, date(2027, 1, 2))
    a = build_next_year_file(info.path, tmp_path / "a.xlsx", rem, holiday_labels={date(2027, 1, 18): "X"})
    b = build_next_year_file(info.path, tmp_path / "b.xlsx", rem, holiday_labels={date(2027, 1, 18): "X"})
    assert sha(info.path) == before and a.sha256 == b.sha256 == sha(tmp_path / "a.xlsx")
    assert [p.name for p in tmp_path.iterdir() if p.name.endswith(".tmp")] == []


def test_a_next_year_file_can_be_the_source_of_the_following_year(tmp_path):
    info = make_source(tmp_path)
    one = build_next_year_file(info.path, tmp_path / "y2.xlsx", {})
    two = build_next_year_file(one.dst_path, tmp_path / "y3.xlsx", {})
    assert two.start == date(2028, 1, 2) and two.end == date(2028, 12, 31)  # 365 columns across a leap year
    assert any("1 day(s) short of a full year ending 2029-01-01" in w for w in two.warnings)
    assert load_roster(two.dst_path).first_date == date(2028, 1, 2)


def test_errors_leave_no_output(tmp_path):
    info = make_source(tmp_path)
    dst = tmp_path / "next.xlsx"
    with pytest.raises(NextYearError, match="Nobody"):
        build_next_year_file(info.path, dst, {("Nobody", date(2027, 1, 2)): "Shift-1"})
    with pytest.raises(NextYearError, match="outside the new file"):
        build_next_year_file(info.path, dst, {(info.people[0].name, date(2027, 6, 1)): "Shift-1"} | {(info.people[0].name, date(2026, 12, 1)): "x"})
    with pytest.raises(NextYearError, match="holiday label"):
        build_next_year_file(info.path, dst, {}, holiday_labels={date(2025, 1, 1): "old"})
    with pytest.raises(NextYearError, match="must differ"):
        build_next_year_file(info.path, info.path, {})
    assert not dst.exists() and [p.name for p in tmp_path.iterdir()] == ["source.xlsx"]


def test_refuses_a_date_chain_it_cannot_restart(tmp_path):
    info = make_source(tmp_path, days=60)
    bad = tmp_path / "bad.xlsx"
    rewrite_zip(info.path, bad, {SHEET_PART: lambda d: d.replace(b"E13+1", b"E13+7", 1)})
    with pytest.raises(NextYearError, match="previous cell \\+ 1"):
        build_next_year_file(bad, tmp_path / "next.xlsx", {})
    assert not (tmp_path / "next.xlsx").exists()


def test_formula_cell_in_the_grid_is_refused_not_erased(tmp_path):
    info = make_source(tmp_path, days=60)
    bad = tmp_path / "bad.xlsx"
    row, col = info.people[0].row, 6

    def make_formula(data):
        s = data.decode()
        m = re.search(rf'<c r="F{row}"[^>]*?(?:/>|>.*?</c>)', s, re.S)
        attrs = re.sub(r'\s+t="[^"]*"', "", re.match(r"<c([^>]*?)/?>", m.group(0)).group(1))
        return (s[: m.start()] + f"<c{attrs}><f>1+1</f><v>2</v></c>" + s[m.end():]).encode()

    rewrite_zip(info.path, bad, {SHEET_PART: make_formula})
    with pytest.raises(NextYearError, match="formula"):
        build_next_year_file(bad, tmp_path / "next.xlsx", {})
    assert not (tmp_path / "next.xlsx").exists()


def test_custom_start(tmp_path):
    info = make_source(tmp_path, days=60, start=date(2026, 11, 3))
    res = build_next_year_file(info.path, tmp_path / "next.xlsx", {}, start=date(2027, 1, 4))
    assert res.start == date(2027, 1, 4) and load_roster(res.dst_path).first_date == date(2027, 1, 4)


@needs_real
def test_real_file_next_year_smoke(tmp_path):
    master = tmp_path / "real_master.xlsx"
    shutil.copyfile(REAL, master)
    roster = load_roster(master)
    people = roster.people[:3]
    rem = {(p.name, date(2027, 1, 2) + timedelta(days=i)): "Shift-1" for p in people for i in range(5)}
    res = build_next_year_file(master, tmp_path / "next.xlsx", rem, holiday_labels={date(2027, 1, 26): "Test"})
    assert (res.start, res.end, res.date_count) == (date(2027, 1, 2), date(2028, 1, 1), 365)
    assert res.people == len(roster.people) and res.cells_written == 15 and res.calc_on_load
    pkgdiff.assert_only_changed(master, res.dst_path, {SHEET_PART, WB})
    nr = load_roster(res.dst_path)
    assert nr.first_date == roster.last_date + timedelta(days=1) and len(nr.dates) == 365
    assert len(nr.people) == len(roster.people) and sum(1 for p in nr.people for d in nr.dates if nr.cell(p, d)) == 15
    assert len(nr.holiday_labels()) == 1
    assert len(load_workbook(res.dst_path).sheetnames) == 6
