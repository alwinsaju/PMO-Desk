"""Engine restarts: tolerant task discovery (CQ-044), UTF-8 everywhere (CQ-013) and the
persisted run state (D-7). Steps are trivial python scripts: nothing here touches Outlook."""
import asyncio
import json

import pytest
from conftest import make_client

import main as backend

DRAFT_SCRIPT = "from pathlib import Path\nPath('output/draft-entry-id.txt').write_text('ENTRY-1')\n"
STEPS = [
    {"id": "build", "type": "python", "cmd": "scripts/noop.py"},
    {"id": "draft", "type": "python", "cmd": "scripts/draft.py", "capturesEntryId": True},
    {"id": "review_gate", "type": "review"},
    {"id": "send_gate", "type": "confirm"},
    {"id": "finish", "type": "python", "cmd": "scripts/noop.py"},
]


def make_task(root, task_id="t", steps=None, name=None):
    folder = root / (name or task_id)
    (folder / "scripts").mkdir(parents=True)
    (folder / "task.json").write_text(
        json.dumps({"id": task_id, "displayName": task_id, "steps": steps or STEPS}), encoding="utf-8")
    (folder / "scripts" / "noop.py").write_text("print('ok')", encoding="utf-8")
    (folder / "scripts" / "draft.py").write_text(DRAFT_SCRIPT, encoding="utf-8")
    return folder


def restart():
    """What the engine does at start: discover the tasks, then restore the run state."""
    backend.discover_tasks()
    backend.restore_run_state()
    return backend.tasks.get("t")


def state_file(task_id="t"):
    return backend.RUN_STATE_DIR / f"{task_id}.json"


def saved(task_id="t"):
    return json.loads(state_file(task_id).read_text(encoding="utf-8"))


def run_to_first_gate():
    backend.discover_tasks()
    task = backend.tasks["t"]
    task.run_id, task.run_started_at = "run-1", "2026-10-28T09:00:00+00:00"
    backend.set_state(task, "working")
    asyncio.run(backend.run_steps(task, task.steps))
    return task


# --- discovery never aborts the engine -----------------------------------------

def test_a_broken_manifest_is_skipped_logged_and_recorded(tmp_path, caplog):
    make_task(tmp_path, "good")
    (tmp_path / "bad-json").mkdir()
    (tmp_path / "bad-json" / "task.json").write_text("{ not json", encoding="utf-8")
    (tmp_path / "not-object").mkdir()
    (tmp_path / "not-object" / "task.json").write_text("[1, 2]", encoding="utf-8")
    (tmp_path / "no-id").mkdir()
    (tmp_path / "no-id" / "task.json").write_text(json.dumps({"steps": []}), encoding="utf-8")
    (tmp_path / "no-steps").mkdir()
    (tmp_path / "no-steps" / "task.json").write_text(json.dumps({"id": "no-steps"}), encoding="utf-8")
    (tmp_path / "bad-step").mkdir()
    (tmp_path / "bad-step" / "task.json").write_text(
        json.dumps({"id": "bad-step", "steps": [{"id": "x"}]}), encoding="utf-8")
    (tmp_path / "bad-bytes").mkdir()
    (tmp_path / "bad-bytes" / "task.json").write_bytes(b'{"id": "\xff\xfe"}')

    with caplog.at_level("WARNING", logger="tasks-engine"):
        backend.discover_tasks()

    assert list(backend.tasks) == ["good"]
    assert sorted(e["folder"] for e in backend.task_load_errors) == [
        "bad-bytes", "bad-json", "bad-step", "no-id", "no-steps", "not-object"]
    assert all(e["reason"] for e in backend.task_load_errors)
    assert sum("skipping task folder" in r.getMessage() for r in caplog.records) == 6


def test_load_errors_are_reset_by_the_next_discovery(tmp_path):
    (tmp_path / "bad").mkdir()
    (tmp_path / "bad" / "task.json").write_text("nope", encoding="utf-8")
    backend.discover_tasks()
    assert len(backend.task_load_errors) == 1

    (tmp_path / "bad" / "task.json").write_text(json.dumps({"id": "bad", "steps": []}), encoding="utf-8")
    backend.discover_tasks()

    assert backend.task_load_errors == [] and "bad" in backend.tasks


