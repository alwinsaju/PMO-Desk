"""The Outlook/Excel safety switch (AI_OS_TASKS_OFFICE=off), the run outputs that survive an engine
restart, and the notes a task can leave for the review dialog. Nothing here can reach Outlook:
every subprocess is replaced."""
import json
import subprocess

from conftest import make_client

import main as backend


def make_task(root, steps, task_id="office-task", files=None):
    folder = root / task_id
    (folder / "scripts").mkdir(parents=True)
    (folder / "task.json").write_text(json.dumps({"id": task_id, "displayName": "Office task", "steps": steps}))
    for rel, content in (files or {}).items():
        path = folder / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    backend.discover_tasks()
    return backend.tasks[task_id]


PS_STEP = {"id": "create_draft", "type": "powershell", "cmd": "scripts/create_draft.ps1"}


def forbid_processes(monkeypatch):
    def boom(*args, **kwargs):
        raise AssertionError("a process was started")

    monkeypatch.setattr(subprocess, "Popen", boom)


def test_office_steps_run_by_default(monkeypatch, tmp_path):
    monkeypatch.delenv(backend.OFFICE_ENV, raising=False)
    started = []

    class FakeProc:
        stdout = iter(["done\n"])
        returncode = 0

        def communicate(self):
            return "", ""

    monkeypatch.setattr(subprocess, "Popen", lambda cmd, **kw: started.append(cmd) or FakeProc())
    task = make_task(tmp_path, [PS_STEP])

    result = backend.run_step(PS_STEP, task.folder, None, task)

    assert started and started[0][0] == "powershell"
    assert result.returncode == 0 and not task.office_skipped


def test_the_off_switch_turns_every_powershell_step_into_a_logged_no_op(monkeypatch, tmp_path):
    monkeypatch.setenv(backend.OFFICE_ENV, "off")
    forbid_processes(monkeypatch)
    task = make_task(tmp_path, [PS_STEP])

    result = backend.run_step(PS_STEP, task.folder, "token", task)

    assert result.returncode == 0
    assert task.office_skipped is True
    assert "Skipped scripts/create_draft.ps1" in task.step_output[-1]["text"]


def test_the_off_switch_accepts_the_usual_spellings(monkeypatch):
    for value in ("off", "OFF", "0", "false", "no", "disabled", " off "):
        monkeypatch.setenv(backend.OFFICE_ENV, value)
        assert backend.office_steps_enabled() is False
    for value in ("", "on", "1", "anything"):
        monkeypatch.setenv(backend.OFFICE_ENV, value)
        assert backend.office_steps_enabled() is True


def test_a_python_step_still_runs_when_office_is_off(monkeypatch, tmp_path):
    monkeypatch.setenv(backend.OFFICE_ENV, "off")
    step = {"id": "make", "type": "python", "cmd": "scripts/make.py"}
    task = make_task(tmp_path, [step], files={"scripts/make.py": "print('made')"})

    result = backend.run_step(step, task.folder, None, task)

    assert result.returncode == 0 and "made" in result.stdout
    assert task.office_skipped is False


def test_the_run_says_it_skipped_outlook_at_the_gate_and_at_the_end(monkeypatch, tmp_path):
    monkeypatch.setenv(backend.OFFICE_ENV, "off")
    task = make_task(tmp_path, [PS_STEP, {"id": "review_gate", "type": "review"}])
    task.office_skipped = True

    backend._review_gate(task, task.steps[1])
    backend._finish_task(task, task.steps)

    assert backend.OFFICE_OFF_NOTE in task.notifications[0]["body"]
    assert backend.OFFICE_OFF_NOTE in task.notifications[1]["body"]


def finished_task(tmp_path):
    task = make_task(
        tmp_path,
        [{"id": "make", "type": "python", "cmd": "scripts/make.py"}],
        files={
            "output/report-data.json": json.dumps({"workbook_path": "output/report.xlsx"}),
            "output/report.xlsx": "x",
        },
    )
    task.run_id = "run-1"
    task.run_started_at = "2026-11-05T09:00:00+00:00"
    backend._finish_task(task, task.steps)
    return task


def test_a_finished_run_keeps_its_output_in_the_history_record(tmp_path):
    task = finished_task(tmp_path)

    (record,) = backend._read_history()

    assert record["outcome"] == "completed"
    assert record["outputs"] == [{"label": None, "path": str(task.folder / "output" / "report.xlsx")}]


def test_the_open_buttons_come_back_after_an_engine_restart(monkeypatch, tmp_path):
    task = finished_task(tmp_path)
    task.notifications.clear()  # what a restart does
    opened = []
    monkeypatch.setattr(backend, "_open_with_default_app", opened.append)

    backend.restore_output_notifications()

    (note,) = task.notifications
    assert note["kind"] == "task.completed"
    assert note["outputPaths"] == [{"label": None, "path": str(task.folder / "output" / "report.xlsx")}]
    reply = make_client().post(f"/tasks/{task.id}/notifications/{note['id']}/open").json()
    assert reply == {"ok": True} and opened == [str(task.folder / "output" / "report.xlsx")]


def test_an_output_that_was_deleted_is_not_offered_again(tmp_path):
    task = finished_task(tmp_path)
    task.notifications.clear()
    (task.folder / "output" / "report.xlsx").unlink()

    backend.restore_output_notifications()

    assert task.notifications == []


def test_restoring_never_doubles_up_when_the_task_already_has_notifications(tmp_path):
    task = finished_task(tmp_path)
    before = list(task.notifications)

    backend.restore_output_notifications()

    assert task.notifications == before


def test_the_draft_summary_carries_the_notes_the_task_wrote(tmp_path):
    task = make_task(
        tmp_path,
        [{"id": "make", "type": "python", "cmd": "scripts/make.py"}],
        files={
            "output/email-data.json": json.dumps(
                {"to": "a@b.com", "cc": "", "subject": "S", "attachments": [], "warnings": ["No roster email on file for: Ann"]}
            )
        },
    )

    summary = make_client().get(f"/tasks/{task.id}/draft-summary").json()["summary"]

    assert summary["notes"] == ["No roster email on file for: Ann"]


def test_the_draft_summary_has_no_notes_key_without_notes(tmp_path):
    task = make_task(
        tmp_path,
        [{"id": "make", "type": "python", "cmd": "scripts/make.py"}],
        files={"output/email-data.json": json.dumps({"to": "a@b.com", "subject": "S"})},
    )

    assert "notes" not in make_client().get(f"/tasks/{task.id}/draft-summary").json()["summary"]
