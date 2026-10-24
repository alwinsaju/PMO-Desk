"""Backend tests: the three original regression bugs plus the task/worker
pool model (auto-assignment, parallelism, re-entry, pool exhaustion, release)."""
import asyncio
import json
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import main as backend


@pytest.fixture(autouse=True)
def isolate_state(tmp_path, monkeypatch):
    saved_tasks = dict(backend.tasks)
    saved_enabled = backend.session_manager.enabled
    backend.tasks.clear()
    for w in backend.workers.values():
        w.current_task_id = None
    # Tests must never spawn or talk to a real Claude CLI - the local
    # subprocess path is the default under test; CLI-path tests inject fakes.
    backend.session_manager.enabled = False
    monkeypatch.setattr(backend, "WORKSPACE_ROOT", tmp_path)
    # task discovery now reads TASKS_ROOT, not WORKSPACE_ROOT - isolate it too
    monkeypatch.setattr(backend, "TASKS_ROOT", tmp_path)
    # run history lands in tmp too - the real history.jsonl stays untouched
    monkeypatch.setattr(backend, "HISTORY_FILE", tmp_path / "history.jsonl")
    yield
    backend.tasks.clear()
    backend.tasks.update(saved_tasks)
    backend.session_manager.enabled = saved_enabled
    for w in backend.workers.values():
        w.current_task_id = None


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

def test_rescan_removes_task_whose_folder_was_deleted(tmp_path):
    folder = make_task_folder(tmp_path, "temp-task", "temp-task")
    backend.discover_tasks()
    assert "temp-task" in backend.tasks

    shutil.rmtree(folder)
    backend.rescan_tasks()

    assert "temp-task" not in backend.tasks


def test_rescan_removes_task_whose_manifest_was_deleted(tmp_path):
    folder = make_task_folder(tmp_path, "temp-task", "temp-task")
    backend.discover_tasks()
    assert "temp-task" in backend.tasks

    (folder / "task.json").unlink()
    backend.rescan_tasks()

    assert "temp-task" not in backend.tasks


def test_rescan_keeps_and_updates_live_tasks(tmp_path):
    folder = make_task_folder(tmp_path, "temp-task", "temp-task")
    backend.discover_tasks()
    task = backend.tasks["temp-task"]
    task.state = "working"  # mid-pipeline state must survive a rescan

    manifest = json.loads((folder / "task.json").read_text())
    manifest["displayName"] = "Renamed Task"
    (folder / "task.json").write_text(json.dumps(manifest))
    backend.rescan_tasks()

    assert backend.tasks["temp-task"] is task
    assert task.display_name == "Renamed Task"
    assert task.state == "working"


def test_rescan_pruning_releases_the_worker(tmp_path):
    folder = make_task_folder(tmp_path, "temp-task", "temp-task")
    backend.discover_tasks()
    task = backend.tasks["temp-task"]
    backend.assign_worker(task, backend.workers["adam"])

    shutil.rmtree(folder)
    backend.rescan_tasks()

    assert backend.workers["adam"].current_task_id is None


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

    asyncio.run(backend.run_pipeline(task, task.steps))

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

def test_start_assigns_first_idle_worker(tmp_path):
    make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()

    resp = asyncio.run(backend.start_task("task-a"))

    assert resp["ok"] and resp["agent"] == "adam"
    assert backend.tasks["task-a"].assigned_agent_id == "adam"
    assert backend.workers["adam"].current_task_id == "task-a"


def test_parallel_tasks_get_different_workers(tmp_path):
    make_task_folder(tmp_path, "task-a", "task-a")
    make_task_folder(tmp_path, "task-b", "task-b")
    backend.discover_tasks()

    asyncio.run(backend.start_task("task-a"))
    resp = asyncio.run(backend.start_task("task-b"))

    assert resp["ok"] and resp["agent"] == "ash"
    assert backend.workers["adam"].current_task_id == "task-a"
    assert backend.workers["ash"].current_task_id == "task-b"


