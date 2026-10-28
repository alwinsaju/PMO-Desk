"""task.json: the upload dialog input, the cleanup flag and the untouched pipeline.

Reads the manifest only; nothing here runs a step or talks to Outlook / the tasks engine. The
tasks engine's own `Task` class is imported (no server, no endpoint) to prove it accepts the manifest
and resolves the input's `dest`."""

import fnmatch
import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

TASK = Path(__file__).resolve().parents[1]
MANIFEST = json.loads((TASK / "task.json").read_text(encoding="utf-8"))
ENGINE = Path(__file__).resolve().parents[3] / "tasks-engine"

# The pipeline exactly as it was before the upload dialog was added: it must not change.
PREVIOUS_STEPS = [{'id': 'prepare_data', 'type': 'python', 'cmd': 'scripts/prepare_data.py'},
 {'id': 'review_incidents', 'type': 'review'},
 {'id': 'refresh_workbook',
  'type': 'powershell',
  'cmd': 'scripts/refresh_workbook.ps1',
  'args': ['-SidecarPath', 'output/report-data.json']},
 {'id': 'review_workbook', 'type': 'review'}]

INPUT_ID = 'incident'
ROSTER_ID = 'roster'
HISTORY_ID = 'history'
DEST = 'input/incident.xlsx'
# the file-name patterns the script really globs for (checked against its source below)
SCRIPT = 'scripts/prepare_data.py'
SCRIPT_PATTERNS = ['incident*.xlsx']


def test_steps_are_unchanged():
    assert MANIFEST["steps"] == PREVIOUS_STEPS
    assert MANIFEST["id"] == 'monthly-report-deck' and MANIFEST["displayName"] == 'Monthly Report deck'
    assert "prepare" not in MANIFEST and "schedule" not in MANIFEST and "runtime" not in MANIFEST


def test_one_required_file_input_opens_the_upload_dialog():
    inputs = MANIFEST["inputs"]
    assert [i["id"] for i in inputs] == [INPUT_ID, ROSTER_ID, HISTORY_ID]
    inp = inputs[0]
    assert inp["type"] == "file" and inp["accept"] == [".xlsx"] and inp["required"] is True
    assert inp["dest"] == DEST and inp["label"]
    # no select input, nothing to prepare: Run goes straight to the upload dialog
    assert all(i["type"] == "file" for i in inputs)
    # the weekly/monthly upload is cleaned after each run, so it is never a persisted input
    assert not inp.get("persist")


def test_previous_workbook_upload_is_found_by_the_script_pattern():
    history = MANIFEST["inputs"][2]
    assert history["required"] is False and history["persist"] is True
    folder, name = history["dest"].split("/", 1)
    assert folder == "reference"
    pattern = re.search(r'MONTHLY_WORKBOOK_PATTERN = "([^"]+)"', (TASK / SCRIPT).read_text(encoding="utf-8")).group(1)
    assert fnmatch.fnmatch(name, pattern)


def test_dest_matches_the_pattern_the_script_looks_for():
    name = DEST.split("/", 1)[1]
    assert DEST.startswith("input/") and "/" not in name and ".." not in DEST
    assert any(fnmatch.fnmatch(name, pattern) for pattern in SCRIPT_PATTERNS), (name, SCRIPT_PATTERNS)
    source = (TASK / SCRIPT).read_text(encoding="utf-8")
    for pattern in SCRIPT_PATTERNS:
        assert pattern in source, pattern


def test_cleanup_flag_removes_only_the_weekly_upload():
    assert MANIFEST["cleanup"] == {"onComplete": True}  # no `keep`: nothing else lives in input/


@pytest.mark.skipif(not (ENGINE / "main.py").exists(), reason="the tasks engine is not present")
def test_engine_reads_the_manifest_and_accepts_the_dest():
    code = (
        "import json, sys; sys.path.insert(0, sys.argv[1]);"
        "import main as engine; from pathlib import Path;"
        "m = json.loads(Path(sys.argv[2]).read_text(encoding='utf-8'));"
        "t = engine.Task(m, Path(sys.argv[3]));"
        "d = t.to_dict();"
        "p = engine._resolve_in_task(t, t.inputs[0]['dest'], roots=('input',));"
        "print(json.dumps({'id': d['id'], 'inputs': [(i['id'], i['required']) for i in d['inputs']],"
        " 'prepare': d['prepare'],"
        " 'steps': [(s['id'], s['type']) for s in d['steps']],"
        " 'dest': str(p.relative_to(Path(sys.argv[3]).resolve())).replace(chr(92), '/')}))"
    )
    done = subprocess.run([sys.executable, "-c", code, str(ENGINE), str(TASK / "task.json"), str(TASK)],
                          capture_output=True, text=True, timeout=120, cwd=TASK)
    if done.returncode != 0 and "No module named" in done.stderr:
        pytest.skip("the engine's dependencies are not installed in this interpreter: "
                    + done.stderr.strip().splitlines()[-1])
    assert done.returncode == 0, done.stderr[-800:]
    info = json.loads(done.stdout.strip().splitlines()[-1])
    assert info["id"] == 'monthly-report-deck' and info["inputs"] == [[INPUT_ID, True], [ROSTER_ID, True], [HISTORY_ID, False]]
    assert info["prepare"] is False
    assert info["steps"] == [[s["id"], s["type"]] for s in PREVIOUS_STEPS]
    assert info["dest"] == DEST
