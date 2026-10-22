"""
Example PTO import workbook (synthetic rows only).

Columns: Name | From | To | Code (defaults to `P`). A "Notes" sheet explains the
rules the roster builder applies: PTO is written only on days the person would
work, never on weekly offs; PTO beats HOL; no replacements are arranged.
"""

from __future__ import annotations

import datetime as _dt
from pathlib import Path

import openpyxl
from openpyxl.styles import Font, PatternFill

PTO_SHEET_NAME = "PTO"


def write_pto_template(path: str | Path) -> Path:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = PTO_SHEET_NAME
    ws.cell(1, 1, "EXAMPLE - synthetic names and dates; replace with real PTO requests. "
                  "Code defaults to P when blank.").font = Font(bold=True, color="C00000")
    for j, title in enumerate(["Name", "From", "To", "Code"], start=1):
        c = ws.cell(2, j, title)
        c.font = Font(bold=True)
        c.fill = PatternFill("solid", fgColor="D9D9D9")
    examples = [
        ("Alice Test", _dt.date(2026, 12, 21), _dt.date(2026, 12, 25), "P"),
        ("Bob Sample", _dt.date(2026, 12, 28), _dt.date(2027, 1, 1), None),
        ("Carol Example", _dt.date(2027, 1, 11), _dt.date(2027, 1, 11), "P"),
    ]
    for i, (name, start, end, code) in enumerate(examples, start=3):
        ws.cell(i, 1, name)
        ws.cell(i, 2, start).number_format = "dd-mmm-yyyy"
        ws.cell(i, 3, end).number_format = "dd-mmm-yyyy"
        if code:
            ws.cell(i, 4, code)
    for col, width in zip("ABCD", (24, 14, 14, 8)):
        ws.column_dimensions[col].width = width
    notes = wb.create_sheet("Notes")
    for i, line in enumerate([
        "EXAMPLE FILE - synthetic data.",
        "One row per leave request: Name, From, To (inclusive), Code (default P).",
        "PTO is written only on days the person would work in that cycle; weekly offs stay as they are.",
        "PTO beats HOL: if a holiday falls inside the range, the person shows P, not HOL.",
        "No replacements are arranged for PTO; coverage gaps are reported, not filled.",
    ], start=1):
        notes.cell(i, 1, line)
    notes.column_dimensions["A"].width = 100
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(path)
    return path


if __name__ == "__main__":
    print(write_pto_template(Path(__file__).parent / "examples" / "pto_import_template.xlsx"))