def test_running_task_cannot_be_restarted(tmp_path):
    make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()
    asyncio.run(backend.start_task("task-a"))

    resp = asyncio.run(backend.start_task("task-a"))

    assert resp["ok"] is False
    assert "working" in resp["reason"]


def test_start_fails_when_no_workers_idle(tmp_path):
    for i in range(len(backend.workers) + 1):
        make_task_folder(tmp_path, f"task-{i}", f"task-{i}")
    backend.discover_tasks()
    for i in range(len(backend.workers)):
        asyncio.run(backend.start_task(f"task-{i}"))

    resp = asyncio.run(backend.start_task(f"task-{len(backend.workers)}"))

    assert resp == {"ok": False, "reason": "no idle agents"}


def test_completed_pipeline_releases_worker(tmp_path):
    make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()
    task = backend.tasks["task-a"]
    backend.assign_worker(task, backend.workers["adam"])

    asyncio.run(backend.run_pipeline(task, task.steps))

    assert task.state == "resting"
    assert task.assigned_agent_id is None
    assert backend.workers["adam"].current_task_id is None


def test_reject_releases_worker(tmp_path):
    make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()
    task = backend.tasks["task-a"]
    backend.assign_worker(task, backend.workers["lucy"])
    backend.set_state(task, "awaiting_review", current_step="review_gate")

    resp = asyncio.run(backend.reject_task("task-a"))

    assert resp["ok"]
    assert task.state == "resting"
    assert task.assigned_agent_id is None
    assert backend.workers["lucy"].current_task_id is None


def test_retry_after_error_keeps_same_worker(tmp_path):
    make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()
    task = backend.tasks["task-a"]
    backend.assign_worker(task, backend.workers["nancy"])
    backend.set_state(task, "error", error="boom", current_step="noop")

    resp = asyncio.run(backend.start_task("task-a"))

    assert resp["ok"] and resp["agent"] == "nancy"


# --- Rename: display name persists to the manifest ---

def test_rename_persists_display_name_to_manifest(tmp_path):
    folder = make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()
    client = TestClient(backend.app, raise_server_exceptions=False)

    resp = client.post("/tasks/task-a/rename", json={"displayName": "Weekend Report Bot"})

    assert resp.json() == {"ok": True}
    assert backend.tasks["task-a"].display_name == "Weekend Report Bot"
    manifest = json.loads((folder / "task.json").read_text())
    assert manifest["displayName"] == "Weekend Report Bot"


def test_rename_rejects_blank_name(tmp_path):
    folder = make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()
    client = TestClient(backend.app, raise_server_exceptions=False)

    resp = client.post("/tasks/task-a/rename", json={"displayName": "   "})

    assert resp.json() == {"ok": False, "reason": "name cannot be empty"}
    manifest = json.loads((folder / "task.json").read_text())
    assert manifest["displayName"] == "task-a"


def test_unknown_task_rename_returns_ok_false():
    client = TestClient(backend.app, raise_server_exceptions=False)
    resp = client.post("/tasks/ghost/rename", json={"displayName": "X"})
    assert resp.status_code == 200
    assert resp.json() == {"ok": False, "reason": "unknown task"}


# --- Candidate folders for the "Add task" picker ---

def test_candidate_folders_excludes_registered_reserved_and_hidden(tmp_path):
    make_task_folder(tmp_path, "registered-task", "registered-task")
    (tmp_path / "shared").mkdir()
    (tmp_path / ".hidden").mkdir()
    (tmp_path / "plain-candidate").mkdir()
    backend.discover_tasks()
    late = tmp_path / "late-folder"
    late.mkdir()
    (late / "task.json").write_text(json.dumps({"id": "late", "steps": []}))
    client = TestClient(backend.app, raise_server_exceptions=False)

    body = client.get("/tasks/candidate-folders").json()

    by_name = {f["name"]: f for f in body}
    assert set(by_name) == {"plain-candidate", "late-folder"}
    assert by_name["plain-candidate"]["hasManifest"] is False
    assert by_name["late-folder"]["hasManifest"] is True


