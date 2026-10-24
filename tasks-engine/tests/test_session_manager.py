"""SessionManager / ClaudeSession tests - subprocess fully mocked, no real CLI."""
import asyncio
import io
import json
import types

import pytest

import session_manager as sm


class FakeProc:
    """Minimal stand-in for the CLI subprocess: scripted stdout lines, a
    writable stdin, poll/terminate plumbing."""

    def __init__(self, lines=()):
        self.stdin = io.StringIO()
        self.stdout = io.StringIO("".join(line + "\n" for line in lines))
        self._dead = False

    def poll(self):
        return 0 if self._dead else None

    def terminate(self):
        self._dead = True


def make_worker(**session_config):
    return types.SimpleNamespace(
        id="adam",
        display_name="Adam",
        persona="# Adam\nMethodical.",
        session_config=session_config,
    )


@pytest.fixture
def patch_popen(monkeypatch):
    created = []

    def fake_popen(cmd, **kw):
        proc = FakeProc()
        created.append((cmd, kw, proc))
        return proc

    monkeypatch.setattr(sm.subprocess, "Popen", fake_popen)
    monkeypatch.setattr(sm.shutil, "which", lambda name: "C:/npm/claude.CMD")
    return created


def test_cli_available(monkeypatch):
    monkeypatch.setattr(sm.shutil, "which", lambda name: "/usr/bin/claude")
    assert sm.cli_available() is True
    monkeypatch.setattr(sm.shutil, "which", lambda name: None)
    assert sm.cli_available() is False


def test_session_spawn_builds_expected_command(patch_popen):
    worker = make_worker(model="claude-sonnet-4-6", max_budget_usd=0.25,
                         permission_mode="dontAsk", allowed_tools=["Bash(python *)", "Read"])
    sm.ClaudeSession(worker, sm.Path("C:/ws"))

    (cmd, kw, _), = patch_popen
    assert cmd[0].endswith("claude.CMD")
    for flag in ("-p", "--input-format", "stream-json", "--output-format",
                 "--verbose", "--session-id", "--permission-mode", "dontAsk",
                 "--allowedTools", "Bash(python *)", "--model", "claude-sonnet-4-6",
                 "--max-budget-usd", "0.25", "--append-system-prompt"):
        assert flag in cmd
    assert worker.persona in cmd[cmd.index("--append-system-prompt") + 1]
    assert kw["cwd"] == str(sm.Path("C:/ws"))


def test_session_send_writes_stream_json_user_message(patch_popen):
    session = sm.ClaudeSession(make_worker(), sm.Path("C:/ws"))
    session.send("hello agent")

    line = session.proc.stdin.getvalue().strip()
    msg = json.loads(line)
    assert msg["type"] == "user"
    assert msg["message"]["content"][0]["text"] == "hello agent"


def test_session_parses_stdout_events_and_skips_garbage(patch_popen, monkeypatch):
    # Preload stdout before the reader thread starts - swapping it afterward
    # races the thread's own EOF sentinel.
    scripted = FakeProc(lines=[
        '{"type": "system", "subtype": "init"}',
        "not json at all",
        '{"type": "result", "is_error": false}',
    ])
    monkeypatch.setattr(sm.subprocess, "Popen", lambda *a, **k: scripted)
    session = sm.ClaudeSession(make_worker(), sm.Path("C:/ws"))

    first = asyncio.run(session.next_event(timeout=1))
    second = asyncio.run(session.next_event(timeout=1))
    assert first["subtype"] == "init"
    assert second["type"] == "result"


def test_session_next_event_times_out(patch_popen, monkeypatch):
    session = sm.ClaudeSession(make_worker(), sm.Path("C:/ws"))
    monkeypatch.setattr(sm.ClaudeSession, "_get_event", staticmethod(lambda q: ...))
    with pytest.raises(sm.ClaudeSessionError, match="timed out"):
        asyncio.run(session.next_event(timeout=0.05))


def test_session_next_event_eof_raises(patch_popen):
    session = sm.ClaudeSession(make_worker(), sm.Path("C:/ws"))  # empty stdout -> instant EOF
    with pytest.raises(sm.ClaudeSessionError, match="closed its event stream"):
        asyncio.run(session.next_event(timeout=5))


def test_session_send_to_dead_process_raises(patch_popen):
    session = sm.ClaudeSession(make_worker(), sm.Path("C:/ws"))
    session.proc.terminate()
    with pytest.raises(sm.ClaudeSessionError, match="dead"):
        session.send("anything")


def test_session_spawn_oserror_raises(patch_popen, monkeypatch):
    monkeypatch.setattr(sm.subprocess, "Popen", lambda *a, **k: (_ for _ in ()).throw(OSError("no binary")))
    with pytest.raises(sm.ClaudeSessionError, match="failed to spawn"):
        sm.ClaudeSession(make_worker(), sm.Path("C:/ws"))


def test_manager_spawn_get_ensure_stop(patch_popen):
    manager = sm.SessionManager(sm.Path("C:/ws"), enabled=True)
    worker = make_worker()

    assert manager.spawn(worker) is True
    session = manager.get("adam")
    assert session is not None and session.alive

    manager.stop_all()
    assert manager.get("adam") is None
    assert session.proc.poll() == 0


def test_manager_ensure_respawns_after_crash(patch_popen):
    manager = sm.SessionManager(sm.Path("C:/ws"), enabled=True)
    worker = make_worker()

    first = manager.ensure(worker)
    first.proc.terminate()  # simulate crash
    second = manager.ensure(worker)

    assert second is not first
    assert second.alive
    assert len(patch_popen) == 2


def test_manager_disabled_never_spawns(patch_popen):
    manager = sm.SessionManager(sm.Path("C:/ws"), enabled=False)
    manager.spawn_all({"adam": make_worker()})
    assert manager.sessions == {}
    assert manager.ensure(make_worker()) is None
    assert patch_popen == []


def test_manager_disabled_when_cli_missing(patch_popen, monkeypatch):
    monkeypatch.setattr(sm.shutil, "which", lambda name: None)
    assert sm.SessionManager(sm.Path("C:/ws"), enabled=True).enabled is False


def test_health_local_mode():
    manager = sm.SessionManager(sm.Path("C:/ws"), enabled=False)
    assert manager.health("adam") == {"runtime": "local"}


def test_health_claude_mode(patch_popen):
    manager = sm.SessionManager(sm.Path("C:/ws"), enabled=True)
    manager.spawn(make_worker())
    h = manager.health("adam")
    assert h["runtime"] == "claude"
    assert h["session_alive"] is True
    assert h["session_id"]
    assert h["spawned_at"] and "T" in h["spawned_at"]
    assert h["tasks_run"] == 0


def test_health_dead_session_reports_not_alive(patch_popen):
    manager = sm.SessionManager(sm.Path("C:/ws"), enabled=True)
    session = manager.ensure(make_worker())
    session.proc.terminate()
    assert manager.health("adam")["session_alive"] is False
