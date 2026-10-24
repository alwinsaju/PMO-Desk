import re
import time
import zipfile
from datetime import date, timedelta

import pytest

from roster_lib import xlsx_patch as xp
from roster_lib.pkgdiff import (
    assert_only_changed,
    assert_sheet_only_changed,
    diff_packages,
    diff_sheet_xml,
)
from xlsx_fixtures import FIRST_DATE_COL, SHEET, build_roster_workbook

SHEET_PART = "xl/worksheets/sheet1.xml"


@pytest.fixture()
def wb(tmp_path):
    info = build_roster_workbook(tmp_path / "roster.xlsx")
    return info


def patch(info, tmp_path, edits, **kw):
    dst = tmp_path / "out.xlsx"
    res = xp.patch_workbook(info.path, dst, SHEET, edits, **kw)
    return dst, res


def sheet_xml(path, part=SHEET_PART) -> str:
    with zipfile.ZipFile(path) as z:
        return z.read(part).decode("utf-8")


def cell_xml(path, ref, part=SHEET_PART) -> str:
    m = re.search(r'<c r="%s"[^>]*?(?:/>|>.*?</c>)' % ref, sheet_xml(path, part), re.S)
    assert m, ref
    return m.group(0)


def blank_cell(info, person_index=0):
    """A (row, col) of an existing, blank, styled data cell."""
    p = info.people[person_index]
    for d in info.dates():
        if info.expected(p.name, d) == "":
            return p.row, info.date_col(d)
    raise AssertionError("no blank cell")


# --- helpers --------------------------------------------------------------


def test_ref_helpers_roundtrip():
    assert xp.col_to_num("A") == 1 and xp.col_to_num("AA") == 27 and xp.col_to_num("NE") == 369
    assert xp.num_to_col(369) == "NE" and xp.num_to_col(26) == "Z" and xp.num_to_col(27) == "AA"
    assert xp.parse_ref("$E$16") == (16, 5)
    assert xp.format_ref(16, 5) == "E16"
    with pytest.raises(ValueError):
        xp.parse_ref("16E")


def test_text_encoding_roundtrip():
    for s in ["plain", "a & b < c > d", "Shift Swap\nNS", "x\r\ny", " lead and trail ", "_x000D_ literal", "tab\there", "q\"uote'"]:
        assert xp.decode_text(xp.encode_text(s)) == s


def test_decode_text_normalises_markup_newlines_and_decodes_escapes():
    assert xp.decode_text("a\r\nb") == "a\nb"  # raw CRLF in markup -> LF, like an XML parser
    assert xp.decode_text("a&#13;&#10;b") == "a\r\nb"
    assert xp.decode_text("a_x000D_b") == "a\rb"
    assert xp.decode_text("&lt;&gt;&amp;&quot;&apos;") == "<>&\"'"


def test_encode_rejects_invalid_xml_chars():
    with pytest.raises(ValueError):
        xp.encode_text("bad\x00char")


# --- package structure -----------------------------------------------------


def test_resolve_sheet_parts_including_absolute_targets(wb):
    with zipfile.ZipFile(wb.path) as z:
        sheets = xp.list_sheets(z)
        assert [(s.name, s.part, s.state) for s in sheets] == [
            (SHEET, "xl/worksheets/sheet1.xml", "visible"),
            ("Notes", "xl/worksheets/sheet2.xml", "hidden"),
        ]
        assert xp.resolve_sheet_part(z, "Notes") == "xl/worksheets/sheet2.xml"
        with pytest.raises(xp.SheetNotFoundError, match="PDT Operate"):
            xp.resolve_sheet_part(z, "Nope")


