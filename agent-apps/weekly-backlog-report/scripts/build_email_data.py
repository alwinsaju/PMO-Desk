"""
Weekly Backlog Report - email data prep.

Reads the finished pivot workbook (output/Backlog Incident_<date>.xlsx,
after build_report.py + Recalc-Workbook.ps1 + create_pivot.ps1) and the
roster email map already present in output/pivot-input.json. It writes
output/email-data.json for create_draft.ps1 to turn into the actual Outlook
HTML table (name-display resolution against the Exchange directory happens
there, via Outlook COM).

Usage: python build_email_data.py
"""
import json
import os
import sys

import openpyxl

AGENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKSPACE_DIR = os.path.dirname(AGENT_DIR)
OUTPUT_DIR = os.path.join(AGENT_DIR, "output")

sys.path.insert(0, os.path.join(WORKSPACE_DIR, "shared", "roster"))
from name_matching import load_roster  # noqa: E402


def main():
    sidecar_path = os.path.join(OUTPUT_DIR, "pivot-input.json")
    with open(sidecar_path, encoding="utf-8") as f:
        sidecar = json.load(f)

    workbook_path = sidecar["output_path"]
    raw_to_roster = sidecar["raw_to_roster"]
    email_by_roster_name = sidecar.get("email_by_roster_name")
    if email_by_roster_name is None:
        _, email_by_roster_name = load_roster(
            os.path.join(WORKSPACE_DIR, "shared", "roster", "Names.xlsx")
        )

    wb = openpyxl.load_workbook(workbook_path, data_only=True)
    ws = wb["Sheet1"]

    rows = []
    r = 5  # first priority row, per create_pivot.ps1's fixed layout (header at row 3-4)
    while True:
        label = ws.cell(row=r, column=1).value
        if label is None:
            break
        vals = [ws.cell(row=r, column=c).value or 0 for c in (2, 3, 4)]
        total = ws.cell(row=r, column=5).value or 0
        is_name_row = ws.cell(row=r, column=1).alignment.indent == 1
        if label == "Grand Total":
            row_type = "grand_total"
        elif is_name_row:
            row_type = "name"
        else:
            row_type = "priority"

        entry = {"type": row_type, "label": label, "values": vals, "total": total}
        if row_type == "name":
            roster_name = raw_to_roster.get(label, label)
            entry["email"] = email_by_roster_name.get(roster_name, "")
        rows.append(entry)
        r += 1

    grand_total_row = next(row for row in rows if row["type"] == "grand_total")

    data = {
        "workbook_path": workbook_path,
        "date_str": sidecar["date_str"],
        "grand_total": grand_total_row["total"],
        "rows": rows,
    }
    out_path = os.path.join(OUTPUT_DIR, "email-data.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    print(f"Saved: {out_path}")
    print(f"Grand total: {data['grand_total']} incidents, {sum(1 for r in rows if r['type']=='name')} people")
    no_email = [r["label"] for r in rows if r["type"] == "name" and not r.get("email")]
    if no_email:
        print(f"WARNING - no email on file for: {no_email}")


if __name__ == "__main__":
    main()
