"""Poll-path caching: the read-only GETs the Tasks app polls (/tasks, /agents,
/tasks/<id>/log|inputs|form|flags|diff|options|history) must be cheap per call
WITHOUT changing a single byte of any response, and a cache must never serve
stale data once a file changed.

Hermetic like the rest of the suite: every task folder is a synthetic temp dir
(TASKS_ROOT patched to tmp_path), the Claude CLI runtime is off, nothing here can
reach Outlook or the live backend on :8000."""
import hashlib
import json
import os
import shutil
import threading
import time
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

import main as backend
from test_platform import FORM_SCHEMA, at_gate, make_link, make_platform_task, upload, write


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
    for cache in (backend._sha_cache, backend._json_cache, backend._body_cache,
                  backend._resolve_memo, backend._realpath_memo):
        cache.clear()
    backend._history_cache = None
    backend._json_cache_bytes = 0
    backend._body_cache_bytes = 0
    yield
    backend.tasks.clear()
    backend.tasks.update(saved_tasks)
    backend.session_manager.enabled = saved_enabled
    for w in backend.workers.values():
        w.current_task_id = None


def client():
    return TestClient(backend.app, raise_server_exceptions=False)


def compact(obj) -> bytes:
    """What FastAPI's JSONResponse (and so every poll response) puts on the wire."""
    return json.dumps(obj, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")


def age(path, seconds=3600):
    """Move a file's mtime into the past so it is outside the 'racy' no-cache window."""
    t = time.time_ns() - int(seconds * 1e9)
    os.utime(path, ns=(t, t))


def count_calls(monkeypatch, owner, name):
    calls = []
    real = getattr(owner, name)

    def wrapper(*a, **k):
        calls.append(1)
        return real(*a, **k)

    monkeypatch.setattr(owner, name, wrapper)
    return calls


# --- sha256 cache (GET /inputs) -------------------------------------------------

def test_sha_cache_hit_rehashes_nothing_and_invalidates_on_mtime_or_size(tmp_path, monkeypatch):
    expected = {b: hashlib.sha256(b).hexdigest() for b in (b"hello", b"world", b"world!!")}
    f = tmp_path / "f.bin"
    f.write_bytes(b"hello")
    calls = count_calls(monkeypatch, backend.hashlib, "sha256")

    first = backend._file_info(f)
    assert first == {"size": 5, "sha256": expected[b"hello"]}
    assert backend._file_info(f) == first
    assert len(calls) == 1  # second call was a cache hit

    f.write_bytes(b"world")  # same size, new content: the mtime moves
    age(f, 100)
    assert backend._file_info(f) == {"size": 5, "sha256": expected[b"world"]}
    assert len(calls) == 2

    f.write_bytes(b"world!!")  # new size
    assert backend._file_info(f) == {"size": 7, "sha256": expected[b"world!!"]}
    assert len(calls) == 3


def test_sha_cache_evicts_only_the_stalest_entry(tmp_path):
    files = []
    for i in range(backend._SHA_CACHE_MAX + 3):
        g = tmp_path / f"g{i}.bin"
        g.write_bytes(bytes([i]))
        files.append(g)
    for g in files[:backend._SHA_CACHE_MAX]:
        backend._file_info(g)
    backend._file_info(files[0])  # touch the oldest: now the most recently used
    for g in files[backend._SHA_CACHE_MAX:]:
        backend._file_info(g)
    paths = {key[0] for key in backend._sha_cache}
    assert len(backend._sha_cache) == backend._SHA_CACHE_MAX  # bounded, never wiped wholesale
    assert str(files[0]) in paths  # recently used survived
    assert str(files[1]) not in paths  # the stalest were evicted
    assert str(files[-1]) in paths


def test_upload_primes_the_hash_cache_so_the_first_poll_does_not_rehash(tmp_path, monkeypatch):
    make_platform_task(tmp_path)
    c = client()
    data = os.urandom(4096)
    body = upload(c, "plat", "roster", "roster.xlsx", data)
    assert body["sha256"] == hashlib.sha256(data).hexdigest()

    calls = count_calls(monkeypatch, backend.hashlib, "sha256")
    inputs = c.get("/tasks/plat/inputs").json()
    roster = next(i for i in inputs["inputs"] if i["id"] == "roster")
    assert roster["sha256"] == body["sha256"] and roster["size"] == len(data)
    assert calls == []  # primed by the upload, nothing re-read


def test_file_replaced_after_upload_is_rehashed(tmp_path, monkeypatch):
    folder = make_platform_task(tmp_path)
    c = client()
    upload(c, "plat", "roster", "roster.xlsx", b"A" * 100)
    dest = folder / "input" / "roster.xlsx"
    dest.write_bytes(b"B" * 100)  # replaced outside the app, same size
    age(dest, 50)
    roster = next(i for i in c.get("/tasks/plat/inputs").json()["inputs"] if i["id"] == "roster")
    assert roster["sha256"] == hashlib.sha256(b"B" * 100).hexdigest()


# --- GET /inputs: same payload, fewer syscalls -----------------------------------

def test_inputs_payload_shape_and_values_are_unchanged(tmp_path):
    folder = make_platform_task(tmp_path)
    c = client()
    upload(c, "plat", "roster", "My Roster.xlsx", b"R" * 300)
    write(folder, "input/holiday-roster.xlsx", b"H" * 10)  # present, but never uploaded via the app
    write(folder, "input/run-params.json", {"params": {"cycle": "2026-12"}})
    write(folder, "input/sub/stray.csv", b"x" * 50)
    for p in (folder / "input").rglob("*"):
        if p.is_file():
            age(p, 600)

    resp = c.get("/tasks/plat/inputs")
    assert resp.headers["content-type"] == "application/json"
    body = resp.json()
    roster_st = os.stat(folder / "input" / "roster.xlsx")
    expected_roster = {
        "id": "roster", "label": "Roster workbook", "type": "file", "required": True, "persist": False,
        "present": True, "modified": None,
        "filename": "My Roster.xlsx", "size": 300, "sha256": hashlib.sha256(b"R" * 300).hexdigest(),
    }
    expected_roster["modified"] = datetime.fromtimestamp(roster_st.st_mtime, timezone.utc).isoformat()
    got = body["inputs"][0]
    assert got == expected_roster
    # field ORDER is part of the contract too (clients may rely on it)
    assert list(got) == ["id", "label", "type", "required", "persist", "present", "modified",
                         "filename", "size", "sha256"]
    holidays = body["inputs"][1]
    assert holidays["filename"] == "holiday-roster.xlsx" and holidays["size"] == 10
    pto = body["inputs"][2]
    assert pto == {"id": "pto", "label": "PTO", "type": "file", "required": False, "persist": False,
                   "present": False, "modified": None}
    cycle = body["inputs"][3]
    assert cycle["type"] == "select" and cycle["present"] is True and "filename" not in cycle
    assert body["params"] == {"cycle": "2026-12"}
    assert body["cleanable"] == {"files": 3, "bytes": 300 + 10 + 50}
    assert list(body) == ["ok", "inputs", "params", "cleanable"]
    assert resp.content == compact(body)


def test_inputs_follow_the_disk_immediately(tmp_path):
    folder = make_platform_task(tmp_path)
    c = client()
    pto = lambda: next(i for i in c.get("/tasks/plat/inputs").json()["inputs"] if i["id"] == "pto")  # noqa: E731
    assert pto()["present"] is False
    dest = write(folder, "input/pto-import.xlsx", b"1234")
    assert pto()["present"] is True and pto()["size"] == 4
    dest.write_bytes(b"123456")
    assert pto()["size"] == 6
    dest.unlink()
    assert pto()["present"] is False
    # saved select choice: written, read, changed, removed
    params = write(folder, "input/run-params.json", {"params": {"cycle": "2026-12"}})
    assert c.get("/tasks/plat/inputs").json()["params"] == {"cycle": "2026-12"}
    params.write_text(json.dumps({"params": {"cycle": "2027-01"}}))  # same size, different content
    assert c.get("/tasks/plat/inputs").json()["params"] == {"cycle": "2027-01"}
    params.unlink()
    body = c.get("/tasks/plat/inputs").json()
    assert body["params"] == {} and next(i for i in body["inputs"] if i["id"] == "cycle")["present"] is False


def test_inputs_even_when_cached_see_a_same_size_rewrite_with_a_new_mtime(tmp_path):
    folder = make_platform_task(tmp_path)
    c = client()
    params = write(folder, "input/run-params.json", {"params": {"cycle": "2026-11"}})
    age(params, 3600)
    assert c.get("/tasks/plat/inputs").json()["params"] == {"cycle": "2026-11"}  # now cached
    assert backend._json_cache  # (it really is held)
    params.write_text(json.dumps({"params": {"cycle": "2026-12"}}))  # identical size
    age(params, 1800)
    assert c.get("/tasks/plat/inputs").json()["params"] == {"cycle": "2026-12"}


def test_inputs_refuse_a_symlinked_input_folder_even_after_it_was_cached(tmp_path):
    folder = make_platform_task(tmp_path)
    c = client()
    write(folder, "input/roster.xlsx", b"x" * 20)
    roster = lambda: next(i for i in c.get("/tasks/plat/inputs").json()["inputs"] if i["id"] == "roster")  # noqa: E731
    assert roster()["present"] is True  # validated and memoised

    outside = tmp_path / "outside"
    write(outside, "roster.xlsx", b"y" * 20)
    (folder / "input" / "roster.xlsx").unlink()
    backend_input = folder / "input"
    # swap the whole input/ folder for a junction/symlink to somewhere else
    shutil.rmtree(backend_input)
    make_link(backend_input, outside)
    assert roster()["present"] is False  # never follows the link, memo or not


def test_resolve_memo_skips_realpath_on_a_hit_but_still_checks_links(tmp_path, monkeypatch):
    folder = make_platform_task(tmp_path)
    task = backend.tasks["plat"]
    write(folder, "input/roster.xlsx", b"z")
    first = backend._resolve_in_task(task, "input/roster.xlsx", roots=("input",), memo=True)
    assert first == backend._resolve_in_task(task, "input/roster.xlsx", roots=("input",))

    resolves = count_calls(monkeypatch, type(folder), "resolve")
    for _ in range(5):
        assert backend._resolve_in_task(task, "input/roster.xlsx", roots=("input",), memo=True) == first
    assert resolves == []  # hit: no realpath work at all

    # the un-memoised path still does the full check every time
    backend._resolve_in_task(task, "input/roster.xlsx", roots=("input",))
    assert len(resolves) == 2


def test_resolve_memo_rejects_what_the_plain_resolver_rejects(tmp_path):
    make_platform_task(tmp_path)
    task = backend.tasks["plat"]
    for bad in ("../x.json", "input/../../x", "C:/x", "/abs/x", "output", "other/x.json", "", None, "in\x00put/x"):
        with pytest.raises(backend._Refusal) as plain:
            backend._resolve_in_task(task, bad)
        with pytest.raises(backend._Refusal) as memo:
            backend._resolve_in_task(task, bad, memo=True)
        assert plain.value.reason == memo.value.reason


def test_resolve_memo_is_bounded(tmp_path, monkeypatch):
    make_platform_task(tmp_path)
    task = backend.tasks["plat"]
    monkeypatch.setattr(backend, "_RESOLVE_MEMO_MAX", 4)
    for i in range(20):
        backend._resolve_in_task(task, f"output/f{i}.json", memo=True)
    assert len(backend._resolve_memo) == 4


def test_cleanup_plan_memo_equals_fresh_plan(tmp_path):
    folder = make_platform_task(tmp_path)
    task = backend.tasks["plat"]
    write(folder, "input/roster.xlsx", b"a" * 10)
    write(folder, "input/sub/x.csv", b"b" * 5)
    fresh = backend._cleanup_plan(task)
    for _ in range(3):
        assert backend._cleanup_plan(task, memo=True) == fresh
    write(folder, "input/sub/y.csv", b"c" * 7)  # a new file shows up at once (the walk is never cached)
    assert backend._cleanup_plan(task, memo=True) == backend._cleanup_plan(task)
    assert len(backend._cleanup_plan(task, memo=True)["files"]) == 3


def test_realpath_cache_is_bounded_and_follows_the_path(tmp_path, monkeypatch):
    monkeypatch.setattr(backend, "_REALPATH_MEMO_MAX", 3)
    for i in range(10):
        d = tmp_path / f"d{i}"
        d.mkdir()
        assert backend._realpath_cached(d) == os.path.realpath(d)
    assert len(backend._realpath_memo) == 3
    assert backend._realpath_cached(tmp_path / "missing") == os.path.realpath(tmp_path / "missing")


# --- parsed JSON cache ----------------------------------------------------------

def test_json_cache_hit_returns_the_parsed_object_and_invalidates_on_change(tmp_path, monkeypatch):
    folder = make_platform_task(tmp_path)
    task = backend.tasks["plat"]
    path = write(folder, "output/data.json", {"a": 1})
    age(path, 3600)
    loads = count_calls(monkeypatch, backend.json, "loads")

    v1 = backend._read_json_rel(task, "output/data.json", cached=True)
    v2 = backend._read_json_rel(task, "output/data.json", cached=True)
    assert v1 == {"a": 1} and v2 is v1
    assert len(loads) == 1  # parsed once

    path.write_text(json.dumps({"a": 2}))  # same size
    age(path, 1800)
    assert backend._read_json_rel(task, "output/data.json", cached=True) == {"a": 2}
    path.write_text(json.dumps({"a": 22}))  # different size
    assert backend._read_json_rel(task, "output/data.json", cached=True) == {"a": 22}


def test_json_cache_never_holds_a_file_modified_moments_ago(tmp_path):
    folder = make_platform_task(tmp_path)
    task = backend.tasks["plat"]
    path = write(folder, "output/data.json", {"a": 1})
    for n in range(5):
        path.write_text(json.dumps({"a": n}))  # all the same size, all within one timestamp tick
        assert backend._read_json_rel(task, "output/data.json", cached=True) == {"a": n}
    assert not backend._json_cache


def test_json_cache_matches_the_uncached_reader_for_every_outcome(tmp_path):
    folder = make_platform_task(tmp_path)
    task = backend.tasks["plat"]
    assert backend._read_json_rel(task, "output/none.json", cached=True) is None  # absent
    (folder / "output" / "dir.json").mkdir(parents=True)
    assert backend._read_json_rel(task, "output/dir.json", cached=True) is None  # not a file
    bad = write(folder, "output/bad.json", "{not json")
    age(bad)
    for _ in range(2):  # twice: the failure itself may be cached, the refusal must not change
        with pytest.raises(backend._Refusal, match=r"output/bad.json is not valid JSON") as cached:
            backend._read_json_rel(task, "output/bad.json", cached=True)
        with pytest.raises(backend._Refusal) as fresh:
            backend._read_json_rel(task, "output/bad.json")
        assert cached.value.reason == fresh.value.reason
    bom = folder / "output" / "bom.json"
    bom.write_bytes(b"\xef\xbb\xbf" + json.dumps({"k": "v"}).encode())
    age(bom)
    assert backend._read_json_rel(task, "output/bom.json", cached=True) == {"k": "v"}  # utf-8-sig, like before
    write(folder, "output/bad.json", {"fixed": True})  # repaired file is read again
    assert backend._read_json_rel(task, "output/bad.json", cached=True) == {"fixed": True}


def test_json_cache_is_bounded_by_entries_total_bytes_and_file_size(tmp_path, monkeypatch):
    folder = make_platform_task(tmp_path)
    task = backend.tasks["plat"]
    monkeypatch.setattr(backend, "_JSON_CACHE_MAX_ENTRIES", 3)
    monkeypatch.setattr(backend, "_JSON_CACHE_MAX_FILE_BYTES", 400)
    monkeypatch.setattr(backend, "_JSON_CACHE_MAX_TOTAL_BYTES", 600)
    for i in range(10):
        p = write(folder, f"output/f{i}.json", {"i": i, "pad": "x" * 100})
        age(p)
        backend._read_json_rel(task, f"output/f{i}.json", cached=True)
    assert len(backend._json_cache) <= 3
    assert backend._json_cache_bytes == sum(k[2] for k in backend._json_cache) <= 600
    big = write(folder, "output/big.json", {"pad": "y" * 1000})
    age(big)
    assert backend._read_json_rel(task, "output/big.json", cached=True)["pad"] == "y" * 1000
    assert all(not k[0].endswith("big.json") for k in backend._json_cache)  # too large to hold


def test_mutating_handlers_do_not_share_cached_objects(tmp_path):
    """POST /params and POST /form read-modify-write: they must never mutate a
    parsed object that a cached GET also hands out."""
    folder = make_platform_task(tmp_path)
    c = client()
    write(folder, "output/options.json", {"cycles": [{"id": "2026-12", "enabled": True}, {"id": "2026-11", "enabled": True}]})
    params = write(folder, "input/run-params.json", {"params": {"cycle": "2026-11"}})
    age(params)
    age(folder / "output" / "options.json")
    assert c.get("/tasks/plat/inputs").json()["params"] == {"cycle": "2026-11"}  # cached
    assert c.post("/tasks/plat/params", json={"params": {"cycle": "2026-12"}}).json()["params"] == {"cycle": "2026-12"}
    assert c.post("/tasks/plat/params", json={"params": {"cycle": ""}}).json()["params"] == {}
    assert c.get("/tasks/plat/inputs").json()["params"] == {}


# --- gate GETs: form / flags / diff / options -------------------------------------

def test_gate_get_bodies_are_served_from_cache_and_identical(tmp_path, monkeypatch):
    folder = make_platform_task(tmp_path)
    c = client()
    at_gate(backend.tasks["plat"], "answers")
    flags = {"flags": [{"row": n, "message": "é ünïcode"} for n in range(5)]}
    diff = {"blocking": [], "changes": [{"a": n} for n in range(5)]}
    options = {"cycles": [{"id": "2026-12", "enabled": True}]}
    for rel, content in (("output/ask-me.json", FORM_SCHEMA), ("output/ask-me-answers.json", {"note": "hi"}),
                         ("output/flags.json", flags), ("output/roster-diff.json", diff), ("output/options.json", options)):
        age(write(folder, rel, content))

    expected = {
        "/tasks/plat/form": {"ok": True, "schema": FORM_SCHEMA, "answers": {"note": "hi"}, "pending": ["shift:Ann"]},
        "/tasks/plat/flags": {"ok": True, "flags": flags},
        "/tasks/plat/diff": {"ok": True, "diff": diff},
        "/tasks/plat/options": {"ok": True, "options": options},
    }
    loads = count_calls(monkeypatch, backend.json, "loads")
    for url, payload in expected.items():
        first = c.get(url)
        parsed_after_first = len(loads)
        second = c.get(url)
        assert first.headers["content-type"] == second.headers["content-type"] == "application/json"
        assert first.content == second.content == compact(payload), url
        assert len(loads) == parsed_after_first, url  # the second GET parsed nothing


def test_gate_get_bodies_invalidate_when_any_source_file_changes(tmp_path):
    folder = make_platform_task(tmp_path)
    c = client()
    at_gate(backend.tasks["plat"], "answers")
    schema = write(folder, "output/ask-me.json", FORM_SCHEMA)
    answers = write(folder, "output/ask-me-answers.json", {"note": "aa"})
    flags = write(folder, "output/flags.json", {"flags": [1]})
    diff = write(folder, "output/roster-diff.json", {"blocking": []})
    for p in (schema, answers, flags, diff):
        age(p)
    assert c.get("/tasks/plat/form").json()["answers"] == {"note": "aa"}
    assert c.get("/tasks/plat/flags").json()["flags"] == {"flags": [1]}
    assert c.get("/tasks/plat/diff").json()["diff"] == {"blocking": []}

    answers.write_text(json.dumps({"note": "bb"}))  # same size, newer mtime
    age(answers, 1800)
    flags.write_text(json.dumps({"flags": [2]}))
    age(flags, 1800)
    diff.write_text(json.dumps({"blocking": ["x"]}))
    assert c.get("/tasks/plat/form").json()["answers"] == {"note": "bb"}
    assert c.get("/tasks/plat/flags").json()["flags"] == {"flags": [2]}
    assert c.get("/tasks/plat/diff").json()["diff"] == {"blocking": ["x"]}

    schema.unlink()  # the form disappears: refusal again, nothing stale served
    assert c.get("/tasks/plat/form").json() == {"ok": False, "reason": "the form is not ready yet", "pending": []}
    diff.unlink()
    assert c.get("/tasks/plat/diff").json() == {"ok": True, "diff": None}


def test_form_post_then_get_round_trip_with_a_warm_cache(tmp_path):
    folder = make_platform_task(tmp_path)
    c = client()
    at_gate(backend.tasks["plat"], "answers")
    age(write(folder, "output/ask-me.json", FORM_SCHEMA))
    age(write(folder, "output/ask-me-answers.json", {"note": "one"}))
    assert c.get("/tasks/plat/form").json()["answers"] == {"note": "one"}  # warm
    assert c.post("/tasks/plat/form", json={"answers": {"shift:Ann": "KEEP"}}).json() == {"ok": True, "pending": []}
    after = c.get("/tasks/plat/form").json()
    assert after["answers"] == {"note": "one", "shift:Ann": "KEEP"} and after["pending"] == []


def test_gate_refusals_are_unchanged_and_never_cached(tmp_path):
    folder = make_platform_task(tmp_path)
    c = client()
    assert c.get("/tasks/ghost/form").json() == {"ok": False, "reason": "unknown task"}
    assert c.get("/tasks/plat/form").json()["reason"] == "the form is not ready yet"
    write(folder, "output/ask-me.json", "[1, 2]")
    assert c.get("/tasks/plat/form").json() == {"ok": False, "reason": "the form schema is malformed", "pending": []}
    bad = write(folder, "output/flags.json", "{oops")
    age(bad)
    for _ in range(2):
        assert c.get("/tasks/plat/flags").json() == {"ok": False, "reason": "output/flags.json is not valid JSON"}
    assert not backend._body_cache


def test_body_cache_is_bounded_and_skips_racy_and_oversized_bodies(tmp_path, monkeypatch):
    folder = make_platform_task(tmp_path)
    c = client()
    monkeypatch.setattr(backend, "_BODY_CACHE_MAX_ENTRIES", 2)
    monkeypatch.setattr(backend, "_BODY_CACHE_MAX_BODY_BYTES", 5000)
    monkeypatch.setattr(backend, "_BODY_CACHE_MAX_TOTAL_BYTES", 8000)
    # a file written just now is never cached (same-size rewrite inside one timestamp tick)
    write(folder, "output/flags.json", {"flags": [1]})
    assert c.get("/tasks/plat/flags").status_code == 200 and not backend._body_cache
    # an old, small one is
    age(folder / "output" / "flags.json")
    c.get("/tasks/plat/flags")
    assert len(backend._body_cache) == 1
    # oversized body: served, not kept
    big = write(folder, "output/roster-diff.json", {"blocking": [], "pad": "p" * 6000})
    age(big)
    assert len(c.get("/tasks/plat/diff").content) > 5000 and len(backend._body_cache) == 1
    # entry bound
    for i in range(4):
        opt = write(folder, f"output/o{i}.json", {"cycles": [i]})
        age(opt)
        backend._body_put(("k", i, backend._file_key(opt)), b"x" * 100)
    assert len(backend._body_cache) <= 2
    assert backend._body_cache_bytes == sum(len(v) for v in backend._body_cache.values())


# --- history ----------------------------------------------------------------------

def record(n, task="plat", agent="adam", outcome="completed", approvals=True):
    r = {"run_id": f"r{n}", "task_id": task, "agent_id": agent, "outcome": outcome,
         "started_at": "2026-10-01T01:00:00+00:00", "ended_at": "2026-10-01T01:10:00+00:00"}
    if approvals:
        r["approvals"] = [{"step": "s", "kind": "approve", "user": "u", "at": "t"}]
    return r


def write_history(tmp_path, records, header=True):
    lines = ([json.dumps(backend.HISTORY_HEADER)] if header else []) + [json.dumps(r) for r in records]
    path = tmp_path / "history.jsonl"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def test_history_endpoint_matches_the_old_per_call_parse(tmp_path):
    make_platform_task(tmp_path)
    make_platform_task(tmp_path, "other")
    recs = [record(n, "plat" if n % 2 else "other", approvals=n % 3 != 0) for n in range(300)]
    path = write_history(tmp_path, recs)
    with path.open("a") as fh:
        fh.write("{corrupt line\n[1,2]\n")  # skipped, as before
    age(path)
    c = client()

    def old(task_id):  # the removed implementation, verbatim
        runs = [r for r in reversed(backend._read_history()) if r.get("task_id") == task_id]
        return {"ok": True, "runs": [r if "approvals" in r else {**r, "approvals": []} for r in runs[:backend.MAX_RUNS_PER_TASK]]}

    for task_id in ("plat", "other"):
        resp = c.get(f"/tasks/{task_id}/history")
        assert resp.json() == old(task_id) and len(resp.json()["runs"]) == backend.MAX_RUNS_PER_TASK
        assert resp.content == compact(old(task_id))
        assert all("approvals" in r for r in resp.json()["runs"])
    assert c.get("/tasks/ghost/history").json() == {"ok": False, "reason": "unknown task"}
    assert c.get("/tasks/plat/history").json()["runs"][0]["run_id"] == "r299"  # newest first


def test_history_parsed_once_then_invalidated_by_append_or_rewrite(tmp_path, monkeypatch):
    make_platform_task(tmp_path)
    path = write_history(tmp_path, [record(1), record(2)])
    age(path)
    reads = count_calls(monkeypatch, backend, "_read_history")
    c = client()
    for _ in range(3):
        assert [r["run_id"] for r in c.get("/tasks/plat/history").json()["runs"]] == ["r2", "r1"]
    assert c.get("/agents/adam/metrics").status_code == 200
    assert len(reads) == 1  # one parse serves history AND metrics

    backend._append_history(record(3))  # the app's own writer: size changes
    assert [r["run_id"] for r in c.get("/tasks/plat/history").json()["runs"]] == ["r3", "r2", "r1"]
    path.write_text(json.dumps(record(9)) + "\n")  # truncated + rewritten
    age(path, 100)
    assert [r["run_id"] for r in c.get("/tasks/plat/history").json()["runs"]] == ["r9"]
    path.unlink()
    assert c.get("/tasks/plat/history").json() == {"ok": True, "runs": []}


def test_history_just_written_is_not_cached(tmp_path):
    make_platform_task(tmp_path)
    write_history(tmp_path, [record(1)])
    assert backend._history_snapshot()[1]["plat"]
    assert backend._history_cache is None  # modified moments ago: re-read until it settles


def test_metrics_are_unchanged(tmp_path):
    make_platform_task(tmp_path)
    recs = [record(1, outcome="completed"), record(2, outcome="failed"), record(3, agent="nancy"), record(4, outcome="completed")]
    age(write_history(tmp_path, recs))
    body = client().get("/agents/adam/metrics").json()
    assert body["ok"] and body["tasks_completed"] == 2 and body["tasks_failed"] == 1
    assert body["success_rate"] == 2 / 3 and body["avg_duration_seconds"] == 600.0


# --- /log, /tasks, /agents ---------------------------------------------------------

def test_log_body_is_byte_identical_cached_and_tracks_every_change(tmp_path):
    make_platform_task(tmp_path)
    task = backend.tasks["plat"]
    c = client()
    resp = c.get("/tasks/plat/log")
    assert resp.content == b"[]" and resp.headers["content-type"] == "application/json"

    task.log_step("analyze", "stdout", "héllo\n")
    task.log_step("analyze", "stderr", "boom")
    resp = c.get("/tasks/plat/log")
    assert resp.content == compact(task.step_output)
    body = task.log_json()
    assert task.log_json() is body  # unchanged log: the very same cached bytes

    task.log_step("build", "stdout", "more")
    assert c.get("/tasks/plat/log").content == compact(task.step_output) and task.log_json() is not body

    for n in range(450):  # past the 400-entry cap: length stays 400 but the entries change
        task.log_step("build", "stdout", f"line {n}")
        if n % 97 == 0:
            assert c.get("/tasks/plat/log").content == compact(task.step_output)
    assert len(task.step_output) == 400
    before = task.log_json()
    task.log_step("build", "stdout", "one more")
    assert task.log_json() is not before and json.loads(task.log_json())[-1]["text"] == "one more"

    task.step_output.clear()  # a new run
    assert c.get("/tasks/plat/log").content == b"[]"
    assert c.get("/tasks/ghost/log").json() == {"ok": False, "reason": "unknown task"}


def test_tasks_and_agents_bodies_are_byte_identical_to_the_plain_encoding(tmp_path):
    make_platform_task(tmp_path)
    make_platform_task(tmp_path, "second", prepare={}, inputs=[])
    backend.push_notification(backend.tasks["plat"], "task.completed", "T", "b", "x", [{"label": None, "path": "x"}])
    c = client()
    tasks = c.get("/tasks")
    assert tasks.headers["content-type"] == "application/json"
    assert tasks.content == compact([t.to_dict() for t in backend.tasks.values()])
    assert [t["id"] for t in tasks.json()] == ["plat", "second"]
    agents = c.get("/agents")
    assert agents.headers["content-type"] == "application/json"
    assert agents.content == compact([w.to_dict() for w in backend.workers.values()])


# --- concurrency -----------------------------------------------------------------

def test_cache_bookkeeping_survives_many_threads(tmp_path, monkeypatch):
    """Handlers run in worker threads next to the event loop: hammer every cache
    from several threads and check nothing raises and every bound holds."""
    folder = make_platform_task(tmp_path)
    task = backend.tasks["plat"]
    monkeypatch.setattr(backend, "_JSON_CACHE_MAX_ENTRIES", 5)
    monkeypatch.setattr(backend, "_BODY_CACHE_MAX_ENTRIES", 4)
    monkeypatch.setattr(backend, "_SHA_CACHE_MAX", 6)
    monkeypatch.setattr(backend, "_RESOLVE_MEMO_MAX", 7)
    paths = []
    for i in range(12):
        p = write(folder, f"output/f{i}.json", {"i": i})
        age(p)
        paths.append(p)
    errors = []

    def hammer(seed):
        try:
            for n in range(150):
                i = (seed + n) % 12
                assert backend._read_json_rel(task, f"output/f{i}.json", cached=True) == {"i": i}
                assert backend._file_info(paths[i])["size"] == paths[i].stat().st_size
                backend._body_put(("t", i, backend._file_key(paths[i])), b"b" * (10 + i))
                backend._resolve_in_task(task, f"output/f{i}.json", memo=True)
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=hammer, args=(k,)) for k in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(30)
    assert errors == []
    assert len(backend._json_cache) <= 5 and len(backend._body_cache) <= 4
    assert len(backend._sha_cache) <= 6 and len(backend._resolve_memo) <= 7
    assert backend._json_cache_bytes == sum(k[2] for k in backend._json_cache)
    assert backend._body_cache_bytes == sum(len(v) for v in backend._body_cache.values())


