import re
import zipfile
from datetime import date

import pytest
from openpyxl import load_workbook

from roster_lib import pkgdiff
from roster_lib.xlsx_patch import list_sheets, load_sheet
from roster_lib.xlsx_sheets import (
    Cell,
    SheetNameError,
    SheetSpec,
    XlsxSheetsError,
    add_sheets,
    clean_text,
    validate_sheet_name,
)
from xlsx_fixtures import SHEET, build_roster_workbook

SHEET_PART = "xl/worksheets/sheet1.xml"
CHANGED = {
    "xl/workbook.xml",
    "xl/_rels/workbook.xml.rels",
    "[Content_Types].xml",
    "xl/styles.xml",
    "docProps/app.xml",
}


def assert_only_sheets_added(src, dst, new_parts, allowed_changed=CHANGED):
    d = pkgdiff.diff_packages(src, dst)
    assert d.only_in_a == []
    assert sorted(d.only_in_b) == sorted(new_parts)
    assert set(d.byte_changed) <= set(allowed_changed), d.byte_changed
    assert d.compression_changed == []
    with zipfile.ZipFile(src) as za, zipfile.ZipFile(dst) as zb:
        old = za.namelist()
        assert zb.namelist()[: len(old)] == old  # existing order kept, new parts appended
    return d


@pytest.fixture()
def pkg(tmp_path):
    return build_roster_workbook(tmp_path / "master.xlsx")


def specs():
    return [
        SheetSpec(
            "Summary",
            [
                [Cell("Title", "bold"), None, None, None, None, Cell("hdr", "header")],
                ["count", 3, 2.5, True, date(2026, 1, 4)],
                [Cell("red", "flag_red"), Cell("amber", "flag_amber"), Cell("note", "info")],
                ["multi\nline", Cell("wrapped text", "wrap")],
            ],
            col_widths=[20, None, 12],
            freeze="A2",
            tab_color="1F3864",
            row_styles={2: "flag_red"},
        ),
        SheetSpec("_snapshot", [["a", "b"], ["c", None, "e"]], state="veryHidden"),
        SheetSpec("Hid", [["x"]], state="hidden", freeze="B2"),
    ]


def test_only_expected_parts_change(pkg, tmp_path):
    dst = tmp_path / "out.xlsx"
    res = add_sheets(pkg.path, dst, specs())
    assert res.sheet_names == ["Summary", "_snapshot", "Hid"]
    assert res.sheet_parts == [
        "xl/worksheets/sheet3.xml",
        "xl/worksheets/sheet4.xml",
        "xl/worksheets/sheet5.xml",
    ]
    d = assert_only_sheets_added(pkg.path, dst, res.sheet_parts)
    assert SHEET_PART not in d.byte_changed
    assert "xl/workbook.xml" in d.byte_changed
    assert set(res.changed_parts) <= CHANGED


def test_existing_parts_survive_byte_identical(pkg, tmp_path):
    dst = tmp_path / "out.xlsx"
    add_sheets(pkg.path, dst, specs())
    d = pkgdiff.diff_packages(pkg.path, dst)
    for part in (
        "xl/threadedComments/threadedComment1.xml",
        "xl/persons/person.xml",
        "docMetadata/LabelInfo.xml",
        "docProps/custom.xml",
        SHEET_PART,
        "xl/worksheets/sheet2.xml",
        "xl/calcChain.xml",
        "xl/sharedStrings.xml",
        "xl/drawings/drawing1.xml",
    ):
        assert part not in d.byte_changed, part


def test_workbook_registration(pkg, tmp_path):
    dst = tmp_path / "out.xlsx"
    add_sheets(pkg.path, dst, specs())
    with zipfile.ZipFile(pkg.path) as z:
        old = list_sheets(z)
    with zipfile.ZipFile(dst) as z:
        new = list_sheets(z)
        ct = z.read("[Content_Types].xml").decode()
        rels = z.read("xl/_rels/workbook.xml.rels").decode()
    assert new[: len(old)] == old
    added = new[len(old):]
    assert [(s.name, s.state) for s in added] == [("Summary", "visible"), ("_snapshot", "veryHidden"), ("Hid", "hidden")]
    ids = [s.sheet_id for s in new]
    assert len(set(ids)) == len(ids) and ids == sorted(ids)
    rids = re.findall(r'Id="([^"]+)"', rels)
    assert len(set(rids)) == len(rids)
    for s in added:
        assert f'PartName="/{s.part}"' in ct
        assert f'Target="{s.part[3:]}"' in rels