def test_sheet_name_resolved_through_rels_not_filename(tmp_path, wb):
    """Swap which part the first <sheet> points at; resolution must follow the rels."""
    src = wb.path
    dst = tmp_path / "swapped.xlsx"
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
        for zi in zin.infolist():
            data = zin.read(zi)
            if zi.filename == "xl/_rels/workbook.xml.rels":
                t = data.decode()
                t = t.replace('Target="/xl/worksheets/sheet1.xml" Id="rId1"', 'Target="/xl/worksheets/TMP.xml" Id="rId1"')
                t = t.replace('Target="/xl/worksheets/sheet2.xml" Id="rId2"', 'Target="/xl/worksheets/sheet1.xml" Id="rId2"')
                t = t.replace("TMP.xml", "sheet2.xml")
                data = t.encode()
            zout.writestr(zi.filename, data)
    with zipfile.ZipFile(dst) as z:
        assert xp.resolve_sheet_part(z, SHEET) == "xl/worksheets/sheet2.xml"
        assert xp.resolve_sheet_part(z, "Notes") == "xl/worksheets/sheet1.xml"


# --- reading ----------------------------------------------------------------


def test_load_sheet_reads_all_texts_as_written(wb):
    sheet = xp.load_sheet(wb.path, SHEET)
    for p in wb.people:
        for d in wb.dates():
            assert sheet.text(p.row, wb.date_col(d)) == wb.expected(p.name, d)
    assert sheet.text(wb.header_row, 2) == "L2"
    assert sheet.text(wb.header_row, 3) == "Loc"
    assert sheet.max_row >= wb.people[-1].row


def test_load_sheet_reads_formula_cached_values_and_flags(wb):
    sheet = xp.load_sheet(wb.path, SHEET)
    first = FIRST_DATE_COL
    assert sheet.cells[(wb.date_row, first)].is_formula is False
    c = sheet.cells[(wb.date_row, first + 1)]
    assert c.is_formula and c.text == str((wb.start + timedelta(days=1) - date(1899, 12, 30)).days)
    wk = sheet.cells[(wb.weekday_row, first)]
    assert wk.is_formula and wk.text == wb.start.strftime("%a") and wk.cell_type == "str"


def test_rich_text_shared_string_is_concatenated(wb):
    sheet = xp.load_sheet(wb.path, SHEET)
    col = FIRST_DATE_COL + 2
    assert sheet.text(wb.holiday_row, col) == "Republic Day"
    assert sheet.cells[(wb.holiday_row, col)].cell_type == "s"


def test_load_sheet_reads_merges(wb):
    sheet = xp.load_sheet(wb.path, SHEET)
    anchor_col = wb.date_col(wb.merged_holiday[0])
    assert (wb.holiday_row, anchor_col, wb.holiday_row, anchor_col + wb.merged_holiday[1] - 1) in sheet.merges


def test_read_cell_texts_selected_refs_and_blank(wb):
    row, col = blank_cell(wb)
    p = wb.people[0]
    texts = xp.read_cell_texts(wb.path, SHEET, [(row, col), "B%d" % p.row, (9999, 3)])
    assert texts == {(row, col): "", (p.row, 2): p.name, (9999, 3): ""}


# --- patching: basic behaviour ---------------------------------------------


def test_patch_sets_text_and_keeps_style(wb, tmp_path):
    row, col = blank_cell(wb)
    before = cell_xml(wb.path, xp.format_ref(row, col))
    style = re.search(r' s="(\d+)"', before).group(1)
    dst, res = patch(wb, tmp_path, {(row, col): "Shift-1"})
    after = cell_xml(dst, xp.format_ref(row, col))
    assert f' s="{style}"' in after
    assert xp.read_cell_texts(dst, SHEET, [(row, col)]) == {(row, col): "Shift-1"}
    assert res.written == 1 and res.changed_parts == (SHEET_PART,)


def test_patch_only_target_sheet_part_changes(wb, tmp_path):
    row, col = blank_cell(wb)
    p2 = wb.people[2]
    existing = next(d for d in wb.dates() if wb.expected(p2.name, d))
    dst, res = patch(wb, tmp_path, {(row, col): "Shift-2", (p2.row, wb.date_col(existing)): "Zebra shift"})
    d = assert_only_changed(wb.path, dst, {SHEET_PART})
    assert d.byte_changed == [SHEET_PART]
    assert d.order_preserved and not d.compression_changed
    assert_sheet_only_changed(wb.path, dst, SHEET_PART, {(row, col), (p2.row, wb.date_col(existing))})


