"""Engine tests: task discovery, the step pipeline, its gates (review / confirm),
retry, reset and the read endpoints."""
import asyncio
import json
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import main as backend


def make_task_folder(root, folder_name, task_id, steps=None):
    folder = root / folder_name
    (folder / "scripts").mkdir(parents=True)
    manifest = {
        "id": task_id,
        "displayName": task_id,
        "steps": steps or [{"id": "noop", "type": "python", "cmd": "scripts/noop.py"}],
    }
    (folder / "task.json").write_text(json.dumps(manifest))
    (folder / "scripts" / "noop.py").write_text("print('ok')")
    return folder


def test_run_step_hides_the_windows_console(monkeypatch, tmp_path):
    received_kwargs = {}

    class FakeProcess:
        returncode = 0
        stdout = ()

        def communicate(self):
            return "", ""

    def fake_popen(_cmd, **kwargs):
        received_kwargs.update(kwargs)
        return FakeProcess()

    monkeypatch.setattr(backend.subprocess, "Popen", fake_popen)

    backend.run_step(
        {"id": "noop", "type": "python", "cmd": "scripts/noop.py"},
        tmp_path,
        None,
    )

    expected = (
        {"creationflags": backend.subprocess.CREATE_NO_WINDOW}
        if backend.sys.platform == "win32"
        else {}
    )
    assert {key: received_kwargs[key] for key in expected} == expected


# --- Regression: rescan must prune tasks whose folder/manifest was deleted ---

# --- Regression: a step that fails to launch must surface as error, not vanish ---

def test_pipeline_surfaces_subprocess_launch_failure(tmp_path):
    folder = tmp_path / "gone-task"
    (folder / "scripts").mkdir(parents=True)
    (folder / "scripts" / "noop.py").write_text("print('ok')")
    task = backend.Task(
        {"id": "gone-task", "steps": [{"id": "noop", "type": "python", "cmd": "scripts/noop.py"}]},
        folder,
    )
    backend.tasks["gone-task"] = task
    shutil.rmtree(folder)  # cwd vanishes before the step can launch

    asyncio.run(backend.run_steps(task, task.steps))

    assert task.state == "error"
    assert task.error
    assert any(n["kind"] == "task.failed" for n in task.notifications)


# --- Regression: unknown ids must return ok:false, not HTTP 500 ---

@pytest.mark.parametrize("action", ["start", "approve", "reject", "send", "reset"])
def test_unknown_task_state_endpoints_return_ok_false(action):
    client = TestClient(backend.app, raise_server_exceptions=False)
    resp = client.post(f"/tasks/ghost/{action}")
    assert resp.status_code == 200
    assert resp.json() == {"ok": False, "reason": "unknown task"}


def test_unknown_task_open_notification_returns_ok_false():
    client = TestClient(backend.app, raise_server_exceptions=False)
    resp = client.post("/tasks/ghost/notifications/whatever/open")
    assert resp.status_code == 200
    assert resp.json() == {"ok": False, "reason": "unknown task"}


# --- Pool model: assignment, parallelism, re-entry, exhaustion, release ---

def test_running_task_cannot_be_restarted(tmp_path):
    make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()
    asyncio.run(backend.start_task("task-a"))

    resp = asyncio.run(backend.start_task("task-a"))

    assert resp["ok"] is False
    assert "working" in resp["reason"]


def test_completed_pipeline_returns_to_resting(tmp_path):
    make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()
    task = backend.tasks["task-a"]

    asyncio.run(backend.run_steps(task, task.steps))

    assert task.state == "resting"


def test_reject_returns_to_resting(tmp_path):
    make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()
    task = backend.tasks["task-a"]
    backend.set_state(task, "awaiting_review", current_step="review_gate")

    resp = asyncio.run(backend.reject_task("task-a"))

    assert resp["ok"]
    assert task.state == "resting"


# --- Rename: display name persists to the manifest ---

# --- Candidate folders for the "Add task" picker ---

# --- Inspect: path guard, reserved names, and the naming suggestion flow ---

# --- Notifications: ring buffer capped at 30 ---

def test_push_notification_trims_to_30(tmp_path):
    make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()
    task = backend.tasks["task-a"]

    for i in range(35):
        backend.push_notification(task, "task.completed", f"t{i}", f"b{i}")

    assert len(task.notifications) == 30
    assert task.notifications[0]["title"] == "t5"
    assert task.notifications[-1]["title"] == "t34"


# --- capturesEntryId: draft id flows from output file into later step args ---

