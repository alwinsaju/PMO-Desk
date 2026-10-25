"""
Weekly Backlog Report - Excel processing step 1 of 2.

Reads this week's raw ServiceNow export from input/ (a file matching
"incident (*).xlsx" - ServiceNow's own default export filename) and adds the
Today / Aging in Days / Age Bucket columns, replicating the formulas from
reference/Backlog Incident_19 August 2026.xlsx. Saves the augmented workbook
to output/Backlog Incident_<date>.xlsx and writes a JSON sidecar describing
which raw "Assigned to" values should be visible in the pivot table (i.e.
match the roster in ../../shared/roster/Names.xlsx), for scripts/create_pivot.ps1 to consume.

This script does NOT build the pivot table itself - openpyxl can't reliably
create a native, refreshable Excel PivotTable. scripts/create_pivot.ps1 does
that via Excel COM, using this script's JSON output to know which "Assigned
to" pivot items to filter to.

Usage: python build_report.py
"""
import datetime
import glob
import json
import os
import sys

import openpyxl

AGENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKSPACE_DIR = os.path.dirname(AGENT_DIR)
INPUT_DIR = os.path.join(AGENT_DIR, "input")
OUTPUT_DIR = os.path.join(AGENT_DIR, "output")
ROSTER_PATH = os.path.join(WORKSPACE_DIR, "shared", "roster", "Names.xlsx")

sys.path.insert(0, os.path.join(WORKSPACE_DIR, "shared", "roster"))
from name_matching import load_roster, match_roster_to_raw  # noqa: E402


def find_raw_export():
    candidates = glob.glob(os.path.join(INPUT_DIR, "incident *.xlsx")) + glob.glob(
        os.path.join(INPUT_DIR, "incident(*.xlsx")
    )
    candidates = [c for c in candidates if "~$" not in os.path.basename(c)]
    if not candidates:
        raise SystemExit(
            f'No raw ServiceNow export found in {INPUT_DIR} (expected a file like "incident (18).xlsx")'
        )
    candidates.sort(key=os.path.getmtime, reverse=True)
    return candidates[0]


def main():
    today = datetime.date.today()
    raw_path = find_raw_export()
    print(f"Raw export: {raw_path}")

    wb = openpyxl.load_workbook(raw_path)
    ws = wb["Page 1"]
    headers = [ws.cell(row=1, column=c).value for c in range(1, ws.max_column + 1)]
    if headers[:3] != ["Number", "Requested for", "Opened"]:
        raise SystemExit(f"Unexpected column layout in {raw_path}: {headers}")

    max_row = ws.max_row

    # Shift columns D.. right by 3 to make room for Today / Aging in Days / Age Bucket
    ws.insert_cols(4, 3)
    ws["D1"] = "Today"
    ws["E1"] = "Aging in Days"
    ws["F1"] = "Age Bucket"

    date_fmt = "dd\\-mmm\\-yy\\ hh:mm:ss"
    for r in range(2, max_row + 1):
        ws[f"D{r}"] = "=TODAY()"
        ws[f"D{r}"].number_format = date_fmt
        ws[f"E{r}"] = f"=D{r}-C{r}"
        ws[f"E{r}"].number_format = date_fmt
        ws[f"F{r}"] = (
            f'=_xlfn.IFS(E{r}=" ", " ",AND(E{r}>14,E{r}<31),"15-30 days",'
            f'AND(E{r}>30,E{r}<46),"31-45 days",E{r}>45,">45 days",'
            f'AND(E{r}>-2,E{r}<15)," ")'
        )

    headers = [ws.cell(row=1, column=c).value for c in range(1, ws.max_column + 1)]
    idx = {h: i + 1 for i, h in enumerate(headers)}
    assigned_col = idx["Assigned to"]

    # --- Roster + name matching ---
    roster_names, email_by_roster_name = load_roster(ROSTER_PATH)

    raw_assigned = set()
    for r in range(2, max_row + 1):
        v = ws.cell(row=r, column=assigned_col).value
        if v:
            raw_assigned.add(v.strip())

    raw_to_roster, unmatched_roster, flagged = match_roster_to_raw(roster_names, raw_assigned)

    print(f"\nMatched {len(raw_to_roster)} roster members to today's data.")
    if flagged:
        print("Fuzzy matches used (please confirm these are correct):")
        for name, raw, conf, reason in flagged:
            print(f"  {name!r} -> {raw!r}  (confidence {conf}, {reason})")
    if unmatched_roster:
        print(
            f"{len(unmatched_roster)} roster members have no backlog items in today's export "
            f"(not an error - they simply have nothing assigned right now)."
        )

    out_name = f"Backlog Incident_{today.day} {today.strftime('%B %Y')}.xlsx"
    out_path = os.path.join(OUTPUT_DIR, out_name)
    wb.save(out_path)

    sidecar = {
        "output_path": out_path,
        "date_str": today.strftime("%d %B %Y"),
        "visible_assigned_to": sorted(raw_to_roster.keys()),
        "raw_to_roster": raw_to_roster,
        "email_by_roster_name": email_by_roster_name,
        "unmatched_roster": unmatched_roster,
        "flagged_matches": [
            {"roster_name": n, "raw_name": r, "confidence": c, "reason": reason}
            for n, r, c, reason in flagged
        ],
    }
    sidecar_path = os.path.join(OUTPUT_DIR, "pivot-input.json")
    with open(sidecar_path, "w", encoding="utf-8") as f:
        json.dump(sidecar, f, indent=2)

    print(f"\nSaved: {out_path}")
    print(f"Saved: {sidecar_path}")
    print("Next: Recalc-Workbook.ps1, then create_pivot.ps1")
    return out_path


if __name__ == "__main__":
    main()
