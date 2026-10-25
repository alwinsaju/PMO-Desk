import os

import openpyxl
import pytest

from winter_lib import xlsx_style as xs

LOGO = os.path.join(os.path.dirname(__file__), "..", "..", "assets", "takeda-logo.png")


def _build(path, logo=True):
    wb = xs.new_workbook(path)
    st = xs.Styles(wb)
    ws = wb.add_worksheet("T")
    nxt = xs.banner(ws, st, 9, "Winter Holiday Coverage", "BY TEAM & DAY", "A note line", LOGO if logo else None)
    xs.kpi_tile(ws, st, nxt + 1, 0, 2, "PEOPLE", "=1+1", tone="good", cached=2)
    xs.kpi_tile(ws, st, nxt + 1, 3, 3, "PLAIN", 7)
    for r in range(3):
        ws.write_number(10 + r, 0, 2, st.get("heat_min"))
        for c in range(1, 4):
            ws.write_number(10 + r, c, r, st.get("heat"))
    xs.heatmap_cf(ws, st, 10, 1, 12, 3, 0)
    xs.shift_code_cf(ws, st, 14, 1, 16, 3, ["Shift-1", "NS"])
    ws.write(20, 0, "Christmas", xs.day_chip_format(st, "Christmas"))
    ws.write(21, 0, "x", xs.day_chip_format(st, "unknown label"))
    wb.close()


def test_workbook_defaults_and_banner(tmp_path):
    p = tmp_path / "s.xlsx"
    _build(p)
    wb = openpyxl.load_workbook(p)
    ws = wb["T"]
    assert ws["C1"].font.name == "Arial"
    assert ws["C1"].fill.fgColor.rgb.upper().endswith("282728")
    assert ws["A3"].fill.fgColor.rgb.upper().endswith("86BC25")
    assert ws["A1"].fill.fgColor.rgb.upper().endswith("FFFFFF")
    assert ws.row_dimensions[1].height == 66
    assert len(ws._images) == 1
    assert "A1:B1" in {str(m) for m in ws.merged_cells.ranges}
    assert ws["A5"].value == "PEOPLE" or ws["A6"].value == "PEOPLE"


def test_kpi_tile_formula_and_value(tmp_path):
    p = tmp_path / "s.xlsx"
    _build(p)
    ws = openpyxl.load_workbook(p)["T"]
    cells = {c.value for row in ws.iter_rows() for c in row if c.value is not None}
    assert "=1+1" in cells and 7 in cells
    cached = openpyxl.load_workbook(p, data_only=True)["T"]
    assert 2 in {c.value for row in cached.iter_rows() for c in row}


def test_heatmap_rules_order_and_ranges(tmp_path):
    p = tmp_path / "s.xlsx"
    _build(p)
    ws = openpyxl.load_workbook(p)["T"]
    rules = []
    for cf in ws.conditional_formatting:
        if str(cf.sqref) == "B11:D13":
            rules = [(r.formula[0], r.stopIfTrue) for r in cf.rules]
    assert rules[0][0] == "B11=0" and rules[0][1]
    assert rules[1][0] == "B11>=$A11"
    assert rules[2][0] == "B11<$A11"
    ranges = {str(cf.sqref) for cf in ws.conditional_formatting}
    assert "B15:D17" in ranges


def test_no_logo_still_builds(tmp_path):
    p = tmp_path / "n.xlsx"
    _build(p, logo=False)
    assert len(openpyxl.load_workbook(p)["T"]._images) == 0


def test_styles_cache_and_names():
    wb = xs.xlsxwriter.Workbook(os.devnull)
    st = xs.Styles(wb)
    assert st.get("th") is st.get("th")
    assert st.get("th") is not st.get("th", bold=False)
    assert "chip_morning" in st.names()
    with pytest.raises(KeyError):
        st.get("nope")
    wb.close()


def test_palette_has_brand_colors():
    assert xs.COLORS["dark"] == "#282728" and xs.COLORS["green"] == "#86BC25"
    assert xs.FONT == "Arial"
