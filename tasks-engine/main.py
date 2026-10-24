import argparse
import asyncio
import getpass
import hashlib
import json
import logging
import os
import platform
import re
import stat
import subprocess
import sys
import threading
import time
import uuid
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, File, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

import workcopy

log = logging.getLogger("tasks-engine")

ENGINE_DIR = Path(__file__).resolve().parent
ROOT_DIR = ENGINE_DIR.parent
SKIP_DIRS = {"shared"}

# Task definitions live in the tasks/ folder beside this engine (in the repo and
# in the installed app); each task resolves its sibling shared/ relative to its
# own folder. Override with AI_OS_TASKS_DIR to look elsewhere.
DEFINITIONS_ROOT = Path(os.environ.get("AI_OS_TASKS_DIR") or ROOT_DIR / "tasks").resolve()

# Where tasks run, and where their inputs, outputs and the run history live:
# * AI_OS_TASKS_DATA_DIR set (the installed app: the app-data folder): tasks run
#   from a working copy in <data>/tasks that workcopy.sync() refreshes from the
#   definitions at start, so the install folder stays read-only and the user's
#   data survives a reinstall;
# * unset (running from the repo): tasks run in place, history goes to the
#   gitignored tasks-engine/.data.
_data_dir_env = os.environ.get("AI_OS_TASKS_DATA_DIR")
DATA_DIR = Path(_data_dir_env or ENGINE_DIR / ".data").resolve()
TASKS_ROOT = DATA_DIR / "tasks" if _data_dir_env else DEFINITIONS_ROOT
if _data_dir_env:
    workcopy.sync(DEFINITIONS_ROOT, TASKS_ROOT)

# Append-only audit log of finished/failed runs: local-only runtime data (the
# file's own header line says so), never committed.
HISTORY_FILE = DATA_DIR / "history.jsonl"
HISTORY_HEADER = {
    "_comment": "Tasks engine run history. Local-only runtime data - never commit this file.",
}
MAX_RUNS_PER_TASK = 100

app = FastAPI()
# The Tasks app talks to this engine straight from the browser (or the Electron
# window), so the only origins allowed are loopback pages on any port.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^http://(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$",
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    """Identity probe: lets the launcher tell this engine from any other
    process that happens to answer on a port."""
    return {"ok": True, "service": "tasks-engine"}


class Task:
    """A runnable pipeline discovered from a task folder's task.json."""

    def __init__(self, manifest: dict, folder: Path):
        self.id = manifest["id"]
        self.folder = folder
        self.apply_manifest(manifest)
        self.state = "resting"
        self.error = None
        self.entry_id = None
        self.current_step = None
        self.notifications: list[dict] = []
        self.completed_steps: set[str] = set()
        # Set by start_task when a run actually begins executing steps; cleared
        # when the run's history record is written (or the run is abandoned).
        self.run_id: str | None = None
        self.run_started_at: str | None = None
        # Live per-run step output, newest-appended; powers the frontend's
        # per-step stdout viewer. In-memory only (cleared on each new run).
        self.step_output: list[dict] = []
        self._log_cache: tuple | None = None  # see log_json()
        # Approver stamps (OS user + UTC time) for this run's approve/send
        # clicks; written into the run's history record, then cleared.
        self.approvals: list[dict] = []
        # True while a manifest `prepare` script is executing (one at a time).
        self.preparing = False

    def apply_manifest(self, manifest: dict):
        """Manifest-derived fields (name, steps, inputs, prepare, cleanup)."""
        self.display_name = manifest.get("displayName", self.id)
        self.steps = manifest["steps"]
        # Platform additions (all optional).
        inputs = manifest.get("inputs")
        self.inputs: list[dict] = [i for i in inputs if isinstance(i, dict) and i.get("id")] if isinstance(inputs, list) else []
        prepare = manifest.get("prepare")
        self.prepare: dict | None = prepare if isinstance(prepare, dict) and prepare.get("cmd") else None
        # Optional text for the "task complete" notification of tasks that do
        # not send an email (the default text says "sent it").
        completed = manifest.get("completedMessage")
        self.completed_message: str | None = completed.strip() if isinstance(completed, str) and completed.strip() else None
        # Optional input-file cleanup (see "Input cleanup" below). None = the
        # task never cleans up, exactly as before this key existed.
        self.cleanup: dict | None = _parse_cleanup(manifest.get("cleanup"))

    def log_step(self, step_id: str, stream: str, text: str):
        if text:
            self.step_output.append({"step": step_id, "stream": stream, "text": text[-4000:]})
            del self.step_output[:-400]

    def log_json(self) -> bytes:
        """`step_output` serialised exactly as the /log response body, rebuilt
        only when the log changed. Entries are append-only dicts that are never
        mutated, and old ones only leave through `del [:-400]` / `.clear()`, so
        (length, first entry, last entry) - compared by IDENTITY, the cache keeps
        the objects alive so an id can never be recycled - detects every change."""
        entries = list(self.step_output)  # one atomic snapshot: log_step may run in another thread
        first = entries[0] if entries else None
        last = entries[-1] if entries else None
        cached = self._log_cache
        if cached is not None and cached[0] == len(entries) and cached[1] is first and cached[2] is last:
            return cached[3]
        body = JSONResponse(entries).body
        self._log_cache = (len(entries), first, last, body)
        return body

    def to_dict(self):
        return {
            "id": self.id,
            "displayName": self.display_name,
            "state": self.state,
            "error": self.error,
            "currentStep": self.current_step,
            "steps": [
                {
                    "id": s["id"],
                    "type": s["type"],
                    "label": s.get("label"),
                    "gate": _step_gate(s),
                }
                for s in self.steps
            ],
            "notifications": self.notifications,
            # `persist` is always present so the UI never has to guess; every
            # other manifest key passes through untouched.
            "inputs": [{**i, "persist": i.get("persist") is True} for i in self.inputs],
            "prepare": self.prepare is not None,
            "cleanup": self.cleanup,
        }


tasks: dict[str, Task] = {}

def _step_python() -> str:
    """The interpreter task steps run with: the engine's own, using the console
    build (python.exe) when the engine itself runs windowless as pythonw.exe,
    since a step's stdout and stderr are piped back to the engine."""
    exe = Path(sys.executable)
    if exe.name.lower() == "pythonw.exe" and (exe.parent / "python.exe").is_file():
        return str(exe.parent / "python.exe")
    return sys.executable


STEP_PYTHON = _step_python()


def _step_env() -> dict:
    """Steps (and scripts they start, e.g. a PowerShell step calling Python) find
    the engine's interpreter in AI_OS_TASKS_PYTHON instead of guessing a venv path.
    PYTHONNOUSERSITE keeps a user-level Python install out of their imports."""
    return {**os.environ, "AI_OS_TASKS_PYTHON": STEP_PYTHON, "PYTHONNOUSERSITE": "1"}


# Task scripts include console-subsystem Python and PowerShell executables.
# Suppress the transient console window on Windows while leaving POSIX process
# creation unchanged.
STEP_POPEN_EXTRA_KWARGS = {"creationflags": subprocess.CREATE_NO_WINDOW} if sys.platform == "win32" else {}


def discover_tasks():
    tasks.clear()
    for folder in sorted(TASKS_ROOT.iterdir()):
        if not folder.is_dir() or folder.name in SKIP_DIRS:
            continue
        manifest_path = folder / "task.json"
        if manifest_path.exists():
            manifest = json.loads(manifest_path.read_text())
            task = tasks[manifest["id"]] = Task(manifest, folder)
            _ensure_task_dirs(task)


def set_state(task: Task, state: str, **kw):
    task.state = state
    for k, v in kw.items():
        setattr(task, k, v)


def _read_report_data(task: Task) -> dict | None:
    """The first readable report-data.json / email-data.json object, or None."""
    for filename in ("report-data.json", "email-data.json"):
        data_file = task.folder / "output" / filename
        if not data_file.exists():
            continue
        try:
            data = json.loads(data_file.read_text(encoding="utf-8-sig"))
        except (ValueError, OSError):  # ValueError covers bad JSON and bad UTF-8
            continue
        if isinstance(data, dict):
            return data
    return None


def _resolve_report_file(task: Task, path, *, inside_task_only: bool = False) -> str | None:
    """One report-data path -> the string the notification carries, or None
    (not a path, missing, or outside the task folder where that is required)."""
    if not isinstance(path, str) or not path:
        return None
    candidate = Path(path)
    if candidate.is_absolute():
        # Legacy tasks write absolute paths; returned exactly as given.
        if not candidate.exists():
            return None
        if inside_task_only and not candidate.resolve().is_relative_to(task.folder.resolve()):
            return None
        return path
    # Platform tasks write task-relative paths ("output/<file>.xlsx"): they
    # are relative to the task folder, never to this process's cwd, and must
    # stay inside it. The notification carries the absolute path so the
    # "open" endpoint (which re-checks containment) can use it as is.
    resolved = (task.folder / candidate).resolve()
    if resolved.is_relative_to(task.folder.resolve()) and resolved.exists():
        return str(resolved)
    return None


def resolve_output_path(task: Task) -> str | None:
    for filename in ("report-data.json", "email-data.json"):
        data_file = task.folder / "output" / filename
        if not data_file.exists():
            continue
        try:
            data = json.loads(data_file.read_text(encoding="utf-8-sig"))
        except (ValueError, OSError):
            continue
        resolved = _resolve_report_file(task, data.get("workbook_path") if isinstance(data, dict) else None)
        if resolved:
            return resolved
    return None