# --- Inspect: path guard, reserved names, and the naming suggestion flow ---

def test_inspect_rejects_path_traversal():
    client = TestClient(backend.app, raise_server_exceptions=False)
    resp = client.post("/tasks/inspect", json={"folder": ".."})
    assert resp.json() == {"ok": False, "reason": "path must be inside the tasks root"}


def test_inspect_rejects_absolute_path_outside_workspace(tmp_path):
    client = TestClient(backend.app, raise_server_exceptions=False)
    resp = client.post("/tasks/inspect", json={"folder": str(tmp_path.parent)})
    assert resp.json() == {"ok": False, "reason": "path must be inside the tasks root"}


def test_inspect_rejects_missing_folder():
    client = TestClient(backend.app, raise_server_exceptions=False)
    resp = client.post("/tasks/inspect", json={"folder": "does-not-exist"})
    assert resp.json() == {"ok": False, "reason": "folder not found"}


def test_inspect_rejects_reserved_folder_name(tmp_path):
    (tmp_path / "shared").mkdir()
    client = TestClient(backend.app, raise_server_exceptions=False)
    resp = client.post("/tasks/inspect", json={"folder": "shared"})
    assert resp.json() == {"ok": False, "reason": "reserved folder name"}


def _stub_ollama(monkeypatch, name="Stub Name", description="stub desc"):
    monkeypatch.setattr(
        backend,
        "suggest_name_via_ollama",
        lambda folder_name, context: {"name": name, "description": description},
    )


def test_inspect_returns_suggestion_for_valid_folder(tmp_path, monkeypatch):
    cand = tmp_path / "new-agent"
    (cand / "scripts").mkdir(parents=True)
    (cand / "TASK.md").write_text("# New Agent\nDoes things.")
    (cand / "scripts" / "run.py").write_text('"""Run the thing."""\nprint(1)')
    _stub_ollama(monkeypatch)
    client = TestClient(backend.app, raise_server_exceptions=False)

    body = client.post("/tasks/inspect", json={"folder": "new-agent"}).json()

    assert body["ok"] is True
    assert body["hasManifest"] is False
    assert body["existingId"] is None
    assert body["suggestedName"] == "Stub Name"
    assert body["suggestedDescription"] == "stub desc"


def test_inspect_reports_existing_manifest(tmp_path, monkeypatch):
    cand = tmp_path / "existing-agent"
    cand.mkdir()
    (cand / "task.json").write_text(
        json.dumps({"id": "eid", "displayName": "Existing Name", "steps": []})
    )
    _stub_ollama(monkeypatch)
    client = TestClient(backend.app, raise_server_exceptions=False)

    body = client.post("/tasks/inspect", json={"folder": "existing-agent"}).json()

    assert body["ok"] is True
    assert body["hasManifest"] is True
    assert body["existingId"] == "eid"
    assert body["existingDisplayName"] == "Existing Name"


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

    asyncio.run(backend.run_pipeline(task, steps))

    assert task.state == "resting"
    assert task.entry_id == "ENTRY-42"
    assert (folder / "output" / "args.txt").read_text() == "-EntryId ENTRY-42"


def test_captures_entry_id_without_file_leaves_entry_id_none(tmp_path):
    steps = [{"id": "draft", "type": "python", "cmd": "scripts/noop.py", "capturesEntryId": True}]
    make_task_folder(tmp_path, "task-a", "task-a", steps=steps)
    backend.discover_tasks()
    task = backend.tasks["task-a"]

    asyncio.run(backend.run_pipeline(task, task.steps))

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
    backend.assign_worker(task, backend.workers["adam"])
    backend.set_state(task, "working")

    asyncio.run(backend.run_pipeline(task, task.steps))

    assert task.state == "awaiting_review"
    assert task.current_step == "review_gate"
    assert any(n["kind"] == "task.review_ready" for n in task.notifications)
    assert backend.workers["adam"].current_task_id == "task-a"