def test_styles_append_only(pkg, tmp_path):
    dst = tmp_path / "out.xlsx"
    add_sheets(pkg.path, dst, specs())
    with zipfile.ZipFile(pkg.path) as za, zipfile.ZipFile(dst) as zb:
        a, b = za.read("xl/styles.xml").decode(), zb.read("xl/styles.xml").decode()
    from lxml import etree

    ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    ra, rb = etree.fromstring(a.encode()), etree.fromstring(b.encode())
    for sec in ("fonts", "fills", "borders", "cellXfs"):
        ea, eb = ra.find(ns + sec), rb.find(ns + sec),
        ea, eb = ra.find(ns + sec), rb.find(ns + sec)
        assert len(eb) > len(ea)
        assert eb.get("count") == str(len(eb))
        for x, y in zip(ea, eb):  # existing entries unchanged and in order
            assert etree.tostring(x, method="c14n") == etree.tostring(y, method="c14n")
    nf = rb.find(ns + "numFmts")
    assert nf is not None and nf.get("count") == str(len(nf))
    assert all(int(f.get("numFmtId")) >= 164 for f in nf)
    # every new xf points at existing fonts / fills / borders
    xfs = rb.find(ns + "cellXfs")
    for xf in xfs:
        assert int(xf.get("fontId")) < len(rb.find(ns + "fonts"))
        assert int(xf.get("fillId")) < len(rb.find(ns + "fills"))
        assert int(xf.get("borderId")) < len(rb.find(ns + "borders"))


def test_no_styles_change_when_no_style_used(pkg, tmp_path):
    dst = tmp_path / "out.xlsx"
    res = add_sheets(pkg.path, dst, [SheetSpec("Plain", [["a", 1]])])
    assert "xl/styles.xml" not in res.changed_parts
    pkgdiff.diff_packages(pkg.path, dst)
    assert "xl/styles.xml" not in pkgdiff.diff_packages(pkg.path, dst).byte_changed


def test_app_xml_titles_updated(pkg, tmp_path):
    dst = tmp_path / "out.xlsx"
    with zipfile.ZipFile(pkg.path) as z:
        before = z.read("docProps/app.xml").decode()
    add_sheets(pkg.path, dst, specs())
    with zipfile.ZipFile(dst) as z:
        after = z.read("docProps/app.xml").decode()
    if "TitlesOfParts" in before:
        assert "<vt:lpstr>Summary</vt:lpstr>" in after
        sizes = re.findall(r'<vt:vector size="(\d+)" baseType="lpstr">', after)
        assert int(sizes[0]) == len(re.findall(r"<vt:lpstr>", after.split("<TitlesOfParts>")[1]))
        assert "<vt:i4>5</vt:i4>" in after  # 2 original worksheets + 3 new


def test_openpyxl_loads_and_sees_new_sheets(pkg, tmp_path):
    dst = tmp_path / "out.xlsx"
    add_sheets(pkg.path, dst, specs())
    wb = load_workbook(dst)
    assert wb.sheetnames == [SHEET, "Notes", "Summary", "_snapshot", "Hid"]
    assert wb["_snapshot"].sheet_state == "veryHidden"
    assert wb["Hid"].sheet_state == "hidden"
    ws = wb["Summary"]
    assert ws["A1"].value == "Title" and ws["A1"].font.b
    assert ws["A2"].value == "count" and ws["B2"].value == 3 and ws["C2"].value == 2.5
    assert ws["D2"].value is True
    assert ws["E2"].value.date() == date(2026, 1, 4)
    assert ws["E2"].number_format.replace("\\", "") == "yyyy-mm-dd"
    assert ws["A3"].fill.fgColor.rgb == "FFFFC7CE"  # row style
    assert ws["B3"].fill.fgColor.rgb == "FFFFEB9C"  # explicit style wins
    assert ws["A4"].value == "multi\nline"
    assert ws["B4"].alignment.wrap_text
    assert ws.freeze_panes == "A2"
    assert ws.sheet_properties.tabColor.rgb == "001F3864" or ws.sheet_properties.tabColor.rgb == "FF1F3864"
    assert ws.column_dimensions["A"].width == 20
    assert wb["Hid"].freeze_panes == "B2"
    assert wb["_snapshot"]["C2"].value == "e"
    assert wb["_snapshot"]["B2"].value is None


def test_xlsx_patch_reader_reads_new_sheets(pkg, tmp_path):
    dst = tmp_path / "out.xlsx"
    add_sheets(pkg.path, dst, specs())
    s = load_sheet(dst, "_snapshot")
    assert s.text(1, 1) == "a" and s.text(2, 3) == "e"
    s = load_sheet(dst, "Summary")
    assert s.text(2, 2) == "3" and s.text(4, 1) == "multi\nline"


def test_existing_features_survive(pkg, tmp_path):
    dst = tmp_path / "out.xlsx"
    add_sheets(pkg.path, dst, specs())
    with zipfile.ZipFile(pkg.path) as za, zipfile.ZipFile(dst) as zb:
        assert za.read(SHEET_PART) == zb.read(SHEET_PART)  # CF, validation, extLst, hyperlink live here
    wb = load_workbook(dst)
    assert wb["Notes"].sheet_state == "hidden"
    assert load_sheet(dst, SHEET).max_row == load_sheet(pkg.path, SHEET).max_row


def test_source_never_modified_and_dst_must_differ(pkg, tmp_path):
    before = pkg.path.read_bytes()
    add_sheets(pkg.path, tmp_path / "o.xlsx", specs())
    assert pkg.path.read_bytes() == before
    with pytest.raises(XlsxSheetsError, match="must differ"):
        add_sheets(pkg.path, pkg.path, specs())
    assert pkg.path.read_bytes() == before