def test_an_unreadable_manifest_is_skipped(tmp_path, monkeypatch):
    make_task(tmp_path, "good")
    make_task(tmp_path, "locked")
    real = backend.Path.read_text

    def read_text(self, *a, **kw):
        if self.parent.name == "locked":
            raise PermissionError("locked by another program")
        return real(self, *a, **kw)

    monkeypatch.setattr(backend.Path, "read_text", read_text)

    backend.discover_tasks()

    assert list(backend.tasks) == ["good"]
    assert backend.task_load_errors[0]["folder"] == "locked"


def test_manifests_are_read_as_utf8_with_or_without_a_bom(tmp_path):
    for name, prefix in (("plain", b""), ("bom", b"\xef\xbb\xbf")):
        folder = tmp_path / name
        folder.mkdir()
        manifest = {"id": name, "displayName": "Caf\u00e9 \u2014 r\u00e9sum\u00e9", "steps": []}
        (folder / "task.json").write_bytes(prefix + json.dumps(manifest, ensure_ascii=False).encode("utf-8"))

    backend.discover_tasks()

    assert backend.tasks["plain"].display_name == "Caf\u00e9 \u2014 r\u00e9sum\u00e9"
    assert backend.tasks["bom"].display_name == "Caf\u00e9 \u2014 r\u00e9sum\u00e9"


def test_the_step_environment_forces_utf8():
    assert backend._step_env()["PYTHONUTF8"] == "1"


def test_step_output_is_decoded_as_utf8(tmp_path):
    folder = make_task(tmp_path, "t", steps=[{"id": "say", "type": "python", "cmd": "scripts/say.py"}])
    (folder / "scripts" / "say.py").write_text("print('caf\\u00e9 \\u2014 \\u2713')", encoding="utf-8")
    backend.discover_tasks()
    task = backend.tasks["t"]

    asyncio.run(backend.run_steps(task, task.steps))

    assert task.state == "resting"
    assert task.step_output[0]["text"].strip() == "caf\u00e9 \u2014 \u2713"


def test_an_entry_id_file_with_a_bom_is_read_cleanly(tmp_path):
    folder = make_task(tmp_path)
    (folder / "scripts" / "draft.py").write_text(
        "from pathlib import Path\nPath('output/draft-entry-id.txt').write_bytes(b'\\xef\\xbb\\xbfENTRY-9')\n",
        encoding="utf-8")
    backend.discover_tasks()
    task = backend.tasks["t"]

    asyncio.run(backend.run_steps(task, task.steps))

    assert task.entry_id == "ENTRY-9"


# --- run state: written on every transition ----------------------------------

def test_a_review_gate_is_persisted_with_everything_a_restart_needs(tmp_path):
    make_task(tmp_path)

    task = run_to_first_gate()

    assert task.state == "awaiting_review"
    data = saved()
    assert data["state"] == "awaiting_review" and data["current_step"] == "review_gate"
    assert data["completed_steps"] == ["build", "draft"]
    assert data["entry_id"] == "ENTRY-1"
    assert (data["run_id"], data["run_started_at"]) == ("run-1", "2026-10-28T09:00:00+00:00")
    assert data["error"] is None and data["approvals"] == []
    assert list(backend.RUN_STATE_DIR.iterdir()) == [state_file()]  # atomic: no temp files left behind


def test_each_completed_step_is_persisted_while_the_task_is_working(tmp_path, monkeypatch):
    make_task(tmp_path)
    backend.discover_tasks()
    task = backend.tasks["t"]
    seen = []
    real = backend._persist_run_state
    monkeypatch.setattr(backend, "_persist_run_state", lambda t: (real(t), seen.append(saved()["completed_steps"]))[0])

    backend.set_state(task, "working")
    asyncio.run(backend.run_steps(task, task.steps))

    assert ["build"] in seen and ["build", "draft"] in seen


def test_a_task_back_at_rest_leaves_no_file(tmp_path):
    make_task(tmp_path, steps=[{"id": "build", "type": "python", "cmd": "scripts/noop.py"}])
    backend.discover_tasks()
    task = backend.tasks["t"]
    backend.set_state(task, "working")
    assert state_file().is_file()

    asyncio.run(backend.run_steps(task, task.steps))

    assert task.state == "resting" and not state_file().exists()