MAX_EXTRA_OUTPUT_PATHS = 10


def resolve_output_paths(task: Task, primary: str | None = None) -> list[dict]:
    """Every file the Open button may offer: `[{label, path (absolute)}]`.

    The first entry is the single `workbook_path` (label None unless an
    `extra_paths` entry names the same file, which then supplies its label);
    after it come report-data.json's optional `extra_paths`
    (`[{label, path}]`, task-relative like `workbook_path`). Every path obeys
    the single-path rules and extras must additionally stay inside the task
    folder; entries that are malformed, missing, outside, or duplicates are
    skipped. The notification's list is the open endpoint's whitelist."""
    out: list[dict] = []
    primary = primary or resolve_output_path(task)
    if primary:
        out.append({"label": None, "path": primary})
    data = _read_report_data(task)
    extras = data.get("extra_paths") if data else None
    if not isinstance(extras, list):
        return out
    seen = {os.path.normcase(os.path.normpath(e["path"])) for e in out}
    for entry in extras[:MAX_EXTRA_OUTPUT_PATHS]:
        if not isinstance(entry, dict):
            continue
        label = entry.get("label")
        label = label.strip()[:80] if isinstance(label, str) and label.strip() else None
        resolved = _resolve_report_file(task, entry.get("path"), inside_task_only=True)
        if not resolved:
            continue
        key = os.path.normcase(os.path.normpath(resolved))
        if key in seen:
            same = next((e for e in out if os.path.normcase(os.path.normpath(e["path"])) == key), None)
            if same is not None and same["label"] is None and label:
                same["label"] = label  # the same file listed with a label: name it
            continue
        seen.add(key)
        out.append({"label": label, "path": resolved})
    return out


def resolve_outputs(task: Task) -> tuple[str | None, list[dict]]:
    """(outputPath, outputPaths) for a notification."""
    primary = resolve_output_path(task)
    return primary, resolve_output_paths(task, primary)


def push_notification(
    task: Task,
    kind: str,
    title: str,
    body: str,
    output_path: str | None = None,
    output_paths: list[dict] | None = None,
):
    if output_paths is None:
        output_paths = [{"label": None, "path": output_path}] if output_path else []
    task.notifications.append(
        {
            "id": str(uuid.uuid4()),
            "kind": kind,  # "task.review_ready" | "task.completed" | "task.failed"
            "title": title,
            "body": body,
            "outputPath": output_path,
            # every file the Open button may open (outputPath stays for older clients)
            "outputPaths": output_paths,
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }
    )
    del task.notifications[:-30]


def run_step(step: dict, cwd: Path, entry_id: str | None, task: "Task | None" = None) -> subprocess.CompletedProcess:
    kind = step["type"]
    raw_args = step.get("args", [])
    # replace(), not str.format(): args may legitimately contain other braces
    # (JSON payloads, regex) which str.format would choke on.
    args = [a.replace("{entryId}", entry_id) if entry_id else a for a in raw_args]
    if kind == "python":
        # -u: unbuffered stdout so a long-running step's progress lines stream
        # out as they're printed instead of being held until process exit.
        cmd = [STEP_PYTHON, "-u", step["cmd"], *args]
    elif kind == "powershell":
        cmd = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", step["cmd"], *args]
    else:
        raise ValueError(f"unknown step type {kind}")
    # stdin=DEVNULL: a headless step must never be able to block on interactive
    # input (e.g. PowerShell prompting for a missing mandatory parameter) -
    # without this it hangs forever instead of failing fast with a clear error.
    # stdout is streamed line-by-line and fed to task.log_step as it arrives so
    # the UI log tab updates live during the step rather than only at the end;
    # stderr is still captured whole (it's short, and only read on failure).
    proc = subprocess.Popen(
        cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, stdin=subprocess.DEVNULL, env=_step_env(),
        **STEP_POPEN_EXTRA_KWARGS,
    )
    out_lines: list[str] = []
    assert proc.stdout is not None
    for line in proc.stdout:
        out_lines.append(line)
        if task is not None:
            task.log_step(step["id"], "stdout", line)
    _, stderr = proc.communicate()
    return subprocess.CompletedProcess(cmd, proc.returncode, "".join(out_lines), stderr)


def _read_history() -> list[dict]:
    """Every run record in history.jsonl, in append order. A missing file,
    corrupt lines, and the header comment line are all skipped - the audit
    log must never take the API down."""
    try:
        lines = HISTORY_FILE.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    records = []
    for line in lines:
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(record, dict) and "run_id" in record:
            records.append(record)
    return records


# GET /tasks/<id>/history used to re-read and re-parse
# the whole (append-only, ever-growing) history.jsonl on every call. The parsed
# result is kept per (path, mtime_ns, size): an append changes the size and any
# rewrite changes the mtime, so a changed file is always re-read. The snapshot is
# shared between requests - callers must treat the records as read-only.
_history_cache: tuple | None = None  # (key, records, {task_id: records newest-first})
_history_lock = threading.Lock()


def _history_snapshot() -> tuple[list[dict], dict[str, list[dict]]]:
    """(records in append order, records per task newest-first), cached."""
    global _history_cache
    try:
        st = HISTORY_FILE.stat()
    except OSError:
        return [], {}
    key = (str(HISTORY_FILE), st.st_mtime_ns, st.st_size)
    cached = _history_cache
    if cached is not None and cached[0] == key:
        return cached[1], cached[2]
    records = _read_history()
    by_task: dict[str, list[dict]] = {}
    for record in reversed(records):
        task_id = record.get("task_id")
        if isinstance(task_id, str):
            by_task.setdefault(task_id, []).append(record)
    if not _racy(st.st_mtime_ns):
        with _history_lock:
            _history_cache = (key, records, by_task)
    return records, by_task


def _append_history(record: dict):
    # JSONL has no comment syntax, so the local-only note rides as a marked
    # first line that readers skip (it has no run_id).
    try:
        HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
        if not HISTORY_FILE.exists():
            HISTORY_FILE.write_text(json.dumps(HISTORY_HEADER) + "\n", encoding="utf-8")
        with HISTORY_FILE.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record) + "\n")
    except OSError:
        # A broken audit sink must not crash a real pipeline run.
        log.warning("failed to append run history", exc_info=True)


def _finalize_run_record(task: Task, outcome: str, error: str | None = None, cleanup: dict | None = None):
    """Write the terminal record for a started run, exactly once. Runs that
    never started (reject/reset from resting) have no run_started_at and leave no trace."""
    if task.run_started_at is None:
        return
    record = {
        "run_id": task.run_id,
        "task_id": task.id,
        "task_name": task.display_name,
        "started_at": task.run_started_at,
        "ended_at": datetime.now(timezone.utc).isoformat(),
        "outcome": outcome,
        "current_step_at_end": task.current_step,
        "error": error,
        "steps_completed": [s["id"] for s in task.steps if s["id"] in task.completed_steps],
        "approvals": list(task.approvals),
    }
    if cleanup is not None:
        # Counts only ({removed, bytes, skipped}): no file names in the audit log.
        record["cleanup"] = cleanup
    _append_history(record)
    task.run_id = None
    task.run_started_at = None
    task.approvals = []


def _fail_task(task: Task, step_id: str, error_text: str):
    set_state(task, "error", error=error_text, current_step=step_id)
    _finalize_run_record(task, "failed", error_text[:500])
    push_notification(
        task,
        "task.failed",
        f"{task.display_name}: hit an error",
        error_text[:300],
    )


def _finish_task(task: Task, steps: list[dict]):
    # Every successful finish funnels through here (python-only pipelines, runs
    # ended by a confirm/send), so this is the one place a task's `cleanup` runs. Failed runs, resets and rejects never reach it.
    cleanup = _cleanup_after_run(task)
    if steps:
        push_notification(
            task,
            "task.completed",
            f"{task.display_name}: task complete",
            (task.completed_message or "Sent successfully - nothing else needed from you.")
            + _cleanup_note(cleanup),
            *resolve_outputs(task),
        )
    # Record first: current_step must still name the last executed step.
    _finalize_run_record(task, "completed", cleanup=cleanup)
    set_state(task, "resting", current_step=None)


def _review_gate(task: Task, step: dict):
    set_state(task, "awaiting_review", current_step=step["id"])
    message = step.get("reviewMessage")
    if isinstance(message, str) and message.strip():
        # Manifest-supplied text (platform tasks that have no Outlook draft).
        push_notification(
            task,
            "task.review_ready",
            f"{task.display_name}: your review is needed",
            message.strip(),
            *resolve_outputs(task),
        )
        return
    push_notification(
        task,
        "task.review_ready",
        f"{task.display_name}: draft ready for your review",
        "The report's built and a draft is waiting in Outlook - take a look before it goes out.",
        *resolve_outputs(task),
    )


def _confirm_gate(task: Task, step: dict):
    set_state(task, "awaiting_send", current_step=step["id"])
    # Only manifest-opted-in confirm steps (reviewMessage present) notify; the
    # legacy confirm gates have never pushed a notification.
    message = step.get("reviewMessage")
    if isinstance(message, str) and message.strip():
        push_notification(
            task,
            "task.review_ready",
            f"{task.display_name}: your confirmation is needed",
            message.strip(),
            *resolve_outputs(task),
        )


