"""
Deployment & DEP Weekend Activities Mailer - email data prep.

Reads this week's workbook from input/ (the most recently modified .xlsx
that isn't a "Template - ..." reference file), pulls just the latest dated
block from the "Deployment" sheet - the workbook accumulates one block per
week, so the bottom-most block is this week's, see TASK.md - plus the full
"Activities" sheet (the standing recurring schedule, not week-specific).
Every Point of Contact / Assignee cell is a first-name-only reference (e.g.
"Saranya", "Tushar/Vansh"), resolved against ../../shared/roster/Names.xlsx.
Writes output/email-data.json for create_draft.ps1 to turn into the Outlook
HTML tables.

No filtering or aggregation happens here - the table data is carried as-is,
per the user's explicit instruction that this mailer needs no data
processing, just resolving names and copying the table into the template.

Usage: python build_email_data.py
"""
import datetime
import glob
import html
import json
import os
import re
import sys

import openpyxl

AGENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKSPACE_DIR = os.path.dirname(AGENT_DIR)
INPUT_DIR = os.path.join(AGENT_DIR, "input")
OUTPUT_DIR = os.path.join(AGENT_DIR, "output")
ROSTER_PATH = os.path.join(WORKSPACE_DIR, "shared", "roster", "Names.xlsx")

sys.path.insert(0, os.path.join(WORKSPACE_DIR, "shared"))
from template_lib import Html, apply_email_template  # noqa: E402

# Draft addressing lives here so create_draft.ps1 and the 'Confirm & send' dialog show the same values.
MAIL_TO = "USPDTOperate <uspdtoperate@deloitte.com>"
MAIL_CC = "Peethambaram, Sreela <speethambaram@deloitte.com>; Sarab, Mani Deep <msarab@deloitte.com>; Atchula, Rupavani <ratchula@deloitte.com>"

ORDINAL_SUFFIXES = {1: "st", 2: "nd", 3: "rd"}


def ordinal(n):
    if 11 <= n % 100 <= 13:
        return f"{n}th"
    return f"{n}{ORDINAL_SUFFIXES.get(n % 10, 'th')}"


def body_date_html(body_date):
    """The date as create_draft.ps1 writes it in the message (bold, with a raised ordinal suffix)."""
    if body_date.get("single"):
        inner = f"{body_date['day']}<sup>{body_date['suffix']}</sup> {html.escape(str(body_date['month']))}"
    else:
        inner = html.escape(str(body_date.get("range_text", "")))
    return Html(f"<b><span style='color:black'>{inner}</span></b>")


def find_workbook():
    candidates = [
        f
        for f in glob.glob(os.path.join(INPUT_DIR, "*.xlsx"))
        if "~$" not in os.path.basename(f) and not os.path.basename(f).startswith("Template")
    ]
    if not candidates:
        raise SystemExit(
            f'No workbook found in {INPUT_DIR} (expected this week\'s "Deployment and Activites.xlsx")'
        )
    candidates.sort(key=os.path.getmtime, reverse=True)
    return candidates[0]


def load_roster():
    wb = openpyxl.load_workbook(ROSTER_PATH, data_only=True)
    ws = wb["Sheet1"]
    roster = []
    for r in range(2, ws.max_row + 1):
        name = ws.cell(row=r, column=1).value
        email = ws.cell(row=r, column=2).value
        if name and email:
            roster.append((name.strip(), email.strip()))
    return roster


def build_first_name_index(roster):
    index = {}
    for name, email in roster:
        first = name.split()[0].lower()
        index.setdefault(first, []).append((name, email))
    return index


def resolve_name(raw, roster_by_full_name, first_name_index, unmatched, flagged):
    raw = raw.strip()
    if "," in raw:
        # "Last, First" form (e.g. "Nakka, Naga Siva Kumar") -> roster's "First Last"
        last, _, first_part = raw.partition(",")
        raw = f"{first_part.strip()} {last.strip()}".strip()
    exact = roster_by_full_name.get(raw.lower())
    if exact:
        return exact
    first = raw.split()[0].lower() if raw else ""
    candidates = first_name_index.get(first, [])
    if len(candidates) == 1:
        name, email = candidates[0]
        flagged.append((raw, name, email))
        return (name, email)
    if len(candidates) > 1:
        flagged.append((raw, f"AMBIGUOUS - candidates: {[c[0] for c in candidates]}", None))
        unmatched.append(raw)
        return (raw, None)
    unmatched.append(raw)
    return (raw, None)


