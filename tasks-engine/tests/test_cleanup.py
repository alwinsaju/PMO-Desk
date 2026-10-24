"""Persistent inputs ("kept on file") and input cleanup
(tasks/TASK-PLATFORM-CONTRACT.md, sections 1-2): `persist`, `modified`,
`cleanable`, the manifest `cleanup` key, the success-path hook and
POST /tasks/{id}/cleanup.

Hermetic by construction: every task folder is a synthetic temp dir
(TASKS_ROOT is patched to tmp_path) and nothing here can reach Outlook or a
running engine."""
import asyncio
import json
import os
import shutil
import stat

import pytest

import main as backend
from test_platform import (
    NOOP, PLATFORM_INPUTS, PLATFORM_STEPS, client, make_legacy_task, make_link, make_platform_task,
    upload, wait_for, write,
)


# --- builders -----------------------------------------------------------------

INPUTS = [
    {"id": "roster", "label": "Roster", "type": "file", "accept": [".xlsx"], "dest": "input/roster.xlsx", "required": True},
    {"id": "holidays", "label": "Holiday Roster", "type": "file", "accept": [".xlsx"], "dest": "input/holiday-roster.xlsx",
     "required": True, "persist": True},
    {"id": "pto", "label": "PTO", "type": "file", "accept": [".xlsx"], "dest": "input/pto-import.xlsx", "required": False},
    {"id": "cycle", "label": "Cycle", "type": "select", "optionsFile": "output/options.json", "optionsKey": "cycles", "required": True},
]
OPTIONAL_INPUTS = [{**i, "required": False} for i in INPUTS]
PY_STEP = [{"id": "noop", "type": "python", "cmd": "scripts/noop.py"}]
FAIL_STEP = [{"id": "boom", "type": "python", "cmd": "scripts/boom.py"}]


def cleanup_task(root, *, cleanup=None, steps=None, inputs=None, name="plat", prepare=None, seed=True):
    """A platform task with `cleanup`, plus seeded input/output files."""
    extra = {} if cleanup is None else {"cleanup": cleanup}
    folder = make_platform_task(root, name, steps=steps if steps is not None else PY_STEP,
                                inputs=inputs if inputs is not None else INPUTS,
                                prepare=prepare, extra=extra)
    (folder / "scripts" / "boom.py").write_text("import sys; sys.exit(3)")
    if seed:
        seed_inputs(folder)
    return folder


def seed_inputs(folder):
    write(folder, "input/roster.xlsx", b"R" * 100)
    write(folder, "input/holiday-roster.xlsx", b"H" * 50)
    write(folder, "input/pto-import.xlsx", b"P" * 10)
    write(folder, "input/extra/notes.txt", b"N" * 7)
    write(folder, "input/extra/deep/more.csv", b"M" * 3)
    write(folder, "input/.gitkeep", "")
    write(folder, "input/run-params.json", {"params": {"cycle": "2026-12"}})
    write(folder, "input/.uploads-meta.json", {
        "roster": {"filename": "Roster 2026.xlsx", "uploaded_at": "t"},
        "holidays": {"filename": "Holidays.xlsx", "uploaded_at": "t"},
        "pto": {"filename": "pto.xlsx", "uploaded_at": "t"},
    })
    write(folder, "output/options.json", {"cycles": []})
    write(folder, "output/final.xlsx", b"FINAL")
    write(folder, "output/audit/log.json", {"a": 1})
    write(folder, "output/backups/b.xlsx", b"BK")


def names_under(folder, sub):
    base = folder / sub
    return sorted(p.relative_to(base).as_posix() for p in base.rglob("*") if p.is_file())


def run_to_rest(task_id):
    task = backend.tasks[task_id]

    async def go():
        assert (await backend.start_task(task_id))["ok"]
        await wait_for(lambda: task.state in ("resting", "error"))

    asyncio.run(go())
    return task


def history(tmp_path):
    return [json.loads(line) for line in (tmp_path / "history.jsonl").read_text().splitlines() if "run_id" in line]


# --- manifest parsing and GET /tasks ---------------------------------------------

def test_cleanup_manifest_is_normalised_and_exposed(tmp_path):
    cleanup_task(tmp_path, cleanup={"onComplete": True, "keep": ["input/a.xlsx", "  ", 7, " input/b "], "x": 1}, seed=False)
    body = client().get("/tasks").json()[0]
    assert body["cleanup"] == {"onComplete": True, "keep": ["input/a.xlsx", "input/b"]}
    assert [i["persist"] for i in body["inputs"]] == [False, True, False, False]
    assert body["inputs"][1]["dest"] == "input/holiday-roster.xlsx"  # manifest keys still pass through