async def run_steps(task: Task, steps: list[dict]):
    """Run each step's command as a subprocess until a gate pauses the task or
    the steps run out (already-completed steps are skipped)."""
    loop = asyncio.get_running_loop()
    _ensure_task_dirs(task)
    for step in steps:
        if step["type"] == "review":
            _review_gate(task, step)
            return
        if step["type"] == "confirm":
            _confirm_gate(task, step)
            return
        if step["id"] in task.completed_steps:
            continue  # already ran (a retry resumes after the last good step)

        set_state(task, task.state, current_step=step["id"])
        try:
            result = await loop.run_in_executor(None, run_step, step, task.folder, task.entry_id, task)
        except Exception as exc:
            # The step never launched (folder deleted mid-run, unknown step
            # type, missing interpreter). Without this, the exception dies in
            # the fire-and-forget task and it looks like the run just finished.
            _fail_task(task, step["id"], f"{type(exc).__name__}: {exc}")
            return
        if result.stderr:
            task.log_step(step["id"], "stderr", result.stderr)
        if result.returncode != 0:
            _fail_task(task, step["id"], (result.stderr or result.stdout)[-2000:])
            return
        task.completed_steps.add(step["id"])
        if step.get("capturesEntryId"):
            entry_file = task.folder / "output" / "draft-entry-id.txt"
            if entry_file.exists():
                task.entry_id = entry_file.read_text().strip()

    _finish_task(task, steps)


def _steps_after(task: Task, gate_id: str) -> list[dict] | None:
    # None when the gate id no longer exists in the manifest (edited mid-gate):
    # that must degrade to ok:false, not an unhandled StopIteration 500.
    idx = next((i for i, s in enumerate(task.steps) if s["id"] == gate_id), None)
    return None if idx is None else task.steps[idx + 1 :]


@app.get("/tasks")
async def list_tasks():
    return JSONResponse([t.to_dict() for t in tasks.values()])


@app.get("/tasks/{task_id}/history")
def task_history(task_id: str):
    """This task's run records from history.jsonl, newest first, capped."""
    if task_id not in tasks:
        return {"ok": False, "reason": "unknown task"}
    runs = _history_snapshot()[1].get(task_id, ())
    # Records written before the approver stamp existed gain an empty list.
    runs = [r if "approvals" in r else {**r, "approvals": []} for r in runs[:MAX_RUNS_PER_TASK]]
    return JSONResponse({"ok": True, "runs": runs})


@app.get("/tasks/{task_id}/log")
async def task_log(task_id: str):
    """This task's live per-step output for the current/most-recent run."""
    task = tasks.get(task_id)
    if not task:
        return {"ok": False, "reason": "unknown task"}
    return Response(task.log_json(), media_type="application/json")


@app.post("/tasks/{task_id}/start")
async def start_task(task_id: str):
    task = tasks.get(task_id)
    if not task:
        return {"ok": False, "reason": "unknown task"}
    if task.state not in ("resting", "error"):
        return {"ok": False, "reason": f"task is {task.state}"}
    missing = _missing_required_inputs(task)
    if missing:
        return {"ok": False, "reason": f"missing required input(s): {', '.join(missing)}", "missing": missing}
    is_retry = task.state == "error"
    # A retry resumes after whatever already completed rather than re-running
    # the whole pipeline - steps like create_draft have real-world side
    # effects (an Outlook draft), and re-running them on every retry after a
    # later step fails duplicates that side effect instead of fixing it.
    steps = task.steps
    entry_id = task.entry_id
    if is_retry:
        entry_file = task.folder / "output" / "draft-entry-id.txt"
        if not entry_id and entry_file.exists():
            entry_id = entry_file.read_text().strip()
        steps = [s for s in steps if s["id"] not in task.completed_steps]
    else:
        task.completed_steps.clear()
        task.step_output.clear()
        task.approvals = []
        entry_id = None
    task.run_id = str(uuid.uuid4())
    task.run_started_at = datetime.now(timezone.utc).isoformat()
    set_state(task, "working", error=None, entry_id=entry_id, current_step=None)
    asyncio.create_task(run_steps(task, steps))
    return {"ok": True}


@app.post("/tasks/{task_id}/approve")
async def approve_task(task_id: str):
    task = tasks.get(task_id)
    if not task:
        return {"ok": False, "reason": "unknown task"}
    if task.state != "awaiting_review":
        return {"ok": False, "reason": f"task is {task.state}"}
    # A review gate that carries an incident queue (review_incidents) must not
    # pass while anything is still unclassified - the whole point of pausing
    # before the build is that the build consumes the resolutions.
    if task.current_step == "review_incidents":
        pending = _pending_review_numbers(task)
        if pending:
            return {"ok": False, "reason": f"{len(pending)} incident(s) still need a Subcategory2", "pending": len(pending)}
    refusal = _gate_refusal(task)
    if refusal:
        return refusal
    remaining = _steps_after(task, task.current_step)
    if remaining is None:
        return {"ok": False, "reason": "gate no longer exists in the manifest - reset the task"}
    _stamp_approval(task, "approve")
    set_state(task, "working")
    asyncio.create_task(run_steps(task, remaining))
    return {"ok": True}


@app.post("/tasks/{task_id}/reject")
async def reject_task(task_id: str):
    task = tasks.get(task_id)
    if not task:
        return {"ok": False, "reason": "unknown task"}
    if task.state != "awaiting_review":
        return {"ok": False, "reason": f"task is {task.state}"}
    # A rejected run writes no record - outcomes are only completed/failed.
    task.run_id = None
    task.run_started_at = None
    task.approvals = []
    set_state(task, "resting", current_step=None, entry_id=None)
    return {"ok": True}


@app.post("/tasks/{task_id}/send")
async def send_task(task_id: str):
    task = tasks.get(task_id)
    if not task:
        return {"ok": False, "reason": "unknown task"}
    if task.state != "awaiting_send":
        return {"ok": False, "reason": f"task is {task.state}"}
    refusal = _gate_refusal(task)
    if refusal:
        return refusal
    remaining = _steps_after(task, task.current_step)
    if remaining is None:
        return {"ok": False, "reason": "gate no longer exists in the manifest - reset the task"}
    _stamp_approval(task, "send")
    set_state(task, "finishing")
    asyncio.create_task(run_steps(task, remaining))
    return {"ok": True}


@app.post("/tasks/{task_id}/reset")
async def reset_task(task_id: str):
    task = tasks.get(task_id)
    if not task:
        return {"ok": False, "reason": "unknown task"}
    task.completed_steps.clear()
    task.run_id = None
    task.run_started_at = None
    task.approvals = []
    set_state(task, "resting", error=None, current_step=None, entry_id=None)
    return {"ok": True}


# --- In-app incident review (monthly-report-deck) ---------------------------
# The task's prepare step writes output/review-incidents.json (the queue the
# human must classify, with the Subcategory2 option vocabulary). The Tasks app
# lists them, the human picks a Subcategory2 per incident, and the UI POSTs the
# choices here; the task's refresh step then folds review-resolutions.json into
# the staging workbook before building. Generic file names, but only tasks that
# actually emit a review queue respond with incidents - others 404 cleanly.

def _review_queue_path(task: Task) -> Path:
    return task.folder / "output" / "review-incidents.json"


def _resolutions_path(task: Task) -> Path:
    return task.folder / "output" / "review-resolutions.json"


def _read_review_queue(task: Task) -> dict | None:
    path = _review_queue_path(task)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def _read_resolutions(task: Task) -> dict:
    path = _resolutions_path(task)
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    entries = data.get("resolutions", data) if isinstance(data, dict) else data
    resolved = {}
    for entry in entries if isinstance(entries, list) else []:
        number = str(entry.get("number", "")).strip()
        subcategory2 = str(entry.get("subcategory2", "")).strip()
        if number and subcategory2 and subcategory2.lower() != "skip":
            resolved[number] = subcategory2
    return resolved


def _pending_review_numbers(task: Task) -> list[str]:
    queue = _read_review_queue(task)
    if not queue:
        return []
    resolved = _read_resolutions(task)
    return [str(i["number"]) for i in queue.get("incidents", []) if str(i.get("number")) not in resolved]


@app.get("/tasks/{task_id}/review-incidents")
async def review_incidents(task_id: str):
    task = tasks.get(task_id)
    if not task:
        return {"ok": False, "reason": "unknown task"}
    queue = _read_review_queue(task)
    if queue is None:
        return {"ok": True, "count": 0, "options": [], "incidents": []}
    resolved = _read_resolutions(task)
    incidents = [
        {**i, "resolved_subcategory2": resolved.get(str(i.get("number")))}
        for i in queue.get("incidents", [])
    ]
    pending = sum(1 for i in incidents if not i["resolved_subcategory2"])
    return {"ok": True, "count": len(incidents), "pending": pending,
            "options": queue.get("options", []), "incidents": incidents}


class ResolutionsRequest(BaseModel):
    resolutions: list[dict]


@app.post("/tasks/{task_id}/review-resolutions")
async def save_review_resolutions(task_id: str, req: ResolutionsRequest):
    task = tasks.get(task_id)
    if not task:
        return {"ok": False, "reason": "unknown task"}
    if _review_queue_path(task) is None:
        return {"ok": False, "reason": "this task has no review queue"}
    path = _resolutions_path(task)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"resolutions": req.resolutions}, indent=2), encoding="utf-8")
    return {"ok": True, "pending": len(_pending_review_numbers(task))}