def test_deterministic_bytes(pkg, tmp_path):
    a, b = tmp_path / "a.xlsx", tmp_path / "b.xlsx"
    add_sheets(pkg.path, a, specs())
    add_sheets(pkg.path, b, specs())
    assert a.read_bytes() == b.read_bytes()


@pytest.mark.parametrize(
    "name",
    ["", "   ", "x" * 32, "a:b", "a/b", "a\\b", "a?b", "a*b", "a[b", "a]b", "'lead", "trail'", "History", "pdt operate", "NOTES"],
)
def test_bad_or_colliding_names_rejected(pkg, tmp_path, name):
    dst = tmp_path / "o.xlsx"
    with pytest.raises(SheetNameError):
        add_sheets(pkg.path, dst, [SheetSpec(name, [["a"]])])
    assert not dst.exists()


def test_duplicate_names_among_new_sheets(pkg, tmp_path):
    with pytest.raises(SheetNameError):
        add_sheets(pkg.path, tmp_path / "o.xlsx", [SheetSpec("Dup", [["a"]]), SheetSpec("dup", [["b"]])])


def test_name_rules_helper():
    validate_sheet_name("x" * 31)
    validate_sheet_name("Run log", ["Other"])
    with pytest.raises(SheetNameError):
        validate_sheet_name("run LOG", ["Run log"])


def test_unknown_style_and_bad_state_and_values(pkg, tmp_path):
    with pytest.raises(XlsxSheetsError, match="unknown style"):
        add_sheets(pkg.path, tmp_path / "o.xlsx", [SheetSpec("S", [[Cell("a", "nope")]])])
    with pytest.raises(XlsxSheetsError, match="state"):
        add_sheets(pkg.path, tmp_path / "o.xlsx", [SheetSpec("S", [["a"]], state="gone")])
    with pytest.raises(XlsxSheetsError):
        add_sheets(pkg.path, tmp_path / "o.xlsx", [SheetSpec("S", [[float("nan")]])])
    with pytest.raises(XlsxSheetsError):
        add_sheets(pkg.path, tmp_path / "o.xlsx", [SheetSpec("S", [["bad\x00char"]])])
    with pytest.raises(XlsxSheetsError, match="tab colour"):
        add_sheets(pkg.path, tmp_path / "o.xlsx", [SheetSpec("S", [["a"]], tab_color="red")])
    assert not (tmp_path / "o.xlsx").exists()


def test_special_text_roundtrips(pkg, tmp_path):
    texts = ["a & b < c > d", "_x0041_ literal", "  padded  ", "=1+1", "12", "line1\r\nline2", "ünï"]
    dst = tmp_path / "o.xlsx"
    add_sheets(pkg.path, dst, [SheetSpec("T", [[t] for t in texts])])
    s = load_sheet(dst, "T")
    got = [s.text(i + 1, 1) for i in range(len(texts))]
    assert got[:5] == texts[:5]
    assert got[5] == "line1\nline2".replace("\n", "\r") or got[5] in ("line1\r\nline2", "line1\nline2", "line1\rline2")
    assert got[6] == texts[6]
    wb = load_workbook(dst)
    assert wb["T"]["A4"].value == "=1+1" and wb["T"]["A4"].data_type == "s"
    assert wb["T"]["A5"].value == "12" and wb["T"]["A5"].data_type == "s"


def test_clean_text():
    assert clean_text("a\x00b\x1fc") == "abc"
    assert clean_text(None) == ""
    assert len(clean_text("x" * 50, limit=10)) == 10


def test_second_add_on_top_of_first(pkg, tmp_path):
    a, b = tmp_path / "a.xlsx", tmp_path / "b.xlsx"
    r1 = add_sheets(pkg.path, a, [SheetSpec("One", [[Cell("x", "bold")]])])
    r2 = add_sheets(a, b, [SheetSpec("Two", [[Cell("y", "header")]])])
    assert r1.sheet_parts == ["xl/worksheets/sheet3.xml"] and r2.sheet_parts == ["xl/worksheets/sheet4.xml"]
    assert load_workbook(b).sheetnames[-2:] == ["One", "Two"]


def test_workbook_without_app_xml_or_numfmts(pkg, tmp_path):
    stripped = tmp_path / "s.xlsx"
    with zipfile.ZipFile(pkg.path) as zin, zipfile.ZipFile(stripped, "w", zipfile.ZIP_DEFLATED) as zout:
        for zi in zin.infolist():
            if zi.filename == "docProps/app.xml":
                continue
            data = zin.read(zi)
            if zi.filename == "_rels/.rels":
                data = re.sub(rb"<Relationship [^>]*docProps/app\.xml[^>]*/>", b"", data)
            if zi.filename == "[Content_Types].xml":
                data = re.sub(rb"<Override [^>]*docProps/app\.xml[^>]*/>", b"", data)
            zout.writestr(zi.filename, data)
    dst = tmp_path / "o.xlsx"
    add_sheets(stripped, dst, specs())
    assert load_workbook(dst).sheetnames[-3:] == ["Summary", "_snapshot", "Hid"]