@pytest.mark.parametrize("raw,expected", [
    (None, None), ("yes", None), (True, None), ([], None),
    ({}, {"onComplete": False, "keep": []}),
    ({"onComplete": "true"}, {"onComplete": False, "keep": []}),  # only a real true opts in
    ({"onComplete": True, "keep": "input/a"}, {"onComplete": True, "keep": []}),
])
def test_parse_cleanup(raw, expected):
    assert backend._parse_cleanup(raw) == expected


def test_task_without_cleanup_has_null_cleanup(tmp_path):
    make_legacy_task(tmp_path)
    d = client().get("/tasks").json()[0]
    assert d["cleanup"] is None and d["inputs"] == []


def test_persist_must_be_a_real_true(tmp_path):
    inputs = [{"id": "a", "type": "file", "accept": [".xlsx"], "dest": "input/a.xlsx", "persist": "yes"}]
    make_platform_task(tmp_path, inputs=inputs, prepare=None)
    assert client().get("/tasks").json()[0]["inputs"][0]["persist"] is False
    assert client().get("/tasks/plat/inputs").json()["inputs"][0]["persist"] is False


# --- GET /inputs: persist, modified, cleanable -----------------------------------

def test_inputs_report_persist_modified_and_cleanable(tmp_path):
    folder = cleanup_task(tmp_path, cleanup={"onComplete": True, "keep": ["input/extra/deep"]})
    body = client().get("/tasks/plat/inputs").json()
    by_id = {i["id"]: i for i in body["inputs"]}

    assert body["ok"] is True
    assert by_id["holidays"]["persist"] is True and by_id["roster"]["persist"] is False
    assert by_id["holidays"]["present"] is True and by_id["holidays"]["size"] == 50 and len(by_id["holidays"]["sha256"]) == 64
    assert by_id["holidays"]["filename"] == "Holidays.xlsx"
    stamp = by_id["roster"]["modified"]
    assert stamp.endswith("+00:00") and stamp[:4].isdigit()
    mtime = (folder / "input" / "roster.xlsx").stat().st_mtime
    assert abs(__import__("datetime").datetime.fromisoformat(stamp).timestamp() - mtime) < 1
    assert by_id["cycle"]["modified"] is None and by_id["cycle"]["persist"] is False
    # roster 100 + pto 10 + notes 7; persist holidays, kept deep/, dotfile and bookkeeping excluded
    assert body["cleanable"] == {"files": 3, "bytes": 117}


def test_inputs_absent_file_has_null_modified(tmp_path):
    cleanup_task(tmp_path, seed=False)
    body = client().get("/tasks/plat/inputs").json()
    assert all(i["modified"] is None and i["present"] is False for i in body["inputs"])
    assert body["cleanable"] == {"files": 0, "bytes": 0}


def test_inputs_cleanable_is_zero_for_a_task_with_nothing_to_clean(tmp_path):
    make_platform_task(tmp_path, inputs=[], prepare=None, steps=PY_STEP)
    write(tmp_path / "plat", "input/x.txt", b"x")
    assert client().get("/tasks/plat/inputs").json()["cleanable"] == {"files": 0, "bytes": 0}


def test_inputs_cleanable_for_task_with_inputs_but_no_cleanup_key(tmp_path):
    cleanup_task(tmp_path)  # no `cleanup` key
    assert client().get("/tasks/plat/inputs").json()["cleanable"] == {"files": 4, "bytes": 120}


# --- persistent inputs: re-upload ------------------------------------------------

def test_reuploading_a_persist_input_replaces_it_and_updates_modified(tmp_path):
    folder = cleanup_task(tmp_path, cleanup={"onComplete": True})
    os.utime(folder / "input" / "holiday-roster.xlsx", (1_000_000_000, 1_000_000_000))
    before = client().get("/tasks/plat/inputs").json()["inputs"][1]

    out = upload(client(), "plat", "holidays", "Holidays 2027.xlsx", b"NEW-HOLIDAYS")
    after = client().get("/tasks/plat/inputs").json()["inputs"][1]

    assert out["ok"] is True and after["size"] == len(b"NEW-HOLIDAYS") and after["sha256"] != before["sha256"]
    assert after["filename"] == "Holidays 2027.xlsx" and after["modified"] > before["modified"]
    assert (folder / "input" / "holiday-roster.xlsx").read_bytes() == b"NEW-HOLIDAYS"
    assert not [p for p in (folder / "input").iterdir() if p.name.endswith((".upload", ".tmp"))]


def test_reuploading_a_persist_input_in_prepare_after_still_invalidates_options(tmp_path):
    folder = cleanup_task(tmp_path, cleanup={"onComplete": True})  # prepare.after = roster, holidays
    out = upload(client(), "plat", "holidays", "h.xlsx", b"HHH")
    assert out["ok"] is True
    assert not (folder / "output" / "options.json").exists()
    assert json.loads((folder / "input" / "run-params.json").read_text())["params"] == {}