def test_pipeline_pauses_at_confirm_gate(tmp_path):
    steps = [
        {"id": "send_gate", "type": "confirm"},
        {"id": "send", "type": "python", "cmd": "scripts/noop.py"},
    ]
    make_task_folder(tmp_path, "task-a", "task-a", steps=steps)
    backend.discover_tasks()
    task = backend.tasks["task-a"]

    asyncio.run(backend.run_pipeline(task, task.steps))

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
    backend.assign_worker(task, backend.workers["ash"])
    backend.set_state(task, "working")

    asyncio.run(backend.run_pipeline(task, task.steps))
    assert task.state == "awaiting_review"
    asyncio.run(backend.run_pipeline(task, backend._steps_after(task, "review_gate")))

    assert task.state == "resting"
    assert any(n["kind"] == "task.completed" for n in task.notifications)
    assert backend.workers["ash"].current_task_id is None


# --- Step failure modes ---

def test_pipeline_surfaces_unknown_step_type(tmp_path):
    make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()
    task = backend.tasks["task-a"]

    asyncio.run(backend.run_pipeline(task, [{"id": "mystery", "type": "carrier-pigeon"}]))

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
    backend.assign_worker(task, backend.workers["adam"])

    asyncio.run(backend.run_pipeline(task, task.steps))

    assert task.state == "error"
    assert "kaboom" in task.error
    assert task.current_step == "boom"
    # error keeps the assignment so Retry reuses the same worker
    assert task.assigned_agent_id == "adam"
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

    asyncio.run(backend.run_pipeline(task, task.steps))

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
    backend.assign_worker(task, backend.workers["adam"])
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


def test_send_completes_pipeline_and_releases_worker(tmp_path):
    steps = [
        {"id": "send_gate", "type": "confirm"},
        {"id": "send", "type": "python", "cmd": "scripts/noop.py"},
    ]
    make_task_folder(tmp_path, "task-a", "task-a", steps=steps)
    backend.discover_tasks()
    task = backend.tasks["task-a"]
    backend.assign_worker(task, backend.workers["lucy"])
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
    assert task.assigned_agent_id is None
    assert backend.workers["lucy"].current_task_id is None
    assert any(n["kind"] == "task.completed" for n in task.notifications)


def test_send_rejects_task_not_awaiting_send(tmp_path):
    make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()

    resp = asyncio.run(backend.send_task("task-a"))

    assert resp["ok"] is False
    assert "resting" in resp["reason"]


def test_reset_clears_error_and_releases_worker(tmp_path):
    make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()
    task = backend.tasks["task-a"]
    backend.assign_worker(task, backend.workers["adam"])
    backend.set_state(task, "error", error="boom", current_step="noop")

    resp = asyncio.run(backend.reset_task("task-a"))

    assert resp["ok"]
    assert task.state == "resting"
    assert task.error is None
    assert task.current_step is None
    assert task.assigned_agent_id is None
    assert backend.workers["adam"].current_task_id is None


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


def test_suggest_name_parses_ollama_json_and_fixes_casing(monkeypatch):
    monkeypatch.setattr(
        backend.urllib.request,
        "urlopen",
        lambda req, timeout=None: _FakeOllamaResponse(
            '{"name": "StubBot", "description": "does stubs"}'
        ),
    )

    result = backend.suggest_name_via_ollama("stub-folder", "some context")

    assert result == {"name": "Stub Bot", "description": "does stubs"}


def test_suggest_name_falls_back_when_ollama_unreachable(monkeypatch):
    def refuse(req, timeout=None):
        raise backend.urllib.error.URLError("connection refused")

    monkeypatch.setattr(backend.urllib.request, "urlopen", refuse)

    result = backend.suggest_name_via_ollama("my-cool-folder", "some context")

    assert result == {"name": "My Cool Folder", "description": ""}


def test_suggest_name_falls_back_on_unparseable_response(monkeypatch):
    monkeypatch.setattr(
        backend.urllib.request,
        "urlopen",
        lambda req, timeout=None: _FakeOllamaResponse("no json here"),
    )

    result = backend.suggest_name_via_ollama("my-folder", "some context")

    assert result == {"name": "My Folder", "description": ""}