def test_sensitive_parts_survive_byte_identical(wb, tmp_path):
    row, col = blank_cell(wb)
    dst, _ = patch(wb, tmp_path, {(row, col): "P"})
    must_survive = [
        "xl/threadedComments/threadedComment1.xml",
        "xl/persons/person.xml",
        "docProps/custom.xml",
        "docMetadata/LabelInfo.xml",
        "customXml/item1.xml",
        "xl/drawings/drawing1.xml",
        "xl/comments/comment1.xml",
        "xl/worksheets/_rels/sheet1.xml.rels",
        "xl/workbook.xml",
        "xl/sharedStrings.xml",
        "xl/styles.xml",
        "xl/calcChain.xml",
        "[Content_Types].xml",
        "xl/worksheets/sheet2.xml",
    ]
    with zipfile.ZipFile(wb.path) as a, zipfile.ZipFile(dst) as b:
        for part in must_survive:
            assert a.read(part) == b.read(part), part
        wbxml = b.read("xl/workbook.xml").decode()
        assert 'name="Notes"' in wbxml and 'state="hidden"' in wbxml


def test_non_cell_sheet_elements_byte_identical(wb, tmp_path):
    """CF, DV, hyperlinks, merges, extLst: the bytes around sheetData are carried over verbatim."""
    row, col = blank_cell(wb)
    dst, _ = patch(wb, tmp_path, {(row, col): "P", (row + 100, 3): "new row"})
    a, b = sheet_xml(wb.path), sheet_xml(dst)
    tail_a = a[a.index("</sheetData>"):]
    tail_b = b[b.index("</sheetData>"):]
    assert tail_a == tail_b
    for needle in ("<conditionalFormatting", "<dataValidations", "<hyperlinks>", "<extLst>", "x14:cfRule"):
        assert needle in tail_b
    assert b.startswith(a[: a.index("<dimension")])
    # views, cols, ... between <dimension/> and <sheetData> are untouched too
    head_a = a[a.index("/>", a.index("<dimension")) : a.index("<sheetData")]
    head_b = b[b.index("/>", b.index("<dimension")) : b.index("<sheetData")]
    assert head_a == head_b


def test_untouched_cells_and_rows_canonically_unchanged(wb, tmp_path):
    row, col = blank_cell(wb)
    dst, _ = patch(wb, tmp_path, {(row, col): "P"})
    with zipfile.ZipFile(wb.path) as a, zipfile.ZipFile(dst) as b:
        d = diff_sheet_xml(a.read(SHEET_PART), b.read(SHEET_PART))
    assert d.changed_cells == {(row, col)}
    assert not d.added_cells and not d.removed_cells and not d.added_rows
    assert d.other_elements_changed == [] and d.row_attrs_changed == set()


def test_clear_cell_keeps_style_and_drops_type(wb, tmp_path):
    p = wb.people[0]
    d0 = next(d for d in wb.dates() if wb.expected(p.name, d))
    row, col = p.row, wb.date_col(d0)
    ref = xp.format_ref(row, col)
    style = re.search(r' s="(\d+)"', cell_xml(wb.path, ref)).group(1)
    dst, res = patch(wb, tmp_path, {(row, col): None})
    after = cell_xml(dst, ref)
    assert after == f'<c r="{ref}" s="{style}"/>'
    assert res.cleared == 1
    assert xp.read_cell_texts(dst, SHEET, [(row, col)]) == {(row, col): ""}


def test_empty_string_is_treated_as_clear(wb, tmp_path):
    p = wb.people[0]
    d0 = next(d for d in wb.dates() if wb.expected(p.name, d))
    dst, res = patch(wb, tmp_path, {(p.row, wb.date_col(d0)): ""})
    assert res.cleared == 1
    assert xp.read_cell_texts(dst, SHEET, [(p.row, wb.date_col(d0))])[(p.row, wb.date_col(d0))] == ""


