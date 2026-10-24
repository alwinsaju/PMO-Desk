"""FEAT-001 run history + FEAT-005 agent metrics - both sides of history.jsonl:
the pipeline appends one record per finished/failed run, the endpoints read
and aggregate. The file is local-only runtime data (header line says so)."""
import asyncio
import json
import types
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

import main as backend
import session_manager as sm


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


def drive_start(task_id):
    """POST-start a task and let the fire-and-forget pipeline settle."""

    async def go():
        resp = await backend.start_task(task_id)
        assert backend.tasks[task_id].state == "working"
        for _ in range(500):
            if backend.tasks[task_id].state != "working":
                break
            await asyncio.sleep(0.01)
        return resp

    return asyncio.run(go())


def read_records(path):
    if not path.exists():
        return []
    return [
        rec
        for rec in (json.loads(line) for line in path.read_text().splitlines())
        if "run_id" in rec
    ]


def make_run(task_id="task-a", agent_id="adam", outcome="completed",
             started="2026-08-24T10:00:00+00:00", ended="2026-08-24T10:00:10+00:00",
             **overrides):
    record = {
        "run_id": f"{task_id}-{agent_id}-{started}",
        "task_id": task_id,
        "task_name": task_id,
        "agent_id": agent_id,
        "agent_name": agent_id.capitalize(),
        "runtime": "local",
        "started_at": started,
        "ended_at": ended,
        "outcome": outcome,
        "current_step_at_end": "noop",
        "error": None,
        "steps_completed": ["noop"],
    }
    record.update(overrides)
    return record


# --- FEAT-001: pipeline lifecycle appends to history.jsonl ---

def test_completed_run_appends_one_history_record(tmp_path):
    make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()

    resp = drive_start("task-a")

    assert resp["ok"]
    (record,) = read_records(tmp_path / "history.jsonl")
    worker = backend.workers[resp["agent"]]
    assert record["run_id"]
    assert record["task_id"] == "task-a"
    assert record["task_name"] == "task-a"
    assert record["agent_id"] == worker.id
    assert record["agent_name"] == worker.display_name
    assert record["runtime"] == "local"
    assert record["outcome"] == "completed"
    assert record["error"] is None
    assert record["current_step_at_end"] == "noop"
    assert record["steps_completed"] == ["noop"]
    assert datetime.fromisoformat(record["started_at"]) <= datetime.fromisoformat(record["ended_at"])
    # the run's fields clear at finalize so a later reject/reset stays silent
    task = backend.tasks["task-a"]
    assert task.run_id is None and task.run_started_at is None


def test_history_file_opens_with_local_only_header(tmp_path):
    make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()
    drive_start("task-a")

    header = json.loads((tmp_path / "history.jsonl").read_text().splitlines()[0])

    assert "local" in header["_comment"].lower()


def test_failed_run_appends_failed_record(tmp_path):
    folder = tmp_path / "fail-task"
    (folder / "scripts").mkdir(parents=True)
    (folder / "scripts" / "boom.py").write_text(
        "import sys; sys.stderr.write('kaboom'); sys.exit(3)"
    )
    (folder / "task.json").write_text(json.dumps(
        {"id": "fail-task", "steps": [{"id": "boom", "type": "python", "cmd": "scripts/boom.py"}]}
    ))
    backend.discover_tasks()

    drive_start("fail-task")

    (record,) = read_records(tmp_path / "history.jsonl")
    assert record["outcome"] == "failed"
    assert "kaboom" in record["error"]
    assert record["current_step_at_end"] == "boom"
    assert record["steps_completed"] == []