def test_pipeline_captures_entry_id_and_substitutes_into_later_step(tmp_path):
    folder = tmp_path / "mail-task"
    (folder / "scripts").mkdir(parents=True)
    (folder / "output").mkdir()
    (folder / "scripts" / "make_draft.py").write_text(
        "from pathlib import Path\n"
        "Path('output/draft-entry-id.txt').write_text('ENTRY-42')\n"
    )
    (folder / "scripts" / "record_args.py").write_text(
        "import sys\n"
        "from pathlib import Path\n"
        "Path('output/args.txt').write_text(' '.join(sys.argv[1:]))\n"
    )
    steps = [
        {"id": "draft", "type": "python", "cmd": "scripts/make_draft.py", "capturesEntryId": True},
        {"id": "send", "type": "python", "cmd": "scripts/record_args.py", "args": ["-EntryId", "{entryId}"]},
    ]
    task = backend.Task({"id": "mail-task", "steps": steps}, folder)
    backend.tasks["mail-task"] = task

    asyncio.run(backend.run_steps(task, steps))

    assert task.state == "resting"
    assert task.entry_id == "ENTRY-42"
    assert (folder / "output" / "args.txt").read_text() == "-EntryId ENTRY-42"


def test_captures_entry_id_without_file_leaves_entry_id_none(tmp_path):
    steps = [{"id": "draft", "type": "python", "cmd": "scripts/noop.py", "capturesEntryId": True}]
    make_task_folder(tmp_path, "task-a", "task-a", steps=steps)
    backend.discover_tasks()
    task = backend.tasks["task-a"]

    asyncio.run(backend.run_steps(task, task.steps))

    assert task.state == "resting"
    assert task.entry_id is None


# --- Gates: review/confirm pause the pipeline; remaining steps resume it ---

def test_pipeline_pauses_at_review_gate_with_notification(tmp_path):
    steps = [
        {"id": "build", "type": "python", "cmd": "scripts/noop.py"},
        {"id": "review_gate", "type": "review"},
        {"id": "send", "type": "python", "cmd": "scripts/noop.py"},
    ]
    make_task_folder(tmp_path, "task-a", "task-a", steps=steps)
    backend.discover_tasks()
    task = backend.tasks["task-a"]
    backend.set_state(task, "working")

    asyncio.run(backend.run_steps(task, task.steps))

    assert task.state == "awaiting_review"
    assert task.current_step == "review_gate"
    assert any(n["kind"] == "task.review_ready" for n in task.notifications)


def test_pipeline_pauses_at_confirm_gate(tmp_path):
    steps = [
        {"id": "send_gate", "type": "confirm"},
        {"id": "send", "type": "python", "cmd": "scripts/noop.py"},
    ]
    make_task_folder(tmp_path, "task-a", "task-a", steps=steps)
    backend.discover_tasks()
    task = backend.tasks["task-a"]

    asyncio.run(backend.run_steps(task, task.steps))

    assert task.state == "awaiting_send"
    assert task.current_step == "send_gate"


def test_pipeline_resume_after_gate_completes_with_notification(tmp_path):
    steps = [
        {"id": "review_gate", "type": "review"},
        {"id": "send", "type": "python", "cmd": "scripts/noop.py"},
    ]
    make_task_folder(tmp_path, "task-a", "task-a", steps=steps)
    backend.discover_tasks()
    task = backend.tasks["task-a"]
    backend.set_state(task, "working")

    asyncio.run(backend.run_steps(task, task.steps))
    assert task.state == "awaiting_review"
    asyncio.run(backend.run_steps(task, backend._steps_after(task, "review_gate")))

    assert task.state == "resting"
    assert any(n["kind"] == "task.completed" for n in task.notifications)


# --- Step failure modes ---

def test_pipeline_surfaces_unknown_step_type(tmp_path):
    make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()
    task = backend.tasks["task-a"]

    asyncio.run(backend.run_steps(task, [{"id": "mystery", "type": "carrier-pigeon"}]))

    assert task.state == "error"
    assert "unknown step type" in task.error


def test_pipeline_marks_error_when_step_exits_nonzero(tmp_path):
    folder = tmp_path / "fail-task"
    (folder / "scripts").mkdir(parents=True)
    (folder / "scripts" / "boom.py").write_text(
        "import sys; sys.stderr.write('kaboom'); sys.exit(3)"
    )
    task = backend.Task(
        {"id": "fail-task", "steps": [{"id": "boom", "type": "python", "cmd": "scripts/boom.py"}]},
        folder,
    )
    backend.tasks["fail-task"] = task

    asyncio.run(backend.run_steps(task, task.steps))

    assert task.state == "error"
    assert "kaboom" in task.error
    assert task.current_step == "boom"
    assert any(n["kind"] == "task.failed" for n in task.notifications)


