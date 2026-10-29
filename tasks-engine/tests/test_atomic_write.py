"""The engine's atomic file writer: data is flushed to disk before the rename, and a
transient Windows PermissionError on the rename is retried instead of failing the request."""
import os

import pytest

import main as engine


def test_write_is_fsynced_before_it_replaces_the_target(tmp_path, monkeypatch):
    order = []
    real_fsync, real_replace = os.fsync, os.replace
    monkeypatch.setattr(os, "fsync", lambda fd: (order.append("fsync"), real_fsync(fd))[1])
    monkeypatch.setattr(os, "replace", lambda a, b: (order.append("replace"), real_replace(a, b))[1])

    target = tmp_path / "out" / "answers.json"
    engine._atomic_write_json(target, {"a": 1})

    assert order == ["fsync", "replace"]
    assert target.read_text(encoding="utf-8").strip() == '{\n  "a": 1\n}'
    assert [p.name for p in target.parent.iterdir()] == ["answers.json"]  # no temp file left


def test_a_transient_permission_error_on_rename_is_retried(tmp_path, monkeypatch):
    real_replace = os.replace
    calls = {"n": 0}

    def flaky(src, dest):
        calls["n"] += 1
        if calls["n"] < 3:
            raise PermissionError("held open by a scanner")
        return real_replace(src, dest)

    monkeypatch.setattr(os, "replace", flaky)
    monkeypatch.setattr(engine.time, "sleep", lambda _seconds: None)

    target = tmp_path / "f.json"
    engine._atomic_write_bytes(target, b"ok")

    assert calls["n"] == 3 and target.read_bytes() == b"ok"


def test_a_permanent_permission_error_is_raised_and_leaves_no_temp_file(tmp_path, monkeypatch):
    def always(_src, _dest):
        raise PermissionError("locked")

    monkeypatch.setattr(os, "replace", always)
    monkeypatch.setattr(engine.time, "sleep", lambda _seconds: None)

    target = tmp_path / "f.json"
    with pytest.raises(PermissionError):
        engine._atomic_write_bytes(target, b"x")

    assert list(tmp_path.iterdir()) == []