def test_required_check_is_satisfied_by_a_persisted_file_after_cleanup(tmp_path):
    folder = cleanup_task(tmp_path, cleanup={"onComplete": True})
    run_to_rest("plat")
    assert (folder / "input" / "holiday-roster.xlsx").exists()
    assert set(backend._missing_required_inputs(backend.tasks["plat"])) == {"roster", "cycle"}  # holidays satisfied


# --- cleanup on a successful run ---------------------------------------------------

def test_successful_python_run_cleans_inputs_and_records_it(tmp_path):
    folder = cleanup_task(tmp_path, cleanup={"onComplete": True, "keep": ["input/extra/deep"]})
    task = run_to_rest("plat")

    assert task.state == "resting"
    # removed: roster, pto, extra/notes.txt. Kept: persist holidays, keep-folder, dotfile.
    assert names_under(folder, "input") == [".gitkeep", ".uploads-meta.json", "extra/deep/more.csv", "holiday-roster.xlsx"]
    assert not (folder / "input" / "run-params.json").exists()
    meta = json.loads((folder / "input" / ".uploads-meta.json").read_text())
    assert list(meta) == ["holidays"]  # entries of removed files are gone, the persisted one stays
    # output/ is untouched apart from the stale prepare options
    assert names_under(folder, "output") == ["audit/log.json", "backups/b.xlsx", "final.xlsx"]
    (record,) = history(tmp_path)
    assert record["outcome"] == "completed" and record["cleanup"] == {"removed": 3, "bytes": 117, "skipped": 0}
    assert "roster" not in json.dumps(record["cleanup"])
    (note,) = task.notifications
    assert note["kind"] == "task.completed"
    assert note["body"].endswith(" Cleaned up 3 input files (117 B).")
    assert client().get("/tasks/plat/history").json()["runs"][0]["cleanup"]["removed"] == 3


def test_completion_message_keeps_manifest_text_and_appends_the_note(tmp_path):
    folder = make_platform_task(tmp_path, steps=PY_STEP, inputs=OPTIONAL_INPUTS,
                                extra={"cleanup": {"onComplete": True}, "completedMessage": "The final roster is ready."})
    write(folder, "input/roster.xlsx", b"x" * 2048 * 1024)
    task = run_to_rest("plat")
    assert task.notifications[0]["body"] == "The final roster is ready. Cleaned up 1 input file (2.0 MB)."


def test_note_sizes_and_plurals():
    assert backend._format_bytes(0) == "0 B" and backend._format_bytes(1023) == "1023 B"
    assert backend._format_bytes(1536) == "1.5 KB"
    assert backend._format_bytes(13 * 1024 * 1024 + 400_000) == "13.4 MB"
    assert backend._cleanup_note(None) == ""
    assert backend._cleanup_note({"removed": 0, "bytes": 0, "skipped": 0}) == ""
    assert backend._cleanup_note({"removed": 1, "bytes": 5, "skipped": 0}) == " Cleaned up 1 input file (5 B)."
    both = backend._cleanup_note({"removed": 2, "bytes": 2048, "skipped": 1})
    assert both == " Cleaned up 2 input files (2.0 KB). 1 input file could not be removed (open in another program?)."


def test_nothing_to_clean_leaves_the_message_untouched_but_records_zero_counts(tmp_path):
    cleanup_task(tmp_path, cleanup={"onComplete": True}, inputs=OPTIONAL_INPUTS, seed=False)
    task = run_to_rest("plat")
    assert task.notifications[0]["body"].endswith("Sent successfully - nothing else needed from you.")
    assert "Cleaned up" not in task.notifications[0]["body"]
    assert history(tmp_path)[0]["cleanup"] == {"removed": 0, "bytes": 0, "skipped": 0}


def test_run_finished_through_review_and_confirm_send_is_cleaned(tmp_path, monkeypatch):
    monkeypatch.setattr(backend.getpass, "getuser", lambda: "alice")
    folder = cleanup_task(tmp_path, cleanup={"onComplete": True}, steps=PLATFORM_STEPS, inputs=PLATFORM_INPUTS)
    write(folder, "output/ask-me.json", {"title": "Q", "fields": []})
    write(folder, "output/roster-diff.json", {"blocking": []})
    task = backend.tasks["plat"]

    async def go():
        assert (await backend.start_task("plat"))["ok"]
        await wait_for(lambda: task.state == "awaiting_review" and task.current_step == "answers")
        # a paused run never touches its inputs
        assert (folder / "input" / "roster.xlsx").exists()
        assert (await backend.approve_task("plat"))["ok"]
        await wait_for(lambda: task.current_step == "review_draft" and task.state == "awaiting_review")
        assert (await backend.approve_task("plat"))["ok"]
        await wait_for(lambda: task.state == "awaiting_send")
        assert (folder / "input" / "roster.xlsx").exists()
        assert (await backend.send_task("plat"))["ok"]
        await wait_for(lambda: task.state == "resting")

    asyncio.run(go())

    # PLATFORM_INPUTS has no persist flag: everything declared is cleared
    assert names_under(folder, "input") == [".gitkeep"]  # incl. the emptied upload-meta file
    (record,) = history(tmp_path)
    assert record["outcome"] == "completed" and record["cleanup"]["removed"] == 5
    assert [a["kind"] for a in record["approvals"]] == ["approve", "approve", "send"]
    assert task.notifications[-1]["kind"] == "task.completed" and "Cleaned up 5 input files" in task.notifications[-1]["body"]


