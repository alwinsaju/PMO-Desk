import zipfile

import pytest

from roster_lib import pkgdiff
from roster_lib.xlsx_patch import patch_workbook
from xlsx_fixtures import SHEET, build_roster_workbook

SHEET_PART = "xl/worksheets/sheet1.xml"


def rewrite(src, dst, *, replace=None, drop=(), add=None, stored=(), reverse=False):
    replace = replace or {}
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
        infos = list(zin.infolist())
        if reverse:
            infos.reverse()
        for zi in infos:
            if zi.filename in drop:
                continue
            data = replace.get(zi.filename, zin.read(zi))
            zout.writestr(
                zi.filename, data, compress_type=zipfile.ZIP_STORED if zi.filename in stored else zipfile.ZIP_DEFLATED
            )
        for name, data in (add or {}).items():
            zout.writestr(name, data)


@pytest.fixture()
def pkg(tmp_path):
    info = build_roster_workbook(tmp_path / "a.xlsx")
    return info


def test_identical_packages(pkg, tmp_path):
    copy = tmp_path / "copy.xlsx"
    rewrite(pkg.path, copy)
    d = pkgdiff.diff_packages(pkg.path, copy)
    assert d.identical and d.byte_changed == [] and d.order_preserved
    pkgdiff.assert_only_changed(pkg.path, copy, [])


def test_changed_added_removed_reported_exactly(pkg, tmp_path):
    b = tmp_path / "b.xlsx"
    rewrite(
        pkg.path,
        b,
        replace={"xl/persons/person.xml": b"<personList/>"},
        drop=("docMetadata/LabelInfo.xml",),
        add={"xl/extra.xml": b"<x/>"},
    )
    d = pkgdiff.diff_packages(pkg.path, b)
    assert d.changed == ["xl/persons/person.xml"]
    assert d.only_in_a == ["docMetadata/LabelInfo.xml"]
    assert d.only_in_b == ["xl/extra.xml"]
    assert not d.identical


def test_reserialised_xml_is_distinguished_from_real_change(pkg, tmp_path):
    with zipfile.ZipFile(pkg.path) as z:
        person = z.read("xl/persons/person.xml").decode()
    reformatted = person.replace("><", ">\n<", 1)
    b = tmp_path / "b.xlsx"
    rewrite(pkg.path, b, replace={"xl/persons/person.xml": reformatted.encode()})
    d = pkgdiff.diff_packages(pkg.path, b)
    assert d.changed == ["xl/persons/person.xml"]  # whitespace text nodes are real content in C14N
    # attribute reorder is canonically identical
    a = tmp_path / "c.xlsx"
    swapped = person.replace('userId="test.author" providerId="None"', 'providerId="None" userId="test.author"')
    assert swapped != person
    rewrite(pkg.path, a, replace={"xl/persons/person.xml": swapped.encode()})
    d2 = pkgdiff.diff_packages(pkg.path, a)
    assert d2.reserialised == ["xl/persons/person.xml"] and d2.changed == []
    assert d2.byte_changed == ["xl/persons/person.xml"]
    with pytest.raises(AssertionError, match="unexpected changed parts"):
        pkgdiff.assert_only_changed(pkg.path, a, [])  # strict: bytes must match
    pkgdiff.assert_only_changed(pkg.path, a, [], strict=False)  # canonical comparison only


def test_assert_only_changed_flags_unexpected_and_structural_changes(pkg, tmp_path):
    b = tmp_path / "b.xlsx"
    rewrite(pkg.path, b, replace={"xl/persons/person.xml": b"<personList/>", SHEET_PART: b"<worksheet/>"})
    with pytest.raises(AssertionError, match="unexpected changed parts.*persons"):
        pkgdiff.assert_only_changed(pkg.path, b, {SHEET_PART})
    pkgdiff.assert_only_changed(pkg.path, b, {SHEET_PART, "xl/persons/person.xml"})

    removed = tmp_path / "removed.xlsx"
    rewrite(pkg.path, removed, drop=("xl/persons/person.xml",))
    with pytest.raises(AssertionError, match="parts removed"):
        pkgdiff.assert_only_changed(pkg.path, removed, [])

    added = tmp_path / "added.xlsx"
    rewrite(pkg.path, added, add={"xl/new.xml": b"<n/>"})
    with pytest.raises(AssertionError, match="parts added"):
        pkgdiff.assert_only_changed(pkg.path, added, [])


def test_order_and_compression_changes_detected_in_strict_mode(pkg, tmp_path):
    reordered = tmp_path / "reordered.xlsx"
    rewrite(pkg.path, reordered, reverse=True)
    assert not pkgdiff.diff_packages(pkg.path, reordered).order_preserved
    with pytest.raises(AssertionError, match="order"):
        pkgdiff.assert_only_changed(pkg.path, reordered, [])
    pkgdiff.assert_only_changed(pkg.path, reordered, [], strict=False)

    stored = tmp_path / "stored.xlsx"
    rewrite(pkg.path, stored, stored={"xl/styles.xml"})
    d = pkgdiff.diff_packages(pkg.path, stored)
    assert d.compression_changed == ["xl/styles.xml"] and d.identical
    with pytest.raises(AssertionError, match="compression"):
        pkgdiff.assert_only_changed(pkg.path, stored, [])


def _sheet_bytes(path):
    with zipfile.ZipFile(path) as z:
        return z.read(SHEET_PART)


def test_diff_sheet_xml_reports_cells_rows_and_other_elements(pkg, tmp_path):
    p = pkg.people[0]
    edits = {(p.row, pkg.last_col + 3): "new cell", (pkg.people[-1].row + 4, 2): "new row"}
    out = tmp_path / "out.xlsx"
    patch_workbook(pkg.path, out, SHEET, edits)
    d = pkgdiff.diff_sheet_xml(_sheet_bytes(pkg.path), _sheet_bytes(out))
    assert d.added_cells == set(edits) and not d.changed_cells and not d.removed_cells
    assert d.added_rows == {pkg.people[-1].row + 4}
    assert d.other_elements_changed == ["dimension"]
    assert d.row_attrs_changed <= {p.row}


def test_diff_sheet_xml_detects_conditional_formatting_tamper(pkg, tmp_path):
    xml = _sheet_bytes(pkg.path).decode()
    tampered = xml.replace('text="shift-1"', 'text="shift-9"', 1)
    assert tampered != xml
    out = tmp_path / "t.xlsx"
    rewrite(pkg.path, out, replace={SHEET_PART: tampered.encode()})
    d = pkgdiff.diff_sheet_xml(xml.encode(), tampered.encode())
    assert d.other_elements_changed == ["conditionalFormatting"] and not d.touched_cells
    with pytest.raises(AssertionError, match="sheet-level elements changed"):
        pkgdiff.assert_sheet_only_changed(pkg.path, out, SHEET_PART, [])


def test_assert_sheet_only_changed_rejects_extra_cells(pkg, tmp_path):
    p = pkg.people[0]
    out = tmp_path / "o.xlsx"
    patch_workbook(pkg.path, out, SHEET, {(p.row, pkg.last_col + 3): "x"})
    with pytest.raises(AssertionError, match="unexpected cell changes"):
        pkgdiff.assert_sheet_only_changed(pkg.path, out, SHEET_PART, [])
