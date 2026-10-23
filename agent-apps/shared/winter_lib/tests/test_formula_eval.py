import pytest
import xlsxwriter

from formula_eval import NA, Evaluator, Unsupported, XlErr


def build(path, formulas, *, sheet2=None):
    """Sheet `Data` (A:D) with fixed content; `formulas` = [(cell, formula, cached)] written on sheet `Out Sheet`."""
    wb = xlsxwriter.Workbook(path)
    data = wb.add_worksheet("Data")
    out = wb.add_worksheet("Out Sheet")
    rows = [("DIS", "Ann", "Shift-1", 3), ("DIS", "Bob", None, 2), ("DEP", "Cy", "NS", 0), ("DEP", "Di", "", 5)]
    for r, (a, b, c, d) in enumerate(rows):
        data.write(r, 0, a)
        data.write(r, 1, b)
        if c is not None:
            data.write_string(r, 2, c)
        data.write_number(r, 3, d)
    data.write_formula(4, 3, "=SUM(D1:D4)", None, 10)
    data.write_column(6, 0, ["Shift-1", "Shift-2"])
    for cell, f, v in formulas:
        out.write_formula(cell, f, None, v)
    wb.close()
    return path


def ev_of(tmp_path, formulas):
    p = build(str(tmp_path / "t.xlsx"), formulas)
    return Evaluator(p)


def val(ev, cell):
    from openpyxl.utils.cell import coordinate_from_string, column_index_from_string
    col, row = coordinate_from_string(cell)
    return ev.value("Out Sheet", row, column_index_from_string(col))


def test_countif_text_wildcard_counts_text_only(tmp_path):
    ev = ev_of(tmp_path, [("A1", '=COUNTIF(Data!C1:C4,"?*")', 2), ("A2", '=COUNTIF(Data!D1:D4,"?*")', 0),
                          ("A3", "=COUNTIF(Data!D1:D4,0)", 1), ("A4", '=COUNTIF(Data!D1:D4,">=3")', 2),
                          ("A5", '=COUNTIF(Data!D1:D4,">="&Data!D2)', 3), ("A6", '=COUNTIF(Data!A1:A4,"dis")', 2),
                          ("A7", '=COUNTIF(Data!C1:C4,"<>")', 2)])
    assert [val(ev, f"A{i}") for i in range(1, 8)] == [2, 0, 1, 2, 3, 2, 2]
    assert ev.check() == []


def test_countifs_sumif_and_sumproduct_broadcast(tmp_path):
    ev = ev_of(tmp_path, [
        ("A1", '=COUNTIFS(Data!A1:A4,"DIS",Data!C1:C4,"?*")', 1),
        ("A2", '=SUMIF(Data!A1:A4,"DEP",Data!D1:D4)', 5),
        ("A3", "=SUMPRODUCT((Data!D1:D4>0)*(Data!A1:A4=\"DIS\"))", 2),
        ("A4", "=SUMPRODUCT(--(Data!D1:D4>=Data!D1:D1))", 2),
        ("A5", "=SUMPRODUCT(--(Data!C1:C2<>\"\"))", 1),
    ])
    assert [val(ev, f"A{i}") for i in range(1, 6)] == [1, 5, 2, 2, 1]  # A4: 3>=3 and 5>=3 (D1 broadcast)
    assert ev.check() == []


def test_names_in_cell_pattern(tmp_path):
    f = ('=MID(IF(ISNUMBER(MATCH(Data!C1,Data!A7:A8,0)),CHAR(10)&Data!B1,"")&'
         'IF(ISNUMBER(MATCH(Data!C2,Data!A7:A8,0)),CHAR(10)&Data!B2,"")&'
         'IF(ISNUMBER(MATCH(Data!C3,Data!A7:A8,0)),CHAR(10)&Data!B3,""),2,2000)')
    ev = ev_of(tmp_path, [("A1", f, "Ann"), ("A2", "=SUMPRODUCT(--ISNUMBER(MATCH(Data!C1:C4,Data!A7:A8,0)))", 1)])
    assert val(ev, "A1") == "Ann"
    assert val(ev, "A2") == 1
    assert ev.check() == []


def test_text_concatenation_and_number_formatting(tmp_path):
    ev = ev_of(tmp_path, [("A1", '=COUNT(Data!D1:D4)&" / "&COUNTA_FAKE', 0)])
    with pytest.raises(Unsupported):
        val(ev, "A1")  # unknown name token cannot be tokenised/evaluated: never a silent wrong answer


def test_string_ops_and_comparison(tmp_path):
    ev = ev_of(tmp_path, [("A1", '=COUNT(Data!D1:D4)&" / "&SUM(Data!D1:D4)', "4 / 10"),
                          ("A2", '=IF(Data!D1=3,"✓ ok"&"!","bad")', "✓ ok!"),
                          ("A3", '=IF(AND(Data!D1>2,Data!D2<3),1,0)+IF(OR(Data!D3=1,Data!D3=0),10,0)', 11),
                          ("A4", '=MAX(Data!D1:D4,7)-MIN(Data!D1:D4)', 7), ("A5", '=1/0', 0),
                          ("A6", '=IFERROR(1/0,"n/a")', "n/a"), ("A7", '=--(Data!D1>1)+-(-1)', 2)])
    assert val(ev, "A1") == "4 / 10" and val(ev, "A2") == "✓ ok!" and val(ev, "A3") == 11 and val(ev, "A4") == 7
    assert isinstance(val(ev, "A5"), XlErr) and val(ev, "A6") == "n/a" and val(ev, "A7") == 2


def test_match_not_found_is_na_and_blank_lookup(tmp_path):
    ev = ev_of(tmp_path, [("A1", "=MATCH(Data!C3,Data!A7:A8,0)", 0), ("A2", "=MATCH(Data!C5,Data!A7:A8,0)", 0)])
    assert val(ev, "A1") == NA and val(ev, "A2") == NA


def test_check_reports_error_and_stale_cached_values(tmp_path):
    ev = ev_of(tmp_path, [("A1", "=1/0", 0), ("A2", "=SUM(Data!D1:D4)", 99), ("A3", "=SUM(Data!D1:D4)", 10)])
    problems = ev.check()
    assert any("A1" in p and "#DIV/0!" in p for p in problems)
    assert any("A2" in p and "cached 99" in p for p in problems)
    assert not any("A3" in p for p in problems)
    assert ev.checked == 4  # three formulas + the SUM on the Data sheet


def test_unsupported_function_fails_loudly(tmp_path):
    ev = ev_of(tmp_path, [("A1", '=TEXTJOIN(",",TRUE,Data!A1:A4)', "")])
    problems = ev.check()
    assert any("unsupported" in p for p in problems)


def test_cross_sheet_dependency_chain(tmp_path):
    ev = ev_of(tmp_path, [("A1", "=Data!D5*2", 20), ("A2", "='Out Sheet'!A1+1", 21)])
    assert val(ev, "A2") == 21 and ev.check() == []