def test_retry_after_failure_appends_a_second_record(tmp_path):
    folder = tmp_path / "flaky-task"
    (folder / "scripts").mkdir(parents=True)
    (folder / "scripts" / "flaky.py").write_text(
        "import sys\nfrom pathlib import Path\n"
        "if not Path('output').exists():\n"
        "    Path('output').mkdir()\n"
        "    sys.stderr.write('first run fails'); sys.exit(1)\n"
    )
    (folder / "task.json").write_text(json.dumps(
        {"id": "flaky-task", "steps": [{"id": "flaky", "type": "python", "cmd": "scripts/flaky.py"}]}
    ))
    backend.discover_tasks()

    drive_start("flaky-task")
    assert backend.tasks["flaky-task"].state == "error"
    drive_start("flaky-task")  # retry keeps the same worker, now succeeds
    assert backend.tasks["flaky-task"].state == "resting"

    records = read_records(tmp_path / "history.jsonl")
    assert [r["outcome"] for r in records] == ["failed", "completed"]
    assert records[0]["run_id"] != records[1]["run_id"]
    assert records[0]["agent_id"] == records[1]["agent_id"]


def test_reject_after_review_gate_writes_no_record(tmp_path):
    steps = [
        {"id": "build", "type": "python", "cmd": "scripts/noop.py"},
        {"id": "review_gate", "type": "review"},
        {"id": "send", "type": "python", "cmd": "scripts/noop.py"},
    ]
    make_task_folder(tmp_path, "task-a", "task-a", steps=steps)
    backend.discover_tasks()
    drive_start("task-a")
    assert backend.tasks["task-a"].state == "awaiting_review"

    resp = asyncio.run(backend.reject_task("task-a"))

    assert resp["ok"]
    assert read_records(tmp_path / "history.jsonl") == []
    task = backend.tasks["task-a"]
    assert task.run_id is None and task.run_started_at is None


def test_reset_without_started_run_writes_no_record(tmp_path):
    make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()

    resp = asyncio.run(backend.reset_task("task-a"))

    assert resp["ok"]
    assert not (tmp_path / "history.jsonl").exists()


class _FakeSession:
    """Scripted stand-in for a worker's CLI session (no real claude process)."""

    def __init__(self, events):
        self.worker = types.SimpleNamespace(session_config={})
        self.tasks_run = 0
        self._events = list(events)

    def send(self, text):
        pass

    async def next_event(self, timeout):
        if not self._events:
            raise sm.ClaudeSessionError("script exhausted")
        return self._events.pop(0)


def test_claude_runtime_run_records_identically(tmp_path, monkeypatch):
    make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()
    fake = _FakeSession([
        {"type": "assistant", "message": {"content": [
            {"type": "text", "text": f"ran it\n{sm.MARKER_STEP_DONE} noop"},
        ]}},
        {"type": "result", "is_error": False},
    ])
    monkeypatch.setattr(backend.session_manager, "enabled", True)
    monkeypatch.setattr(backend.session_manager, "ensure", lambda worker: fake)

    resp = drive_start("task-a")

    assert resp["ok"]
    (record,) = read_records(tmp_path / "history.jsonl")
    assert record["runtime"] == "claude"
    assert record["outcome"] == "completed"
    assert record["steps_completed"] == ["noop"]
    assert record["agent_id"] == resp["agent"]


# --- FEAT-001: GET /tasks/{id}/history ---

def test_history_endpoint_returns_runs_newest_first(tmp_path):
    make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()
    backend._append_history(make_run(run_id="old", started="2026-08-24T10:00:00+00:00",
                                     ended="2026-08-24T10:00:10+00:00"))
    backend._append_history(make_run(run_id="new", started="2026-08-24T11:00:00+00:00",
                                     ended="2026-08-24T11:00:10+00:00"))
    client = TestClient(backend.app, raise_server_exceptions=False)

    body = client.get("/tasks/task-a/history").json()

    assert body["ok"] is True
    assert [r["run_id"] for r in body["runs"]] == ["new", "old"]


def test_history_endpoint_filters_to_one_task(tmp_path):
    make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()
    backend._append_history(make_run(task_id="task-a", run_id="a1"))
    backend._append_history(make_run(task_id="task-b", run_id="b1"))
    client = TestClient(backend.app, raise_server_exceptions=False)

    body = client.get("/tasks/task-a/history").json()

    assert [r["run_id"] for r in body["runs"]] == ["a1"]