def test_a1_string_keys_accepted(wb, tmp_path):
    row, col = blank_cell(wb)
    dst, _ = patch(wb, tmp_path, {xp.format_ref(row, col): "HOL"})
    assert xp.read_cell_texts(dst, SHEET, [(row, col)])[(row, col)] == "HOL"


# --- text storage ------------------------------------------------------------


def test_reuses_existing_plain_shared_string_never_the_rich_lookalike(wb, tmp_path):
    row, col = blank_cell(wb)
    dst, res = patch(wb, tmp_path, {(row, col): "Shift-1"})
    x = cell_xml(dst, xp.format_ref(row, col))
    assert 't="s"' in x and "inlineStr" not in x
    idx = int(re.search(r"<v>(\d+)</v>", x).group(1))
    assert idx != 0  # index 0 is a rich-text "Shift-1" lookalike
    with zipfile.ZipFile(dst) as z:
        sst = xp.parse_shared_strings(z.read("xl/sharedStrings.xml"))
    assert sst.texts[idx] == "Shift-1" and sst.plain_index["Shift-1"] == idx
    assert res.shared_string_refs == 1 and res.inline_strings == 0


def test_new_text_uses_inline_string_and_does_not_touch_shared_strings(wb, tmp_path):
    row, col = blank_cell(wb)
    dst, res = patch(wb, tmp_path, {(row, col): "Zebra 9AM-6PM"})
    x = cell_xml(dst, xp.format_ref(row, col))
    assert 't="inlineStr"' in x and '<t xml:space="preserve">Zebra 9AM-6PM</t>' in x
    assert res.inline_strings == 1
    with zipfile.ZipFile(wb.path) as a, zipfile.ZipFile(dst) as b:
        assert a.read("xl/sharedStrings.xml") == b.read("xl/sharedStrings.xml")


def test_reuse_disabled_forces_inline(wb, tmp_path):
    row, col = blank_cell(wb)
    dst, res = patch(wb, tmp_path, {(row, col): "Shift-1"}, reuse_shared_strings=False)
    assert 't="inlineStr"' in cell_xml(dst, xp.format_ref(row, col))
    assert res.shared_string_refs == 0


def test_special_text_roundtrips(wb, tmp_path):
    row, col = blank_cell(wb)
    texts = ["Shift Swap\nNS", "a & b <c> \"d\"", "  padded  ", "crlf\r\nline", "_x000D_ not an escape", "12", "=1+1", "1/2"]
    edits = {(row, col + i): t for i, t in enumerate(texts)}
    dst, _ = patch(wb, tmp_path, edits)
    got = xp.read_cell_texts(dst, SHEET, edits.keys())
    assert got == edits
    for (r, c), t in edits.items():  # always text, never a number or formula
        x = cell_xml(dst, xp.format_ref(r, c))
        assert "<f" not in x and re.search(r't="(s|inlineStr)"', x)


def test_writing_over_numeric_cell_with_same_digits_converts_to_text(wb, tmp_path):
    """A numeric cell reading '5' is not 'already the text 5'."""
    row, col = blank_cell(wb)
    first, _ = patch(wb, tmp_path, {(row, col): "5"})
    # force the cell numeric by hand
    sx = sheet_xml(first)
    ref = xp.format_ref(row, col)
    sx2 = re.sub(r'<c r="%s"[^>]*?(?:/>|>.*?</c>)' % ref, f'<c r="{ref}" s="1" t="n"><v>5</v></c>', sx, flags=re.S)
    numeric = tmp_path / "numeric.xlsx"
    with zipfile.ZipFile(first) as zin, zipfile.ZipFile(numeric, "w", zipfile.ZIP_DEFLATED) as zout:
        for zi in zin.infolist():
            zout.writestr(zi.filename, sx2.encode() if zi.filename == SHEET_PART else zin.read(zi))
    out = tmp_path / "text.xlsx"
    res = xp.patch_workbook(numeric, out, SHEET, {(row, col): "5"})
    assert res.written == 1 and res.unchanged == 0
    assert 't="n"' not in cell_xml(out, ref)


# --- creating cells / rows ----------------------------------------------------