def test_run_whose_last_step_is_the_confirm_still_cleans_and_records(tmp_path):
    folder = cleanup_task(tmp_path, cleanup={"onComplete": True},
                          steps=[{"id": "go", "type": "python", "cmd": "scripts/noop.py"}, {"id": "send_gate", "type": "confirm"}])
    task = backend.tasks["plat"]

    async def go():
        assert (await backend.start_task("plat"))["ok"]
        await wait_for(lambda: task.state == "awaiting_send")
        assert (folder / "input" / "roster.xlsx").exists()
        assert (await backend.send_task("plat"))["ok"]
        await wait_for(lambda: task.state == "resting")

    asyncio.run(go())

    assert not (folder / "input" / "roster.xlsx").exists() and (folder / "input" / "holiday-roster.xlsx").exists()
    (record,) = history(tmp_path)
    assert record["cleanup"]["removed"] == 4  # roster, pto, extra/notes.txt, extra/deep/more.csv
    # nothing ran after the confirm, so (as before) there is no completion notification to annotate
    assert not [n for n in task.notifications if n["kind"] == "task.completed"]


def test_confirm_flow_cleans_when_the_cli_fallback_finishes_the_run(tmp_path):
    folder = cleanup_task(tmp_path, cleanup={"onComplete": True})
    task = backend.tasks["plat"]
    backend._finish_task(task, [])  # what the CLI-desync fallback calls when nothing is left
    assert not (folder / "input" / "roster.xlsx").exists()
    assert task.state == "resting"


@pytest.mark.parametrize("cleanup", [None, {"onComplete": False, "keep": []}, {}])
def test_without_on_complete_a_finished_run_leaves_inputs_alone(tmp_path, cleanup):
    folder = cleanup_task(tmp_path, cleanup=cleanup)
    before = names_under(folder, "input")
    task = run_to_rest("plat")
    assert names_under(folder, "input") == before and (folder / "output" / "options.json").exists()
    assert "cleanup" not in history(tmp_path)[0]
    assert "Cleaned" not in task.notifications[0]["body"]


def test_legacy_task_run_is_unchanged(tmp_path):
    folder = make_legacy_task(tmp_path)
    write(folder, "input/data.csv", b"keep me")
    write(folder, "output/options.json", {"x": 1})
    task = backend.tasks["legacy"]
    task.run_id, task.run_started_at = "r1", "2026-01-01T00:00:00+00:00"
    asyncio.run(backend.run_steps(task, task.steps))

    assert (folder / "input" / "data.csv").exists() and (folder / "output" / "options.json").exists()
    (record,) = history(tmp_path)
    assert "cleanup" not in record
    assert task.notifications[0]["body"].endswith("Sent successfully - nothing else needed from you.")


def test_failed_run_does_not_clean(tmp_path):
    folder = cleanup_task(tmp_path, cleanup={"onComplete": True}, steps=FAIL_STEP)
    before = names_under(folder, "input")
    task = run_to_rest("plat")
    assert task.state == "error"
    assert names_under(folder, "input") == before and (folder / "output" / "options.json").exists()
    (record,) = history(tmp_path)
    assert record["outcome"] == "failed" and "cleanup" not in record


def test_reset_and_reject_do_not_clean(tmp_path):
    folder = cleanup_task(tmp_path, cleanup={"onComplete": True}, steps=[{"id": "gate", "type": "review"}] + PY_STEP)
    before = names_under(folder, "input")
    task = backend.tasks["plat"]

    async def go():
        assert (await backend.start_task("plat"))["ok"]
        await wait_for(lambda: task.state == "awaiting_review")
        assert (await backend.reject_task("plat"))["ok"]
        assert (await backend.start_task("plat"))["ok"]
        await wait_for(lambda: task.state == "awaiting_review")
        assert (await backend.reset_task("plat"))["ok"]

    asyncio.run(go())
    assert names_under(folder, "input") == before
    assert not (tmp_path / "history.jsonl").exists() or not history(tmp_path)