def test_history_endpoint_caps_at_100_runs(tmp_path):
    make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()
    for i in range(105):
        backend._append_history(make_run(run_id=f"run-{i:03d}"))
    client = TestClient(backend.app, raise_server_exceptions=False)

    body = client.get("/tasks/task-a/history").json()

    assert len(body["runs"]) == 100
    assert body["runs"][0]["run_id"] == "run-104"


def test_history_endpoint_empty_when_no_runs(tmp_path):
    make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()
    client = TestClient(backend.app, raise_server_exceptions=False)

    body = client.get("/tasks/task-a/history").json()

    assert body == {"ok": True, "runs": []}


def test_history_endpoint_unknown_task_returns_ok_false():
    client = TestClient(backend.app, raise_server_exceptions=False)
    resp = client.get("/tasks/ghost/history")
    assert resp.status_code == 200
    assert resp.json() == {"ok": False, "reason": "unknown task"}


# --- FEAT-005: GET /agents/{id}/metrics ---

def test_metrics_zeroed_when_history_missing():
    client = TestClient(backend.app, raise_server_exceptions=False)

    body = client.get("/agents/adam/metrics").json()

    assert body["ok"] is True
    assert body["agent_id"] == "adam"
    assert body["display_name"] == backend.workers["adam"].display_name
    assert body["tasks_completed"] == 0
    assert body["tasks_failed"] == 0
    assert body["success_rate"] is None
    assert body["avg_duration_seconds"] is None
    assert body["last_active_at"] is None
    assert body["runtime_note"] == "local"


def test_metrics_aggregates_the_agents_runs(tmp_path):
    backend._append_history(make_run(agent_id="adam", outcome="completed", run_id="r1",
                                     started="2026-08-24T10:00:00+00:00",
                                     ended="2026-08-24T10:00:10+00:00"))
    backend._append_history(make_run(agent_id="adam", outcome="failed", run_id="r2",
                                     started="2026-08-24T11:00:00+00:00",
                                     ended="2026-08-24T11:00:30+00:00", error="boom"))
    backend._append_history(make_run(agent_id="adam", outcome="completed", run_id="r3",
                                     started="2026-08-24T12:00:00+00:00",
                                     ended="2026-08-24T12:00:50+00:00"))
    backend._append_history(make_run(agent_id="ash", outcome="completed", run_id="r4"))
    client = TestClient(backend.app, raise_server_exceptions=False)

    body = client.get("/agents/adam/metrics").json()

    assert body["tasks_completed"] == 2
    assert body["tasks_failed"] == 1
    assert body["success_rate"] == pytest.approx(2 / 3)
    assert body["avg_duration_seconds"] == pytest.approx(30.0)  # mean of completed: 10s, 50s
    assert body["last_active_at"] == "2026-08-24T12:00:50+00:00"


def test_metrics_skips_corrupt_and_partial_lines(tmp_path):
    path = tmp_path / "history.jsonl"
    path.write_text(
        '{"_comment": "local only"}\n'
        "not json at all\n"
        + json.dumps(make_run(agent_id="adam", run_id="r1")) + "\n"
        + '{"run_id": "truncated", "agent_id": "adam"\n'
        + json.dumps(make_run(agent_id="adam", run_id="r2",
                              started=None, ended=None)) + "\n"
    )
    client = TestClient(backend.app, raise_server_exceptions=False)

    body = client.get("/agents/adam/metrics").json()

    assert body["ok"] is True
    assert body["tasks_completed"] == 2
    assert body["avg_duration_seconds"] == pytest.approx(10.0)  # r2 has no timestamps
    assert body["last_active_at"] == "2026-08-24T10:00:10+00:00"


def test_metrics_unknown_agent_returns_ok_false():
    client = TestClient(backend.app, raise_server_exceptions=False)
    resp = client.get("/agents/ghost/metrics")
    assert resp.status_code == 200
    assert resp.json() == {"ok": False, "reason": "unknown agent"}