def test_suggest_name_never_calls_network_without_context(monkeypatch):
    def fail(req, timeout=None):
        raise AssertionError("urlopen must not be called")

    monkeypatch.setattr(backend.urllib.request, "urlopen", fail)

    assert backend.suggest_name_via_ollama("my-folder", "   ") == {
        "name": "My Folder",
        "description": "",
    }


# --- Misc endpoint coverage: rescan count, serialization, bad manifests ---

def test_rescan_endpoint_reports_task_count(tmp_path):
    make_task_folder(tmp_path, "task-a", "task-a")
    client = TestClient(backend.app, raise_server_exceptions=False)

    resp = client.post("/tasks/rescan")

    assert resp.json() == {"ok": True, "count": 1}


def test_rescan_skips_folder_with_invalid_manifest(tmp_path):
    bad = tmp_path / "bad-task"
    bad.mkdir()
    (bad / "task.json").write_text("{ not json")
    (tmp_path / "stray-file.txt").write_text("x")
    (tmp_path / "shared").mkdir()

    backend.rescan_tasks()

    assert "bad-task" not in backend.tasks


def test_list_endpoints_serialize_tasks_and_workers(tmp_path):
    make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()
    task = backend.tasks["task-a"]
    backend.assign_worker(task, backend.workers["adam"])
    client = TestClient(backend.app, raise_server_exceptions=False)

    tasks_body = client.get("/tasks").json()
    agents_body = client.get("/agents").json()

    assert tasks_body[0]["id"] == "task-a"
    adam = next(a for a in agents_body if a["id"] == "adam")
    assert adam["currentTaskId"] == "task-a"
    assert adam["currentTaskName"] == "task-a"
    idle = next(a for a in agents_body if a["id"] == "ash")
    assert idle["state"] == "resting"
    assert idle["currentTaskId"] is None


def test_reject_rejects_task_not_awaiting_review(tmp_path):
    make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()

    resp = asyncio.run(backend.reject_task("task-a"))

    assert resp["ok"] is False
    assert "resting" in resp["reason"]


def test_suggest_name_falls_back_when_matched_json_is_invalid(monkeypatch):
    monkeypatch.setattr(
        backend.urllib.request,
        "urlopen",
        lambda req, timeout=None: _FakeOllamaResponse("{not valid json}"),
    )

    result = backend.suggest_name_via_ollama("my-folder", "some context")

    assert result == {"name": "My Folder", "description": ""}


def test_resolve_output_path_returns_none_when_email_data_corrupt(tmp_path):
    folder = make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()
    (folder / "output").mkdir()
    (folder / "output" / "email-data.json").write_text("{ not json")

    assert backend.resolve_output_path(backend.tasks["task-a"]) is None


def test_inspect_tolerates_unparseable_manifest(tmp_path, monkeypatch):
    cand = tmp_path / "corrupt-agent"
    cand.mkdir()
    (cand / "task.json").write_text("{ not json")
    _stub_ollama(monkeypatch)
    client = TestClient(backend.app, raise_server_exceptions=False)

    body = client.post("/tasks/inspect", json={"folder": "corrupt-agent"}).json()

    assert body["ok"] is True
    assert body["hasManifest"] is True
    assert body["existingId"] is None
    assert body["existingDisplayName"] is None


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
    backend.rescan_tasks()

    client = TestClient(backend.app, raise_server_exceptions=False)
    resp = client.post("/tasks/task-a/approve")

    assert resp.status_code == 200
    assert resp.json()["ok"] is False


# --- Worker pool discovery from agents/ folders ---

