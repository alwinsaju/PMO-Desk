from pathlib import Path

import openpyxl

from roster_lib import pto_template
from roster_lib.pto_template import write_pto_template


def test_template_structure(tmp_path):
    path = write_pto_template(tmp_path / "pto.xlsx")
    wb = openpyxl.load_workbook(path)
    ws = wb["PTO"]
    assert "EXAMPLE" in ws["A1"].value
    assert [c.value for c in ws[2]] == ["Name", "From", "To", "Code"]
    rows = [r for r in ws.iter_rows(min_row=3, values_only=True) if r[0]]
    assert len(rows) == 3
    assert all(r[1] <= r[2] for r in rows)
    notes = "\n".join(str(c.value) for c in wb["Notes"]["A"] if c.value)
    for phrase in ("weekly offs", "PTO beats HOL", "No replacements"):
        assert phrase in notes


def test_committed_example_matches_structure():
    path = Path(pto_template.__file__).parent / "examples" / "pto_import_template.xlsx"
    ws = openpyxl.load_workbook(path)["PTO"]
    assert [c.value for c in ws[2]] == ["Name", "From", "To", "Code"]