@pytest.mark.parametrize("leave", ["reject", "reset"])
def test_reject_and_reset_remove_the_file(tmp_path, leave):
    make_task(tmp_path)
    run_to_first_gate()
    assert state_file().is_file()

    asyncio.run(getattr(backend, f"{leave}_task")("t"))

    assert not state_file().exists()


def test_a_failed_run_is_persisted_as_an_error_without_its_finished_run_id(tmp_path):
    make_task(tmp_path, steps=[{"id": "boom", "type": "python", "cmd": "scripts/boom.py"}])
    (tmp_path / "t" / "scripts" / "boom.py").write_text("raise SystemExit('it broke')", encoding="utf-8")
    backend.discover_tasks()
    task = backend.tasks["t"]
    task.run_id, task.run_started_at = "run-1", "2026-10-28T09:00:00+00:00"
    backend.set_state(task, "working")

    asyncio.run(backend.run_steps(task, task.steps))

    data = saved()
    assert data["state"] == "error" and "it broke" in data["error"]
    assert data["run_id"] is None and data["run_started_at"] is None  # its history record is written


def test_a_run_state_that_cannot_be_written_does_not_stop_the_run(tmp_path, monkeypatch, caplog):
    make_task(tmp_path)
    backend.discover_tasks()
    task = backend.tasks["t"]

    def deny(*_a, **_k):
        raise PermissionError("read-only")

    monkeypatch.setattr(backend, "_atomic_write_json", deny)

    with caplog.at_level("WARNING", logger="tasks-engine"):
        backend.set_state(task, "working")

    assert task.state == "working"
    assert any("could not save the run state" in r.getMessage() for r in caplog.records)


def test_unsafe_task_ids_get_no_state_file():
    assert backend._run_state_path("../evil") is None
    assert backend._run_state_path("a/b") is None
    assert backend._run_state_path("") is None
    assert backend._run_state_path("weekly-backlog_report.v2").name == "weekly-backlog_report.v2.json"


# --- run state: restored after a restart ---------------------------------------

def test_a_gate_survives_a_restart_and_the_run_continues(tmp_path):
    make_task(tmp_path)
    run_to_first_gate()
    backend.tasks.clear()  # the engine process is gone

    task = restart()

    assert task.state == "awaiting_review" and task.current_step == "review_gate"
    assert task.completed_steps == {"build", "draft"}
    assert task.entry_id == "ENTRY-1"
    assert (task.run_id, task.run_started_at) == ("run-1", "2026-10-28T09:00:00+00:00")
    assert task.error is None
    remaining = backend._steps_after(task, task.current_step)
    backend.set_state(task, "working")
    asyncio.run(backend.run_steps(task, remaining))
    assert task.state == "awaiting_send" and saved()["current_step"] == "send_gate"


def test_a_send_gate_and_the_approver_stamp_survive_a_restart(tmp_path):
    make_task(tmp_path)
    task = run_to_first_gate()
    backend._stamp_approval(task, "approve")
    backend.set_state(task, "awaiting_send", current_step="send_gate")

    task = restart()

    assert task.state == "awaiting_send" and task.current_step == "send_gate"
    assert [(a["step"], a["kind"]) for a in task.approvals] == [("review_gate", "approve")]
    assert task.run_id == "run-1"


@pytest.mark.parametrize("state", ["working", "finishing"])
def test_a_run_interrupted_mid_step_becomes_an_error_that_retry_resumes(tmp_path, state, monkeypatch):
    make_task(tmp_path)
    task = run_to_first_gate()
    backend.set_state(task, state, current_step="finish")  # the engine dies while "finish" runs
    history_before = len(backend._read_history())

    task = restart()

    assert task.state == "error"
    assert task.error == backend.INTERRUPTED_MESSAGE == (
        "The engine restarted while this task was running. Retry resumes after the last completed step.")
    assert task.completed_steps == {"build", "draft"} and task.entry_id == "ENTRY-1"
    assert any(n["kind"] == "task.failed" for n in task.notifications)
    records = backend._read_history()
    assert len(records) == history_before + 1
    assert records[-1]["outcome"] == "failed" and records[-1]["run_id"] == "run-1"
    assert records[-1]["steps_completed"] == ["build", "draft"]
    # Retry: nothing already completed (the create_draft step makes a real Outlook draft) runs again.
    launched = []
    monkeypatch.setattr(backend, "run_steps", lambda t, steps: (launched.append([s["id"] for s in steps]), asyncio.sleep(0))[1])
    assert asyncio.run(backend.start_task("t")) == {"ok": True}
    assert launched == [["review_gate", "send_gate", "finish"]]
    assert task.entry_id == "ENTRY-1"


