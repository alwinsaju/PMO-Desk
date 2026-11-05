"""Mailer from a table - email data prep.

Reads the table the person uploaded (input/table.xlsx or input/table.csv), fills the
wording from config/mail.json (or from a template in the Templates app, when
config/mail.json names one) and writes output/email-data.json for create_draft.ps1.
Nothing is sent from here.

Usage: python build_email_data.py
"""
import csv
import datetime
import html
import json
import os
import sys

PACK_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INPUT_DIR = os.path.join(PACK_DIR, "input")
OUTPUT_DIR = os.path.join(PACK_DIR, "output")
CONFIG_FILE = os.path.join(PACK_DIR, "config", "mail.json")
SHARED_DIR = os.environ.get("AI_OS_TASKS_SHARED") or os.path.join(os.path.dirname(PACK_DIR), "shared")
MAX_ROWS = 500

sys.path.insert(0, SHARED_DIR)
try:
    from template_lib.library import body_to_html, load_library, load_snippets, render_text  # noqa: E402
except ImportError:  # the shared library is missing: the pack's own wording is used
    body_to_html = load_library = load_snippets = render_text = None


def read_config():
    with open(CONFIG_FILE, encoding="utf-8-sig") as f:
        return json.load(f)


def table_path():
    for name in ("table.xlsx", "table.csv"):
        path = os.path.join(INPUT_DIR, name)
        if os.path.isfile(path):
            return path
    raise SystemExit("No table was uploaded. Add table.xlsx or table.csv and run again.")


def cell_text(value):
    if value is None:
        return ""
    if isinstance(value, datetime.datetime):
        return value.strftime("%d %b %Y") if value.time() == datetime.time(0) else value.strftime("%d %b %Y %H:%M")
    if isinstance(value, datetime.date):
        return value.strftime("%d %b %Y")
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def read_rows(path):
    if path.lower().endswith(".csv"):
        with open(path, newline="", encoding="utf-8-sig") as f:
            rows = [[cell_text(c) for c in row] for row in csv.reader(f)]
    else:
        import openpyxl

        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        try:
            rows = [[cell_text(c) for c in row] for row in wb.worksheets[0].iter_rows(values_only=True)]
        finally:
            wb.close()
    rows = [r for r in rows if any(r)]
    if not rows:
        raise SystemExit("The table is empty.")
    return rows[0], rows[1:]


def pick_columns(header, rows, wanted):
    if not wanted:
        return header, rows
    index = [i for i, name in enumerate(header) if name in wanted]
    if not index:
        raise SystemExit("None of the chosen columns are in the table: " + ", ".join(wanted))
    return [header[i] for i in index], [[r[i] if i < len(r) else "" for i in index] for r in rows]


def table_html(header, rows):
    th = "font-size:10.5pt;font-family:'Aptos Narrow',sans-serif;background:#1F4E79;color:#FFFFFF;border:solid #D9D9D9 1.0pt;padding:2pt 5.4pt;text-align:left"
    td = "font-size:10.5pt;font-family:'Aptos Narrow',sans-serif;color:#2D2D2D;border:solid #D9D9D9 1.0pt;padding:2pt 5.4pt"
    head = "".join(f"<th style=\"{th}\">{html.escape(h)}</th>" for h in header)
    body = "".join(
        "<tr>" + "".join(f"<td style=\"{td}\">{html.escape(c)}</td>" for c in row) + "</tr>"
        for row in rows[:MAX_ROWS]
    )
    cut = (
        f"<p style=\"font-size:10.5pt;font-family:'Aptos Narrow',sans-serif;color:#C00000\">"
        f"Only the first {MAX_ROWS} of {len(rows)} rows are shown here.</p>"
        if len(rows) > MAX_ROWS
        else ""
    )
    return (
        "<table border=1 cellspacing=0 cellpadding=0 style='border-collapse:collapse;border:solid #D9D9D9 1.0pt'>"
        f"<tr>{head}</tr>{body}</table>{cut}"
    )


def template_named(name):
    if not name or load_library is None:
        return None
    for item in load_library():
        if item.get("kind") == "email" and item.get("name") == name:
            return item
    return None


def main():
    config = read_config()
    path = table_path()
    header, rows = pick_columns(*read_rows(path), config.get("columns") or [])
    today = datetime.date.today()
    values = {
        "rows": len(rows),
        "date": today.strftime("%d %B %Y").lstrip("0"),
        "columns": ", ".join(header),
    }
    subject = config.get("subject", "")
    to = config.get("to", "")
    cc = config.get("cc", "")
    body = config.get("body", "")
    template = template_named(config.get("templateName", ""))
    snippets = load_snippets() if load_snippets else None
    if template is not None:
        subject = template.get("subject") or subject
        to = template.get("to") or to
        cc = template.get("cc") or cc
        body = template.get("body") or body
        print(f"Using template: {template.get('name')}")
    elif config.get("templateName"):
        print(f"Template '{config['templateName']}' was not found; using the wording saved with this task.")

    if render_text is not None:
        subject = " ".join(render_text(subject, values, snippets).split())
        to = " ".join(render_text(to, values, snippets).split())
        cc = " ".join(render_text(cc, values, snippets).split())
        body_html = body_to_html(body, values, snippets)
    else:
        subject, body_html = " ".join(subject.split()), "<p>" + html.escape(body) + "</p>"

    warnings = []
    if len(rows) > MAX_ROWS:
        warnings.append(
            f"The table has {len(rows)} rows, but only the first {MAX_ROWS} are in the email. "
            "Turn on “attach the table” if the others must reach the readers."
        )
    if not to:
        warnings.append("No To address is set; add one in Outlook before sending.")

    data = {
        "to": to,
        "cc": cc,
        "subject": subject or "Table update",
        "body_html": body_html,
        "table_html": table_html(header, rows),
        "attachments": [path] if config.get("attachTable") else [],
        "rows": len(rows),
        "warnings": warnings,
    }
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    out = os.path.join(OUTPUT_DIR, "email-data.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    print(f"Saved: {out}")
    print(f"Rows: {len(rows)}, columns: {len(header)}")
    for warning in warnings:
        print(f"WARNING - {warning}")


if __name__ == "__main__":
    main()