def test_pipeline_runs_powershell_step(tmp_path):
    folder = tmp_path / "ps-task"
    (folder / "scripts").mkdir(parents=True)
    (folder / "scripts" / "noop.ps1").write_text("Write-Output 'ok'")
    task = backend.Task(
        {"id": "ps-task", "steps": [{"id": "ps", "type": "powershell", "cmd": "scripts/noop.ps1"}]},
        folder,
    )
    backend.tasks["ps-task"] = task

    asyncio.run(backend.run_steps(task, task.steps))

    assert task.state == "resting"


# --- Gate endpoints: state guards and transitions ---

def test_approve_moves_task_to_awaiting_send(tmp_path):
    steps = [
        {"id": "review_gate", "type": "review"},
        {"id": "send_gate", "type": "confirm"},
    ]
    make_task_folder(tmp_path, "task-a", "task-a", steps=steps)
    backend.discover_tasks()
    task = backend.tasks["task-a"]
    backend.set_state(task, "awaiting_review", current_step="review_gate")

    async def drive():
        resp = await backend.approve_task("task-a")
        assert task.state == "working"
        for _ in range(10):
            await asyncio.sleep(0)
        return resp

    resp = asyncio.run(drive())

    assert resp["ok"]
    assert task.state == "awaiting_send"
    assert task.current_step == "send_gate"


def test_approve_rejects_task_not_awaiting_review(tmp_path):
    make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()

    resp = asyncio.run(backend.approve_task("task-a"))

    assert resp["ok"] is False
    assert "resting" in resp["reason"]


def test_send_completes_pipeline(tmp_path):
    steps = [
        {"id": "send_gate", "type": "confirm"},
        {"id": "send", "type": "python", "cmd": "scripts/noop.py"},
    ]
    make_task_folder(tmp_path, "task-a", "task-a", steps=steps)
    backend.discover_tasks()
    task = backend.tasks["task-a"]
    backend.set_state(task, "awaiting_send", current_step="send_gate")

    async def drive():
        resp = await backend.send_task("task-a")
        assert task.state == "finishing"
        for _ in range(500):
            if task.state == "resting":
                break
            await asyncio.sleep(0.01)
        return resp

    resp = asyncio.run(drive())

    assert resp["ok"]
    assert task.state == "resting"
    assert any(n["kind"] == "task.completed" for n in task.notifications)


def test_send_rejects_task_not_awaiting_send(tmp_path):
    make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()

    resp = asyncio.run(backend.send_task("task-a"))

    assert resp["ok"] is False
    assert "resting" in resp["reason"]


def test_reset_clears_error(tmp_path):
    make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()
    task = backend.tasks["task-a"]
    backend.set_state(task, "error", error="boom", current_step="noop")

    resp = asyncio.run(backend.reset_task("task-a"))

    assert resp["ok"]
    assert task.state == "resting"
    assert task.error is None
    assert task.current_step is None


# --- resolve_output_path: the reviewable artifact behind the Open button ---

def test_resolve_output_path_returns_none_without_email_data(tmp_path):
    make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()
    assert backend.resolve_output_path(backend.tasks["task-a"]) is None


def test_resolve_output_path_returns_none_when_workbook_missing(tmp_path):
    folder = make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()
    (folder / "output").mkdir()
    (folder / "output" / "email-data.json").write_text(
        json.dumps({"workbook_path": str(folder / "gone.xlsx")})
    )
    assert backend.resolve_output_path(backend.tasks["task-a"]) is None


def test_resolve_output_path_returns_workbook_when_present(tmp_path):
    folder = make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()
    workbook = folder / "report.xlsx"
    workbook.write_text("placeholder")
    (folder / "output").mkdir()
    (folder / "output" / "email-data.json").write_text(
        json.dumps({"workbook_path": str(workbook)})
    )
    assert backend.resolve_output_path(backend.tasks["task-a"]) == str(workbook)


def test_resolve_output_path_returns_workbook_from_report_data(tmp_path):
    folder = make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()
    workbook = folder / "report.xlsx"
    workbook.write_text("placeholder")
    (folder / "output").mkdir()
    (folder / "output" / "report-data.json").write_text(
        json.dumps({"workbook_path": str(workbook)})
    )
    assert backend.resolve_output_path(backend.tasks["task-a"]) == str(workbook)