def resolve_people(raw_field, roster_by_full_name, first_name_index, unmatched, flagged):
    parts = [p.strip() for p in (raw_field or "").split("/") if p.strip()]
    return [
        resolve_name(p, roster_by_full_name, first_name_index, unmatched, flagged)
        for p in parts
    ]


EXTRA_LINE_RE = re.compile(r"^\s*(Handhelds?|Computer Shortcuts?)\s*[-:\u2013\u2014]\s*(.+?)\s*$", re.IGNORECASE)


def resolve_poc_cell(raw_cell, roster_by_full_name, first_name_index, unmatched, flagged):
    """A Point of Contact cell can be multi-line: the first line(s) are the
    main POC (first names, "/"-separated), and further lines are labelled
    sections such as "Handhelds - Nakka, Naga Siva Kumar" or "Computer
    Shortcuts - Samson, Amos". Returns (main_people, extras) where extras is
    a list of {"label", "people"}."""
    text = str(raw_cell or "").replace("_x000D_", "").replace("\r", "\n")
    main_parts, extras = [], []
    for line in text.split("\n"):
        if not line.strip():
            continue
        m = EXTRA_LINE_RE.match(line)
        if m:
            people = resolve_people(m.group(2), roster_by_full_name, first_name_index, unmatched, flagged)
            extras.append({"label": m.group(1).strip(), "people": [{"name": n, "email": e} for n, e in people]})
        else:
            main_parts.append(line.strip())
    main = resolve_people("/".join(main_parts), roster_by_full_name, first_name_index, unmatched, flagged)
    return main, extras


def forward_fill_merged_column(ws, col, row_range):
    """Merged cells only store their value in the top-left cell - every
    other cell in the range reads back as None via openpyxl. Reconstruct
    the effective value per row for a single column."""
    fill = {}
    for rng in ws.merged_cells.ranges:
        if rng.min_col == col and rng.max_col == col:
            top_value = ws.cell(row=rng.min_row, column=col).value
            for r in range(rng.min_row, rng.max_row + 1):
                fill[r] = top_value
    values = {}
    for r in row_range:
        v = ws.cell(row=r, column=col).value
        values[r] = v if v is not None else fill.get(r)
    return values


def find_latest_deployment_block(ws):
    """Each week's block starts with a full-row merge across columns A-E
    holding the block's title (e.g. "Deployment Activities 08/24/2026").
    The bottom-most such merge is this week's - older blocks stay above as
    history."""
    header_rows = sorted(
        rng.min_row
        for rng in ws.merged_cells.ranges
        if rng.min_row == rng.max_row and rng.min_col == 1 and rng.max_col >= 5
    )
    if not header_rows:
        raise SystemExit(
            'No dated block header found in the "Deployment" sheet (expected a merged A:E title row)'
        )
    title_row = header_rows[-1]
    title = ws.cell(row=title_row, column=1).value
    return title, title_row + 1, title_row + 2  # title, columns_row, data_start


def extract_deployment_rows(ws, roster_by_full_name, first_name_index, unmatched, flagged):
    title, _columns_row, data_start = find_latest_deployment_block(ws)
    data_end = ws.max_row
    while data_end >= data_start and all(
        ws.cell(row=data_end, column=c).value is None for c in range(1, 6)
    ):
        data_end -= 1

    day_col = forward_fill_merged_column(ws, 1, range(data_start, data_end + 1))
    date_col = forward_fill_merged_column(ws, 2, range(data_start, data_end + 1))

    rows = []
    dates = []
    last_key = None
    for r in range(data_start, data_end + 1):
        activity = ws.cell(row=r, column=4).value
        if activity is None:
            continue
        day = day_col.get(r)
        date_val = date_col.get(r)
        time_val = ws.cell(row=r, column=3).value
        poc_raw = ws.cell(row=r, column=5).value

        key = (day, date_val)
        new_group = key != last_key
        last_key = key

        if isinstance(date_val, datetime.datetime):
            d = date_val.date()
            dates.append(d)
            date_str = f"{d.month}/{d.day}/{d.year}"
        else:
            date_str = str(date_val) if date_val else ""

        people, extras = resolve_poc_cell(poc_raw, roster_by_full_name, first_name_index, unmatched, flagged)
        rows.append(
            {
                "day": day or "",
                "date": date_str,
                "new_group": new_group,
                "time": str(time_val or "").strip(),
                "activity": str(activity or "").strip(),
                "people": [{"name": n, "email": e} for n, e in people],
                "extras": extras,
            }
        )

    _assign_rowspans(rows)

    if dates:
        d_min, d_max = min(dates), max(dates)
        if d_min == d_max:
            date_str = f"{d_min.month}/{d_min.day}/{d_min.year}"
            body_date = {"single": True, "day": d_min.day, "suffix": ordinal(d_min.day)[-2:], "month": d_min.strftime("%B")}
        else:
            date_str = f"{d_min.month}/{d_min.day}/{d_min.year} to {d_max.month}/{d_max.day}/{d_max.year}"
            body_date = {"single": False, "range_text": f"{ordinal(d_min.day)} to {ordinal(d_max.day)} {d_max.strftime('%B')}"}
    else:
        date_str = title
        body_date = {"single": False, "range_text": title}

    return rows, date_str, body_date, title