def test_an_error_survives_a_restart_as_it_was(tmp_path):
    make_task(tmp_path, steps=[{"id": "boom", "type": "python", "cmd": "scripts/boom.py"}])
    (tmp_path / "t" / "scripts" / "boom.py").write_text("raise SystemExit('it broke')", encoding="utf-8")
    backend.discover_tasks()
    task = backend.tasks["t"]
    task.run_id, task.run_started_at = "run-1", "2026-10-28T09:00:00+00:00"
    backend.set_state(task, "working")
    asyncio.run(backend.run_steps(task, task.steps))
    history_before = len(backend._read_history())

    task = restart()

    assert task.state == "error" and "it broke" in task.error and task.current_step == "boom"
    assert len(backend._read_history()) == history_before  # no second record for the same run


def test_restoring_twice_is_stable(tmp_path):
    make_task(tmp_path)
    task = run_to_first_gate()
    backend.set_state(task, "working", current_step="finish")

    restart()
    task = restart()

    assert task.state == "error" and task.error == backend.INTERRUPTED_MESSAGE
    assert sum(r["outcome"] == "failed" for r in backend._read_history()) == 1
    assert saved()["state"] == "error"


def test_a_resting_task_with_no_file_stays_resting(tmp_path):
    make_task(tmp_path)

    task = restart()

    assert task.state == "resting" and task.completed_steps == set()


def test_a_state_naming_steps_the_manifest_no_longer_has_is_dropped(tmp_path):
    folder = make_task(tmp_path)
    run_to_first_gate()
    (folder / "task.json").write_text(json.dumps({
        "id": "t", "steps": [{"id": "build", "type": "python", "cmd": "scripts/noop.py"}]}), encoding="utf-8")

    task = restart()

    assert task.state == "resting" and task.completed_steps == set()
    assert not state_file().exists()


@pytest.mark.parametrize("mutate", [
    lambda d: d.update(state="resting"),
    lambda d: d.update(state="nonsense"),
    lambda d: d.update(current_step="ghost"),
    lambda d: d.update(current_step=None),  # a gate needs a step
    lambda d: d.update(completed_steps="build"),
    lambda d: d.update(completed_steps=["ghost"]),
    lambda d: d.update(entry_id=7),
    lambda d: d.update(run_id=["x"]),
])
def test_a_malformed_state_is_dropped_not_restored(tmp_path, mutate, caplog):
    make_task(tmp_path)
    run_to_first_gate()
    data = saved()
    mutate(data)
    state_file().write_text(json.dumps(data), encoding="utf-8")

    with caplog.at_level("WARNING", logger="tasks-engine"):
        task = restart()

    assert task.state == "resting" and not state_file().exists()
    assert any("dropping the saved run state" in r.getMessage() for r in caplog.records)


@pytest.mark.parametrize("content", ["{ torn", "[]", '"text"', ""])
def test_an_unreadable_state_file_is_dropped(tmp_path, content):
    make_task(tmp_path)
    backend.RUN_STATE_DIR.mkdir(parents=True)
    state_file().write_text(content, encoding="utf-8")

    task = restart()

    assert task.state == "resting" and not state_file().exists()


def test_the_state_of_a_task_that_is_gone_is_left_alone(tmp_path):
    make_task(tmp_path)
    run_to_first_gate()
    (tmp_path / "t" / "task.json").unlink()  # not listed this start; it may come back

    restart()

    assert "t" not in backend.tasks and state_file().is_file()


def test_the_restored_gate_is_visible_through_the_api(tmp_path):
    make_task(tmp_path)
    run_to_first_gate()
    restart()

    (listed,) = make_client().get("/tasks").json()

    assert listed["state"] == "awaiting_review" and listed["currentStep"] == "review_gate"