def test_create_cell_in_column_order_inside_existing_row(wb, tmp_path):
    first, last = wb.legend_ranges[0]
    cont = last  # continuation row: no col A, has col B
    assert "<c r=\"A%d\"" % cont not in sheet_xml(wb.path)
    dst, res = patch(wb, tmp_path, {(cont, 1): "front", (cont, 4): "back"})
    row_xml = re.search(r'<row r="%d"[^>]*>.*?</row>' % cont, sheet_xml(dst), re.S).group(0)
    cols = re.findall(r'<c r="([A-Z]+)%d"' % cont, row_xml)
    assert cols == ["A", "B", "D"]
    assert res.created_cells == 2 and res.created_rows == 0
    assert_only_changed(wb.path, dst, {SHEET_PART})


def test_create_cell_beyond_last_column_widens_spans_and_dimension(wb, tmp_path):
    p = wb.people[0]
    far = wb.last_col + 7
    old_dim = re.search(r'<dimension ref="([^"]+)"', sheet_xml(wb.path)).group(1)
    dst, _ = patch(wb, tmp_path, {(p.row, far): "late"})
    assert xp.read_cell_texts(dst, SHEET, [(p.row, far)])[(p.row, far)] == "late"
    new_dim = re.search(r'<dimension ref="([^"]+)"', sheet_xml(dst)).group(1)
    assert new_dim != old_dim
    assert new_dim.split(":")[1].startswith(xp.num_to_col(far))
    assert_sheet_only_changed(wb.path, dst, SHEET_PART, {(p.row, far)}, allow_row_attr_changes={p.row})


def test_create_new_rows_in_order_preserving_attrs(wb, tmp_path):
    xml = sheet_xml(wb.path)
    present = {int(n) for n in re.findall(r'<row r="(\d+)"', xml)}
    missing_mid = next((r for r in range(2, max(present)) if r not in present), None)
    last = max(present)
    edits = {(last + 3, 2): "tail row", (last + 1, 5): "after", (wb.header_row, 20): "keep row attrs"}
    if missing_mid is not None:
        edits[(missing_mid, 6)] = "gap row"
    dst, res = patch(wb, tmp_path, edits)
    rows = [int(n) for n in re.findall(r'<row r="(\d+)"', sheet_xml(dst))]
    assert rows == sorted(rows) and len(rows) == len(set(rows))
    assert res.created_rows == len(edits) - 1
    for (r, c), t in edits.items():
        assert xp.read_cell_texts(dst, SHEET, [(r, c)])[(r, c)] == t
    assert_sheet_only_changed(wb.path, dst, SHEET_PART, set(edits))


def test_row_attributes_preserved_when_editing_row(wb, tmp_path):
    spacer = wb.legend_ranges[0][0] - 1  # thin spacer row carrying ht/customHeight
    before = re.search(r'<row r="%d"([^>]*)' % spacer, sheet_xml(wb.path)).group(1)
    assert "ht=" in before
    dst, _ = patch(wb, tmp_path, {(spacer, 3): "note in spacer"})
    after = re.search(r'<row r="%d"([^>]*)' % spacer, sheet_xml(dst)).group(1)
    assert after.strip() == before.strip().rstrip("/").strip()


def test_new_cell_style_option_and_row_default(wb, tmp_path):
    p = wb.people[0]
    dst, _ = patch(wb, tmp_path, {(p.row, wb.last_col + 2): "styled"}, new_cell_style=4)
    assert ' s="4"' in cell_xml(dst, xp.format_ref(p.row, wb.last_col + 2))
    dst2, _ = patch(wb, tmp_path, {(p.row, wb.last_col + 2): "plain"})
    assert " s=" not in cell_xml(dst2, xp.format_ref(p.row, wb.last_col + 2))


def test_clearing_nonexistent_cell_is_a_noop(wb, tmp_path):
    res_dst, res = patch(wb, tmp_path, {(5000, 5): None, (wb.people[0].row, 400): None})
    assert res.changed_parts == () and res.unchanged == 2
    assert not diff_packages(wb.path, res_dst).byte_changed


# --- formulas -----------------------------------------------------------------