def _open_with_default_app(path: str):
    # The task agents themselves stay Windows-only (Excel/Outlook COM) - this
    # just keeps the engine importable and testable off-Windows.
    system = platform.system()
    if system == "Windows":
        os.startfile(path)
    elif system == "Darwin":
        subprocess.Popen(["open", path])
    else:
        subprocess.Popen(["xdg-open", path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def _same_file(a: str, b: str) -> bool:
    return os.path.normcase(os.path.normpath(a)) == os.path.normcase(os.path.normpath(b))


@app.post("/tasks/{task_id}/notifications/{notif_id}/open")
async def open_notification_output(task_id: str, notif_id: str, path: str | None = None):
    """Opens the notification's file with the OS default app. Without `path`
    that is `outputPath`; with `path` it must be one of the notification's own
    `outputPaths` (the whitelist) - anything else is refused. Whatever the
    source, the file must still exist inside the task folder."""
    task = tasks.get(task_id)
    if not task:
        return {"ok": False, "reason": "unknown task"}
    notif = next((n for n in task.notifications if n["id"] == notif_id), None)
    if not notif or not (notif.get("outputPath") or notif.get("outputPaths")):
        return {"ok": False, "reason": "no output file for this notification"}
    if path is None:
        target = notif.get("outputPath")
        if not target:
            return {"ok": False, "reason": "no output file for this notification"}
    else:
        listed = [e.get("path") for e in notif.get("outputPaths") or [] if isinstance(e, dict)]
        # open the notification's own string, never the caller's
        target = next((p for p in listed if isinstance(p, str) and _same_file(p, path)), None)
        if target is None:
            return {"ok": False, "reason": "that file is not part of this notification"}
    resolved = Path(target).resolve()
    if not resolved.is_relative_to(task.folder.resolve()) or not resolved.exists():
        return {"ok": False, "reason": "file not available"}
    _open_with_default_app(str(resolved))
    return {"ok": True}


# --- Task platform: inputs, forms, diff gates, approver stamp ----------------
# Manifest-driven additions (see tasks/TASK-PLATFORM-CONTRACT.md). Every
# endpoint replies HTTP 200 with {ok, reason?}. None of this touches Outlook:
# the only process it ever spawns is a manifest-declared `prepare` python
# script, run with this engine's interpreter. Every file it reads or writes
# stays inside the task's own input/ or output/ folder (no traversal, no
# symlinks/junctions), and writes are atomic (temp file + os.replace).

MAX_UPLOAD_BYTES = 50 * 1024 * 1024
PREPARE_TIMEOUT_SECONDS = 120
_DENIED_UPLOAD_EXTENSIONS = {
    ".exe", ".dll", ".bat", ".cmd", ".com", ".scr", ".msi", ".ps1", ".psm1",
    ".vbs", ".vbe", ".js", ".jse", ".wsf", ".lnk", ".py", ".pyw", ".sh", ".jar",
}
_PARAMS_REL = "input/run-params.json"
_UPLOAD_META_REL = "input/.uploads-meta.json"
_DEFAULT_OPTIONS_REL = "output/options.json"
_DEFAULT_FLAGS_REL = "output/flags.json"


class _Refusal(Exception):
    """A request the platform declines; becomes {ok: false, reason, **extra}."""

    def __init__(self, reason: str, **extra):
        super().__init__(reason)
        self.reason = reason
        self.extra = extra

    def payload(self) -> dict:
        return {"ok": False, "reason": self.reason, **self.extra}


def _step_gate(step: dict) -> dict | None:
    """The step's manifest gate as {type, ...file names}, or None."""
    gate = step.get("gate")
    if not isinstance(gate, dict) or not isinstance(gate.get("type"), str):
        return None
    return dict(gate)


def _is_link(path: Path) -> bool:
    is_junction = getattr(path, "is_junction", None)
    return path.is_symlink() or bool(is_junction and is_junction())


# Folders every task expects to find in its own folder. They are gitignored and
# not shipped in the installer, so a fresh checkout or install has none of them
# and several scripts write into output/ without creating it.
TASK_DATA_FOLDERS = ("input", "output", "config")


def _manifest_data_paths(task: Task) -> list:
    """Every data path the manifest names: input dests, options files, gate files."""
    paths = []
    for inp in task.inputs:
        paths += [inp.get("dest"), inp.get("optionsFile")]
    for step in task.steps:
        gate = _step_gate(step) or {}
        paths += [gate.get(key) for key in ("schema", "answers", "file")]
    return paths


def _ensure_task_dirs(task: Task) -> None:
    """Create the task's data folders (and the folders its manifest paths live
    in) when missing. Never follows a link, never leaves the task folder, and a
    failure is only logged: the step then reports its own, clearer error."""
    wanted = {Path(name) for name in TASK_DATA_FOLDERS}
    for rel in _manifest_data_paths(task):
        if not isinstance(rel, str) or "\x00" in rel or ":" in rel or rel.startswith(("/", "\\")):
            continue
        parts = [p for p in rel.replace("\\", "/").split("/") if p not in ("", ".")]
        if len(parts) < 2 or ".." in parts or parts[0] not in TASK_DATA_FOLDERS:
            continue
        wanted.add(Path(*parts[:-1]))
    for rel in sorted(wanted, key=lambda r: len(r.parts)):
        path = task.folder / rel
        try:
            if any(_is_link(task.folder.joinpath(*rel.parts[: i + 1])) for i in range(len(rel.parts))):
                continue
            path.mkdir(parents=True, exist_ok=True)
        except OSError:
            log.warning("could not create %s", path, exc_info=True)


# --- poll-path caches ----------------------------------------------------------
# The Tasks app polls GET /tasks every 2 s and, while a task dialog
# is open, /log + /inputs (+ form/flags/diff/history on open). Everything below
# exists so those GETs do not redo expensive work (path realpath calls, JSON
# parsing, file hashing) when nothing on disk changed. Every cache is bounded,
# guarded by one lock, and keyed so that a changed file can never be served
# stale: (path, mtime_ns, size) for file content, an lstat signature of every
# path component for the symlink/junction validation.

_cache_lock = threading.Lock()
# A file modified within this window is not cached: a rewrite with the same size
# inside one filesystem timestamp tick (NTFS ~15 ms, FAT/network shares 2 s)
# would otherwise be indistinguishable from "unchanged".
_RACY_WINDOW_NS = 2_000_000_000


def _racy(mtime_ns: int) -> bool:
    return time.time_ns() - mtime_ns < _RACY_WINDOW_NS


def _lstat_signature(path: Path):
    """((mode, inode, device, attributes, reparse tag), is_link) from ONE lstat;
    (None, False) when the path does not exist. A directory swapped for a
    junction/symlink changes the attributes/reparse tag, so the signature moves."""
    try:
        st = os.lstat(path)
    except OSError:
        return None, False
    sig = (st.st_mode, st.st_ino, st.st_dev, getattr(st, "st_file_attributes", 0), getattr(st, "st_reparse_tag", 0))
    return sig, _stat_is_link(st)


_RESOLVE_MEMO_MAX = 256
_resolve_memo: "OrderedDict[tuple, tuple[tuple, Path]]" = OrderedDict()


def _resolve_in_task(task: Task, rel, roots: tuple[str, ...] = ("input", "output"), *, memo: bool = False) -> Path:
    """Map a task-relative path from a manifest onto disk, refusing anything
    that is not strictly inside <task>/<root> for one of `roots`: absolute
    paths, drive letters / NTFS streams, '..', and any symlink or junction
    along the way.

    `memo=True` (read-only polling paths) skips the two expensive realpath calls
    when every component's lstat signature is unchanged since the last full
    validation of the same path; every link check still runs on every call."""
    if not isinstance(rel, str) or not rel.strip():
        raise _Refusal("a file path is required")
    if "\x00" in rel or ":" in rel or rel.startswith(("/", "\\")):
        raise _Refusal(f"path not allowed: {rel}")
    parts = [p for p in rel.replace("\\", "/").split("/") if p not in ("", ".")]
    if len(parts) < 2 or ".." in parts or parts[0] not in roots:
        raise _Refusal(f"path must be inside the task's {' or '.join(r + '/' for r in roots)} folder: {rel}")
    current = task.folder
    if not memo:
        for part in parts:
            current = current / part
            if _is_link(current):
                raise _Refusal(f"symbolic links are not allowed: {rel}")
        if not current.resolve().is_relative_to(task.folder.resolve() / parts[0]):
            raise _Refusal(f"path escapes the task folder: {rel}")
        return current
    signature = [_lstat_signature(current)[0]]
    for part in parts:
        current = current / part
        sig, is_link = _lstat_signature(current)
        if is_link:
            raise _Refusal(f"symbolic links are not allowed: {rel}")
        signature.append(sig)
    signature = tuple(signature)
    key = (str(task.folder), tuple(parts))
    with _cache_lock:
        hit = _resolve_memo.get(key)
        if hit is not None and hit[0] == signature:
            _resolve_memo.move_to_end(key)
            return hit[1]
    if not current.resolve().is_relative_to(task.folder.resolve() / parts[0]):
        raise _Refusal(f"path escapes the task folder: {rel}")
    with _cache_lock:
        _resolve_memo[key] = (signature, current)
        _resolve_memo.move_to_end(key)
        while len(_resolve_memo) > _RESOLVE_MEMO_MAX:
            _resolve_memo.popitem(last=False)
    return current


def _atomic_write_bytes(path: Path, data: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.parent / f".{path.name}.{uuid.uuid4().hex}.tmp"
    try:
        tmp.write_bytes(data)
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def _atomic_write_json(path: Path, data):
    _atomic_write_bytes(path, (json.dumps(data, indent=2) + "\n").encode("utf-8"))


# Parsed-object cache: meant for the small run-params / upload-meta files read on
# every /inputs poll. A parsed object costs several times its file size in memory,
# so larger files are never held here (the big gate files are cached as
# serialised response bytes instead, see _body_cache below).
_JSON_CACHE_MAX_ENTRIES = 32
_JSON_CACHE_MAX_FILE_BYTES = 1024 * 1024
_JSON_CACHE_MAX_TOTAL_BYTES = 8 * 1024 * 1024  # sum of the cached files' sizes
_INVALID_JSON = object()
_json_cache: "OrderedDict[tuple[str, int, int], object]" = OrderedDict()
_json_cache_bytes = 0


def _json_cache_put(key: tuple[str, int, int], value):
    global _json_cache_bytes
    size = key[2]
    if size > _JSON_CACHE_MAX_FILE_BYTES:
        return
    with _cache_lock:
        if key in _json_cache:
            _json_cache.move_to_end(key)
            return
        _json_cache[key] = value
        _json_cache_bytes += size
        while len(_json_cache) > _JSON_CACHE_MAX_ENTRIES or _json_cache_bytes > _JSON_CACHE_MAX_TOTAL_BYTES:
            old_key, _ = _json_cache.popitem(last=False)
            _json_cache_bytes -= old_key[2]


def _read_json_cached(path: Path):
    """Parsed JSON of an already validated path: None when it is not a regular
    file, `_INVALID_JSON` when it cannot be parsed. Cached per (path, mtime_ns,
    size). The returned object is shared - callers must not mutate it."""
    try:
        st = path.stat()
    except OSError:
        return None
    if not stat.S_ISREG(st.st_mode):
        return None
    key = (str(path), st.st_mtime_ns, st.st_size)
    with _cache_lock:
        if key in _json_cache:
            _json_cache.move_to_end(key)
            return _json_cache[key]
    try:
        value = json.loads(path.read_text(encoding="utf-8-sig"))
    except OSError:
        return _INVALID_JSON  # locked / vanished mid-read: reported now, never remembered
    except ValueError:  # bad JSON or bad UTF-8: stays bad until the file changes
        value = _INVALID_JSON
    if not _racy(st.st_mtime_ns):
        _json_cache_put(key, value)
    return value


def _read_json_rel(task: Task, rel, roots: tuple[str, ...] = ("input", "output"), *, cached: bool = False):
    """Parsed JSON at a task-relative path; None when the file does not exist.
    Raises _Refusal for unsafe paths or unparseable content.

    `cached=True` is for read-only GET handlers: the path check and the parse are
    memoised on filesystem state and the result is SHARED (never mutate it).
    Everything that modifies what it read keeps the default fresh read."""
    if cached:
        value = _read_json_cached(_resolve_in_task(task, rel, roots, memo=True))
        if value is _INVALID_JSON:
            raise _Refusal(f"{rel} is not valid JSON")
        return value
    path = _resolve_in_task(task, rel, roots)
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        raise _Refusal(f"{rel} is not valid JSON") from None


# Serialised JSON response bodies of the gate GETs (form / flags / diff / options),
# which can be megabytes: keyed by the (path, mtime_ns, size) of every file the
# body was built from, so any change to any of them is a miss. Bounded by entry
# count and total bytes (a body over the per-body cap is simply not kept).
_BODY_CACHE_MAX_ENTRIES = 16
_BODY_CACHE_MAX_BODY_BYTES = 16 * 1024 * 1024
_BODY_CACHE_MAX_TOTAL_BYTES = 32 * 1024 * 1024
_body_cache: "OrderedDict[tuple, bytes]" = OrderedDict()
_body_cache_bytes = 0


def _file_key(path: Path):
    """(path, mtime_ns, size) of a regular file, None when absent / not a file."""
    try:
        st = path.stat()
    except OSError:
        return None
    if not stat.S_ISREG(st.st_mode):
        return None
    return (str(path), st.st_mtime_ns, st.st_size)


def _body_key(task: Task, tag: str, *rels):
    """Cache key for a response built from these task-relative files, or None
    when it cannot be formed (bad path etc.: the uncached code path then raises
    exactly the refusal it always did)."""
    key = [tag, str(task.folder), *map(str, rels)]
    try:
        for rel in rels:
            key.append(_file_key(_resolve_in_task(task, rel, memo=True)))
    except _Refusal:
        return None
    return tuple(key)


def _body_get(key):
    if key is None:
        return None
    with _cache_lock:
        body = _body_cache.get(key)
        if body is not None:
            _body_cache.move_to_end(key)
        return body


def _body_put(key, body: bytes):
    global _body_cache_bytes
    if key is None or len(body) > _BODY_CACHE_MAX_BODY_BYTES:
        return
    if any(isinstance(part, tuple) and _racy(part[1]) for part in key):
        return  # a file written moments ago may still change within the same timestamp tick
    with _cache_lock:
        old = _body_cache.pop(key, None)
        if old is not None:
            _body_cache_bytes -= len(old)
        _body_cache[key] = body
        _body_cache_bytes += len(body)
        while len(_body_cache) > _BODY_CACHE_MAX_ENTRIES or _body_cache_bytes > _BODY_CACHE_MAX_TOTAL_BYTES:
            _, evicted = _body_cache.popitem(last=False)
            _body_cache_bytes -= len(evicted)


def _json_reply(key, build):
    """JSON response for `build()` (a dict), served from the body cache when the
    source files are unchanged. A _Refusal raised by build() is never cached."""
    body = _body_get(key)
    if body is None:
        response = JSONResponse(build())
        _body_put(key, response.body)
        return response
    return Response(body, media_type="application/json")


_SHA_CACHE_MAX = 32
# (path, mtime_ns, size) -> sha256 hex, least recently used first.
_sha_cache: "OrderedDict[tuple[str, int, int], str]" = OrderedDict()


def _sha_cache_put(key: tuple[str, int, int], digest: str):
    with _cache_lock:
        _sha_cache[key] = digest
        _sha_cache.move_to_end(key)
        while len(_sha_cache) > _SHA_CACHE_MAX:
            _sha_cache.popitem(last=False)  # evict the stalest entry only (was: clear everything)


def _file_info(path: Path, st: os.stat_result | None = None) -> dict:
    st = st or path.stat()
    key = (str(path), st.st_mtime_ns, st.st_size)
    with _cache_lock:
        digest = _sha_cache.get(key)
        if digest is not None:
            _sha_cache.move_to_end(key)
    if digest is None:
        h = hashlib.sha256()
        with path.open("rb") as fh:
            for chunk in iter(lambda: fh.read(1024 * 1024), b""):
                h.update(chunk)
        digest = h.hexdigest()
        _sha_cache_put(key, digest)
    return {"size": st.st_size, "sha256": digest}


def _task_or_refusal(task_id: str) -> Task:
    task = tasks.get(task_id)
    if not task:
        raise _Refusal("unknown task")
    return task


def _input_def(task: Task, input_id) -> dict:
    found = next((i for i in task.inputs if i.get("id") == input_id), None)
    if found is None:
        raise _Refusal(f"unknown input: {input_id}")
    return found


def _require_resting(task: Task):
    if task.state != "resting":
        raise _Refusal(f"task is {task.state}")
    if task.preparing:
        raise _Refusal("prepare is running")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _saved_params(task: Task, *, cached: bool = False) -> dict:
    # cached=True returns a SHARED dict: read-only callers (GET /inputs) only.
    try:
        data = _read_json_rel(task, _PARAMS_REL, cached=cached)
    except _Refusal:
        return {}
    params = data.get("params") if isinstance(data, dict) else None
    return params if isinstance(params, dict) else {}


def _read_upload_meta(task: Task, *, cached: bool = False) -> dict:
    # cached=True returns a SHARED dict: read-only callers (GET /inputs) only.
    try:
        data = _read_json_rel(task, _UPLOAD_META_REL, cached=cached)
    except _Refusal:
        return {}
    return data if isinstance(data, dict) else {}


def _file_input_path(task: Task, inp: dict, *, memo: bool = False) -> Path | None:
    """Existing file for a `file` input, or None when absent/unsafe."""
    try:
        path = _resolve_in_task(task, inp.get("dest"), roots=("input",), memo=memo)
    except _Refusal:
        return None
    return path if path.is_file() else None


def _input_present(task: Task, inp: dict, params: dict | None = None) -> bool:
    if inp.get("type") == "select":
        value = (params if params is not None else _saved_params(task)).get(inp["id"])
        return value not in (None, "")
    return _file_input_path(task, inp) is not None


def _missing_required_inputs(task: Task) -> list[str]:
    if not task.inputs:
        return []
    params = _saved_params(task)
    return [
        i["id"] for i in task.inputs
        if i.get("required") and i.get("type") in ("file", "select") and not _input_present(task, i, params)
    ]


def _options_rel(task: Task) -> str:
    for inp in task.inputs:
        if inp.get("type") == "select" and isinstance(inp.get("optionsFile"), str):
            return inp["optionsFile"]
    return _DEFAULT_OPTIONS_REL


def _invalidate_prepared_state(task: Task, input_id: str):
    """Re-uploading an input the prepare step reads makes its options (and any
    select choices made from them) stale - drop both so they must be redone."""
    after = (task.prepare or {}).get("after") or []
    if input_id not in after:
        return
    try:
        _resolve_in_task(task, _options_rel(task)).unlink(missing_ok=True)
    except (_Refusal, OSError):
        pass
    params = _saved_params(task)
    select_ids = {i["id"] for i in task.inputs if i.get("type") == "select"}
    kept = {k: v for k, v in params.items() if k not in select_ids}
    if kept != params:
        _atomic_write_json(_resolve_in_task(task, _PARAMS_REL), {"params": kept, "saved_at": _utc_now()})


async def _json_body(request: Request, key: str) -> dict:
    try:
        body = await request.json()
    except ValueError:
        raise _Refusal("request body must be JSON") from None
    value = body.get(key) if isinstance(body, dict) else None
    if not isinstance(value, dict):
        raise _Refusal(f"body must be an object with a '{key}' object")
    return value


# --- input cleanup ("kept on file" vs. cleared after a run) --------------------
# A manifest `cleanup: {"onComplete": true, "keep": ["input/..."]}` makes the
# engine delete the task's uploaded input files once a run finishes
# SUCCESSFULLY (the person's real data should not linger on disk), and
# POST /tasks/{id}/cleanup does the same on demand while the task is resting.
# One helper (_cleanup_inputs) serves both. It only ever removes regular files
# below <task>/input/: inputs flagged `persist`, `cleanup.keep` paths, dotfiles
# and run bookkeeping are never swept as input files, symlinks/junctions are
# never followed or removed, and a file that cannot be deleted (open in Excel)
# is skipped and counted - it never fails the run. Nothing under output/ is
# touched except the stale prepare options file.

_CLEANUP_BOOKKEEPING = {"run-params.json", ".uploads-meta.json"}  # at input/ root


def _parse_cleanup(raw) -> dict | None:
    """The manifest's cleanup object normalised to {onComplete, keep}, or None
    (absent/malformed = the task never cleans up). `onComplete` must be a real
    `true`: deleting files is always an explicit opt-in."""
    if not isinstance(raw, dict):
        return None
    keep = raw.get("keep")
    return {
        "onComplete": raw.get("onComplete") is True,
        "keep": [k.strip() for k in keep if isinstance(k, str) and k.strip()] if isinstance(keep, list) else [],
    }


def _stat_is_link(st: os.stat_result) -> bool:
    """True for a symlink or an NTFS junction/mount point (from an lstat)."""
    if stat.S_ISLNK(st.st_mode):
        return True
    return getattr(st, "st_reparse_tag", 0) in (stat.IO_REPARSE_TAG_SYMLINK, stat.IO_REPARSE_TAG_MOUNT_POINT)


def _inside(path: str, root: str) -> bool:
    a, b = os.path.normcase(path), os.path.normcase(root)
    try:
        return os.path.commonpath([a, b]) == b
    except ValueError:  # different drives
        return False


def _input_relative(rel) -> str | None:
    """'input/a/B.xlsx' -> 'a/b.xlsx' (case-folded, '/'-separated), or None
    when the text is not a safe path below input/."""
    if not isinstance(rel, str) or "\x00" in rel or ":" in rel or rel.startswith(("/", "\\")):
        return None
    parts = [p for p in rel.replace("\\", "/").split("/") if p not in ("", ".")]
    if len(parts) < 2 or ".." in parts or parts[0].casefold() != "input":
        return None
    return "/".join(parts[1:]).casefold()


def _cleanup_keep_set(task: Task) -> set[str]:
    """Input-relative paths (files or folders) a cleanup must leave alone:
    every `persist` input's dest plus the manifest's `cleanup.keep`."""
    keep = set()
    for inp in task.inputs:
        if inp.get("persist") is True and (rel := _input_relative(inp.get("dest"))):
            keep.add(rel)
    for entry in (task.cleanup or {}).get("keep", []):
        if rel := _input_relative(entry):
            keep.add(rel)
    return keep


def _is_kept(rel: str, keep: set[str]) -> bool:
    parts = rel.split("/")
    return any("/".join(parts[:i]) in keep for i in range(1, len(parts) + 1))


_REALPATH_MEMO_MAX = 64
_realpath_memo: "OrderedDict[str, tuple[tuple, str]]" = OrderedDict()


def _realpath_cached(path) -> str:
    """os.path.realpath, remembered while the path's own lstat signature is
    unchanged. For READ-ONLY reporting only (GET /inputs' cleanable counts): a
    cleanup that deletes files always calls os.path.realpath fresh."""
    key = os.fspath(path)
    signature, _ = _lstat_signature(key)
    with _cache_lock:
        hit = _realpath_memo.get(key)
        if hit is not None and signature is not None and hit[0] == signature:
            _realpath_memo.move_to_end(key)
            return hit[1]
    real = os.path.realpath(key)
    if signature is not None:
        with _cache_lock:
            _realpath_memo[key] = (signature, real)
            _realpath_memo.move_to_end(key)
            while len(_realpath_memo) > _REALPATH_MEMO_MAX:
                _realpath_memo.popitem(last=False)
    return real


def _cleanup_plan(task: Task, *, memo: bool = False) -> dict:
    """What a cleanup would remove right now, without removing anything:
    {files: [(path, size)], dirs: [path], skipped: n, root: realpath|None}.
    The walk uses lstat everywhere and never descends into a link.
    `memo=True` (GET /inputs' read-only counts) reuses remembered realpaths."""
    plan = {"files": [], "dirs": [], "skipped": 0, "root": None}
    root = task.folder / "input"
    try:
        st = os.lstat(root)
    except OSError:
        return plan  # no input folder: nothing to clean
    real = _realpath_cached if memo else os.path.realpath
    root_real = real(root)
    if _stat_is_link(st) or not stat.S_ISDIR(st.st_mode) or not _inside(root_real, os.path.join(real(task.folder), "input")):
        plan["skipped"] = 1  # a linked/odd input folder is never touched
        return plan
    plan["root"] = root_real
    keep = _cleanup_keep_set(task)
    stack = [(str(root), "")]
    while stack:
        dirpath, rel = stack.pop()
        try:
            with os.scandir(dirpath) as it:
                entries = list(it)
        except OSError:
            plan["skipped"] += 1
            continue
        for entry in entries:
            if entry.name.startswith("."):
                continue  # .gitkeep and other dotfiles/folders stay
            try:
                st = entry.stat(follow_symlinks=False)
            except OSError:
                plan["skipped"] += 1
                continue
            if _stat_is_link(st):
                plan["skipped"] += 1  # never followed, never deleted
                continue
            child = f"{rel}/{entry.name}" if rel else entry.name
            if _is_kept(child.casefold(), keep):
                continue
            if stat.S_ISDIR(st.st_mode):
                plan["dirs"].append(entry.path)
                stack.append((entry.path, child))
            elif stat.S_ISREG(st.st_mode):
                if not rel and entry.name.casefold() in _CLEANUP_BOOKKEEPING:
                    continue  # run bookkeeping is cleared separately and not counted
                plan["files"].append((entry.path, st.st_size))
    return plan


def _drop_bookkeeping(task: Task):
    """After a cleanup: forget the saved select choices, the upload records of
    files that are gone, and the (now stale) prepare options. Every step is
    best effort and path-gated; a refusal or OS error just leaves the file."""
    try:
        _resolve_in_task(task, _PARAMS_REL, roots=("input",)).unlink(missing_ok=True)
    except (_Refusal, OSError):
        pass
    try:
        meta = _read_upload_meta(task)
        kept_ids = {i["id"] for i in task.inputs if i.get("type") == "file" and _file_input_path(task, i) is not None}
        gone = [input_id for input_id in meta if input_id not in kept_ids]
        if gone:
            for input_id in gone:
                meta.pop(input_id, None)
            meta_path = _resolve_in_task(task, _UPLOAD_META_REL, roots=("input",))
            if meta:
                _atomic_write_json(meta_path, meta)
            else:
                meta_path.unlink(missing_ok=True)
    except (_Refusal, OSError):
        pass
    if task.prepare or any(i.get("type") == "select" for i in task.inputs):
        # Only a task that has a prepare step owns an options file; for any
        # other task output/options.json could be somebody's real output.
        try:
            _resolve_in_task(task, _options_rel(task), roots=("output",)).unlink(missing_ok=True)
        except (_Refusal, OSError):
            pass


def _cleanup_inputs(task: Task) -> dict:
    """Delete this task's non-persistent input files. Returns the counts
    {removed, bytes, skipped}. The caller guarantees the task is not running."""
    plan = _cleanup_plan(task)
    removed = freed = 0
    skipped = plan["skipped"]
    root_real = plan["root"]
    if root_real is None:
        return {"removed": 0, "bytes": 0, "skipped": skipped}
    for path, size in plan["files"]:
        try:
            st = os.lstat(path)
            if _stat_is_link(st) or not stat.S_ISREG(st.st_mode) or not _inside(os.path.realpath(path), root_real):
                skipped += 1  # swapped for a link/outside file since the scan
                continue
            os.remove(path)
        except OSError:
            skipped += 1  # locked (open in Excel), read-only, vanished...
            continue
        removed += 1
        freed += size
    for dirpath in sorted(plan["dirs"], key=len, reverse=True):  # deepest first
        try:
            if _inside(os.path.realpath(dirpath), root_real):
                os.rmdir(dirpath)  # only succeeds when empty
        except OSError:
            pass
    _drop_bookkeeping(task)
    return {"removed": removed, "bytes": freed, "skipped": skipped}


def _cleanup_after_run(task: Task) -> dict | None:
    """The success-path hook: clean up when the manifest asks for it. Never
    raises - cleanup trouble must not turn a completed run into a failure."""
    if not task.cleanup or not task.cleanup.get("onComplete"):
        return None
    try:
        return _cleanup_inputs(task)
    except Exception:
        log.warning("input cleanup failed for %s", task.id, exc_info=True)
        return {"removed": 0, "bytes": 0, "skipped": 0}


def _format_bytes(n: int) -> str:
    if n < 1024:
        return f"{n} B"
    if n < 1024 * 1024:
        return f"{n / 1024:.1f} KB"
    return f"{n / (1024 * 1024):.1f} MB"


def _cleanup_note(cleanup: dict | None) -> str:
    """Sentence(s) appended to the completion notification; '' when there is
    nothing to say (no cleanup configured, or nothing was in the folder)."""
    if not cleanup:
        return ""
    note = ""
    if cleanup["removed"]:
        n = cleanup["removed"]
        note += f" Cleaned up {n} input file{'s' if n != 1 else ''} ({_format_bytes(cleanup['bytes'])})."
    if cleanup["skipped"]:
        n = cleanup["skipped"]
        note += f" {n} input file{'s' if n != 1 else ''} could not be removed (open in another program?)."
    return note


# --- inputs / upload / prepare / options / params ---------------------------

# The disk-reading poll GETs (inputs, form, diff, flags, history) are plain `def`
# handlers on purpose: FastAPI runs them in its worker-thread pool, so a cold
# cache (first hash of an uploaded file, first parse of a big gate file) never
# stalls the event loop that also serves the 2-second /tasks poll.

@app.get("/tasks/{task_id}/inputs")
def get_inputs(task_id: str):
    try:
        task = _task_or_refusal(task_id)
        # Poll path: shared cached reads, and each file input is resolved ONCE
        # (it used to be resolved twice: once for `present`, once for the details).
        params = _saved_params(task, cached=True)
        meta = _read_upload_meta(task, cached=True)
        out = []
        for inp in task.inputs:
            is_select = inp.get("type") == "select"
            path = None if is_select else _file_input_path(task, inp, memo=True)
            if is_select:
                present = params.get(inp["id"]) not in (None, "")  # same rule as _input_present
            else:
                present = path is not None
            item = {
                "id": inp["id"],
                "label": inp.get("label", inp["id"]),
                "type": inp.get("type"),
                "required": bool(inp.get("required")),
                "persist": inp.get("persist") is True,
                "present": present,
                "modified": None,
            }
            if inp.get("type") == "file" and path is not None:
                recorded = meta.get(inp["id"])
                name = recorded.get("filename") if isinstance(recorded, dict) else None
                item["filename"] = name if isinstance(name, str) and name else path.name
                st = path.stat()
                item.update(_file_info(path, st))
                item["modified"] = datetime.fromtimestamp(st.st_mtime, timezone.utc).isoformat()
            out.append(item)
        cleanable = {"files": 0, "bytes": 0}
        if task.cleanup is not None or task.inputs:
            files = _cleanup_plan(task, memo=True)["files"]
            cleanable = {"files": len(files), "bytes": sum(size for _path, size in files)}
        return JSONResponse({"ok": True, "inputs": out, "params": params, "cleanable": cleanable})
    except _Refusal as exc:
        return exc.payload()


@app.post("/tasks/{task_id}/cleanup")
async def cleanup_task(task_id: str):
    """Clear the task's input files on demand. Only while resting; the check
    and the deletion run without an await in between, so a run cannot begin
    halfway through."""
    try:
        task = _task_or_refusal(task_id)
        if task.cleanup is None and not task.inputs:
            raise _Refusal("Nothing to clean")
        _require_resting(task)
        return {"ok": True, **_cleanup_inputs(task)}
    except _Refusal as exc:
        return exc.payload()


def _client_filename(raw) -> str:
    return str(raw or "").replace("\\", "/").rsplit("/", 1)[-1].strip()


def _store_upload(task: Task, input_id: str, client_name, stream) -> dict:
    """Validate and persist one uploaded file (blocking; runs in a worker thread)."""
    _require_resting(task)
    inp = _input_def(task, input_id)
    if inp.get("type") != "file":
        raise _Refusal(f"input '{input_id}' is not a file input")
    filename = _client_filename(client_name)
    if not filename:
        raise _Refusal("no file was provided")
    accept = [a.lower() for a in (inp.get("accept") or []) if isinstance(a, str)]
    ext = Path(filename).suffix.lower()
    if not accept:
        raise _Refusal(f"input '{input_id}' declares no accepted file types")
    if ext in _DENIED_UPLOAD_EXTENSIONS or ext not in accept:
        raise _Refusal(f"file type '{ext or filename}' is not accepted (allowed: {', '.join(accept)})")
    dest = _resolve_in_task(task, inp.get("dest"), roots=("input",))
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.parent / f".{dest.name}.{uuid.uuid4().hex}.upload"
    digest = hashlib.sha256()
    size = 0
    try:
        with tmp.open("wb") as out:
            while True:
                chunk = stream.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise _Refusal(f"file is larger than the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit")
                digest.update(chunk)
                out.write(chunk)
        if size == 0:
            raise _Refusal("the uploaded file is empty")
        try:
            os.replace(tmp, dest)
        except OSError as exc:
            raise _Refusal(f"could not save the file (is it open in another program?): {exc}") from None
    finally:
        tmp.unlink(missing_ok=True)
    try:
        # The digest was computed while streaming: record it for GET /inputs so
        # the first poll after an upload does not re-read the whole file.
        st = os.stat(dest)
        if st.st_size == size:
            _sha_cache_put((str(dest), st.st_mtime_ns, st.st_size), digest.hexdigest())
    except OSError:
        pass
    meta = _read_upload_meta(task)
    meta[input_id] = {"filename": filename, "uploaded_at": _utc_now()}
    _atomic_write_json(_resolve_in_task(task, _UPLOAD_META_REL), meta)
    _invalidate_prepared_state(task, input_id)
    return {"ok": True, "input": input_id, "filename": filename, "size": size, "sha256": digest.hexdigest()}


def _register_upload_route(target_app: FastAPI, multipart_available: bool):
    """POST /tasks/{id}/upload needs python-multipart. Without it FastAPI
    refuses to even declare a File() route (a crash at import time), so fall
    back to a route that explains the problem instead."""
    if not multipart_available:
        @target_app.post("/tasks/{task_id}/upload")
        async def upload_unavailable(task_id: str):
            return {"ok": False, "reason": "file upload is unavailable: install python-multipart (pip install -r tasks-engine/requirements.txt)"}
        return

    @target_app.post("/tasks/{task_id}/upload")
    def upload_input(task_id: str, input_id: str | None = Query(None, alias="input"), file: UploadFile | None = File(None)):
        # Plain def: FastAPI runs it in a worker thread, so a large copy never blocks the event loop.
        try:
            task = _task_or_refusal(task_id)
            if not input_id:
                raise _Refusal("query parameter 'input' is required")
            if file is None:
                raise _Refusal("multipart field 'file' is required")
            return _store_upload(task, input_id, file.filename, file.file)
        except _Refusal as exc:
            return exc.payload()


def _multipart_installed() -> bool:
    for module in ("python_multipart", "multipart"):
        try:
            __import__(module)
            return True
        except ImportError:
            continue
    return False


_register_upload_route(app, _multipart_installed())


def _run_prepare(task: Task, cmd_path: Path) -> subprocess.CompletedProcess:
    # No shell, stdin closed, the task's own folder as cwd, the engine's python.
    _ensure_task_dirs(task)
    return subprocess.run(
        [STEP_PYTHON, "-u", str(cmd_path)],
        cwd=task.folder, stdin=subprocess.DEVNULL, capture_output=True, env=_step_env(),
        text=True, encoding="utf-8", errors="replace",
        timeout=PREPARE_TIMEOUT_SECONDS, shell=False,
        **STEP_POPEN_EXTRA_KWARGS,
    )


def _tail(text, limit: int = 2000) -> str:
    return text[-limit:] if isinstance(text, str) else ""


@app.post("/tasks/{task_id}/prepare")
async def prepare_task(task_id: str):
    try:
        task = _task_or_refusal(task_id)
        _require_resting(task)
        if not task.prepare:
            raise _Refusal("this task has no prepare step")
        missing = [
            i for i in (task.prepare.get("after") or [])
            if not any(inp["id"] == i and _input_present(task, inp) for inp in task.inputs)
        ]
        if missing:
            raise _Refusal(f"upload the required input(s) first: {', '.join(missing)}", missing=missing)
        cmd = task.prepare["cmd"]
        if not isinstance(cmd, str) or not cmd.lower().endswith(".py"):
            raise _Refusal("prepare.cmd must be a python script")
        cmd_path = (task.folder / cmd).resolve()
        if cmd.startswith(("/", "\\")) or ":" in cmd or not cmd_path.is_relative_to(task.folder.resolve()) or not cmd_path.is_file():
            raise _Refusal("prepare.cmd must be a script inside the task folder")
        options_rel = _options_rel(task)
        _resolve_in_task(task, options_rel).unlink(missing_ok=True)  # success must mean freshly written
    except _Refusal as exc:
        return exc.payload()

    task.preparing = True
    try:
        loop = asyncio.get_running_loop()
        try:
            result = await loop.run_in_executor(None, _run_prepare, task, cmd_path)
        except subprocess.TimeoutExpired as exc:
            return {"ok": False, "reason": f"prepare timed out after {PREPARE_TIMEOUT_SECONDS}s",
                    "stderr_tail": _tail(exc.stderr)}
        except OSError as exc:
            return {"ok": False, "reason": f"prepare could not start: {exc}", "stderr_tail": ""}
    finally:
        task.preparing = False
    if result.returncode != 0:
        return {"ok": False, "reason": f"prepare failed (exit {result.returncode})",
                "stderr_tail": _tail(result.stderr or result.stdout)}
    try:
        options = _read_json_rel(task, options_rel)
    except _Refusal as exc:
        return {"ok": False, "reason": exc.reason, "stderr_tail": _tail(result.stderr)}
    if options is None:
        return {"ok": False, "reason": f"prepare finished but did not write {options_rel}", "stderr_tail": _tail(result.stderr)}
    return {"ok": True, "options": options}


@app.get("/tasks/{task_id}/options")
async def get_options(task_id: str):
    try:
        task = _task_or_refusal(task_id)
        rel = _options_rel(task)
        return _json_reply(_body_key(task, "options", rel), lambda: {"ok": True, "options": _read_json_rel(task, rel, cached=True)})
    except _Refusal as exc:
        return exc.payload()


@app.post("/tasks/{task_id}/params")
async def save_params(task_id: str, request: Request):
    try:
        task = _task_or_refusal(task_id)
        incoming = await _json_body(request, "params")
        _require_resting(task)
        merged = _saved_params(task)
        for input_id, value in incoming.items():
            inp = _input_def(task, input_id)
            if inp.get("type") != "select":
                raise _Refusal(f"input '{input_id}' is not a select input")
            if value in (None, ""):
                merged.pop(input_id, None)
                continue
            if not isinstance(value, str):
                raise _Refusal(f"value for '{input_id}' must be a string")
            options = _read_json_rel(task, inp.get("optionsFile") or _DEFAULT_OPTIONS_REL)
            if options is None:
                raise _Refusal("run prepare first - no options are available yet")
            entries = options.get(inp.get("optionsKey")) if isinstance(options, dict) else None
            entry = next((e for e in entries if isinstance(e, dict) and e.get("id") == value), None) if isinstance(entries, list) else None
            if entry is None:
                raise _Refusal(f"'{value}' is not an available option for '{input_id}'")
            if entry.get("enabled") is False:
                raise _Refusal(str(entry.get("reason") or f"'{value}' is not available"))
            merged[input_id] = value
        _atomic_write_json(_resolve_in_task(task, _PARAMS_REL), {"params": merged, "saved_at": _utc_now()})
        return {"ok": True, "params": merged}
    except _Refusal as exc:
        return exc.payload()


# --- gates: form / diff / flags ----------------------------------------------

def _gate_of_type(task: Task, kind: str) -> dict | None:
    """The gate of this type on the task's current step, else the first one
    declared anywhere in the manifest (so the UI can read it before the pause)."""
    current = next((s for s in task.steps if s["id"] == task.current_step), None)
    gate = _step_gate(current) if current else None
    if gate and gate["type"] == kind:
        return gate
    for step in task.steps:
        gate = _step_gate(step)
        if gate and gate["type"] == kind:
            return gate
    return None


def _is_blank(value) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, (list, dict)):
        return not value
    return False


def _form_state(task: Task, gate: dict, *, cached: bool = False) -> tuple[dict, dict, list[str]]:
    """(schema, answers, pending required field ids) for a form gate.
    cached=True (GET only) returns SHARED parsed objects - never mutate them."""
    schema = _read_json_rel(task, gate.get("schema"), cached=cached)
    if schema is None:
        raise _Refusal("the form is not ready yet", pending=[])
    fields = schema.get("fields") if isinstance(schema, dict) else None
    if not isinstance(fields, list) or not all(isinstance(f, dict) and f.get("id") for f in fields):
        raise _Refusal("the form schema is malformed", pending=[])
    answers = _read_json_rel(task, gate["answers"], cached=cached) if gate.get("answers") else None
    answers = answers if isinstance(answers, dict) else {}
    pending = [str(f["id"]) for f in fields if f.get("required") and _is_blank(answers.get(f["id"]))]
    return schema, answers, pending


def _gate_refusal(task: Task) -> dict | None:
    """Generic guard evaluated on approve and send for the current step's gate:
    a form with unanswered required fields, or a diff with blocking issues,
    cannot be passed. Legacy tasks declare no gate, so this is a no-op for them."""
    current = next((s for s in task.steps if s["id"] == task.current_step), None)
    gate = _step_gate(current) if current else None
    if not gate:
        return None
    try:
        if gate["type"] == "form":
            _, _, pending = _form_state(task, gate)
            if pending:
                return {"ok": False, "reason": f"{len(pending)} required answer(s) still pending", "pending": pending}
        elif gate["type"] == "diff":
            diff = _read_json_rel(task, gate.get("file"))
            if diff is None:
                return {"ok": False, "reason": "the comparison is not available yet", "blocking": []}
            blocking = diff.get("blocking") if isinstance(diff, dict) else None
            if not isinstance(blocking, list):
                return {"ok": False, "reason": "the comparison file is malformed", "blocking": []}
            if blocking:
                return {"ok": False, "reason": f"{len(blocking)} blocking issue(s) must be resolved first", "blocking": blocking}
    except _Refusal as exc:
        return exc.payload()
    return None


def _stamp_approval(task: Task, kind: str):
    try:
        user = getpass.getuser()
    except Exception:  # no usable OS identity: record that fact, never a client-supplied name
        user = "unknown"
    task.approvals.append({"step": task.current_step, "kind": kind, "user": user, "at": _utc_now()})


@app.get("/tasks/{task_id}/form")
def get_form(task_id: str):
    try:
        task = _task_or_refusal(task_id)
        gate = _gate_of_type(task, "form")
        if not gate:
            raise _Refusal("this task has no form gate")
        def build():
            schema, answers, pending = _form_state(task, gate, cached=True)
            return {"ok": True, "schema": schema, "answers": answers, "pending": pending}

        key = _body_key(task, "form", gate.get("schema"), *([gate["answers"]] if gate.get("answers") else []))
        return _json_reply(key, build)
    except _Refusal as exc:
        return exc.payload()


MAX_TEXT_ANSWER_CHARS = 500


def _validate_answer(field: dict, value):
    """Checks one incoming answer against its field and returns the value to
    store (a `text` answer is stored trimmed)."""
    if value is None:
        return None
    if field.get("type") == "select":
        allowed = [o.get("value") for o in field.get("options") or [] if isinstance(o, dict)]
        if value not in allowed:
            raise _Refusal(f"'{value}' is not an option for '{field['id']}'", invalid=[str(field["id"])])
    elif field.get("type") == "text":
        if not isinstance(value, str):
            raise _Refusal(f"'{field['id']}' needs text", invalid=[str(field["id"])])
        value = value.strip()
        if len(value) > MAX_TEXT_ANSWER_CHARS:
            raise _Refusal(
                f"the answer for '{field['id']}' is longer than {MAX_TEXT_ANSWER_CHARS} characters",
                invalid=[str(field["id"])],
            )
    elif not isinstance(value, (str, int, float, bool, list)):
        raise _Refusal(f"unsupported value for '{field['id']}'", invalid=[str(field["id"])])
    return value


@app.post("/tasks/{task_id}/form")
async def save_form(task_id: str, request: Request):
    try:
        task = _task_or_refusal(task_id)
        incoming = await _json_body(request, "answers")
        current = next((s for s in task.steps if s["id"] == task.current_step), None)
        gate = _step_gate(current) if current else None
        if task.state != "awaiting_review" or not gate or gate["type"] != "form":
            raise _Refusal("answers can only be saved while the task is waiting at its form")
        if not gate.get("answers"):
            raise _Refusal("this form has no answers file")
        schema, answers, _ = _form_state(task, gate)
        fields = {str(f["id"]): f for f in schema["fields"]}
        unknown = [k for k in incoming if k not in fields]
        if unknown:
            raise _Refusal(f"unknown field(s): {', '.join(unknown)}", invalid=unknown)
        incoming = {key: _validate_answer(fields[key], value) for key, value in incoming.items()}
        merged = dict(answers)
        for key, value in incoming.items():
            if value is None:
                merged.pop(key, None)
            else:
                merged[key] = value
        _atomic_write_json(_resolve_in_task(task, gate["answers"]), merged)
        _, _, pending = _form_state(task, gate)
        return {"ok": True, "pending": pending}
    except _Refusal as exc:
        return exc.payload()


@app.get("/tasks/{task_id}/diff")
def get_diff(task_id: str):
    try:
        task = _task_or_refusal(task_id)
        gate = _gate_of_type(task, "diff")
        if not gate:
            raise _Refusal("this task has no diff gate")
        return _json_reply(
            _body_key(task, "diff", gate.get("file")),
            lambda: {"ok": True, "diff": _read_json_rel(task, gate.get("file"), cached=True)},
        )
    except _Refusal as exc:
        return exc.payload()


@app.get("/tasks/{task_id}/flags")
def get_flags(task_id: str):
    try:
        task = _task_or_refusal(task_id)
        gate = _gate_of_type(task, "flags")
        rel = gate.get("file") if gate and gate.get("file") else _DEFAULT_FLAGS_REL
        return _json_reply(_body_key(task, "flags", rel), lambda: {"ok": True, "flags": _read_json_rel(task, rel, cached=True)})
    except _Refusal as exc:
        return exc.payload()


discover_tasks()


def main(argv: list[str] | None = None) -> None:
    """`python main.py --port N`: serve on 127.0.0.1 only. The launcher picks a
    free port and passes it here (the port is never hardcoded)."""
    parser = argparse.ArgumentParser(description="AI OS Tasks engine")
    parser.add_argument("--port", type=int, required=True, help="port to listen on (127.0.0.1 only)")
    args = parser.parse_args(argv)
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="info")


if __name__ == "__main__":
    main()

