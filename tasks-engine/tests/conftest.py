"""Shared test setup: every test starts with no tasks and empty caches,
discovery pointed at its own tmp folder and run history written there, so the
real data is never read or written."""
import pytest

import main as engine


@pytest.fixture(autouse=True)
def isolate_state(tmp_path, monkeypatch):
    saved_tasks = dict(engine.tasks)
    engine.tasks.clear()
    monkeypatch.setattr(engine, "TASKS_ROOT", tmp_path)
    monkeypatch.setattr(engine, "HISTORY_FILE", tmp_path / "history.jsonl")
    for cache in (engine._sha_cache, engine._json_cache, engine._body_cache,
                  engine._resolve_memo, engine._realpath_memo):
        cache.clear()
    engine._history_cache = None
    engine._json_cache_bytes = 0
    engine._body_cache_bytes = 0
    yield
    engine.tasks.clear()
    engine.tasks.update(saved_tasks)