def test_error_then_retry_success_cleans_once_at_the_end(tmp_path):
    folder = cleanup_task(tmp_path, cleanup={"onComplete": True}, steps=FAIL_STEP)
    task = run_to_rest("plat")
    assert task.state == "error" and (folder / "input" / "roster.xlsx").exists()
    (folder / "scripts" / "boom.py").write_text("print('fixed')")
    async def retry():
        assert (await backend.start_task("plat"))["ok"]
        await wait_for(lambda: task.state in ("resting", "error"))
    asyncio.run(retry())
    assert task.state == "resting" and not (folder / "input" / "roster.xlsx").exists()
    assert [r["outcome"] for r in history(tmp_path)] == ["failed", "completed"]


def test_cleanup_failure_never_fails_the_run(tmp_path, monkeypatch):
    folder = cleanup_task(tmp_path, cleanup={"onComplete": True})

    def explode(task):
        raise RuntimeError("disk on fire")

    monkeypatch.setattr(backend, "_cleanup_inputs", explode)
    task = run_to_rest("plat")
    assert task.state == "resting" and (folder / "input" / "roster.xlsx").exists()
    (record,) = history(tmp_path)
    assert record["outcome"] == "completed" and record["cleanup"] == {"removed": 0, "bytes": 0, "skipped": 0}


# --- locked / unreadable files ---------------------------------------------------

def test_locked_file_is_skipped_counted_and_the_run_still_completes(tmp_path, monkeypatch):
    folder = cleanup_task(tmp_path, cleanup={"onComplete": True})
    real_remove = os.remove

    def locked_remove(path, *a, **kw):
        if os.path.basename(path) == "roster.xlsx":
            raise PermissionError(32, "The process cannot access the file because it is being used by another process")
        return real_remove(path, *a, **kw)

    monkeypatch.setattr(backend.os, "remove", locked_remove)
    task = run_to_rest("plat")

    assert task.state == "resting"
    assert (folder / "input" / "roster.xlsx").exists() and not (folder / "input" / "pto-import.xlsx").exists()
    (record,) = history(tmp_path)
    assert record["outcome"] == "completed" and record["cleanup"] == {"removed": 3, "bytes": 20, "skipped": 1}
    body = task.notifications[0]["body"]
    assert "Cleaned up 3 input files" in body and "1 input file could not be removed" in body


def test_file_vanishing_between_scan_and_delete_is_skipped(tmp_path):
    folder = cleanup_task(tmp_path, cleanup={"onComplete": True})
    task = backend.tasks["plat"]
    real_plan = backend._cleanup_plan

    def plan_then_vanish(t):
        plan = real_plan(t)
        (folder / "input" / "pto-import.xlsx").unlink()
        return plan

    backend._cleanup_plan, saved = plan_then_vanish, backend._cleanup_plan
    try:
        result = backend._cleanup_inputs(task)
    finally:
        backend._cleanup_plan = saved
    assert result == {"removed": 3, "bytes": 110, "skipped": 1}


def test_unreadable_directory_is_skipped(tmp_path, monkeypatch):
    folder = cleanup_task(tmp_path, cleanup={"onComplete": True})
    real_scandir = os.scandir

    def deny(path, *a, **kw):
        if os.path.basename(str(path)) == "extra":
            raise PermissionError("denied")
        return real_scandir(path, *a, **kw)

    monkeypatch.setattr(backend.os, "scandir", deny)
    result = backend._cleanup_inputs(backend.tasks["plat"])
    assert result["skipped"] == 1 and result["removed"] == 2
    assert (folder / "input" / "extra" / "notes.txt").exists()


def test_failed_stat_of_an_entry_is_skipped(tmp_path, monkeypatch):
    cleanup_task(tmp_path, cleanup={"onComplete": True})

    class Broken:
        name = "weird.xlsx"
        path = "x"

        def stat(self, follow_symlinks=True):
            raise OSError("gone")

    class Scan:
        def __enter__(self):
            return iter([Broken()])

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(backend.os, "scandir", lambda p: Scan())
    plan = backend._cleanup_plan(backend.tasks["plat"])
    assert plan["skipped"] == 1 and plan["files"] == []


# --- links and traversal ---------------------------------------------------------

def test_linked_subfolder_is_never_followed_or_deleted(tmp_path):
    folder = cleanup_task(tmp_path, cleanup={"onComplete": True})
    outside = tmp_path / "outside-secrets"
    outside.mkdir()
    (outside / "payroll.xlsx").write_bytes(b"PRECIOUS")
    (outside / "sub").mkdir()
    (outside / "sub" / "x.txt").write_bytes(b"X")
    make_link(folder / "input" / "linked", outside)

    task = run_to_rest("plat")

    assert task.state == "resting"
    assert (outside / "payroll.xlsx").read_bytes() == b"PRECIOUS" and (outside / "sub" / "x.txt").exists()
    assert os.path.lexists(folder / "input" / "linked")  # the link itself is left too
    (record,) = history(tmp_path)
    assert record["cleanup"]["removed"] == 4 and record["cleanup"]["skipped"] == 1
    assert not (folder / "input" / "roster.xlsx").exists()