def test_log_endpoint_stays_valid_json_while_the_log_grows(tmp_path):
    make_platform_task(tmp_path)
    task = backend.tasks["plat"]
    errors = []
    stop = threading.Event()

    def poll():
        c = client()
        while not stop.is_set():
            try:
                entries = c.get("/tasks/plat/log").json()
                assert isinstance(entries, list) and len(entries) <= 400
                assert all(set(e) == {"step", "stream", "text"} for e in entries)
            except BaseException as exc:  # noqa: BLE001
                errors.append(exc)
                return

    threads = [threading.Thread(target=poll) for _ in range(3)]
    for t in threads:
        t.start()
    for n in range(600):
        task.log_step("s", "stdout", f"line {n}")
    stop.set()
    for t in threads:
        t.join(20)
    assert errors == []
    assert client().get("/tasks/plat/log").content == compact(task.step_output)


def test_a_transient_read_error_is_reported_but_never_remembered(tmp_path, monkeypatch):
    folder = make_platform_task(tmp_path)
    task = backend.tasks["plat"]
    path = write(folder, "output/data.json", {"a": 1})
    age(path)
    real = type(path).read_text

    def locked(self, *a, **k):
        if self.name == "data.json":
            raise PermissionError("locked by another program")
        return real(self, *a, **k)

    with monkeypatch.context() as patched:
        patched.setattr(type(path), "read_text", locked)
        with pytest.raises(backend._Refusal, match="not valid JSON"):
            backend._read_json_rel(task, "output/data.json", cached=True)
    assert backend._read_json_rel(task, "output/data.json", cached=True) == {"a": 1}  # recovered at once
