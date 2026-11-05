"""The "new mailer" wizard: builds a task pack that emails a table.

The person gives a name, the recipients, the wording (or the name of a template in the
Templates app) and which kind of table they will upload each time. The result is an
ordinary checksummed task pack (see taskpacks.py) that the person still has to install,
and whose run stops at the review step like every other mail task.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import taskpacks

TEMPLATE_DIR = Path(__file__).resolve().parent / "pack-templates" / "mailer"
SCRIPTS = ("build_email_data.py", "create_draft.ps1", "send_draft.ps1")
TABLE_TYPES = ("xlsx", "csv")
PACK_VERSION = "1.0"


class WizardError(Exception):
    """The answers cannot make a mailer; the message says what to change."""


def _text(value, limit: int, label: str, required: bool = False) -> str:
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise WizardError(f"{label} must be text.")
    value = value.strip()
    if required and not value:
        raise WizardError(f"{label} is required.")
    if len(value) > limit:
        raise WizardError(f"{label} is longer than {limit} characters.")
    return value


def slug(name: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return cleaned[:40].strip("-")


# One address ("a@b.com" or "Name <a@b.com>") per entry; entries are separated by semicolons.
_ADDRESS_RE = re.compile(r"^(?:[^<>@;]*<)?[^\s<>@;,]+@[^\s<>@;,]+\.[A-Za-z]{2,}>?$")


def _recipients(value, label: str) -> str:
    text = _text(value, 500, label)
    for entry in (part.strip() for part in text.split(";")):
        if not entry or "{{" in entry:  # a template placeholder is filled in on each run
            continue
        if not _ADDRESS_RE.match(entry):
            raise WizardError(
                f"{label} has something that is not an email address: {entry[:60]!r}. "
                "Use one address after another, separated by semicolons (a@x.com; b@x.com)."
            )
    return text


def build_mailer_pack(answers: dict, taken_ids: set[str]) -> tuple[str, bytes]:
    """Returns (pack id, pack zip). `taken_ids` are the ids already in use (built-in and installed)."""
    if not isinstance(answers, dict):
        raise WizardError("Send the answers as an object.")
    name = _text(answers.get("name"), 60, "The name", required=True)
    if len(name) < 3:
        raise WizardError("The name needs at least 3 characters.")
    base = slug(name)
    if len(base) < 2:
        raise WizardError("The name needs letters or digits.")
    pack_id = f"mailer-{base}"
    if pack_id in taken_ids:
        raise WizardError("A task with this name already exists. Choose another name.")
    table_type = answers.get("tableType", "xlsx")
    if table_type not in TABLE_TYPES:
        raise WizardError("The table must be Excel (xlsx) or CSV.")
    columns = answers.get("columns") or []
    if not isinstance(columns, list) or len(columns) > 30:
        raise WizardError("Choose up to 30 columns.")
    config = {
        "templateName": _text(answers.get("templateName"), 80, "The template name"),
        "to": _recipients(answers.get("to"), "To"),
        "cc": _recipients(answers.get("cc"), "Cc"),
        "subject": _text(answers.get("subject"), 200, "The subject"),
        "body": _text(answers.get("body"), 4000, "The message"),
        "columns": [_text(c, 60, "A column name", required=True) for c in columns],
        "attachTable": answers.get("attachTable") is True,
    }
    if not config["templateName"] and not (config["subject"] and config["body"]):
        raise WizardError("Write a subject and a message, or name a template to use.")

    task = {
        "id": pack_id,
        "displayName": name,
        "inputs": [
            {
                "id": "table",
                "label": "Table (Excel)" if table_type == "xlsx" else "Table (CSV)",
                "type": "file",
                "accept": [f".{table_type}"],
                "dest": f"input/table.{table_type}",
                "required": True,
            }
        ],
        "cleanup": {"onComplete": True},
        "steps": [
            {"id": "build_email_data", "type": "python", "cmd": "scripts/build_email_data.py"},
            {
                "id": "create_draft",
                "type": "powershell",
                "cmd": "scripts/create_draft.ps1",
                "args": ["-DataPath", "output/email-data.json"],
                "capturesEntryId": True,
            },
            {"id": "review_gate", "type": "review"},
            {"id": "send_gate", "type": "confirm"},
            {
                "id": "send_draft",
                "type": "powershell",
                "cmd": "scripts/send_draft.ps1",
                "args": ["-DraftToken", "{entryId}"],
            },
        ],
    }
    files: dict[str, bytes] = {
        "task.json": json.dumps(task, indent=2).encode("utf-8"),
        "config/mail.json": json.dumps(config, indent=2).encode("utf-8"),
        "README.md": (
            f"# {name}\n\nMakes an email draft from a table you upload. It stops at the review step; "
            "nothing is sent until you approve it in the Tasks app.\n\n"
            "Edit `config/mail.json` to change the recipients or the wording.\n"
        ).encode("utf-8"),
    }
    for script in SCRIPTS:
        files[f"scripts/{script}"] = (TEMPLATE_DIR / script).read_bytes()
    return pack_id, taskpacks.build_pack(pack_id, name, PACK_VERSION, files)