def test_discover_workers_from_folders(tmp_path):
    agents_dir = tmp_path / "agents"
    (agents_dir / "marco").mkdir(parents=True)
    (agents_dir / "marco" / "agent.json").write_text(json.dumps(
        {"id": "marco", "displayName": "Marco", "avatar": "marco.png"}))
    (agents_dir / "marco" / "agent.md").write_text("# Marco\nPersona text.")
    (agents_dir / "marco" / "session.json").write_text(json.dumps({"model": "claude-sonnet-4-6"}))
    (agents_dir / "broken").mkdir()
    (agents_dir / "broken" / "agent.json").write_text("{not json")

    found = backend.discover_workers(agents_dir)

    assert list(found) == ["marco"]  # malformed folder skipped, not fatal
    assert found["marco"].display_name == "Marco"
    assert "Persona text." in found["marco"].persona
    assert found["marco"].session_config["model"] == "claude-sonnet-4-6"


def test_discover_workers_missing_agents_dir(tmp_path):
    assert backend.discover_workers(tmp_path / "no-such-dir") == {}


def test_agents_dir_is_not_a_task_candidate(tmp_path):
    (tmp_path / "agents" / "adam").mkdir(parents=True)
    (tmp_path / "agents" / "adam" / "agent.json").write_text(json.dumps({"id": "adam", "steps": []}))
    backend.rescan_tasks()
    assert "adam" not in backend.tasks


# --- Claude CLI runtime path (fake session; no real CLI in tests) ---

import types


class FakeSession:
    """Stands in for ClaudeSession: scripted stdout events, recorded sends."""

    def __init__(self, events):
        self._events = list(events)
        self.sent = []
        self.tasks_run = 0
        self.worker = types.SimpleNamespace(session_config={"step_timeout_seconds": 5})

    @property
    def alive(self):
        return True

    def send(self, text):
        self.sent.append(text)

    async def next_event(self, timeout):
        if not self._events:
            raise backend.sm.ClaudeSessionError("script exhausted")
        return self._events.pop(0)


def assistant_text(text):
    return {"type": "assistant", "message": {"content": [{"type": "text", "text": text}]}}


RESULT_OK = {"type": "result", "subtype": "success", "is_error": False, "result": "done"}


def use_fake_session(monkeypatch, fake):
    stub = types.SimpleNamespace(
        enabled=True,
        ensure=lambda worker: fake,
        get=lambda worker_id: fake,
    )
    monkeypatch.setattr(backend, "session_manager", stub)


def make_gated_task(tmp_path, task_id="task-cli"):
    return make_task_folder(tmp_path, task_id, task_id, steps=[
        {"id": "build", "type": "python", "cmd": "scripts/noop.py"},
        {"id": "review_gate", "type": "review"},
        {"id": "send_gate", "type": "confirm"},
        {"id": "ship", "type": "python", "cmd": "scripts/noop.py"},
    ])


def test_claude_full_run_completes_and_releases_worker(tmp_path, monkeypatch):
    make_task_folder(tmp_path, "task-cli", "task-cli")
    backend.discover_tasks()
    task = backend.tasks["task-cli"]
    backend.assign_worker(task, backend.workers["adam"])
    fake = FakeSession([assistant_text("AO_STEP_DONE noop"), RESULT_OK])
    use_fake_session(monkeypatch, fake)

    asyncio.run(backend.run_pipeline(task, task.steps))

    assert task.state == "resting"
    assert task.runtime == "claude"
    assert task.completed_steps == {"noop"}
    assert backend.workers["adam"].current_task_id is None
    assert any(n["kind"] == "task.completed" for n in task.notifications)
    assert fake.sent and "New task assignment" in fake.sent[0]


