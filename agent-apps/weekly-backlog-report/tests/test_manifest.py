"""agent.json: the upload dialog input, the cleanup flag and the untouched pipeline.

Reads the manifest only; nothing here runs a step or talks to Outlook / agent-office. The
backend's own `Task` class is imported (no server, no endpoint) to prove it accepts the manifest
and resolves the input's `dest`."""

import fnmatch
import json
import subprocess
import sys
from pathlib import Path

import pytest

TASK = Path(__file__).resolve().parents[1]
MANIFEST = json.loads((TASK / "agent.json").read_text(encoding="utf-8"))
BACKEND = Path(r"C:\Projects\Agents-workspace\agent-office\backend")

# The pipeline exactly as it was before the upload dialog was added: it must not change.
PREVIOUS_STEPS = [{'id': 'build_report', 'type': 'python', 'cmd': 'scripts/build_report.py'},
 {'id': 'recalc',
  'type': 'powershell',
  'cmd': 'scripts/Recalc-Workbook.ps1',
  'args': ['-SidecarPath', 'output/pivot-input.json']},
 {'id': 'create_pivot',
  'type': 'powershell',
  'cmd': 'scripts/create_pivot.ps1',
  'args': ['-SidecarPath', 'output/pivot-input.json']},
 {'id': 'build_email_data', 'type': 'python', 'cmd': 'scripts/build_email_data.py'},
 {'id': 'create_draft',
  'type': 'powershell',
  'cmd': 'scripts/create_draft.ps1',
  'args': ['-DataPath', 'output/email-data.json'],
  'capturesEntryId': True},
 {'id': 'review_gate', 'type': 'review'},
 {'id': 'send_gate', 'type': 'confirm'},
 {'id': 'send_draft',
  'type': 'powershell',
  'cmd': 'scripts/send_draft.ps1',
  'args': ['-DraftToken', '{entryId}']}]

INPUT_ID = 'incident'
DEST = 'input/incident (1).xlsx'
# the file-name patterns the script really globs for (checked against its source below)
SCRIPT = 'scripts/build_report.py'
SCRIPT_PATTERNS = ['incident *.xlsx', 'incident(*.xlsx']


def test_steps_are_unchanged():
    assert MANIFEST["steps"] == PREVIOUS_STEPS
    assert MANIFEST["id"] == 'weekly-backlog-report' and MANIFEST["displayName"] == 'Backlog Report'
    assert "prepare" not in MANIFEST and "schedule" not in MANIFEST and "runtime" not in MANIFEST


def test_one_required_file_input_opens_the_upload_dialog():
    inputs = MANIFEST["inputs"]
    assert [i["id"] for i in inputs] == [INPUT_ID]
    inp = inputs[0]
    assert inp["type"] == "file" and inp["accept"] == [".xlsx"] and inp["required"] is True
    assert inp["dest"] == DEST and inp["label"]
    # no select input, nothing to prepare: Run goes straight to the upload dialog
    assert all(i["type"] == "file" for i in inputs)
    # the weekly/monthly upload is cleaned after each run, so it is never a persisted input
    assert not inp.get("persist")


def test_dest_matches_the_pattern_the_script_looks_for():
    name = DEST.split("/", 1)[1]
    assert DEST.startswith("input/") and "/" not in name and ".." not in DEST
    assert any(fnmatch.fnmatch(name, pattern) for pattern in SCRIPT_PATTERNS), (name, SCRIPT_PATTERNS)
    source = (TASK / SCRIPT).read_text(encoding="utf-8")
    for pattern in SCRIPT_PATTERNS:
        assert pattern in source, pattern


def test_cleanup_flag_removes_only_the_weekly_upload():
    assert MANIFEST["cleanup"] == {"onComplete": True}  # no `keep`: nothing else lives in input/


@pytest.mark.skipif(not (BACKEND / "main.py").exists(), reason="the agent-office backend is not present")
def test_backend_reads_the_manifest_and_accepts_the_dest():
    code = (
        "import json, sys; sys.path.insert(0, sys.argv[1]);"
        "import main as backend; from pathlib import Path;"
        "m = json.loads(Path(sys.argv[2]).read_text(encoding='utf-8'));"
        "t = backend.Task(m, Path(sys.argv[3]));"
        "d = t.to_dict();"
        "p = backend._resolve_in_task(t, t.inputs[0]['dest'], roots=('input',));"
        "print(json.dumps({'id': d['id'], 'inputs': [(i['id'], i['required']) for i in d['inputs']],"
        " 'prepare': d['prepare'], 'schedule': d['schedule'],"
        " 'steps': [(s['id'], s['type']) for s in d['steps']],"
        " 'dest': str(p.relative_to(Path(sys.argv[3]).resolve())).replace(chr(92), '/')}))"
    )
    done = subprocess.run([sys.executable, "-c", code, str(BACKEND), str(TASK / "agent.json"), str(TASK)],
                          capture_output=True, text=True, timeout=120, cwd=TASK)
    if done.returncode != 0 and "No module named" in done.stderr:
        pytest.skip("the backend's dependencies are not installed in this interpreter: "
                    + done.stderr.strip().splitlines()[-1])
    assert done.returncode == 0, done.stderr[-800:]
    info = json.loads(done.stdout.strip().splitlines()[-1])
    assert info["id"] == 'weekly-backlog-report' and info["inputs"] == [[INPUT_ID, True]]
    assert info["prepare"] is False and info["schedule"] is None
    assert info["steps"] == [[s["id"], s["type"]] for s in PREVIOUS_STEPS]
    assert info["dest"] == DEST