# --- Open-notification: only files inside the task folder may be launched ---

def test_open_notification_rejects_notification_without_output(tmp_path):
    make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()
    task = backend.tasks["task-a"]
    backend.push_notification(task, "task.completed", "t", "b")
    notif_id = task.notifications[0]["id"]
    client = TestClient(backend.app, raise_server_exceptions=False)

    resp = client.post(f"/tasks/task-a/notifications/{notif_id}/open")

    assert resp.json() == {"ok": False, "reason": "no output file for this notification"}


def test_open_notification_rejects_path_outside_task_folder(tmp_path):
    make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()
    task = backend.tasks["task-a"]
    outside = tmp_path / "elsewhere.txt"
    outside.write_text("x")
    backend.push_notification(task, "task.completed", "t", "b", str(outside))
    notif_id = task.notifications[0]["id"]
    client = TestClient(backend.app, raise_server_exceptions=False)

    resp = client.post(f"/tasks/task-a/notifications/{notif_id}/open")

    assert resp.json() == {"ok": False, "reason": "file not available"}


def test_open_notification_launches_file_inside_task_folder(tmp_path, monkeypatch):
    folder = make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()
    task = backend.tasks["task-a"]
    artifact = folder / "report.xlsx"
    artifact.write_text("placeholder")
    backend.push_notification(task, "task.completed", "t", "b", str(artifact))
    notif_id = task.notifications[0]["id"]
    opened = []
    monkeypatch.setattr(backend.os, "startfile", opened.append)
    client = TestClient(backend.app, raise_server_exceptions=False)

    resp = client.post(f"/tasks/task-a/notifications/{notif_id}/open")

    assert resp.json() == {"ok": True}
    assert opened == [str(artifact.resolve())]


# --- suggest_name_via_ollama: parse model output, fall back deterministically ---

class _FakeOllamaResponse:
    def __init__(self, response_text):
        self._body = json.dumps({"response": response_text}).encode()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self):
        return self._body


# --- Misc endpoint coverage: rescan count, serialization, bad manifests ---

def test_list_endpoint_serializes_tasks(tmp_path):
    make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()
    client = TestClient(backend.app, raise_server_exceptions=False)

    (task,) = client.get("/tasks").json()

    assert task["id"] == "task-a" and task["state"] == "resting"
    assert set(task) == {
        "id", "displayName", "state", "error", "currentStep", "steps", "notifications",
        "inputs", "prepare", "cleanup",
    }
    assert client.get("/agents").status_code == 404


def test_reject_rejects_task_not_awaiting_review(tmp_path):
    make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()

    resp = asyncio.run(backend.reject_task("task-a"))

    assert resp["ok"] is False
    assert "resting" in resp["reason"]


def test_resolve_output_path_returns_none_when_email_data_corrupt(tmp_path):
    folder = make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()
    (folder / "output").mkdir()
    (folder / "output" / "email-data.json").write_text("{ not json")

    assert backend.resolve_output_path(backend.tasks["task-a"]) is None


def test_open_with_default_app_uses_open_on_macos(monkeypatch):
    monkeypatch.setattr(backend.platform, "system", lambda: "Darwin")
    popen_calls = []
    monkeypatch.setattr(backend.subprocess, "Popen", lambda cmd, **kw: popen_calls.append(cmd))

    backend._open_with_default_app("/tmp/x.pdf")

    assert popen_calls == [["open", "/tmp/x.pdf"]]


def test_open_with_default_app_uses_xdg_open_on_linux(monkeypatch):
    monkeypatch.setattr(backend.platform, "system", lambda: "Linux")
    popen_calls = []
    monkeypatch.setattr(backend.subprocess, "Popen", lambda cmd, **kw: popen_calls.append(cmd))

    backend._open_with_default_app("/tmp/x.pdf")

    assert popen_calls == [["xdg-open", "/tmp/x.pdf"]]


# --- open_notification_output: gate checks are real, platform open is mocked ---
# (unknown task id is covered above by test_unknown_task_open_notification_returns_ok_false)

def test_open_notification_without_output_path_returns_ok_false(tmp_path):
    make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()
    task = backend.tasks["task-a"]
    backend.push_notification(task, "task.completed", "done", "body")  # no output_path
    notif_id = task.notifications[0]["id"]

    client = TestClient(backend.app, raise_server_exceptions=False)
    resp = client.post(f"/tasks/task-a/notifications/{notif_id}/open")

    assert resp.status_code == 200
    assert resp.json() == {"ok": False, "reason": "no output file for this notification"}