def test_claude_gates_pause_and_resume_via_endpoints(tmp_path, monkeypatch):
    make_gated_task(tmp_path)
    backend.discover_tasks()
    task = backend.tasks["task-cli"]
    backend.assign_worker(task, backend.workers["lucy"])
    # Turn 1: run the first step, then pause at the review gate. The turn's
    # result arrives after the gate marker - the watcher has detached by then,
    # so it stays queued as the resume path's ready signal.
    fake = FakeSession([assistant_text("AO_STEP_DONE build\nAO_GATE review"), RESULT_OK])
    use_fake_session(monkeypatch, fake)

    asyncio.run(backend.run_pipeline(task, task.steps))
    assert task.state == "awaiting_review"
    assert task.current_step == "review_gate"
    assert any(n["kind"] == "task.review_ready" for n in task.notifications)

    async def drive():
        await backend.approve_task("task-cli")
        # _resume_claude waits for turn 1's result, then sends the decision
        # and watches turn 2: pauses at the confirm gate.
        await asyncio.sleep(0.2)
        assert task.state == "awaiting_send", task.state
        await backend.send_task("task-cli")
        await asyncio.sleep(0.2)

    fake._events += [assistant_text("AO_GATE confirm"), RESULT_OK]
    fake._events += [assistant_text("AO_STEP_DONE ship\nAO_DONE"), RESULT_OK]
    asyncio.run(drive())

    assert task.state == "resting"
    assert task.completed_steps == {"build", "review_gate", "send_gate", "ship"}
    assert backend.workers["lucy"].current_task_id is None
    assert "approved" in fake.sent[1].lower()
    assert "confirmed" in fake.sent[2].lower()


def test_claude_desync_falls_back_to_local_subprocess(tmp_path, monkeypatch):
    make_task_folder(tmp_path, "task-cli", "task-cli")
    backend.discover_tasks()
    task = backend.tasks["task-cli"]
    backend.assign_worker(task, backend.workers["nancy"])
    # CLI claims success without doing anything - desync must trigger fallback.
    fake = FakeSession([RESULT_OK])
    use_fake_session(monkeypatch, fake)

    asyncio.run(backend.run_pipeline(task, task.steps))

    assert task.state == "resting"
    assert task.runtime == "local"
    assert task.completed_steps == {"noop"}  # ran for real via subprocess
    assert backend.workers["nancy"].current_task_id is None


# --- FEAT-002: per-step log capture + endpoint ---

def test_task_log_captures_local_step_output(tmp_path):
    (tmp_path / "task-a" / "scripts").mkdir(parents=True)
    (tmp_path / "task-a" / "scripts" / "emit.py").write_text(
        "import sys; print('hello stdout'); print('oops stderr', file=sys.stderr)"
    )
    (tmp_path / "task-a" / "task.json").write_text(json.dumps(
        {"id": "task-a", "steps": [{"id": "emit", "type": "python", "cmd": "scripts/emit.py"}]}))
    backend.discover_tasks()
    task = backend.tasks["task-a"]

    asyncio.run(backend.run_steps_local(task, task.steps))

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


# --- FEAT-003: scheduling ---

def test_schedule_set_validates_and_persists(tmp_path):
    folder = make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()
    client = TestClient(backend.app, raise_server_exceptions=False)

    ok = client.post("/tasks/task-a/schedule", json={"daily": "09:30"})
    assert ok.json() == {"ok": True, "schedule": {"daily": "09:30"}}
    # Persisted into the manifest, and live task reflects it.
    assert json.loads((folder / "task.json").read_text())["schedule"] == {"daily": "09:30"}
    assert backend.tasks["task-a"].schedule == {"daily": "09:30"}
    # Surfaces in to_dict so the UI can show it.
    assert backend.tasks["task-a"].to_dict()["schedule"] == {"daily": "09:30"}

    bad = client.post("/tasks/task-a/schedule", json={"daily": "9am"})
    assert bad.json()["ok"] is False
    assert "HH:MM" in bad.json()["reason"]

    cleared = client.post("/tasks/task-a/schedule", json={})
    assert cleared.json() == {"ok": True, "schedule": None}
    assert "schedule" not in json.loads((folder / "task.json").read_text())

    assert client.post("/tasks/ghost/schedule", json={"daily": "09:00"}).json() == {"ok": False, "reason": "unknown task"}


def test_task_reads_schedule_from_manifest(tmp_path):
    make_task_folder(tmp_path, "task-a", "task-a")
    folder = tmp_path / "task-a"
    manifest = json.loads((folder / "task.json").read_text())
    manifest["schedule"] = {"daily": "17:00"}
    (folder / "task.json").write_text(json.dumps(manifest))
    backend.discover_tasks()
    assert backend.tasks["task-a"].schedule == {"daily": "17:00"}
