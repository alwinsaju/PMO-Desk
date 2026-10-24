"""Run history - both sides of history.jsonl:
the pipeline appends one record per finished/failed run, the endpoints read
and aggregate. The file is local-only runtime data (header line says so)."""
import asyncio
import json
import types
from datetime import datetime

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


def make_run(task_id="task-a", outcome="completed",
             started="2026-08-24T10:00:00+00:00", ended="2026-08-24T10:00:10+00:00",
             **overrides):
    record = {
        "run_id": f"{task_id}-{started}",
        "task_id": task_id,
        "task_name": task_id,
        "started_at": started,
        "ended_at": ended,
        "outcome": outcome,
        "current_step_at_end": "noop",
        "error": None,
        "steps_completed": ["noop"],
    }
    record.update(overrides)
    return record


# --- pipeline lifecycle appends to history.jsonl ---

def test_completed_run_appends_one_history_record(tmp_path):
    make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()

    resp = drive_start("task-a")

    assert resp["ok"]
    (record,) = read_records(tmp_path / "history.jsonl")
    assert record["run_id"]
    assert record["task_id"] == "task-a"
    assert record["task_name"] == "task-a"
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
    drive_start("flaky-task")  # the retry resumes and now succeeds
    assert backend.tasks["flaky-task"].state == "resting"

    records = read_records(tmp_path / "history.jsonl")
    assert [r["outcome"] for r in records] == ["failed", "completed"]
    assert records[0]["run_id"] != records[1]["run_id"]


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


# --- GET /tasks/{id}/history ---

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


