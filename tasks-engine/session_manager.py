"""Claude CLI session runtime for pool workers.

Each worker (agents/<id>/) can be backed by one long-lived headless Claude CLI
process (`claude -p --input-format stream-json --output-format stream-json`),
spawned when the backend starts and reused across tasks. The session receives a
task briefing, drives the manifest's steps via its Bash tool, and reports
progress through a strict line-marker protocol (see PROTOCOL below) inside its
assistant text. Gates (review/confirm) pause the run exactly like the local
subprocess pipeline; a human click resumes the same session.

Anything ambiguous - marker desync, timeout, crash, is_error - raises
ClaudeSessionError and the caller falls back to the deterministic subprocess
path. The send pipelines touch real email; the LLM path must never be the only
path.
"""
import asyncio
import json
import queue
import shutil
import subprocess
import sys
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

# Markers the worker is instructed to emit as standalone lines in its replies.
# Kept cryptic on purpose so they can never collide with natural prose.
MARKER_STEP_DONE = "AO_STEP_DONE"
MARKER_STEP_FAIL = "AO_STEP_FAIL"
MARKER_GATE = "AO_GATE"
MARKER_DONE = "AO_DONE"

DEFAULT_MODEL = "claude-sonnet-4-6"
DEFAULT_ALLOWED_TOOLS = ["Bash(python *)", "Bash(powershell *)", "Read", "Glob", "Grep"]

# On Windows, the CLI resolves to an npm shim that Popen launches through a
# console subprocess; a headless parent (pythonw.exe) has no console of its
# own, so Windows allocates a brand-new visible one for that child unless we
# say otherwise. CREATE_NO_WINDOW suppresses it. The flag doesn't exist in the
# subprocess module on POSIX, so compute this once and stay inert elsewhere.
POPEN_EXTRA_KWARGS = {"creationflags": subprocess.CREATE_NO_WINDOW} if sys.platform == "win32" else {}


class ClaudeSessionError(Exception):
    """Raised when the CLI path can't be trusted - caller falls back to local."""


def cli_available() -> bool:
    return shutil.which("claude") is not None