def test_linked_input_folder_is_left_untouched(tmp_path):
    folder = cleanup_task(tmp_path, cleanup={"onComplete": True}, seed=False)
    real = tmp_path / "elsewhere"
    real.mkdir()
    (real / "roster.xlsx").write_bytes(b"R")
    make_link(folder / "input", real)

    result = backend._cleanup_inputs(backend.tasks["plat"])

    assert result == {"removed": 0, "bytes": 0, "skipped": 1}
    assert (real / "roster.xlsx").read_bytes() == b"R"
    assert client().get("/tasks/plat/inputs").json()["cleanable"] == {"files": 0, "bytes": 0}


def test_file_symlink_inside_input_is_not_followed(tmp_path):
    folder = cleanup_task(tmp_path, cleanup={"onComplete": True})
    target = tmp_path / "outside.xlsx"
    target.write_bytes(b"OUT")
    try:
        os.symlink(target, folder / "input" / "evil.xlsx")
    except (OSError, NotImplementedError):
        pytest.skip("cannot create file symlinks here")
    result = backend._cleanup_inputs(backend.tasks["plat"])
    assert target.read_bytes() == b"OUT" and os.path.lexists(folder / "input" / "evil.xlsx")
    assert result["skipped"] == 1 and result["removed"] == 3


def test_file_swapped_for_a_link_after_the_scan_is_not_deleted(tmp_path):
    folder = cleanup_task(tmp_path, cleanup={"onComplete": True})
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "keep.txt").write_bytes(b"K")
    real_plan = backend._cleanup_plan

    def plan_then_swap(task):
        plan = real_plan(task)
        victim = folder / "input" / "extra"
        for p in sorted(victim.rglob("*"), reverse=True):
            p.unlink() if p.is_file() else p.rmdir()
        victim.rmdir()
        make_link(victim, outside)
        return plan

    backend._cleanup_plan, saved = plan_then_swap, backend._cleanup_plan
    try:
        result = backend._cleanup_inputs(backend.tasks["plat"])
    finally:
        backend._cleanup_plan = saved
    assert (outside / "keep.txt").read_bytes() == b"K"
    assert os.path.lexists(folder / "input" / "extra")  # never rmdir'd through the link
    assert result["skipped"] >= 1


def test_planned_file_that_resolves_outside_input_is_refused(tmp_path):
    folder = cleanup_task(tmp_path, cleanup={"onComplete": True}, seed=False)
    stray = tmp_path / "stray.xlsx"
    stray.write_bytes(b"S")
    write(folder, "input/roster.xlsx", b"R")
    real_plan = backend._cleanup_plan

    def forged(task):
        plan = real_plan(task)
        plan["files"].append((str(stray), 1))  # a plan entry pointing outside input/
        return plan

    backend._cleanup_plan, saved = forged, backend._cleanup_plan
    try:
        result = backend._cleanup_inputs(backend.tasks["plat"])
    finally:
        backend._cleanup_plan = saved
    assert stray.read_bytes() == b"S" and result == {"removed": 1, "bytes": 1, "skipped": 1}


@pytest.mark.parametrize("entry", [
    "input/../output/final.xlsx", "../outside", "/abs/input/x", "\\input\\x", "C:\\input\\x", "input", "input/", "input/a\x00b",
    "output/final.xlsx", "x/input/roster.xlsx", 5,
])
def test_unsafe_keep_entries_never_match_anything(tmp_path, entry):
    assert backend._input_relative(entry) is None
    folder = cleanup_task(tmp_path, cleanup={"onComplete": True, "keep": [entry] if isinstance(entry, str) else []})
    task = backend.tasks["plat"]
    assert backend._cleanup_keep_set(task) == {"holiday-roster.xlsx"}  # only the persist input
    backend._cleanup_inputs(task)
    assert (folder / "output" / "final.xlsx").exists()  # a '..' keep never reaches into output either


def test_persist_dest_that_escapes_input_is_ignored_and_the_file_outside_is_untouched(tmp_path):
    inputs = [{"id": "h", "type": "file", "accept": [".xlsx"], "dest": "input/../output/final.xlsx", "persist": True},
              {"id": "r", "type": "file", "accept": [".xlsx"], "dest": "input/roster.xlsx"}]
    folder = cleanup_task(tmp_path, cleanup={"onComplete": True}, inputs=inputs, prepare={})
    result = backend._cleanup_inputs(backend.tasks["plat"])
    assert (folder / "output" / "final.xlsx").read_bytes() == b"FINAL" and result["removed"] >= 1


def test_keep_matching_is_case_insensitive_and_covers_folders(tmp_path):
    folder = cleanup_task(tmp_path, cleanup={"onComplete": True, "keep": ["Input/EXTRA", "input/PTO-import.XLSX"]})
    backend._cleanup_inputs(backend.tasks["plat"])
    assert names_under(folder, "input") == [
        ".gitkeep", ".uploads-meta.json", "extra/deep/more.csv", "extra/notes.txt", "holiday-roster.xlsx", "pto-import.xlsx"]


