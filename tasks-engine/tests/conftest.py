"""Shared test setup: every test starts with no tasks and empty caches,
discovery pointed at its own tmp folder and run history / run state written there,
so the real data is never read or written. Requests go to the loopback host the
engine's request guard requires (make_client)."""
import pytest
from fastapi.testclient import TestClient

import main as engine

LOOPBACK_BASE_URL = "http://127.0.0.1:8000"


def make_client(app=None, **kwargs) -> TestClient:
    """A TestClient addressed to 127.0.0.1 (TestClient's default host, "testserver", is refused)."""
    kwargs.setdefault("raise_server_exceptions", False)
    kwargs.setdefault("base_url", LOOPBACK_BASE_URL)
    return TestClient(app or engine.app, **kwargs)


@pytest.fixture(autouse=True)
def isolate_state(tmp_path, monkeypatch):
    saved_tasks = dict(engine.tasks)
    engine.tasks.clear()
    monkeypatch.setattr(engine, "TASKS_ROOT", tmp_path)
    monkeypatch.setattr(engine, "HISTORY_FILE", tmp_path / "history.jsonl")
    monkeypatch.setattr(engine, "RUN_STATE_DIR", tmp_path / ".run-state")
    monkeypatch.delenv(engine.TOKEN_ENV, raising=False)
    monkeypatch.delenv(engine.INSTANCE_ENV, raising=False)
    for cache in (engine._sha_cache, engine._json_cache, engine._body_cache,
                  engine._resolve_memo, engine._realpath_memo):
        cache.clear()
    engine._history_cache = None
    engine._json_cache_bytes = 0
    engine._body_cache_bytes = 0
    yield
    engine.tasks.clear()
    engine.tasks.update(saved_tasks)