def test_open_notification_happy_path_opens_file(tmp_path, monkeypatch):
    folder = make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()
    task = backend.tasks["task-a"]
    out_file = folder / "output" / "report.xlsx"
    out_file.parent.mkdir()
    out_file.write_text("data")
    backend.push_notification(task, "task.review_ready", "ready", "body", str(out_file))
    notif_id = task.notifications[0]["id"]
    opened = []
    monkeypatch.setattr(backend, "_open_with_default_app", opened.append)

    client = TestClient(backend.app, raise_server_exceptions=False)
    resp = client.post(f"/tasks/task-a/notifications/{notif_id}/open")

    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    assert opened == [str(out_file.resolve())]


# --- Regression: {entryId} substitution must not crash on other braces in args ---
# (str.format would raise KeyError on e.g. a JSON payload arg)

def test_entryid_substitution_tolerates_braces(tmp_path):
    (tmp_path / "scripts").mkdir()
    (tmp_path / "scripts" / "noop.py").write_text("print('ok')")
    step = {"id": "send", "type": "python", "cmd": "scripts/noop.py",
            "args": ["-EntryId", "{entryId}", "{\"json\": true}"]}
    result = backend.run_step(step, tmp_path, "ABC123")
    assert result.returncode == 0


# --- Regression: _steps_after must degrade to ok:false when the gate id is gone ---
# (rescan refreshes steps on live tasks; editing a manifest mid-gate used to 500)

def test_approve_with_stale_gate_returns_ok_false(tmp_path):
    folder = make_task_folder(tmp_path, "task-a", "task-a",
                              steps=[{"id": "noop", "type": "python", "cmd": "scripts/noop.py"},
                                     {"id": "review_gate", "type": "review"}])
    backend.discover_tasks()
    task = backend.tasks["task-a"]
    backend.set_state(task, "awaiting_review", current_step="review_gate")
    # Manifest edited mid-gate: the review gate no longer exists.
    (folder / "task.json").write_text(json.dumps(
        {"id": "task-a", "steps": [{"id": "noop", "type": "python", "cmd": "scripts/noop.py"}]}))
    task.apply_manifest(json.loads((folder / "task.json").read_text()))

    client = TestClient(backend.app, raise_server_exceptions=False)
    resp = client.post("/tasks/task-a/approve")

    assert resp.status_code == 200
    assert resp.json()["ok"] is False


# --- per-step log capture + endpoint ---

def test_task_log_captures_local_step_output(tmp_path):
    (tmp_path / "task-a" / "scripts").mkdir(parents=True)
    (tmp_path / "task-a" / "scripts" / "emit.py").write_text(
        "import sys; print('hello stdout'); print('oops stderr', file=sys.stderr)"
    )
    (tmp_path / "task-a" / "task.json").write_text(json.dumps(
        {"id": "task-a", "steps": [{"id": "emit", "type": "python", "cmd": "scripts/emit.py"}]}))
    backend.discover_tasks()
    task = backend.tasks["task-a"]

    asyncio.run(backend.run_steps(task, task.steps))

    streams = {(e["step"], e["stream"]) for e in task.step_output}
    assert ("emit", "stdout") in streams and ("emit", "stderr") in streams
    assert any("hello stdout" in e["text"] for e in task.step_output)


def test_task_log_endpoint_and_unknown_task(tmp_path):
    make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()
    task = backend.tasks["task-a"]
    task.log_step("build", "stdout", "line one")

    client = TestClient(backend.app, raise_server_exceptions=False)
    resp = client.get("/tasks/task-a/log")
    assert resp.status_code == 200
    assert resp.json() == [{"step": "build", "stream": "stdout", "text": "line one"}]
    assert client.get("/tasks/ghost/log").json() == {"ok": False, "reason": "unknown task"}


def test_step_output_cleared_on_new_run(tmp_path):
    make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()
    task = backend.tasks["task-a"]
    task.log_step("old", "stdout", "stale")

    resp = asyncio.run(backend.start_task("task-a"))

    # The stale entry must be gone. step_output is no longer guaranteed empty
    # right after start: stdout now streams live into the log DURING the step
    # (that's the point), so by the time start_task returns the step may have
    # already emitted its "ok" line. What matters is that the pre-run "stale"
    # entry was cleared - any entries present are from the current run only.
    assert resp["ok"]
    assert all(e["step"] != "old" for e in task.step_output)
