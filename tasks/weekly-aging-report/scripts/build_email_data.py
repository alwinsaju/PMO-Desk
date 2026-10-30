"""
Weekly Aging Report - email data prep.

Reads the finished pivot workbook (output/last update before_<date>.xlsx,
after build_report.py + create_pivot.ps1) and output/pivot-input.json, and
flattens the pivot's 3-level rows (Priority > Assigned to > Updated date)
into output/email-data.json for create_draft.ps1 to render as HTML.

Joins each "name" row's raw "Assigned to" text to its roster email via
pivot-input.json's raw_to_roster and email_by_roster_name mappings (both
built by build_report.py from ../../shared/roster/Names.xlsx) - the same
approach as the backlog report's build_email_data.py. Since create_pivot.ps1
already filtered the pivot to roster-matched names only, every "name" row
here should resolve to an email; create_draft.ps1 still has an
Exchange-lookup-by-name fallback for the rare edge case where it doesn't.

Usage: python build_email_data.py
"""
import datetime
import json
import os
import sys

import openpyxl

AGENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKSPACE_DIR = os.path.dirname(AGENT_DIR)
OUTPUT_DIR = os.path.join(AGENT_DIR, "output")

sys.path.insert(0, os.path.join(WORKSPACE_DIR, "shared", "roster"))
sys.path.insert(0, os.path.join(WORKSPACE_DIR, "shared"))
from name_matching import load_roster  # noqa: E402
from template_lib import apply_email_template  # noqa: E402

# Draft addressing lives here so create_draft.ps1 and the 'Confirm & send' dialog show the same values.
MAIL_TO = "USPDTOperate <uspdtoperate@deloitte.com>"
MAIL_CC = "Peethambaram, Sreela <speethambaram@deloitte.com>; Atchula, Rupavani <ratchula@deloitte.com>; Sarab, Mani Deep <msarab@deloitte.com>"


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
    r = 4  # first priority row, per create_pivot.ps1's fixed layout (header at row 3)
    while True:
        cell = ws.cell(row=r, column=1)
        label = cell.value
        if label is None:
            break
        count = ws.cell(row=r, column=2).value or 0
        indent = cell.alignment.indent or 0

        # The "Updated" pivot field's cells hold real datetimes - the "d-mmm"
        # number format set in create_pivot.ps1 only affects Excel's own
        # display, not the value openpyxl reads, so format it the same way
        # here (e.g. "23-Jul") for the HTML table.
        if isinstance(label, (datetime.date, datetime.datetime)):
            label = f"{label.day}-{label.strftime('%b')}"

        if label == "Grand Total":
            row_type = "grand_total"
        elif indent == 0:
            row_type = "priority"
        elif indent == 1:
            row_type = "name"
        else:
            row_type = "date"

        entry = {"type": row_type, "label": label, "count": count}
        if row_type == "name":
            roster_name = raw_to_roster.get(label, label)
            email = email_by_roster_name.get(roster_name)
            if email:
                entry["email"] = email
        rows.append(entry)
        r += 1

    grand_total_row = next(row for row in rows if row["type"] == "grand_total")

    data = {
        "workbook_path": workbook_path,
        "to": MAIL_TO,
        "cc": MAIL_CC,
        "subject": f"Aging Incidents | Last updated before {sidecar['cutoff_date_subject']}",
        "attachments": [os.path.basename(workbook_path)],
        "date_str_subject": sidecar["cutoff_date_subject"],
        "date_str_full": sidecar["cutoff_date_full"],
        "grand_total": grand_total_row["count"],
        "rows": rows,
    }
    # A template chosen in the Templates app replaces the subject, recipients and message above.
    apply_email_template(
        "task:weekly-aging-report",
        data,
        {
            "date_subject": sidecar["cutoff_date_subject"],
            "date_full": sidecar["cutoff_date_full"],
            "total": grand_total_row["count"],
            "people": sum(1 for row in rows if row["type"] == "name"),
        },
    )
    out_path = os.path.join(OUTPUT_DIR, "email-data.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    print(f"Saved: {out_path}")
    print(f"Grand total: {data['grand_total']} incidents, {sum(1 for r in rows if r['type']=='name')} people")
    no_email = [r["label"] for r in rows if r["type"] == "name" and "email" not in r]
    if no_email:
        print(f"WARNING - no roster email on file for: {no_email}")


if __name__ == "__main__":
    main()
