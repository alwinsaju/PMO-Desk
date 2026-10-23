"""Apply human Subcategory2 resolutions to the staging workbook.

The in-app review flow (Tasks app -> review panel) writes
output/review-resolutions.json: a list of {"number", "subcategory2"} for the
incidents the human classified. refresh_workbook.ps1 calls this before copying
the staging sheets into the analysis workbook, so the resolved Subcategory2
lands in both the Incidents data and the (now-shrunk) Review Needed sheet.

Rows left unresolved keep whatever prepare_data.py inferred (usually
"Needs Review") and stay on the Review Needed sheet, exactly as before this
feature existed.
"""
import argparse
import json
from pathlib import Path

import openpyxl

SUBCATEGORY2_HEADER = "Subcategory2"
REVIEW_REASON_HEADER = "Review reason"
RESOLVED_NOTE = "Resolved in app"


def load_resolutions(resolutions_path):
    path = Path(resolutions_path)
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    entries = data.get("resolutions", data) if isinstance(data, dict) else data
    resolved = {}
    for entry in entries if isinstance(entries, list) else []:
        number = str(entry.get("number", "")).strip()
        subcategory2 = str(entry.get("subcategory2", "")).strip()
        if number and subcategory2 and subcategory2.lower() != "skip":
            resolved[number] = subcategory2
    return resolved


def apply_to_staging(staging_path, resolutions):
    if not resolutions:
        return 0
    workbook = openpyxl.load_workbook(staging_path)
    incidents = workbook["Incidents"]
    review = workbook["Review Needed"] if "Review Needed" in workbook.sheetnames else None

    inc_headers = [c.value for c in incidents[1]]
    number_col = inc_headers.index("Number") + 1
    sub_col = inc_headers.index(SUBCATEGORY2_HEADER) + 1
    by_number = {
        incidents.cell(row, number_col).value: row
        for row in range(2, incidents.max_row + 1)
    }

    applied = 0
    for number, subcategory2 in resolutions.items():
        row = by_number.get(number)
        if row is None:
            continue
        incidents.cell(row, sub_col).value = subcategory2
        applied += 1

    if review is not None:
        rev_headers = [c.value for c in review[1]]
        rev_number_col = rev_headers.index("Number") + 1
        # Resolved incidents are classified now, so they no longer belong on the
        # review queue - delete those rows outright (bottom-up so deletion doesn't
        # shift the row indexes we haven't visited yet) rather than leaving them
        # flagged. refresh_workbook.ps1 then copies only the genuinely-unresolved
        # rows into the workbook's Review Needed sheet.
        resolved_rows = [
            row
            for row in range(2, review.max_row + 1)
            if review.cell(row, rev_number_col).value in resolutions
        ]
        for row in reversed(resolved_rows):
            review.delete_rows(row, 1)

    workbook.save(staging_path)
    return applied


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--staging", required=True)
    parser.add_argument("--resolutions", required=True)
    args = parser.parse_args()
    applied = apply_to_staging(args.staging, load_resolutions(args.resolutions))
    print(f"Resolutions applied to staging: {applied}")


if __name__ == "__main__":
    main()
