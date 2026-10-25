"""
Weekly Aging Report - step 1 of 2.

The raw ServiceNow export (input/incident (*).xlsx) is already filtered by
the user in ServiceNow to items whose "Updated" date is before the cutoff -
exactly 2 weeks (14 days) before whatever day this report is being sent, so
the cutoff always falls on the same weekday as send day (e.g. sent Friday
Aug 21 -> cutoff Friday Aug 7). This script needs no formulas for the aging
logic itself. It does add one plain (non-formula) helper column, "Updated (Day)" -
the "Updated" timestamp with its time-of-day dropped to midnight. That's
necessary for the pivot to group same-day updates into one row: Excel's
PivotField date Group() API proved unreliable when driven headlessly via COM
here (it silently collapsed the whole date range into a single bucket no
matter what interval was requested - confirmed even in an isolated minimal
test workbook), so create_pivot.ps1 uses this pre-truncated column as the
pivot's third row level directly instead - duplicate day values then collapse
into one pivot item on their own, no PivotField grouping call needed at all.

This script also copies the export to output/ under the report's standing
filename, matches the roster in ../../shared/roster/Names.xlsx against the
raw "Assigned to" text (same matching used by weekly-backlog-report - see
../../shared/roster/name_matching.py), and writes a JSON sidecar with the
cutoff date (formatted for the subject/filename) and which raw "Assigned to"
values should be visible in the pivot, for create_pivot.ps1 and
build_email_data.py to consume.

Usage: python build_report.py
"""
import datetime
import glob
import json
import os
import shutil
import sys

import openpyxl

AGENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKSPACE_DIR = os.path.dirname(AGENT_DIR)
INPUT_DIR = os.path.join(AGENT_DIR, "input")
OUTPUT_DIR = os.path.join(AGENT_DIR, "output")
ROSTER_PATH = os.path.join(WORKSPACE_DIR, "shared", "roster", "Names.xlsx")

sys.path.insert(0, os.path.join(WORKSPACE_DIR, "shared", "roster"))
from name_matching import load_roster, match_roster_to_raw  # noqa: E402

CUTOFF_DAYS = 14  # exactly 2 weeks before send day, so cutoff lands on the same weekday


def ordinal(n):
    if 11 <= n % 100 <= 13:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def find_raw_export():
    candidates = glob.glob(os.path.join(INPUT_DIR, "incident (*).xlsx")) + glob.glob(
        os.path.join(INPUT_DIR, "incident(*.xlsx")
    )
    candidates = [c for c in candidates if "~$" not in os.path.basename(c)]
    if not candidates:
        raise SystemExit(
            f'No raw ServiceNow export found in {INPUT_DIR} (expected a file like "incident (19).xlsx")'
        )
    candidates.sort(key=os.path.getmtime, reverse=True)
    return candidates[0]


def main():
    cutoff = datetime.date.today() - datetime.timedelta(days=CUTOFF_DAYS)
    raw_path = find_raw_export()
    print(f"Raw export: {raw_path}")
    print(f"Cutoff date (2 weeks before today, today - {CUTOFF_DAYS} days): {cutoff.isoformat()}")

    out_name = f"last update before_{cutoff.day} {cutoff.strftime('%B %Y')}.xlsx"
    out_path = os.path.join(OUTPUT_DIR, out_name)
    shutil.copyfile(raw_path, out_path)

    wb = openpyxl.load_workbook(out_path)
    ws = wb["Page 1"]
    headers = [ws.cell(row=1, column=c).value for c in range(1, ws.max_column + 1)]
    idx = {h: i + 1 for i, h in enumerate(headers)}
    assigned_col = idx["Assigned to"]
    updated_col = idx["Updated"]

    # "Updated (Day)" helper column - see module docstring for why this
    # exists instead of relying on Excel's own PivotField date grouping.
    day_col = ws.max_column + 1
    ws.cell(row=1, column=day_col, value="Updated (Day)")
    date_only_fmt = "d\\-mmm"
    for r in range(2, ws.max_row + 1):
        updated_val = ws.cell(row=r, column=updated_col).value
        if updated_val is not None:
            day_cell = ws.cell(row=r, column=day_col, value=datetime.datetime(
                updated_val.year, updated_val.month, updated_val.day
            ))
            day_cell.number_format = date_only_fmt
    wb.save(out_path)

    # --- Roster + name matching (same roster/logic as weekly-backlog-report) ---

    roster_names, email_by_roster_name = load_roster(ROSTER_PATH)

    raw_assigned = set()
    for r in range(2, ws.max_row + 1):
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
            f"{len(unmatched_roster)} roster members have no aged items in today's export "
            f"(not an error - they simply have nothing aging right now)."
        )
    not_on_roster = sorted(raw_assigned - set(raw_to_roster.keys()))
    if not_on_roster:
        print(f"{len(not_on_roster)} \"Assigned to\" name(s) in the export are not on the roster: {not_on_roster}")

    sidecar = {
        "output_path": out_path,
        "cutoff_date_filename": f"{cutoff.day} {cutoff.strftime('%B %Y')}",
        "cutoff_date_subject": f"{ordinal(cutoff.day)} {cutoff.strftime('%B')}",
        "cutoff_date_full": f"{ordinal(cutoff.day)} {cutoff.strftime('%B %Y')}",
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
    print("Next: create_pivot.ps1 (no recalc step needed - this workbook has no formulas)")
    return out_path


if __name__ == "__main__":
    main()