# --- what is (not) removed ---------------------------------------------------------

def test_empty_subfolders_are_pruned_but_kept_and_dotfile_folders_stay(tmp_path):
    folder = cleanup_task(tmp_path, cleanup={"onComplete": True, "keep": ["input/empty-but-kept"]})
    (folder / "input" / "empty-but-kept").mkdir()
    (folder / "input" / "already-empty").mkdir()
    write(folder, "input/with-dot/.gitkeep", "")
    write(folder, "input/with-dot/data.txt", b"d")
    write(folder, "input/.hidden/secret.txt", b"s")

    backend._cleanup_inputs(backend.tasks["plat"])

    assert not (folder / "input" / "extra").exists() and not (folder / "input" / "already-empty").exists()
    assert (folder / "input" / "empty-but-kept").is_dir()
    assert (folder / "input" / "with-dot" / ".gitkeep").exists() and not (folder / "input" / "with-dot" / "data.txt").exists()
    assert (folder / "input" / ".hidden" / "secret.txt").exists()  # dot folders are not swept


def test_only_the_options_file_of_a_prepare_task_is_removed_from_output(tmp_path):
    folder = cleanup_task(tmp_path, cleanup={"onComplete": True})
    backend._cleanup_inputs(backend.tasks["plat"])
    assert names_under(folder, "output") == ["audit/log.json", "backups/b.xlsx", "final.xlsx"]


def test_a_task_without_prepare_or_select_never_touches_output_options(tmp_path):
    inputs = [{"id": "r", "type": "file", "accept": [".xlsx"], "dest": "input/roster.xlsx"}]
    folder = cleanup_task(tmp_path, cleanup={"onComplete": True}, inputs=inputs, prepare={})
    backend._cleanup_inputs(backend.tasks["plat"])
    assert (folder / "output" / "options.json").exists() and not (folder / "input" / "roster.xlsx").exists()


def test_options_file_declared_outside_output_is_never_deleted(tmp_path):
    inputs = [{"id": "r", "type": "file", "accept": [".xlsx"], "dest": "input/roster.xlsx"},
              {"id": "c", "type": "select", "optionsFile": "input/options.json", "optionsKey": "cycles"}]
    folder = cleanup_task(tmp_path, cleanup={"onComplete": True}, inputs=inputs)
    write(folder, "input/options.json", {"cycles": []})
    backend._cleanup_inputs(backend.tasks["plat"])
    assert not (folder / "input" / "options.json").exists()  # it is a plain input file: swept as one
    assert (folder / "output" / "options.json").exists()  # the real options path is not the manifest's


def test_linked_run_params_and_meta_are_not_followed(tmp_path):
    folder = cleanup_task(tmp_path, cleanup={"onComplete": True})
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "run-params.json").write_text("{}")
    (folder / "input" / "run-params.json").unlink()
    (folder / "input" / ".uploads-meta.json").unlink()
    make_link(folder / "input" / "run-params.json", outside)  # a "file" that is really a directory link
    backend._cleanup_inputs(backend.tasks["plat"])
    assert (outside / "run-params.json").exists()


def test_meta_file_is_removed_when_every_entry_is_gone(tmp_path):
    folder = cleanup_task(tmp_path, cleanup={"onComplete": True, "keep": []},
                          inputs=[i for i in INPUTS if i["id"] != "holidays"])
    backend._cleanup_inputs(backend.tasks["plat"])
    assert not (folder / "input" / ".uploads-meta.json").exists()


def test_meta_entry_stays_for_a_file_that_could_not_be_removed(tmp_path, monkeypatch):
    folder = cleanup_task(tmp_path, cleanup={"onComplete": True})
    real_remove = os.remove
    monkeypatch.setattr(backend.os, "remove", lambda p, *a, **k: (_ for _ in ()).throw(PermissionError("locked"))
                        if os.path.basename(p) == "roster.xlsx" else real_remove(p, *a, **k))
    backend._cleanup_inputs(backend.tasks["plat"])
    meta = json.loads((folder / "input" / ".uploads-meta.json").read_text())
    assert set(meta) == {"roster", "holidays"}


def test_cleanup_with_no_input_folder_is_a_no_op(tmp_path):
    folder = cleanup_task(tmp_path, cleanup={"onComplete": True}, seed=False)
    shutil.rmtree(folder / "input", ignore_errors=True)  # the engine creates it; a user may remove it
    assert backend._cleanup_inputs(backend.tasks["plat"]) == {"removed": 0, "bytes": 0, "skipped": 0}
    assert not (folder / "input").exists()