def test_formula_cells_refused_by_default_and_dst_not_written(wb, tmp_path):
    row, col = wb.formula_cells[0]
    dst = tmp_path / "out.xlsx"
    with pytest.raises(xp.FormulaOverwriteError, match="formula"):
        xp.patch_workbook(wb.path, dst, SHEET, {(row, col): "x"})
    assert not dst.exists() and not list(tmp_path.glob("*.tmp"))


def test_formula_overwrite_allowed_prunes_calc_chain_keeping_sheet_id_inheritance(wb, tmp_path):
    with zipfile.ZipFile(wb.path) as z:
        cc_before = z.read("xl/calcChain.xml").decode()
    first_cell = next(c for c in re.findall(r'<c r="([A-Z]+\d+)"[^>]*/>', cc_before))
    assert 'i="1"' in cc_before.split("/>")[0]  # the entry that carries the inherited sheet id
    row, col = xp.parse_ref(first_cell)  # first calcChain entry is the first serial-chain cell
    dst, res = patch(wb, tmp_path, {(row, col): "text now"}, allow_formula_overwrite=True)
    assert res.formulas_overwritten == 1
    assert set(res.changed_parts) == {SHEET_PART, "xl/calcChain.xml"}
    with zipfile.ZipFile(dst) as z:
        cc = z.read("xl/calcChain.xml").decode()
    assert f'r="{first_cell}"' not in cc
    entries = re.findall(r"<c\b([^>]*?)/>", cc)
    assert len(entries) == len(re.findall(r"<c\b([^>]*?)/>", cc_before)) - 1
    assert 'i="1"' in entries[0]  # inheritance preserved: new first entry now states i
    assert any('i="2"' in e for e in entries)  # the other sheet's entry still there
    assert_only_changed(wb.path, dst, {SHEET_PART, "xl/calcChain.xml"})


def test_shared_formula_master_always_refused_child_allowed(wb, tmp_path):
    master = (wb.date_row, FIRST_DATE_COL + 1)  # F13: <f t="shared" ref=...>
    child = (wb.date_row, FIRST_DATE_COL + 2)
    with pytest.raises(xp.FormulaOverwriteError, match="master"):
        patch(wb, tmp_path, {master: "x"}, allow_formula_overwrite=True)
    dst, res = patch(wb, tmp_path, {child: "x"}, allow_formula_overwrite=True)
    assert res.formulas_overwritten == 1
    assert xp.read_cell_texts(dst, SHEET, [child])[child] == "x"


# --- safety / validation -------------------------------------------------------


def test_idempotent_and_noop_when_values_already_present(wb, tmp_path):
    row, col = blank_cell(wb)
    first, _ = patch(wb, tmp_path, {(row, col): "Zebra"})
    second = tmp_path / "second.xlsx"
    res = xp.patch_workbook(first, second, SHEET, {(row, col): "Zebra"})
    assert res.unchanged == 1 and res.changed_parts == ()
    assert diff_packages(first, second).identical
    # and for a value the cell holds through a shared-string reference
    p = wb.people[0]
    d0 = next(d for d in wb.dates() if wb.expected(p.name, d))
    third = tmp_path / "third.xlsx"
    res = xp.patch_workbook(wb.path, third, SHEET, {(p.row, wb.date_col(d0)): wb.expected(p.name, d0)})
    assert res.unchanged == 1 and diff_packages(wb.path, third).identical


def test_refuses_in_place_and_leaves_source_untouched(wb, tmp_path):
    before = wb.path.read_bytes()
    with pytest.raises(xp.XlsxPatchError, match="differ"):
        xp.patch_workbook(wb.path, wb.path, SHEET, {(1, 1): "x"})
    with pytest.raises(xp.XlsxPatchError, match="differ"):
        xp.patch_workbook(wb.path, wb.path.parent / "." / wb.path.name, SHEET, {(1, 1): "x"})
    assert wb.path.read_bytes() == before


def test_source_never_modified_by_normal_patch(wb, tmp_path):
    before = wb.path.read_bytes()
    row, col = blank_cell(wb)
    patch(wb, tmp_path, {(row, col): "P"})
    assert wb.path.read_bytes() == before


