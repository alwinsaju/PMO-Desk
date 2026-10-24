"""FEAT-006: agents/pool.json restricts/reorders the active worker pool.
Absent or broken config must fall back to every discovered worker - a config
typo must never empty the pool."""
import asyncio
import json
import logging

import pytest

import main as backend


@pytest.fixture(autouse=True)
def isolate_state(tmp_path, monkeypatch):
    saved_tasks = dict(backend.tasks)
    saved_enabled = backend.session_manager.enabled
    backend.tasks.clear()
    for w in backend.workers.values():
        w.current_task_id = None
    backend.session_manager.enabled = False
    monkeypatch.setattr(backend, "WORKSPACE_ROOT", tmp_path)
    monkeypatch.setattr(backend, "TASKS_ROOT", tmp_path)
    monkeypatch.setattr(backend, "HISTORY_FILE", tmp_path / "history.jsonl")
    yield
    backend.tasks.clear()
    backend.tasks.update(saved_tasks)
    backend.session_manager.enabled = saved_enabled
    for w in backend.workers.values():
        w.current_task_id = None


def make_agents_dir(root, ids):
    agents_dir = root / "agents"
    for worker_id in ids:
        folder = agents_dir / worker_id
        folder.mkdir(parents=True)
        (folder / "agent.json").write_text(
            json.dumps({"id": worker_id, "displayName": worker_id.capitalize()})
        )
    return agents_dir


def make_task_folder(root, folder_name, task_id):
    folder = root / folder_name
    (folder / "scripts").mkdir(parents=True)
    (folder / "task.json").write_text(json.dumps(
        {"id": task_id, "displayName": task_id,
         "steps": [{"id": "noop", "type": "python", "cmd": "scripts/noop.py"}]}
    ))
    (folder / "scripts" / "noop.py").write_text("print('ok')")
    return folder


def test_no_pool_config_keeps_all_discovered(tmp_path):
    agents_dir = make_agents_dir(tmp_path, ["adam", "ash"])
    found = backend.discover_workers(agents_dir)

    pool = backend.apply_pool_config(found, agents_dir)

    assert list(pool) == ["adam", "ash"]


def test_pool_config_restricts_and_reorders(tmp_path):
    agents_dir = make_agents_dir(tmp_path, ["adam", "ash", "lucy", "nancy"])
    (agents_dir / "pool.json").write_text(json.dumps({"enabled": ["nancy", "adam"]}))
    found = backend.discover_workers(agents_dir)

    pool = backend.apply_pool_config(found, agents_dir)

    assert list(pool) == ["nancy", "adam"]  # config order wins over folder order
    assert pool["nancy"] is found["nancy"]
    assert "lucy" not in pool


def test_pool_config_invalid_json_falls_back_to_all(tmp_path, caplog):
    agents_dir = make_agents_dir(tmp_path, ["adam", "ash"])
    (agents_dir / "pool.json").write_text("{ not json")
    found = backend.discover_workers(agents_dir)

    with caplog.at_level(logging.WARNING):
        pool = backend.apply_pool_config(found, agents_dir)

    assert list(pool) == ["adam", "ash"]
    assert "pool.json" in caplog.text


def test_pool_config_missing_enabled_key_falls_back(tmp_path, caplog):
    agents_dir = make_agents_dir(tmp_path, ["adam", "ash"])
    (agents_dir / "pool.json").write_text(json.dumps({"disabled": ["ash"]}))
    found = backend.discover_workers(agents_dir)

    with caplog.at_level(logging.WARNING):
        pool = backend.apply_pool_config(found, agents_dir)

    assert list(pool) == ["adam", "ash"]
    assert "pool.json" in caplog.text


def test_pool_config_unknown_worker_id_falls_back_to_all(tmp_path, caplog):
    agents_dir = make_agents_dir(tmp_path, ["adam", "ash"])
    (agents_dir / "pool.json").write_text(json.dumps({"enabled": ["adam", "ghost"]}))
    found = backend.discover_workers(agents_dir)

    with caplog.at_level(logging.WARNING):
        pool = backend.apply_pool_config(found, agents_dir)

    assert list(pool) == ["adam", "ash"]
    assert "ghost" in caplog.text


def test_pool_config_empty_enabled_list_falls_back(tmp_path, caplog):
    agents_dir = make_agents_dir(tmp_path, ["adam", "ash"])
    (agents_dir / "pool.json").write_text(json.dumps({"enabled": []}))
    found = backend.discover_workers(agents_dir)

    with caplog.at_level(logging.WARNING):
        pool = backend.apply_pool_config(found, agents_dir)

    assert list(pool) == ["adam", "ash"]


def test_restricted_pool_drives_assignment_order(tmp_path, monkeypatch):
    agents_dir = make_agents_dir(tmp_path / "ws", ["adam", "ash", "lucy"])
    (agents_dir / "pool.json").write_text(json.dumps({"enabled": ["lucy", "ash"]}))
    pool = backend.apply_pool_config(backend.discover_workers(agents_dir), agents_dir)
    monkeypatch.setattr(backend, "workers", pool)
    make_task_folder(tmp_path, "task-a", "task-a")
    backend.discover_tasks()

    resp = asyncio.run(backend.start_task("task-a"))

    assert resp["ok"] and resp["agent"] == "lucy"
    assert pool["lucy"].current_task_id == "task-a"


def test_rescan_does_not_change_the_pool():
    before = backend.workers

    backend.rescan_tasks()

    assert backend.workers is before
