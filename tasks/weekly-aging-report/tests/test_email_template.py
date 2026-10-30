"""build_email_data.py with a template from the Template library.

Runs the real script on a synthetic pivot workbook in a temp copy of the task, with
AI_OS_TEMPLATES_DIR pointing at a throwaway library. Nothing here touches Outlook, the
tasks engine or the real output folder."""

import datetime
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import openpyxl
import pytest
from openpyxl.styles import Alignment

TASK = Path(__file__).resolve().parents[1]
SHARED = TASK.parent / "shared"
KEY = "task:weekly-aging-report"


@pytest.fixture()
def workdir(tmp_path):
    """A copy of the task's scripts and the two shared modules the script imports."""
    agent = tmp_path / "weekly-aging-report"
    shutil.copytree(TASK / "scripts", agent / "scripts", ignore=shutil.ignore_patterns("__pycache__"))
    (agent / "output").mkdir()
    shutil.copytree(SHARED / "template_lib", tmp_path / "shared" / "template_lib",
                    ignore=shutil.ignore_patterns("tests", "__pycache__", "pytest.ini"))
    (tmp_path / "shared" / "roster").mkdir()
    shutil.copy(SHARED / "roster" / "name_matching.py", tmp_path / "shared" / "roster" / "name_matching.py")

    workbook = agent / "output" / "last update before_5 August 2026.xlsx"
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Sheet1"
    ws.cell(row=3, column=1, value="Row Labels")
    ws.cell(row=3, column=2, value="Count of Number")
    rows = [
        ("1 - Critical", 3, 0),
        ("Doe, Jane", 2, 1),
        (datetime.datetime(2026, 7, 23), 2, 2),
        ("Roe, Rick", 1, 1),
        (datetime.datetime(2026, 7, 24), 1, 2),
        ("Grand Total", 3, 0),
    ]
    for offset, (label, count, indent) in enumerate(rows):
        ws.cell(row=4 + offset, column=1, value=label).alignment = Alignment(indent=indent)
        ws.cell(row=4 + offset, column=2, value=count)
    wb.save(workbook)

    (agent / "output" / "pivot-input.json").write_text(json.dumps({
        "output_path": str(workbook),
        "cutoff_date_subject": "5th August",
        "cutoff_date_full": "5th August 2026",
        "raw_to_roster": {"Doe, Jane": "Jane Doe", "Roe, Rick": "Rick Roe"},
        "email_by_roster_name": {"Jane Doe": "jane@example.com", "Rick Roe": "rick@example.com"},
    }), encoding="utf-8")
    return agent


def run(agent, templates_dir=None):
    env = {**os.environ, "PYTHONUTF8": "1"}
    env.pop("AI_OS_TEMPLATES_DIR", None)
    env.pop("AI_OS_PMO_DATA_DIR", None)
    if templates_dir is not None:
        env["AI_OS_TEMPLATES_DIR"] = str(templates_dir)
    done = subprocess.run([sys.executable, str(agent / "scripts" / "build_email_data.py")],
                          capture_output=True, text=True, env=env, cwd=agent)
    assert done.returncode == 0, done.stderr + done.stdout
    data = json.loads((agent / "output" / "email-data.json").read_text(encoding="utf-8"))
    return data, done.stdout


def library(folder, **over):
    template = {
        "id": "tpl_0123456789ab", "name": "My aging email", "kind": "email",
        "subject": "Aged | {{date_subject}} | {{total}}", "to": "boss@example.com", "cc": "",
        "body": "Hi all,\n\n**{{total}} incidents** across {{people}} people, before {{date_full}}.",
        "usedBy": [KEY],
    }
    template.update(over)
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "library.json").write_text(json.dumps({"version": 1, "templates": [template]}), encoding="utf-8")


def test_without_a_template_the_scripts_own_wording_is_kept(workdir, tmp_path):
    data, _ = run(workdir, tmp_path / "no-library")
    assert data["subject"] == "Aging Incidents | Last updated before 5th August"
    assert data["to"].startswith("USPDTOperate")
    assert "body_html" not in data
    assert data["grand_total"] == 3


def test_a_template_sets_the_subject_recipient_and_message(workdir, tmp_path):
    library(tmp_path / "tpl")
    data, out = run(workdir, tmp_path / "tpl")
    assert data["subject"] == "Aged | 5th August | 3"
    assert data["to"] == "boss@example.com"
    assert data["cc"].startswith("Peethambaram")  # blank in the template: the task's own
    assert "<b>3 incidents</b> across 2 people, before 5th August 2026." in data["body_html"]
    assert data["rows"][0]["type"] == "priority"  # the table data is untouched
    assert "Using template: My aging email" in out


def test_a_template_for_another_task_is_ignored(workdir, tmp_path):
    library(tmp_path / "tpl", usedBy=["task:weekly-backlog-report"])
    data, _ = run(workdir, tmp_path / "tpl")
    assert data["subject"].startswith("Aging Incidents")
    assert "body_html" not in data


def test_a_damaged_library_falls_back_to_the_scripts_wording(workdir, tmp_path):
    (tmp_path / "tpl").mkdir()
    (tmp_path / "tpl" / "library.json").write_text("{ nope", encoding="utf-8")
    data, _ = run(workdir, tmp_path / "tpl")
    assert data["subject"].startswith("Aging Incidents")


@pytest.mark.parametrize("task", ["weekly-aging-report", "weekly-backlog-report", "deployment-dep-weekend-mailer"])
def test_every_mailer_script_asks_for_its_own_template_key(task):
    source = (TASK.parent / task / "scripts" / "build_email_data.py").read_text(encoding="utf-8")
    assert "from template_lib import" in source
    assert f'"task:{task}"' in source
    assert 'os.path.join(WORKSPACE_DIR, "shared")' in source
    compile(source, task, "exec")


@pytest.mark.parametrize("task", ["weekly-aging-report", "weekly-backlog-report", "deployment-dep-weekend-mailer"])
def test_every_draft_script_uses_the_templates_message_when_there_is_one(task):
    source = (TASK.parent / task / "scripts" / "create_draft.ps1").read_text(encoding="utf-8")
    assert "if ($data.body_html)" in source
    assert "$introHtml" in source