def test_overwrite_nonblank_false_refuses_existing_content(wb, tmp_path):
    p = wb.people[0]
    d0 = next(d for d in wb.dates() if wb.expected(p.name, d))
    with pytest.raises(xp.XlsxPatchError, match="not blank"):
        patch(wb, tmp_path, {(p.row, wb.date_col(d0)): "Other"}, overwrite_nonblank=False)
    row, col = blank_cell(wb)
    dst, _ = patch(wb, tmp_path, {(row, col): "Other"}, overwrite_nonblank=False)
    assert xp.read_cell_texts(dst, SHEET, [(row, col)])[(row, col)] == "Other"


def test_input_validation(wb, tmp_path):
    with pytest.raises(TypeError):
        patch(wb, tmp_path, {(16, 5): 5})
    with pytest.raises(ValueError):
        patch(wb, tmp_path, {(16, 5): "bad\x01"})
    with pytest.raises(ValueError):
        patch(wb, tmp_path, {(16, 5): "x" * 40000})
    with pytest.raises(ValueError):
        patch(wb, tmp_path, {(0, 5): "x"})
    with pytest.raises(ValueError):
        patch(wb, tmp_path, {(16, 5): "x", "E16": "y"})
    with pytest.raises(xp.SheetNotFoundError):
        xp.patch_workbook(wb.path, tmp_path / "o.xlsx", "Missing", {(1, 1): "x"})
    assert not (tmp_path / "o.xlsx").exists()


def test_zip_entries_order_compression_and_metadata_preserved(wb, tmp_path):
    row, col = blank_cell(wb)
    dst, _ = patch(wb, tmp_path, {(row, col): "P"})
    with zipfile.ZipFile(wb.path) as a, zipfile.ZipFile(dst) as b:
        ia, ib = a.infolist(), b.infolist()
        assert [i.filename for i in ia] == [i.filename for i in ib]
        assert [i.compress_type for i in ia] == [i.compress_type for i in ib]
        assert [i.date_time for i in ia] == [i.date_time for i in ib]
        assert b.testzip() is None


@pytest.mark.filterwarnings("ignore:.*extension is not supported:UserWarning")
def test_result_opens_in_openpyxl_with_expected_values(wb, tmp_path):
    """Independent consumer check: openpyxl (a different parser) sees the same text."""
    from openpyxl import load_workbook

    row, col = blank_cell(wb)
    dst, _ = patch(wb, tmp_path, {(row, col): "Zebra\nline2", (row, col + 1): None})
    w = load_workbook(dst)
    ws = w[SHEET]
    assert ws.cell(row, col).value == "Zebra\nline2"
    assert ws.cell(row, col + 1).value is None
    assert w["Notes"].sheet_state == "hidden"


# --- scale -----------------------------------------------------------------------


def test_huge_conditional_format_section_is_not_parsed(tmp_path):
    """130k CF rules: read and patch must stay fast and leave them byte-identical."""
    info = build_roster_workbook(tmp_path / "big.xlsx", extra_cf_rules=130_000)
    assert info.path.stat().st_size > 200_000
    t0 = time.perf_counter()
    sheet = xp.load_sheet(info.path, SHEET)
    read_s = time.perf_counter() - t0
    assert sheet.text(info.header_row, 2) == "L2"
    row, col = blank_cell(info)
    t0 = time.perf_counter()
    dst = tmp_path / "big_out.xlsx"
    xp.patch_workbook(info.path, dst, SHEET, {(row, col): "Shift-3"})
    patch_s = time.perf_counter() - t0
    assert read_s < 5 and patch_s < 8, (read_s, patch_s)
    with zipfile.ZipFile(info.path) as a, zipfile.ZipFile(dst) as b:
        xa, xb = a.read(SHEET_PART), b.read(SHEET_PART)
    assert xa[xa.index(b"</sheetData>"):] == xb[xb.index(b"</sheetData>"):]
    assert xb.count(b"<conditionalFormatting") >= 130_000