def test_stat_is_link_reports_symlinks_and_reparse_points():
    class St:
        st_mode = stat.S_IFDIR
        st_reparse_tag = stat.IO_REPARSE_TAG_MOUNT_POINT

    assert backend._stat_is_link(St()) is True
    St.st_reparse_tag = 0
    assert backend._stat_is_link(St()) is False
    St.st_mode = stat.S_IFLNK
    assert backend._stat_is_link(St()) is True
    assert backend._inside("C:\\a\\b", "D:\\a") is False


# --- POST /tasks/{id}/cleanup --------------------------------------------------------

def test_manual_cleanup_clears_inputs_while_resting(tmp_path):
    folder = cleanup_task(tmp_path, cleanup={"onComplete": True, "keep": ["input/extra/deep"]})
    out = client().post("/tasks/plat/cleanup").json()
    assert out == {"ok": True, "removed": 3, "bytes": 117, "skipped": 0}
    assert names_under(folder, "input") == [".gitkeep", ".uploads-meta.json", "extra/deep/more.csv", "holiday-roster.xlsx"]
    assert client().get("/tasks/plat/inputs").json()["cleanable"] == {"files": 0, "bytes": 0}
    assert client().post("/tasks/plat/cleanup").json() == {"ok": True, "removed": 0, "bytes": 0, "skipped": 0}
    assert not (tmp_path / "history.jsonl").exists()  # a manual clear is not a run


def test_manual_cleanup_works_for_a_task_with_on_complete_false(tmp_path):
    cleanup_task(tmp_path, cleanup={"onComplete": False})
    assert client().post("/tasks/plat/cleanup").json()["removed"] == 3 + 1  # includes extra/deep/more.csv


def test_manual_cleanup_works_for_a_task_with_inputs_but_no_cleanup_key(tmp_path):
    folder = cleanup_task(tmp_path)
    out = client().post("/tasks/plat/cleanup").json()
    assert out["ok"] is True and out["removed"] == 4
    assert (folder / "input" / "holiday-roster.xlsx").exists()  # persist is honoured without a cleanup key


def test_manual_cleanup_refused_for_a_task_with_nothing_to_clean(tmp_path):
    folder = make_legacy_task(tmp_path)
    write(folder, "input/data.csv", b"x")
    assert client().post("/tasks/legacy/cleanup").json() == {"ok": False, "reason": "Nothing to clean"}
    assert (folder / "input" / "data.csv").exists()


def test_manual_cleanup_unknown_task(tmp_path):
    assert client().post("/tasks/nope/cleanup").json() == {"ok": False, "reason": "unknown task"}


@pytest.mark.parametrize("state", ["working", "awaiting_review", "awaiting_send", "finishing", "error"])
def test_manual_cleanup_refused_unless_resting(tmp_path, state):
    folder = cleanup_task(tmp_path, cleanup={"onComplete": True})
    backend.set_state(backend.tasks["plat"], state)
    out = client().post("/tasks/plat/cleanup").json()
    assert out == {"ok": False, "reason": f"task is {state}"}
    assert (folder / "input" / "roster.xlsx").exists()


def test_manual_cleanup_refused_while_prepare_is_running(tmp_path):
    folder = cleanup_task(tmp_path, cleanup={"onComplete": True})
    backend.tasks["plat"].preparing = True
    out = client().post("/tasks/plat/cleanup").json()
    assert out["ok"] is False and "prepare" in out["reason"]
    assert (folder / "input" / "roster.xlsx").exists()


def test_manual_cleanup_reports_skipped_for_locked_files(tmp_path, monkeypatch):
    folder = cleanup_task(tmp_path, cleanup={"onComplete": True})
    real_remove = os.remove

    def remove(p, *a, **k):
        if os.path.basename(p) == "pto-import.xlsx":
            raise PermissionError("locked by Excel")
        return real_remove(p, *a, **k)

    monkeypatch.setattr(backend.os, "remove", remove)
    out = client().post("/tasks/plat/cleanup").json()
    assert out["ok"] is True and out["skipped"] == 1 and out["removed"] == 3
    assert (folder / "input" / "pto-import.xlsx").exists()


def test_start_after_cleanup_demands_the_inputs_again(tmp_path):
    cleanup_task(tmp_path, cleanup={"onComplete": True})
    run_to_rest("plat")
    out = client().post("/tasks/plat/start").json()
    assert out["ok"] is False and set(out["missing"]) == {"roster", "cycle"}


def test_cleanup_route_never_calls_outlook_or_spawns_processes(tmp_path, monkeypatch):
    import subprocess

    def boom(*a, **k):
        raise AssertionError("cleanup must not spawn processes")

    cleanup_task(tmp_path, cleanup={"onComplete": True})
    monkeypatch.setattr(subprocess, "Popen", boom)
    monkeypatch.setattr(subprocess, "run", boom)
    assert client().post("/tasks/plat/cleanup").json()["ok"] is True