def _assign_rowspans(rows):
    i = 0
    while i < len(rows):
        j = i + 1
        while j < len(rows) and not rows[j]["new_group"]:
            j += 1
        rows[i]["rowspan"] = j - i
        for k in range(i + 1, j):
            rows[k]["rowspan"] = 0
        i = j


def extract_activities(ws, roster_by_full_name, first_name_index, unmatched, flagged):
    last_data_row = 1
    for r in range(1, ws.max_row + 1):
        if any(ws.cell(row=r, column=c).value is not None for c in range(1, 5)):
            last_data_row = r

    section_header_rows = {
        rng.min_row
        for rng in ws.merged_cells.ranges
        if rng.min_row == rng.max_row and rng.min_col == 1 and rng.max_col >= 4
    }

    activity_fill = forward_fill_merged_column(ws, 1, range(2, last_data_row + 1))

    rows = []
    last_activity = None
    for r in range(2, last_data_row + 1):
        if r in section_header_rows:
            rows.append({"type": "section", "label": ws.cell(row=r, column=1).value})
            last_activity = None
            continue
        day = ws.cell(row=r, column=2).value
        time_val = ws.cell(row=r, column=3).value
        assignee_raw = ws.cell(row=r, column=4).value
        if day is None and time_val is None and assignee_raw is None:
            continue
        activity = activity_fill.get(r)
        new_group = activity != last_activity
        last_activity = activity

        people = resolve_people(str(assignee_raw or ""), roster_by_full_name, first_name_index, unmatched, flagged)
        rows.append(
            {
                "type": "data",
                "activity": activity or "",
                "new_group": new_group,
                "day": str(day or "").strip(),
                "time": str(time_val or "").strip(),
                "people": [{"name": n, "email": e} for n, e in people],
            }
        )

    i = 0
    while i < len(rows):
        if rows[i]["type"] != "data":
            i += 1
            continue
        j = i + 1
        while j < len(rows) and rows[j]["type"] == "data" and not rows[j]["new_group"]:
            j += 1
        rows[i]["rowspan"] = j - i
        for k in range(i + 1, j):
            rows[k]["rowspan"] = 0
        i = j

    return rows


def main():
    workbook_path = find_workbook()
    print(f"Workbook: {workbook_path}")

    roster = load_roster()
    roster_by_full_name = {name.lower(): (name, email) for name, email in roster}
    first_name_index = build_first_name_index(roster)

    unmatched, flagged = [], []

    wb = openpyxl.load_workbook(workbook_path, data_only=True)
    deployment_rows, date_str, body_date, block_title = extract_deployment_rows(
        wb["Deployment"], roster_by_full_name, first_name_index, unmatched, flagged
    )
    activities_rows = extract_activities(
        wb["Activities"], roster_by_full_name, first_name_index, unmatched, flagged
    )

    data = {
        "workbook_path": workbook_path,
        "to": MAIL_TO,
        "cc": MAIL_CC,
        "subject": f"Deployment and POC Details {date_str} & DEP Team Schedule",
        "attachments": [],
        "block_title": block_title,
        "date_str": date_str,
        "body_date": body_date,
        "deployment_rows": deployment_rows,
        "activities_rows": activities_rows,
    }
    # A template chosen in the Templates app replaces the subject, recipients and message above.
    apply_email_template(
        "task:deployment-dep-weekend-mailer",
        data,
        {"date": date_str, "body_date": body_date_html(body_date), "title": block_title},
    )
    out_path = os.path.join(OUTPUT_DIR, "email-data.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, default=str)

    print(f"This week's block: {block_title!r} -> subject date {date_str!r}")
    print(f"Saved: {out_path}")
    if flagged:
        print("Names resolved by first-name match (please confirm these are correct):")
        for raw, name, email in flagged:
            print(f"  {raw!r} -> {name!r} ({email})")
    if unmatched:
        print(f"WARNING - could not resolve against roster, will send as plain text: {sorted(set(unmatched))}")


if __name__ == "__main__":
    main()