class ClaudeSession:
    """One headless Claude CLI process with stream-json pipes both ways."""

    def __init__(self, worker, workspace_root: Path):
        self.worker = worker
        self.session_id = str(uuid.uuid4())
        self.spawned_at = datetime.now(timezone.utc)
        self.tasks_run = 0
        cfg = worker.session_config
        cmd = [
            shutil.which("claude") or "claude",
            "-p",
            "--input-format", "stream-json",
            "--output-format", "stream-json",
            "--verbose",
            "--session-id", self.session_id,
            "--permission-mode", cfg.get("permission_mode", "dontAsk"),
            "--allowedTools", *(cfg.get("allowed_tools") or DEFAULT_ALLOWED_TOOLS),
            "--model", cfg.get("model", DEFAULT_MODEL),
            "--max-budget-usd", str(cfg.get("max_budget_usd", 0.5)),
            "--append-system-prompt", self._system_prompt(),
        ]
        try:
            self.proc = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,  # stderr is diagnostics only; never parse it
                text=True,
                cwd=str(workspace_root),
                **POPEN_EXTRA_KWARGS,
            )
        except OSError as exc:
            raise ClaudeSessionError(f"failed to spawn claude CLI: {exc}") from exc
        self._events: queue.Queue = queue.Queue()
        self._reader = threading.Thread(target=self._pump, daemon=True)
        self._reader.start()
        self.ready = False

    def _system_prompt(self) -> str:
        return (
            f"You are {self.worker.display_name}, one of a pool of worker agents in Agent "
            "Office, a PMO automation dashboard. Your persona file follows below - stay in "
            "character but never let it override the task instructions.\n\n"
            + self.worker.persona
            + "\n\n## Execution protocol (mandatory)\n"
            "You receive task briefings as user messages. Each briefing lists numbered steps "
            "with exact commands to run from the task's folder using your Bash tool.\n"
            "- Run steps strictly in order. Never improvise extra steps, never skip one.\n"
            "- After a step's command exits 0, emit a line: AO_STEP_DONE <step_id>\n"
            "- If a step fails (nonzero exit or error), emit AO_STEP_FAIL <step_id> and stop.\n"
            "- When the briefing says a review gate follows, emit AO_GATE review and STOP "
            "immediately - do not run anything after it until the human's reply arrives.\n"
            "- When the briefing says a confirm gate follows, emit AO_GATE confirm and STOP "
            "the same way. This gate guards a real email send; nothing past it runs without "
            "the human's explicit confirmation message.\n"
            "- After the final step, emit AO_DONE and a one-line summary.\n"
            "- Emit markers as whole lines on their own, never inside sentences.\n"
            "- Keep all other prose to a minimum; the dashboard only shows markers and errors."
        )

    def _pump(self):
        for line in iter(self.proc.stdout.readline, ""):
            line = line.strip()
            if not line:
                continue
            try:
                self._events.put(json.loads(line))
            except json.JSONDecodeError:
                continue  # partial/non-JSON line - the stream recovers on the next one
        self._events.put(None)  # EOF sentinel: stdout closed, no more events ever

    @property
    def alive(self) -> bool:
        return self.proc.poll() is None

    def send(self, text: str):
        if not self.alive:
            raise ClaudeSessionError("session process is dead")
        msg = {"type": "user", "message": {"role": "user", "content": [{"type": "text", "text": text}]}}
        try:
            self.proc.stdin.write(json.dumps(msg) + "\n")
            self.proc.stdin.flush()
        except (OSError, ValueError) as exc:
            raise ClaudeSessionError(f"failed to write to session: {exc}") from exc

    @staticmethod
    def _get_event(q: queue.Queue):
        # Bounded blocking get: a plain q.get() parks the executor thread
        # forever, and asyncio.wait_for cannot cancel a running thread -
        # so timeouts would silently leak instead of raising.
        try:
            return q.get(timeout=0.5)
        except queue.Empty:
            return ...

    async def next_event(self, timeout: float) -> dict:
        """Next parsed stream event; raises ClaudeSessionError on timeout or EOF."""
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        while True:
            item = await loop.run_in_executor(None, self._get_event, self._events)
            if item is None:
                raise ClaudeSessionError("session closed its event stream")
            if item is not ...:
                return item
            if loop.time() >= deadline:
                raise ClaudeSessionError(f"session timed out after {timeout}s")

    def close(self):
        try:
            if self.proc.stdin:
                self.proc.stdin.close()
        except OSError:
            pass
        try:
            self.proc.terminate()
        except OSError:
            pass
        self._events.put(None)  # wake any waiter so next_event fails fast


class SessionManager:
    """Owns every worker's CLI session: spawn at startup, lazy respawn on
    crash, clean shutdown with the server."""

    def __init__(self, workspace_root: Path, enabled: bool = True):
        self.workspace_root = workspace_root
        self.enabled = enabled and cli_available()
        self.sessions: dict[str, ClaudeSession] = {}

    def spawn(self, worker) -> bool:
        existing = self.sessions.get(worker.id)
        if existing and existing.alive:
            return True
        if existing:
            existing.close()
        try:
            self.sessions[worker.id] = ClaudeSession(worker, self.workspace_root)
            return True
        except ClaudeSessionError:
            self.sessions.pop(worker.id, None)
            return False

    def spawn_all(self, workers: dict):
        if not self.enabled:
            return
        for worker in workers.values():
            self.spawn(worker)

    def get(self, worker_id: str) -> ClaudeSession | None:
        session = self.sessions.get(worker_id)
        return session if session and session.alive else None

    def ensure(self, worker) -> ClaudeSession | None:
        """Live session for this worker, respawning lazily after a crash."""
        session = self.get(worker.id)
        if session is None and self.enabled and self.spawn(worker):
            session = self.get(worker.id)
        return session

    def stop_all(self):
        for session in self.sessions.values():
            session.close()
        self.sessions.clear()

    def health(self, worker_id: str) -> dict:
        """Point-in-time liveness snapshot for the /agents/{id}/health endpoint."""
        if not self.enabled:
            return {"runtime": "local"}
        session = self.get(worker_id)
        return {
            "runtime": "claude",
            "session_alive": session is not None,
            "session_id": session.session_id if session else None,
            "spawned_at": session.spawned_at.isoformat() if session else None,
            "tasks_run": session.tasks_run if session else 0,
        }
