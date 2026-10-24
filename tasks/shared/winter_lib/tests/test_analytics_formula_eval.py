from datetime import date

import pytest
import xlsxwriter

from winter_lib.analytics_formula_eval import ExcelError, Workbook, check_workbook_formulas, parse_formula


def build(path, formulas, *, cached=None):
    """Sheet1 holds data in A1:D6; `formulas` is {cell: formula} written on Sheet2."""
    wb = xlsxwriter.Workbook(str(path))
    s1 = wb.add_worksheet("Data Sheet")
    s2 = wb.add_worksheet("Calc")
    rows = [
        ["Name", "Slot", "Day", "Qty"],
        ["Ann", "S1", date(2026, 12, 25), 1],
        ["Bob", "On call", date(2026, 12, 25), 2],
        ["Ann", "S2", date(2026, 12, 26), 3],
        [None, "S1", date(2026, 12, 26), 4],
        ["ann", "On call", date(2026, 12, 27), 5],
    ]
    dfmt = wb.add_format({"num_format": "yyyy-mm-dd"})
    for r, row in enumerate(rows):
        for c, v in enumerate(row):
            if isinstance(v, date):
                s1.write_datetime(r, c, __import__("datetime").datetime(v.year, v.month, v.day), dfmt)
            elif v is not None:
                s1.write(r, c, v)
    for cell, f in formulas.items():
        s2.write_formula(cell, f, None, (cached or {}).get(cell, 0))
    wb.close()


def evaluate(tmp_path, formulas):
    p = tmp_path / "t.xlsx"
    build(p, formulas)
    return Workbook(p).evaluate_all()


def val(res, cell):
    from openpyxl.utils.cell import coordinate_from_string, column_index_from_string
    col, row = coordinate_from_string(cell)
    return res[("Calc", row, column_index_from_string(col))]


def test_countif_family_and_wildcards(tmp_path):
    f = {
        "A1": "=COUNTIF('Data Sheet'!$A$2:$A$6,\"ann\")",  # case-insensitive
        "A2": "=COUNTIFS('Data Sheet'!$A$2:$A$6,\"Ann\",'Data Sheet'!$B$2:$B$6,\"<>On call\")",
        "A3": "=COUNTIFS('Data Sheet'!$B$2:$B$6,\"S?\")",
        "A4": "=COUNTIFS('Data Sheet'!$A$2:$A$6,\"?*\")",  # non-empty text only
        "A5": "=COUNTIF('Data Sheet'!$D$2:$D$6,\">=3\")",
        "A6": "=COUNTIF('Data Sheet'!$C$2:$C$6,'Data Sheet'!C2)",  # date criterion
        "A7": "=COUNTA('Data Sheet'!$A$2:$A$6)",
        "A8": "=COUNTIF('Data Sheet'!$B$2:$B$6,\"<>On call\")",
    }
    r = evaluate(tmp_path, f)
    assert [val(r, f"A{i}") for i in range(1, 9)] == [3, 2, 3, 4, 3, 2, 4, 3]


def test_lookup_text_and_logic(tmp_path):
    f = {
        "A1": "=MATCH(\"Bob\",'Data Sheet'!$A$2:$A$6,0)",
        "A2": "=IFERROR(INDEX('Data Sheet'!$B$2:$B$6,MATCH(\"Bob\",'Data Sheet'!$A$2:$A$6,0)),\"-\")",
        "A3": "=IFERROR(INDEX('Data Sheet'!$B$2:$B$6,MATCH(\"Zed\",'Data Sheet'!$A$2:$A$6,0)),\"-\")",
        "A4": "=ISNA(MATCH(\"Zed\",'Data Sheet'!$A$2:$A$6,0))",
        "A5": "=INDEX('Data Sheet'!$A$2:$D$6,2,4)",
        "A6": "=\"x\"&'Data Sheet'!C2&\"|\"&1.5",
        "A7": "=TRIM(\"  a   b \")&MID(\"hello\",2,3)",
        "A8": "=IF(AND(1<2,\"a\"=\"A\"),\"yes\",\"no\")&IF(OR(1>2,'Data Sheet'!A5=\"\"),\"!\",\"?\")",
        "A9": "=\"a\"&CHAR(10)&\"b\"",
        "A10": "=(2+3)*4-6/3",
    }
    r = evaluate(tmp_path, f)
    assert val(r, "A1") == 2 and val(r, "A2") == "On call" and val(r, "A3") == "-"
    assert val(r, "A4") is True and val(r, "A5") == 2
    assert val(r, "A6") == "x46381|1.5"  # a date is a serial number in a text join
    assert val(r, "A7") == "a bell"
    assert val(r, "A8") == "yes!"
    assert val(r, "A9") == "a\nb"
    assert val(r, "A10") == 18


def test_errors_are_values_and_unsupported_is_flagged(tmp_path):
    f = {
        "A1": "=INDEX('Data Sheet'!$A$2:$A$6,99)",
        "A2": "=1/0",
        "A3": "=VLOOKUP(1,'Data Sheet'!A1:B2,2,0)",
        "A4": "=IFERROR(1/0,\"safe\")",
        "A5": "='Nope'!A1",
    }
    r = evaluate(tmp_path, f)
    assert isinstance(val(r, "A1"), ExcelError) and val(r, "A1").code == "#REF!"
    assert val(r, "A2").code == "#DIV/0!"
    assert "UNSUPPORTED" in val(r, "A3").code
    assert val(r, "A4") == "safe"
    assert val(r, "A5").code == "#REF!"


def test_check_detects_cached_mismatch_and_errors(tmp_path):
    p = tmp_path / "t.xlsx"
    build(p, {"A1": "=COUNTA('Data Sheet'!$A$2:$A$6)", "A2": "=1/0"}, cached={"A1": 4})
    chk = check_workbook_formulas(p)
    assert chk.formula_count == 2
    assert len(chk.errors) == 1 and "DIV/0" in chk.errors[0]
    assert chk.mismatches == []  # A1 cached 4 == 4
    build(p, {"A1": "=COUNTA('Data Sheet'!$A$2:$A$6)"}, cached={"A1": 5})
    chk = check_workbook_formulas(p)
    assert chk.errors == [] and len(chk.mismatches) == 1 and not chk.ok


def test_parse_rejects_garbage():
    with pytest.raises(Exception):
        parse_formula("=1 +* )")
