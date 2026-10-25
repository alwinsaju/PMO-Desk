"""Task platform extensions (tasks/TASK-PLATFORM-CONTRACT.md): manifest
inputs/prepare/gates, upload, prepare, options, params, form, diff, flags, the
start/approve/send guards and the approver stamp.

Hermetic by construction: every task folder is a synthetic temp dir
(TASKS_ROOT is patched to tmp_path) and nothing here can reach Outlook or a
running engine."""
import asyncio
import builtins
import json
import os
import subprocess
import sys
import types

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import main as backend


# --- builders -----------------------------------------------------------------

NOOP = "print('ok')"

PREPARE_OK = """
import json, os, sys
os.makedirs('output', exist_ok=True)
stdin_text = sys.stdin.read()
json.dump({
    "cycles": [
        {"id": "2026-12", "label": "Dec", "enabled": True},
        {"id": "2026-11", "label": "Nov", "enabled": False, "reason": "Previous cycle has no data"},
    ],
    "default": "2026-12",
    "cwd": os.getcwd(), "exe": sys.executable, "stdin": stdin_text,
}, open('output/options.json', 'w'))
"""

FORM_SCHEMA = {
    "title": "Questions",
    "fields": [
        {"id": "shift:Ann", "type": "select", "required": True,
         "options": [{"value": "KEEP", "label": "Keep"}, {"value": "S1", "label": "Shift 1"}], "default": "KEEP"},
        {"id": "pattern:Ann", "type": "select", "required": False,
         "options": [{"value": "MON_FRI", "label": "Mon-Fri"}]},
        {"id": "note", "type": "text", "required": True},
    ],
}

PLATFORM_STEPS = [
    {"id": "analyze", "type": "python", "cmd": "scripts/noop.py", "label": "Analyze"},
    {"id": "answers", "type": "review", "label": "Answer questions", "reviewMessage": "Questions are ready for you",
     "gate": {"type": "form", "schema": "output/ask-me.json", "answers": "output/ask-me-answers.json"}},
    {"id": "build", "type": "python", "cmd": "scripts/noop.py"},
    {"id": "review_draft", "type": "review", "reviewMessage": "Draft is ready",
     "gate": {"type": "flags", "file": "output/flags.json"}},
    {"id": "confirm_diff", "type": "confirm", "reviewMessage": "Review every changed cell, then confirm",
     "gate": {"type": "diff", "file": "output/roster-diff.json"}},
    {"id": "finalize", "type": "python", "cmd": "scripts/noop.py"},
]

PLATFORM_INPUTS = [
    {"id": "roster", "label": "Roster workbook", "type": "file", "accept": [".xlsx"], "dest": "input/roster.xlsx", "required": True},
    {"id": "holidays", "label": "Holiday Roster", "type": "file", "accept": [".xlsx"], "dest": "input/holiday-roster.xlsx", "required": True},
    {"id": "pto", "label": "PTO", "type": "file", "accept": [".XLSX", ".xls"], "dest": "input/pto-import.xlsx", "required": False},
    {"id": "cycle", "label": "Cycle", "type": "select", "optionsFile": "output/options.json", "optionsKey": "cycles", "required": True},
]


def make_platform_task(root, name="plat", *, steps=None, inputs=None, prepare=None,
                       extra=None, prepare_script=PREPARE_OK):
    folder = root / name
    (folder / "scripts").mkdir(parents=True)
    manifest = {
        "id": name,
        "displayName": name,
        "steps": steps if steps is not None else PLATFORM_STEPS,
        "inputs": inputs if inputs is not None else PLATFORM_INPUTS,
        "prepare": prepare if prepare is not None else {"cmd": "scripts/prepare_options.py", "after": ["roster", "holidays"]},
    }
    manifest.update(extra or {})
    (folder / "task.json").write_text(json.dumps(manifest))
    (folder / "scripts" / "noop.py").write_text(NOOP)
    if prepare_script is not None:
        (folder / "scripts" / "prepare_options.py").write_text(prepare_script)
    backend.discover_tasks()
    return folder


def make_legacy_task(root, name="legacy", steps=None):
    folder = root / name
    (folder / "scripts").mkdir(parents=True)
    manifest = {"id": name, "displayName": name,
                "steps": steps or [{"id": "noop", "type": "python", "cmd": "scripts/noop.py"}]}
    (folder / "task.json").write_text(json.dumps(manifest))
    (folder / "scripts" / "noop.py").write_text(NOOP)
    backend.discover_tasks()
    return folder


def write(folder, rel, content):
    path = folder / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(content, (dict, list)):
        content = json.dumps(content)
    if isinstance(content, str):
        path.write_text(content, encoding="utf-8")
    else:
        path.write_bytes(content)
    return path


def make_link(link, target):
    """Directory symlink, falling back to an NTFS junction (no privilege
    needed); skips the test where neither can be created."""
    try:
        os.symlink(target, link, target_is_directory=True)
        return
    except (OSError, NotImplementedError):
        pass
    if sys.platform == "win32":
        done = subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(target)], capture_output=True)
        if done.returncode == 0:
            return
    pytest.skip("cannot create a symlink or junction here")


def client():
    return TestClient(backend.app, raise_server_exceptions=False)


def upload(c, task_id, input_id, name="a.xlsx", data=b"PK-data"):
    return c.post(f"/tasks/{task_id}/upload", params={"input": input_id},
                  files={"file": (name, data, "application/octet-stream")}).json()


def at_gate(task, step_id, state="awaiting_review"):
    backend.set_state(task, state, current_step=step_id)


async def wait_for(predicate, tries=500):
    for _ in range(tries):
        if predicate():
            return
        await asyncio.sleep(0.01)
    raise AssertionError("condition never became true")


# --- manifest parsing and GET /tasks -------------------------------------------

LEGACY_KEYS = {"id", "displayName", "state", "error", "currentStep", "steps", "notifications"}


def test_legacy_task_to_dict_only_gains_keys(tmp_path):
    make_legacy_task(tmp_path, steps=[
        {"id": "build", "type": "python", "cmd": "scripts/noop.py"},
        {"id": "review_gate", "type": "review"},
        {"id": "send_gate", "type": "confirm"},
    ])
    d = backend.tasks["legacy"].to_dict()

    assert LEGACY_KEYS <= set(d)
    assert set(d) - LEGACY_KEYS == {"inputs", "prepare", "cleanup"}
    assert (d["id"], d["displayName"], d["state"], d["error"]) == ("legacy", "legacy", "resting", None)
    assert (d["currentStep"], d["notifications"]) == (None, [])
    assert d["inputs"] == [] and d["prepare"] is False and d["cleanup"] is None
    for step, expected in zip(d["steps"], [("build", "python"), ("review_gate", "review"), ("send_gate", "confirm")]):
        assert (step["id"], step["type"]) == expected
        assert step["label"] is None and step["gate"] is None
        assert set(step) == {"id", "type", "label", "gate"}


def test_platform_task_exposes_manifest_additions(tmp_path):
    make_platform_task(tmp_path)
    body = client().get("/tasks").json()[0]

    assert body["prepare"] is True
    assert [i["id"] for i in body["inputs"]] == ["roster", "holidays", "pto", "cycle"]
    assert body["inputs"][0]["dest"] == "input/roster.xlsx"
    answers = next(s for s in body["steps"] if s["id"] == "answers")
    assert answers["label"] == "Answer questions"
    assert answers["gate"] == {"type": "form", "schema": "output/ask-me.json", "answers": "output/ask-me-answers.json"}
    assert next(s for s in body["steps"] if s["id"] == "confirm_diff")["gate"] == {"type": "diff", "file": "output/roster-diff.json"}


def test_malformed_platform_keys_are_ignored(tmp_path):
    make_platform_task(tmp_path, inputs=[{"label": "no id"}, "junk", {"id": "ok", "type": "file"}],
                       prepare={"after": ["x"]},
                       steps=[{"id": "a", "type": "review", "gate": "oops"}, {"id": "b", "type": "review", "gate": {"file": "x"}}])
    d = backend.tasks["plat"].to_dict()

    assert [i["id"] for i in d["inputs"]] == ["ok"]
    assert d["prepare"] is False
    assert [s["gate"] for s in d["steps"]] == [None, None]
    backend.tasks["plat"].apply_manifest({"id": "plat", "steps": [], "inputs": "nope", "prepare": "nope"})
    assert backend.tasks["plat"].inputs == [] and backend.tasks["plat"].prepare is None


# --- path safety --------------------------------------------------------------

@pytest.mark.parametrize("rel", [
    "../x.json", "input/../../x.json", "output/../../x.json", "/abs/input/x.json", "\\input\\x.json",
    "C:\\input\\x.json", "input/a:stream", "input", "input/", "other/x.json", "", "   ", None, 7, "input/a\x00b",
])
def test_resolve_in_task_refuses_unsafe_paths(tmp_path, rel):
    make_platform_task(tmp_path)
    with pytest.raises(backend._Refusal):
        backend._resolve_in_task(backend.tasks["plat"], rel)


def test_resolve_in_task_accepts_input_and_output_paths(tmp_path):
    folder = make_platform_task(tmp_path)
    task = backend.tasks["plat"]
    assert backend._resolve_in_task(task, "input/roster.xlsx") == folder / "input" / "roster.xlsx"
    assert backend._resolve_in_task(task, "output\\sub/./x.json") == folder / "output" / "sub" / "x.json"
    with pytest.raises(backend._Refusal):
        backend._resolve_in_task(task, "output/x.json", roots=("input",))


def test_resolve_in_task_refuses_symlinked_directory(tmp_path):
    folder = make_platform_task(tmp_path)
    outside = tmp_path / "outside"
    outside.mkdir()
    (folder / "output").mkdir(exist_ok=True)
    make_link(folder / "output" / "sub", outside)

    with pytest.raises(backend._Refusal, match="symbolic"):
        backend._resolve_in_task(backend.tasks["plat"], "output/sub/x.json")


def test_resolve_in_task_refuses_input_folder_itself_linked(tmp_path):
    folder = make_platform_task(tmp_path)
    outside = tmp_path / "outside"
    outside.mkdir()
    make_link(folder / "input", outside)

    with pytest.raises(backend._Refusal, match="symbolic"):
        backend._resolve_in_task(backend.tasks["plat"], "input/roster.xlsx")


def test_resolve_in_task_refuses_escape_after_resolve(tmp_path, monkeypatch):
    # Belt and braces: even if a component evaded the link check, a resolved
    # path outside <task>/<root> is refused.
    folder = make_platform_task(tmp_path)
    monkeypatch.setattr(backend, "_is_link", lambda _p: False)
    outside = tmp_path / "outside"
    outside.mkdir()
    make_link(folder / "output", outside)

    with pytest.raises(backend._Refusal, match="escapes"):
        backend._resolve_in_task(backend.tasks["plat"], "output/x.json")


def test_atomic_write_leaves_no_temp_files_and_cleans_up_on_failure(tmp_path, monkeypatch):
    target = tmp_path / "d" / "x.json"
    backend._atomic_write_json(target, {"a": 1})
    assert json.loads(target.read_text()) == {"a": 1}
    assert [p.name for p in target.parent.iterdir()] == ["x.json"]

    def boom(*_a, **_k):
        raise OSError("disk full")

    monkeypatch.setattr(backend.os, "replace", boom)
    with pytest.raises(OSError):
        backend._atomic_write_json(target, {"a": 2})
    assert [p.name for p in target.parent.iterdir()] == ["x.json"]
    assert json.loads(target.read_text()) == {"a": 1}


def test_file_info_hashes_and_cache_is_bounded(tmp_path):
    f = tmp_path / "f.bin"
    f.write_bytes(b"hello")
    info = backend._file_info(f)
    assert info["size"] == 5
    assert info["sha256"] == "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    assert backend._file_info(f) == info  # cache hit
    for i in range(40):
        g = tmp_path / f"g{i}.bin"
        g.write_bytes(bytes([i]))
        backend._file_info(g)
    assert len(backend._sha_cache) <= 33


# --- unknown task on every new endpoint ----------------------------------------

@pytest.mark.parametrize("method,path", [
    ("get", "/tasks/ghost/inputs"), ("get", "/tasks/ghost/options"), ("get", "/tasks/ghost/form"),
    ("get", "/tasks/ghost/diff"), ("get", "/tasks/ghost/flags"),
    ("post", "/tasks/ghost/prepare"), ("post", "/tasks/ghost/upload?input=x"),
])
def test_unknown_task_returns_ok_false(method, path):
    resp = getattr(client(), method)(path)
    assert resp.status_code == 200
    assert resp.json() == {"ok": False, "reason": "unknown task"}


@pytest.mark.parametrize("path", ["/tasks/ghost/params", "/tasks/ghost/form"])
def test_unknown_task_post_json_endpoints(path):
    resp = client().post(path, json={"params": {}, "answers": {}})
    assert resp.json() == {"ok": False, "reason": "unknown task"}


# --- GET /inputs ----------------------------------------------------------------

def test_inputs_lists_absent_files_and_saved_params(tmp_path):
    make_platform_task(tmp_path)
    body = client().get("/tasks/plat/inputs").json()

    assert body["ok"] is True and body["params"] == {}
    by_id = {i["id"]: i for i in body["inputs"]}
    assert list(by_id) == ["roster", "holidays", "pto", "cycle"]
    assert by_id["roster"] == {"id": "roster", "label": "Roster workbook", "type": "file", "required": True,
                                "persist": False, "present": False, "modified": None}
    assert by_id["pto"]["required"] is False
    assert by_id["cycle"]["present"] is False


def test_inputs_reports_present_file_metadata_and_select_value(tmp_path):
    folder = make_platform_task(tmp_path)
    write(folder, "input/roster.xlsx", b"abc")
    write(folder, "input/run-params.json", {"params": {"cycle": "2026-12"}, "saved_at": "x"})
    body = client().get("/tasks/plat/inputs").json()

    by_id = {i["id"]: i for i in body["inputs"]}
    assert by_id["roster"]["present"] is True
    assert by_id["roster"]["filename"] == "roster.xlsx"
    assert by_id["roster"]["size"] == 3
    assert by_id["roster"]["sha256"] == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    assert by_id["cycle"]["present"] is True
    assert body["params"] == {"cycle": "2026-12"}


def test_inputs_for_task_without_inputs_is_empty(tmp_path):
    make_legacy_task(tmp_path)
    assert client().get("/tasks/legacy/inputs").json() == {"ok": True, "inputs": [], "params": {}, "cleanable": {"files": 0, "bytes": 0}}


def test_inputs_tolerates_corrupt_params_and_meta(tmp_path):
    folder = make_platform_task(tmp_path)
    write(folder, "input/run-params.json", "{not json")
    write(folder, "input/.uploads-meta.json", "[1,2]")
    write(folder, "input/roster.xlsx", b"x")
    body = client().get("/tasks/plat/inputs").json()
    assert body["ok"] is True and body["params"] == {}
    assert next(i for i in body["inputs"] if i["id"] == "roster")["filename"] == "roster.xlsx"
    write(folder, "input/run-params.json", {"params": "wrong-shape"})
    assert client().get("/tasks/plat/inputs").json()["params"] == {}


def test_inputs_with_unsafe_dest_reads_as_absent(tmp_path):
    folder = make_platform_task(tmp_path, inputs=[
        {"id": "bad", "type": "file", "accept": [".xlsx"], "dest": "../escape.xlsx", "required": True},
    ])
    write(tmp_path, "escape.xlsx", b"x")
    body = client().get("/tasks/plat/inputs").json()
    assert body["inputs"][0]["present"] is False
    assert list((folder / "input").iterdir()) == []  # nothing written


# --- POST /upload ---------------------------------------------------------------

def test_upload_happy_path_stores_file_atomically(tmp_path):
    folder = make_platform_task(tmp_path)
    c = client()

    body = upload(c, "plat", "roster", name="My Roster.xlsx", data=b"PK123")

    assert body == {"ok": True, "input": "roster", "filename": "My Roster.xlsx", "size": 5,
                    "sha256": "d10775217921286ed713f51b024bd6c9e62781e565b8673e09ba04644560d5c9"}
    assert (folder / "input" / "roster.xlsx").read_bytes() == b"PK123"
    leftovers = [p.name for p in (folder / "input").iterdir() if p.name.endswith((".upload", ".tmp"))]
    assert leftovers == []
    listed = c.get("/tasks/plat/inputs").json()
    roster = next(i for i in listed["inputs"] if i["id"] == "roster")
    assert roster["present"] and roster["filename"] == "My Roster.xlsx" and roster["size"] == 5
    assert roster["sha256"] == body["sha256"]


def test_upload_extension_check_is_case_insensitive_both_ways(tmp_path):
    folder = make_platform_task(tmp_path)
    c = client()
    assert upload(c, "plat", "roster", name="UPPER.XLSX")["ok"] is True
    # manifest accept entries may be upper-case too
    assert upload(c, "plat", "pto", name="p.xlsx")["ok"] is True
    assert (folder / "input" / "pto-import.xlsx").exists()


@pytest.mark.parametrize("name", ["roster.csv", "roster", "roster.xlsx.exe", "evil.py", ".xlsx.ps1"])
def test_upload_rejects_extensions_outside_allow_list(tmp_path, name):
    folder = make_platform_task(tmp_path)
    body = upload(client(), "plat", "roster", name=name)
    assert body["ok"] is False and "not accepted" in body["reason"]
    assert not (folder / "input" / "roster.xlsx").exists()


def test_upload_denied_extension_wins_even_if_manifest_allows_it(tmp_path):
    make_platform_task(tmp_path, inputs=[
        {"id": "script", "type": "file", "accept": [".py"], "dest": "input/x.py", "required": False},
    ])
    body = upload(client(), "plat", "script", name="x.py")
    assert body["ok"] is False and "not accepted" in body["reason"]


def test_upload_requires_declared_accept_list(tmp_path):
    make_platform_task(tmp_path, inputs=[{"id": "any", "type": "file", "dest": "input/any.bin", "required": False}])
    body = upload(client(), "plat", "any", name="x.bin")
    assert body["ok"] is False and "no accepted file types" in body["reason"]


def test_upload_unknown_input_select_input_and_missing_params(tmp_path):
    make_platform_task(tmp_path)
    c = client()
    assert "unknown input" in upload(c, "plat", "nope")["reason"]
    assert "not a file input" in upload(c, "plat", "cycle")["reason"]
    assert "'input' is required" in c.post("/tasks/plat/upload", files={"file": ("a.xlsx", b"x")}).json()["reason"]
    assert "'file' is required" in c.post("/tasks/plat/upload?input=roster").json()["reason"]


@pytest.mark.parametrize("state", ["working", "awaiting_review", "awaiting_send", "finishing", "error"])
def test_upload_only_while_resting(tmp_path, state):
    folder = make_platform_task(tmp_path)
    backend.set_state(backend.tasks["plat"], state)
    body = upload(client(), "plat", "roster")
    assert body == {"ok": False, "reason": f"task is {state}"}
    assert list((folder / "input").iterdir()) == []  # a refused upload leaves nothing


def test_upload_refused_while_prepare_runs(tmp_path):
    make_platform_task(tmp_path)
    backend.tasks["plat"].preparing = True
    assert upload(client(), "plat", "roster") == {"ok": False, "reason": "prepare is running"}


def test_upload_rejects_empty_file(tmp_path):
    folder = make_platform_task(tmp_path)
    body = upload(client(), "plat", "roster", data=b"")
    assert body["ok"] is False and "empty" in body["reason"]
    assert not (folder / "input" / "roster.xlsx").exists()


def test_upload_enforces_size_cap_and_keeps_existing_file(tmp_path, monkeypatch):
    folder = make_platform_task(tmp_path)
    write(folder, "input/roster.xlsx", b"old")
    monkeypatch.setattr(backend, "MAX_UPLOAD_BYTES", 10)

    body = upload(client(), "plat", "roster", data=b"x" * 11)

    assert body["ok"] is False and "limit" in body["reason"]
    assert (folder / "input" / "roster.xlsx").read_bytes() == b"old"
    assert [p.name for p in (folder / "input").iterdir()] == ["roster.xlsx"]


def test_upload_at_exact_cap_is_accepted(tmp_path, monkeypatch):
    make_platform_task(tmp_path)
    monkeypatch.setattr(backend, "MAX_UPLOAD_BYTES", 10)
    assert upload(client(), "plat", "roster", data=b"x" * 10)["ok"] is True


def test_upload_client_filename_cannot_steer_the_destination(tmp_path):
    folder = make_platform_task(tmp_path)
    body = upload(client(), "plat", "roster", name="..\\..\\evil.xlsx", data=b"data")
    assert body["ok"] is True and body["filename"] == "evil.xlsx"
    assert (folder / "input" / "roster.xlsx").read_bytes() == b"data"
    assert not (tmp_path / "evil.xlsx").exists() and not (folder.parent.parent / "evil.xlsx").exists()
    assert sorted(p.name for p in (folder / "input").iterdir() if not p.name.startswith(".")) == ["roster.xlsx"]


def test_upload_blank_client_filename_is_refused(tmp_path):
    make_platform_task(tmp_path)
    c = client()
    body = c.post("/tasks/plat/upload", params={"input": "roster"}, files={"file": ("/", b"x")}).json()
    assert body["ok"] is False and "no file" in body["reason"]


@pytest.mark.parametrize("dest", ["../escape.xlsx", "input/../../escape.xlsx", "/abs.xlsx", "output/x.xlsx", "x.xlsx", "input/a:b.xlsx"])
def test_upload_refuses_manifest_dest_outside_input_folder(tmp_path, dest):
    make_platform_task(tmp_path, inputs=[{"id": "r", "type": "file", "accept": [".xlsx"], "dest": dest, "required": True}])
    body = upload(client(), "plat", "r")
    assert body["ok"] is False
    assert not (tmp_path / "escape.xlsx").exists()
    assert not (tmp_path / "plat" / "output" / "x.xlsx").exists()


def test_upload_refuses_symlinked_input_folder(tmp_path):
    folder = make_platform_task(tmp_path)
    outside = tmp_path / "outside"
    outside.mkdir()
    make_link(folder / "input", outside)

    body = upload(client(), "plat", "roster")

    assert body["ok"] is False and "symbolic" in body["reason"]
    assert list(outside.iterdir()) == []


def test_upload_refuses_dest_below_a_symlinked_subfolder(tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    folder = make_platform_task(tmp_path, inputs=[
        {"id": "r", "type": "file", "accept": [".xlsx"], "dest": "input/sub/x.xlsx", "required": True}])
    (folder / "input").mkdir(exist_ok=True)
    make_link(folder / "input" / "sub", outside)

    body = upload(client(), "plat", "r")

    assert body["ok"] is False and "symbolic" in body["reason"]
    assert list(outside.iterdir()) == []


def test_upload_reports_replace_failure_and_cleans_temp(tmp_path, monkeypatch):
    folder = make_platform_task(tmp_path)

    def locked(*_a, **_k):
        raise PermissionError("in use")

    monkeypatch.setattr(backend.os, "replace", locked)
    body = upload(client(), "plat", "roster")

    assert body["ok"] is False and "could not save" in body["reason"]
    assert list((folder / "input").iterdir()) == []


def test_reuploading_a_prepare_input_clears_options_and_select_choices(tmp_path):
    folder = make_platform_task(tmp_path)
    c = client()
    for i in ("roster", "holidays"):
        assert upload(c, "plat", i)["ok"]
    assert c.post("/tasks/plat/prepare").json()["ok"]
    assert c.post("/tasks/plat/params", json={"params": {"cycle": "2026-12"}}).json()["ok"]
    assert (folder / "output" / "options.json").exists()

    # an input outside prepare.after leaves everything alone
    assert upload(c, "plat", "pto")["ok"]
    assert (folder / "output" / "options.json").exists()
    assert c.get("/tasks/plat/inputs").json()["params"] == {"cycle": "2026-12"}

    assert upload(c, "plat", "roster", data=b"new")["ok"]
    assert not (folder / "output" / "options.json").exists()
    assert c.get("/tasks/plat/inputs").json()["params"] == {}
    assert c.get("/tasks/plat/options").json() == {"ok": True, "options": None}


def test_upload_without_multipart_gives_clear_ok_false():
    fresh = FastAPI()
    backend._register_upload_route(fresh, False)
    body = TestClient(fresh).post("/tasks/x/upload?input=a").json()
    assert body["ok"] is False and "python-multipart" in body["reason"]


def test_multipart_detection(monkeypatch):
    assert backend._multipart_installed() is True
    real_import = builtins.__import__

    def deny(name, *args, **kwargs):
        if name in ("python_multipart", "multipart"):
            raise ImportError(name)
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", deny)
    assert backend._multipart_installed() is False


# --- POST /prepare and GET /options ---------------------------------------------

def ready_inputs(c):
    assert upload(c, "plat", "roster")["ok"] and upload(c, "plat", "holidays")["ok"]


def test_prepare_runs_declared_script_with_task_python_and_returns_options(tmp_path):
    folder = make_platform_task(tmp_path)
    c = client()
    ready_inputs(c)

    body = c.post("/tasks/plat/prepare").json()

    assert body["ok"] is True
    options = body["options"]
    assert [o["id"] for o in options["cycles"]] == ["2026-12", "2026-11"]
    assert options["exe"] == sys.executable
    assert os.path.samefile(options["cwd"], folder)
    assert options["stdin"] == ""  # stdin is closed, never a prompt
    assert json.loads((folder / "output" / "options.json").read_text()) == options
    assert backend.tasks["plat"].preparing is False
    assert c.get("/tasks/plat/options").json() == {"ok": True, "options": options}


def test_prepare_requires_all_after_inputs(tmp_path):
    make_platform_task(tmp_path)
    c = client()
    assert upload(c, "plat", "roster")["ok"]
    body = c.post("/tasks/plat/prepare").json()
    assert body["ok"] is False and body["missing"] == ["holidays"]


def test_prepare_after_naming_unknown_input_counts_as_missing(tmp_path):
    make_platform_task(tmp_path, prepare={"cmd": "scripts/prepare_options.py", "after": ["ghost"]})
    body = client().post("/tasks/plat/prepare").json()
    assert body["ok"] is False and body["missing"] == ["ghost"]


def test_prepare_with_empty_after_runs_immediately(tmp_path):
    make_platform_task(tmp_path, prepare={"cmd": "scripts/prepare_options.py", "after": []})
    assert client().post("/tasks/plat/prepare").json()["ok"] is True


def test_prepare_refused_unless_resting_or_when_already_running(tmp_path):
    make_platform_task(tmp_path)
    backend.set_state(backend.tasks["plat"], "working")
    assert client().post("/tasks/plat/prepare").json() == {"ok": False, "reason": "task is working"}
    backend.set_state(backend.tasks["plat"], "resting")
    backend.tasks["plat"].preparing = True
    assert client().post("/tasks/plat/prepare").json() == {"ok": False, "reason": "prepare is running"}


def test_prepare_for_task_without_prepare_step(tmp_path):
    make_legacy_task(tmp_path)
    assert client().post("/tasks/legacy/prepare").json() == {"ok": False, "reason": "this task has no prepare step"}


def test_prepare_failure_returns_stderr_tail(tmp_path):
    folder = make_platform_task(tmp_path, prepare_script="import sys\nprint('boom detail', file=sys.stderr)\nsys.exit(3)\n")
    c = client()
    ready_inputs(c)
    write(folder, "output/options.json", {"stale": True})

    body = c.post("/tasks/plat/prepare").json()

    assert body["ok"] is False and "exit 3" in body["reason"]
    assert "boom detail" in body["stderr_tail"]
    assert not (folder / "output" / "options.json").exists()  # stale options never survive a failed prepare
    assert backend.tasks["plat"].preparing is False


def test_prepare_failure_with_only_stdout_uses_it_as_tail(tmp_path):
    make_platform_task(tmp_path, prepare_script="import sys\nprint('only stdout')\nsys.exit(1)\n")
    c = client()
    ready_inputs(c)
    assert "only stdout" in c.post("/tasks/plat/prepare").json()["stderr_tail"]


def test_prepare_that_writes_nothing_or_garbage_is_a_failure(tmp_path):
    folder = make_platform_task(tmp_path, prepare_script="print('did nothing')\n")
    c = client()
    ready_inputs(c)
    body = c.post("/tasks/plat/prepare").json()
    assert body["ok"] is False and "did not write" in body["reason"]

    (folder / "scripts" / "prepare_options.py").write_text(
        "import os\nos.makedirs('output', exist_ok=True)\nopen('output/options.json','w').write('{nope')\n")
    body = c.post("/tasks/plat/prepare").json()
    assert body["ok"] is False and "not valid JSON" in body["reason"]


def test_prepare_times_out(tmp_path, monkeypatch):
    make_platform_task(tmp_path, prepare_script="import time\ntime.sleep(30)\n")
    monkeypatch.setattr(backend, "PREPARE_TIMEOUT_SECONDS", 1)
    c = client()
    ready_inputs(c)

    body = c.post("/tasks/plat/prepare").json()

    assert body["ok"] is False and "timed out after 1s" in body["reason"]
    assert backend.tasks["plat"].preparing is False


def test_prepare_launch_failure_is_reported(tmp_path, monkeypatch):
    make_platform_task(tmp_path)
    c = client()
    ready_inputs(c)

    def cannot_start(*_a, **_k):
        raise OSError("no interpreter")

    monkeypatch.setattr(backend, "_run_prepare", cannot_start)
    body = c.post("/tasks/plat/prepare").json()
    assert body["ok"] is False and "could not start" in body["reason"]
    assert backend.tasks["plat"].preparing is False


def test_prepare_uses_no_shell_and_closes_stdin(tmp_path, monkeypatch):
    make_platform_task(tmp_path)
    c = client()
    ready_inputs(c)
    seen = {}
    real_run = subprocess.run

    def spy(cmd, **kwargs):
        seen["cmd"], seen["kwargs"] = cmd, kwargs
        return real_run(cmd, **kwargs)

    monkeypatch.setattr(backend.subprocess, "run", spy)
    assert c.post("/tasks/plat/prepare").json()["ok"] is True
    assert seen["cmd"][0] == sys.executable and seen["cmd"][-1].endswith("prepare_options.py")
    assert seen["kwargs"]["shell"] is False
    assert seen["kwargs"]["stdin"] == subprocess.DEVNULL
    assert seen["kwargs"]["timeout"] == 120


@pytest.mark.parametrize("cmd", ["../evil.py", "/abs/evil.py", "C:\\evil.py", "scripts/prepare_options.txt", "scripts/missing.py", "\\evil.py"])
def test_prepare_refuses_scripts_outside_the_task_or_not_python(tmp_path, cmd):
    make_platform_task(tmp_path, prepare={"cmd": cmd, "after": []})
    write(tmp_path, "evil.py", "open('pwned','w').write('x')")
    body = client().post("/tasks/plat/prepare").json()
    assert body["ok"] is False and "prepare.cmd" in body["reason"]
    assert not (tmp_path / "plat" / "pwned").exists() and not (tmp_path / "pwned").exists()


def test_prepare_cmd_must_be_a_string(tmp_path):
    make_platform_task(tmp_path, prepare={"cmd": ["scripts/prepare_options.py"], "after": []})
    assert "prepare.cmd" in client().post("/tasks/plat/prepare").json()["reason"]


def test_prepare_refuses_options_file_outside_output(tmp_path):
    make_platform_task(tmp_path, inputs=[
        {"id": "cycle", "type": "select", "optionsFile": "../options.json", "optionsKey": "cycles", "required": True}],
        prepare={"cmd": "scripts/prepare_options.py", "after": []})
    body = client().post("/tasks/plat/prepare").json()
    assert body["ok"] is False and "must be inside" in body["reason"]


def test_options_endpoint_null_invalid_and_custom_file(tmp_path):
    folder = make_platform_task(tmp_path)
    c = client()
    assert c.get("/tasks/plat/options").json() == {"ok": True, "options": None}
    write(folder, "output/options.json", "{bad")
    body = c.get("/tasks/plat/options").json()
    assert body["ok"] is False and "not valid JSON" in body["reason"]
    write(folder, "output/options.json", {"cycles": []})
    assert c.get("/tasks/plat/options").json() == {"ok": True, "options": {"cycles": []}}


def test_options_uses_the_select_inputs_options_file(tmp_path):
    folder = make_platform_task(tmp_path, inputs=[
        {"id": "cycle", "type": "select", "optionsFile": "output/custom-options.json", "optionsKey": "cycles"}])
    write(folder, "output/custom-options.json", {"cycles": [{"id": "a"}]})
    assert client().get("/tasks/plat/options").json()["options"] == {"cycles": [{"id": "a"}]}


# --- POST /params ---------------------------------------------------------------

def prepared(tmp_path):
    folder = make_platform_task(tmp_path)
    c = client()
    ready_inputs(c)
    assert c.post("/tasks/plat/prepare").json()["ok"]
    return folder, c


def test_params_saves_valid_choice(tmp_path):
    folder, c = prepared(tmp_path)

    body = c.post("/tasks/plat/params", json={"params": {"cycle": "2026-12"}}).json()

    assert body == {"ok": True, "params": {"cycle": "2026-12"}}
    saved = json.loads((folder / "input" / "run-params.json").read_text())
    assert saved["params"] == {"cycle": "2026-12"}
    assert saved["saved_at"].endswith("+00:00")
    assert c.get("/tasks/plat/inputs").json()["params"] == {"cycle": "2026-12"}


def test_params_refuses_disabled_option_with_its_reason(tmp_path):
    folder, c = prepared(tmp_path)
    body = c.post("/tasks/plat/params", json={"params": {"cycle": "2026-11"}}).json()
    assert body == {"ok": False, "reason": "Previous cycle has no data"}
    assert not (folder / "input" / "run-params.json").exists()


def test_params_disabled_option_without_reason_has_default_message(tmp_path):
    folder, c = prepared(tmp_path)
    write(folder, "output/options.json", {"cycles": [{"id": "x", "enabled": False}]})
    body = c.post("/tasks/plat/params", json={"params": {"cycle": "x"}}).json()
    assert body["ok"] is False and "not available" in body["reason"]


def test_params_refuses_unknown_option_and_validates_before_writing(tmp_path):
    folder, c = prepared(tmp_path)
    assert c.post("/tasks/plat/params", json={"params": {"cycle": "2026-12"}}).json()["ok"]
    body = c.post("/tasks/plat/params", json={"params": {"cycle": "1999-01"}}).json()
    assert body["ok"] is False and "not an available option" in body["reason"]
    assert c.get("/tasks/plat/inputs").json()["params"] == {"cycle": "2026-12"}  # previous value intact


def test_params_requires_options_first(tmp_path):
    make_platform_task(tmp_path)
    body = client().post("/tasks/plat/params", json={"params": {"cycle": "2026-12"}}).json()
    assert body["ok"] is False and "run prepare first" in body["reason"]


def test_params_options_without_the_key_or_wrong_shape(tmp_path):
    folder, c = prepared(tmp_path)
    write(folder, "output/options.json", {"other": []})
    assert c.post("/tasks/plat/params", json={"params": {"cycle": "a"}}).json()["ok"] is False
    write(folder, "output/options.json", ["not", "a", "dict"])
    assert c.post("/tasks/plat/params", json={"params": {"cycle": "a"}}).json()["ok"] is False


def test_params_rejects_non_select_unknown_and_non_string(tmp_path):
    folder, c = prepared(tmp_path)
    assert "not a select input" in c.post("/tasks/plat/params", json={"params": {"roster": "x"}}).json()["reason"]
    assert "unknown input" in c.post("/tasks/plat/params", json={"params": {"ghost": "x"}}).json()["reason"]
    assert "must be a string" in c.post("/tasks/plat/params", json={"params": {"cycle": 5}}).json()["reason"]


def test_params_clear_with_null_or_empty_and_merge(tmp_path):
    folder, c = prepared(tmp_path)
    write(folder, "output/options.json", {"cycles": [{"id": "a"}, {"id": "b"}]})
    make_platform_task(tmp_path, name="other", inputs=PLATFORM_INPUTS)  # a second task must not interfere
    assert c.post("/tasks/plat/params", json={"params": {"cycle": "a"}}).json()["params"] == {"cycle": "a"}
    assert c.post("/tasks/plat/params", json={"params": {"cycle": "b"}}).json()["params"] == {"cycle": "b"}
    assert c.post("/tasks/plat/params", json={"params": {"cycle": None}}).json()["params"] == {}
    assert c.post("/tasks/plat/params", json={"params": {"cycle": "a"}}).json()["ok"]
    assert c.post("/tasks/plat/params", json={"params": {"cycle": ""}}).json()["params"] == {}
    assert c.post("/tasks/plat/params", json={"params": {}}).json() == {"ok": True, "params": {}}


def test_params_bad_bodies_and_wrong_state(tmp_path):
    folder, c = prepared(tmp_path)
    assert "must be JSON" in c.post("/tasks/plat/params", content="not json").json()["reason"]
    assert "'params' object" in c.post("/tasks/plat/params", json=["x"]).json()["reason"]
    assert "'params' object" in c.post("/tasks/plat/params", json={"params": "x"}).json()["reason"]
    backend.set_state(backend.tasks["plat"], "awaiting_review")
    assert c.post("/tasks/plat/params", json={"params": {"cycle": "2026-12"}}).json() == {"ok": False, "reason": "task is awaiting_review"}


def test_params_refuses_symlinked_input_folder(tmp_path):
    folder, c = prepared(tmp_path)
    outside = tmp_path / "outside"
    outside.mkdir()
    for p in (folder / "input").iterdir():
        p.unlink() if p.is_file() else None
    (folder / "input").rmdir()
    make_link(folder / "input", outside)
    body = c.post("/tasks/plat/params", json={"params": {"cycle": "2026-12"}}).json()
    assert body["ok"] is False and "symbolic" in body["reason"]
    assert list(outside.iterdir()) == []


# --- POST /start input guard ----------------------------------------------------

def test_start_refused_until_required_inputs_present(tmp_path):
    folder, c = prepared(tmp_path)  # roster+holidays uploaded, no cycle chosen
    resp = asyncio.run(backend.start_task("plat"))
    assert resp["ok"] is False and resp["missing"] == ["cycle"]
    assert "cycle" in resp["reason"]
    assert backend.tasks["plat"].state == "resting"

    (folder / "input" / "holiday-roster.xlsx").unlink()
    assert asyncio.run(backend.start_task("plat"))["missing"] == ["holidays", "cycle"]


def test_start_allowed_when_optional_inputs_missing(tmp_path):
    folder, c = prepared(tmp_path)
    assert c.post("/tasks/plat/params", json={"params": {"cycle": "2026-12"}}).json()["ok"]
    assert not (folder / "input" / "pto-import.xlsx").exists()

    async def go():
        resp = await backend.start_task("plat")
        await wait_for(lambda: backend.tasks["plat"].state != "working")
        return resp

    resp = asyncio.run(go())

    assert resp["ok"] is True
    assert backend.tasks["plat"].state == "awaiting_review"  # parked at the form gate, nothing sent
    assert backend.tasks["plat"].current_step == "answers"


def test_start_guard_is_a_noop_without_declared_inputs(tmp_path):
    make_legacy_task(tmp_path)

    async def go():
        resp = await backend.start_task("legacy")
        await wait_for(lambda: backend.tasks["legacy"].state == "resting")
        return resp

    assert asyncio.run(go())["ok"] is True


def test_input_without_required_flag_is_optional(tmp_path):
    make_platform_task(tmp_path, inputs=[{"id": "f", "type": "file", "accept": [".xlsx"], "dest": "input/f.xlsx"}])
    assert backend._missing_required_inputs(backend.tasks["plat"]) == []


# --- form gate ------------------------------------------------------------------

def form_task(tmp_path, *, answers=None, state="awaiting_review", step="answers"):
    folder = make_platform_task(tmp_path)
    write(folder, "output/ask-me.json", FORM_SCHEMA)
    if answers is not None:
        write(folder, "output/ask-me-answers.json", answers)
    if state:
        at_gate(backend.tasks["plat"], step, state)
    return folder


def test_form_get_returns_schema_answers_and_pending(tmp_path):
    form_task(tmp_path, answers={"shift:Ann": "KEEP", "note": "   "})
    body = client().get("/tasks/plat/form").json()

    assert body["ok"] is True
    assert body["schema"] == FORM_SCHEMA
    assert body["answers"] == {"shift:Ann": "KEEP", "note": "   "}
    assert body["pending"] == ["note"]  # whitespace-only is not an answer; optional field never pends


def test_form_get_without_answers_file_lists_every_required_field(tmp_path):
    form_task(tmp_path)
    body = client().get("/tasks/plat/form").json()
    assert body["answers"] == {} and body["pending"] == ["shift:Ann", "note"]


def test_form_get_works_before_the_pause_via_first_declared_gate(tmp_path):
    form_task(tmp_path, state=None)
    assert client().get("/tasks/plat/form").json()["pending"] == ["shift:Ann", "note"]


def test_form_get_errors(tmp_path):
    folder = make_platform_task(tmp_path)
    c = client()
    assert c.get("/tasks/plat/form").json() == {"ok": False, "reason": "the form is not ready yet", "pending": []}
    write(folder, "output/ask-me.json", {"fields": "oops"})
    assert "malformed" in c.get("/tasks/plat/form").json()["reason"]
    write(folder, "output/ask-me.json", {"fields": [{"no": "id"}]})
    assert "malformed" in c.get("/tasks/plat/form").json()["reason"]
    write(folder, "output/ask-me.json", [1])
    assert "malformed" in c.get("/tasks/plat/form").json()["reason"]
    write(folder, "output/ask-me.json", "{broken")
    assert "not valid JSON" in c.get("/tasks/plat/form").json()["reason"]
    make_legacy_task(tmp_path)
    assert c.get("/tasks/legacy/form").json() == {"ok": False, "reason": "this task has no form gate"}


def test_form_answers_treat_non_dict_file_as_empty(tmp_path):
    form_task(tmp_path, answers=["x"])
    assert client().get("/tasks/plat/form").json()["answers"] == {}


def test_form_post_merges_validates_and_writes_atomically(tmp_path):
    folder = form_task(tmp_path, answers={"note": "keep me"})
    c = client()

    body = c.post("/tasks/plat/form", json={"answers": {"shift:Ann": "S1", "pattern:Ann": "MON_FRI"}}).json()

    assert body == {"ok": True, "pending": []}
    saved = json.loads((folder / "output" / "ask-me-answers.json").read_text())
    assert saved == {"note": "keep me", "shift:Ann": "S1", "pattern:Ann": "MON_FRI"}
    assert [p.name for p in (folder / "output").iterdir() if p.name.endswith(".tmp")] == []

    body = c.post("/tasks/plat/form", json={"answers": {"shift:Ann": "KEEP"}}).json()  # overwrite per key
    assert json.loads((folder / "output" / "ask-me-answers.json").read_text())["shift:Ann"] == "KEEP"
    assert body["pending"] == []


def test_form_post_none_clears_an_answer_and_pending_returns(tmp_path):
    form_task(tmp_path, answers={"shift:Ann": "S1", "note": "x"})
    body = client().post("/tasks/plat/form", json={"answers": {"note": None}}).json()
    assert body == {"ok": True, "pending": ["note"]}


AVAIL_SCHEMA = {
    "title": "Questions",
    "fields": [
        {"id": "avail_person_1", "type": "select", "required": False, "default": "NONE",
         "options": [{"value": "NONE", "label": "No exception"}, {"value": "Ann", "label": "Ann"}]},
        {"id": "avail_dates_1", "type": "text", "required": False, "default": "",
         "description": "YYYY-MM-DD, comma separated"},
        {"id": "must_say", "type": "text", "required": True},
    ],
}


def avail_form_task(tmp_path, *, answers=None):
    folder = make_platform_task(tmp_path)
    write(folder, "output/ask-me.json", AVAIL_SCHEMA)
    if answers is not None:
        write(folder, "output/ask-me-answers.json", answers)
    at_gate(backend.tasks["plat"], "answers", "awaiting_review")
    return folder


def test_form_text_answers_are_stored_trimmed(tmp_path):
    folder = avail_form_task(tmp_path)
    body = client().post("/tasks/plat/form", json={"answers": {
        "avail_dates_1": "  2026-12-28, 2026-12-29 " + chr(10), "must_say": chr(9) + " hello "}}).json()
    assert body == {"ok": True, "pending": []}
    saved = json.loads((folder / "output" / "ask-me-answers.json").read_text())
    assert saved == {"avail_dates_1": "2026-12-28, 2026-12-29", "must_say": "hello"}


def test_form_required_text_must_be_non_empty_to_count_as_answered(tmp_path):
    folder = avail_form_task(tmp_path)
    c = client()
    for blank in ("", "   ", chr(10) + chr(9)):
        body = c.post("/tasks/plat/form", json={"answers": {"must_say": blank}}).json()
        assert body == {"ok": True, "pending": ["must_say"]}, repr(blank)
    assert c.get("/tasks/plat/form").json()["pending"] == ["must_say"]
    assert c.post("/tasks/plat/approve").json()["pending"] == ["must_say"]
    assert c.post("/tasks/plat/form", json={"answers": {"must_say": "x"}}).json() == {"ok": True, "pending": []}
    assert c.post("/tasks/plat/form", json={"answers": {"must_say": None}}).json()["pending"] == ["must_say"]
    assert not list((folder / "output").glob("*.tmp"))


def test_form_optional_text_and_select_default_are_never_pending(tmp_path):
    folder = avail_form_task(tmp_path, answers={"must_say": "ok"})
    c = client()
    # nothing posted for the optional fields (not even their defaults): not pending
    assert c.get("/tasks/plat/form").json()["pending"] == []
    # an optional text may be saved empty, and the optional select may be saved at its default
    body = c.post("/tasks/plat/form", json={"answers": {"avail_dates_1": "  ", "avail_person_1": "NONE"}}).json()
    assert body == {"ok": True, "pending": []}
    saved = json.loads((folder / "output" / "ask-me-answers.json").read_text())
    assert saved == {"must_say": "ok", "avail_dates_1": "", "avail_person_1": "NONE"}
    assert c.post("/tasks/plat/form", json={"answers": {"avail_person_1": "Ghost"}}).json()["invalid"] == ["avail_person_1"]


@pytest.mark.parametrize("bad", [5, 1.5, True, ["a"], {"a": 1}])
def test_form_text_answer_must_be_a_string(tmp_path, bad):
    folder = avail_form_task(tmp_path)
    body = client().post("/tasks/plat/form", json={"answers": {"avail_dates_1": bad}}).json()
    assert body["ok"] is False and body["invalid"] == ["avail_dates_1"]
    assert not (folder / "output" / "ask-me-answers.json").exists()


def test_form_text_answer_length_cap(tmp_path):
    folder = avail_form_task(tmp_path)
    c = client()
    cap = backend.MAX_TEXT_ANSWER_CHARS
    assert cap == 500
    assert c.post("/tasks/plat/form", json={"answers": {"must_say": "x" * cap}}).json()["ok"] is True
    # the cap applies to the trimmed text: padding does not count
    assert c.post("/tasks/plat/form", json={"answers": {"must_say": " " * 50 + "y" * cap + " " * 50}}).json()["ok"] is True
    body = c.post("/tasks/plat/form", json={"answers": {"must_say": "z" * (cap + 1)}}).json()
    assert body["ok"] is False and body["invalid"] == ["must_say"] and str(cap) in body["reason"]
    saved = json.loads((folder / "output" / "ask-me-answers.json").read_text())
    assert saved["must_say"] == "y" * cap  # the refused answer left the saved one alone


def test_form_post_rejects_unknown_fields_and_bad_options_without_partial_write(tmp_path):
    folder = form_task(tmp_path)
    c = client()
    body = c.post("/tasks/plat/form", json={"answers": {"shift:Ann": "S1", "ghost": "x"}}).json()
    assert body["ok"] is False and body["invalid"] == ["ghost"]
    body = c.post("/tasks/plat/form", json={"answers": {"note": "fine", "shift:Ann": "NOPE"}}).json()
    assert body["ok"] is False and body["invalid"] == ["shift:Ann"]
    body = c.post("/tasks/plat/form", json={"answers": {"note": {"a": 1}}}).json()
    assert body["ok"] is False and body["invalid"] == ["note"]
    assert not (folder / "output" / "ask-me-answers.json").exists()


def test_form_post_only_while_awaiting_review_at_a_form_gate(tmp_path):
    form_task(tmp_path, state="working")
    c = client()
    refused = "answers can only be saved while the task is waiting at its form"
    assert c.post("/tasks/plat/form", json={"answers": {"note": "x"}}).json() == {"ok": False, "reason": refused}
    backend.set_state(backend.tasks["plat"], "awaiting_review", current_step="review_draft")  # a flags gate
    assert c.post("/tasks/plat/form", json={"answers": {"note": "x"}}).json()["reason"] == refused
    backend.set_state(backend.tasks["plat"], "awaiting_review", current_step=None)
    assert c.post("/tasks/plat/form", json={"answers": {"note": "x"}}).json()["reason"] == refused


def test_form_post_bad_body(tmp_path):
    form_task(tmp_path)
    c = client()
    assert "must be JSON" in c.post("/tasks/plat/form", content="nope").json()["reason"]
    assert "'answers' object" in c.post("/tasks/plat/form", json={"answers": []}).json()["reason"]


def test_form_post_requires_an_answers_file_in_the_gate(tmp_path):
    steps = [{"id": "answers", "type": "review", "gate": {"type": "form", "schema": "output/ask-me.json"}}]
    folder = make_platform_task(tmp_path, steps=steps)
    write(folder, "output/ask-me.json", FORM_SCHEMA)
    at_gate(backend.tasks["plat"], "answers")
    assert client().post("/tasks/plat/form", json={"answers": {"note": "x"}}).json() == {"ok": False, "reason": "this form has no answers file"}


def test_form_post_refuses_answers_path_outside_task_or_through_a_link(tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    for answers in ("../answers.json", "answers.json", "/abs/answers.json"):
        steps = [{"id": "answers", "type": "review", "gate": {"type": "form", "schema": "output/ask-me.json", "answers": answers}}]
        folder = make_platform_task(tmp_path, name="p" + str(abs(hash(answers))), steps=steps)
        write(folder, "output/ask-me.json", FORM_SCHEMA)
        task = backend.tasks[folder.name]
        at_gate(task, "answers")
        body = client().post(f"/tasks/{task.id}/form", json={"answers": {"note": "x"}}).json()
        assert body["ok"] is False
    assert not (tmp_path / "answers.json").exists()

    steps = [{"id": "answers", "type": "review",
              "gate": {"type": "form", "schema": "output/ask-me.json", "answers": "output/linked/answers.json"}}]
    folder = make_platform_task(tmp_path, name="linked", steps=steps)
    write(folder, "output/ask-me.json", FORM_SCHEMA)
    make_link(folder / "output" / "linked", outside)
    at_gate(backend.tasks["linked"], "answers")
    body = client().post("/tasks/linked/form", json={"answers": {"note": "x"}}).json()
    assert body["ok"] is False and "symbolic" in body["reason"]
    assert list(outside.iterdir()) == []


def test_form_schema_read_refuses_traversal_in_manifest(tmp_path):
    steps = [{"id": "answers", "type": "review", "gate": {"type": "form", "schema": "../secret.json", "answers": "output/a.json"}}]
    make_platform_task(tmp_path, steps=steps)
    write(tmp_path, "secret.json", {"fields": []})
    body = client().get("/tasks/plat/form").json()
    assert body["ok"] is False and "must be inside" in body["reason"]


def test_approve_refused_at_form_gate_with_pending_required_fields(tmp_path):
    form_task(tmp_path, answers={"shift:Ann": "KEEP"})
    task = backend.tasks["plat"]

    resp = asyncio.run(backend.approve_task("plat"))

    assert resp["ok"] is False and resp["pending"] == ["note"]
    assert task.state == "awaiting_review" and task.approvals == []


def test_approve_refused_when_form_schema_is_missing(tmp_path):
    make_platform_task(tmp_path)
    at_gate(backend.tasks["plat"], "answers")
    resp = asyncio.run(backend.approve_task("plat"))
    assert resp["ok"] is False and resp["pending"] == []


def test_approve_passes_form_gate_once_answered_and_runs_on(tmp_path):
    folder = form_task(tmp_path)
    c = client()
    assert c.post("/tasks/plat/form", json={"answers": {"shift:Ann": "KEEP", "note": "ok"}}).json() == {"ok": True, "pending": []}
    write(folder, "output/roster-diff.json", {"blocking": []})

    async def go():
        resp = await backend.approve_task("plat")
        await wait_for(lambda: backend.tasks["plat"].state == "awaiting_review" and backend.tasks["plat"].current_step == "review_draft")
        return resp

    assert asyncio.run(go())["ok"] is True


def test_legacy_review_incidents_gate_behaves_as_before(tmp_path):
    folder = make_legacy_task(tmp_path, steps=[
        {"id": "review_incidents", "type": "review"},
        {"id": "build", "type": "python", "cmd": "scripts/noop.py"},
    ])
    write(folder, "output/review-incidents.json", {"incidents": [{"number": "INC1"}, {"number": "INC2"}], "options": ["A"]})
    write(folder, "output/review-resolutions.json", {"resolutions": [{"number": "INC1", "subcategory2": "A"}]})
    at_gate(backend.tasks["legacy"], "review_incidents")

    resp = asyncio.run(backend.approve_task("legacy"))

    assert resp == {"ok": False, "reason": "1 incident(s) still need a Subcategory2", "pending": 1}
    assert backend.tasks["legacy"].approvals == []


# --- diff / flags gates ---------------------------------------------------------

def diff_task(tmp_path, diff=None, state="awaiting_send"):
    folder = make_platform_task(tmp_path)
    if diff is not None:
        write(folder, "output/roster-diff.json", diff)
    if state:
        at_gate(backend.tasks["plat"], "confirm_diff", state)
    return folder


def test_diff_and_flags_endpoints(tmp_path):
    folder = diff_task(tmp_path, state=None)
    c = client()
    assert c.get("/tasks/plat/diff").json() == {"ok": True, "diff": None}
    assert c.get("/tasks/plat/flags").json() == {"ok": True, "flags": None}
    write(folder, "output/roster-diff.json", {"changes": [{"person": "A"}], "blocking": []})
    write(folder, "output/flags.json", {"counts": {"error": 1}, "flags": []})
    assert c.get("/tasks/plat/diff").json() == {"ok": True, "diff": {"changes": [{"person": "A"}], "blocking": []}}
    assert c.get("/tasks/plat/flags").json() == {"ok": True, "flags": {"counts": {"error": 1}, "flags": []}}
    write(folder, "output/roster-diff.json", "{x")
    assert c.get("/tasks/plat/diff").json()["ok"] is False


def test_diff_without_a_diff_gate_and_flags_default_file(tmp_path):
    folder = make_legacy_task(tmp_path)
    c = client()
    assert c.get("/tasks/legacy/diff").json() == {"ok": False, "reason": "this task has no diff gate"}
    assert c.get("/tasks/legacy/flags").json() == {"ok": True, "flags": None}
    write(folder, "output/flags.json", {"flags": []})
    assert c.get("/tasks/legacy/flags").json() == {"ok": True, "flags": {"flags": []}}


def test_flags_prefers_the_flags_gate_file(tmp_path):
    steps = [{"id": "r", "type": "review", "gate": {"type": "flags", "file": "output/custom-flags.json"}}]
    folder = make_platform_task(tmp_path, steps=steps)
    write(folder, "output/custom-flags.json", {"flags": ["x"]})
    write(folder, "output/flags.json", {"flags": ["wrong"]})
    assert client().get("/tasks/plat/flags").json()["flags"] == {"flags": ["x"]}


def test_diff_prefers_the_current_steps_gate(tmp_path):
    steps = [
        {"id": "c1", "type": "confirm", "gate": {"type": "diff", "file": "output/one.json"}},
        {"id": "c2", "type": "confirm", "gate": {"type": "diff", "file": "output/two.json"}},
    ]
    folder = make_platform_task(tmp_path, steps=steps)
    write(folder, "output/one.json", {"n": 1})
    write(folder, "output/two.json", {"n": 2})
    backend.tasks["plat"].current_step = "c2"
    assert client().get("/tasks/plat/diff").json()["diff"] == {"n": 2}


def test_send_refused_at_diff_gate_with_blocking_issues(tmp_path):
    blocking = [{"kind": "SNAPSHOT_TAMPERED", "message": "Draft was altered outside the changes list"}]
    diff_task(tmp_path, {"changes": [], "blocking": blocking})
    task = backend.tasks["plat"]

    resp = asyncio.run(backend.send_task("plat"))

    assert resp["ok"] is False and resp["blocking"] == blocking and "1 blocking" in resp["reason"]
    assert task.state == "awaiting_send" and task.approvals == []


def test_send_refused_when_diff_missing_or_malformed(tmp_path):
    folder = diff_task(tmp_path)
    resp = asyncio.run(backend.send_task("plat"))
    assert resp["ok"] is False and resp["blocking"] == []
    write(folder, "output/roster-diff.json", {"changes": []})  # no blocking key at all
    assert "malformed" in asyncio.run(backend.send_task("plat"))["reason"]
    write(folder, "output/roster-diff.json", ["not a dict"])
    assert "malformed" in asyncio.run(backend.send_task("plat"))["reason"]
    write(folder, "output/roster-diff.json", "{bad")
    assert "not valid JSON" in asyncio.run(backend.send_task("plat"))["reason"]
    assert backend.tasks["plat"].state == "awaiting_send"


def test_send_proceeds_when_blocking_is_empty(tmp_path):
    diff_task(tmp_path, {"changes": [], "blocking": []})
    task = backend.tasks["plat"]

    async def go():
        resp = await backend.send_task("plat")
        await wait_for(lambda: task.state == "resting")
        return resp

    assert asyncio.run(go())["ok"] is True
    assert task.completed_steps == {"finalize"}


# --- approver stamp -------------------------------------------------------------

def test_full_run_stamps_every_approve_and_send_into_history(tmp_path, monkeypatch):
    folder = make_platform_task(tmp_path)
    monkeypatch.setattr(backend.getpass, "getuser", lambda: "alice")
    write(folder, "output/ask-me.json", FORM_SCHEMA)
    write(folder, "output/ask-me-answers.json", {"shift:Ann": "KEEP", "note": "ok"})
    write(folder, "output/roster-diff.json", {"blocking": []})
    write(folder, "input/roster.xlsx", b"x")
    write(folder, "input/holiday-roster.xlsx", b"x")
    write(folder, "input/run-params.json", {"params": {"cycle": "2026-12"}})
    task = backend.tasks["plat"]

    async def go():
        assert (await backend.start_task("plat"))["ok"]
        await wait_for(lambda: task.state == "awaiting_review" and task.current_step == "answers")
        assert task.approvals == []
        assert (await backend.approve_task("plat"))["ok"]
        await wait_for(lambda: task.current_step == "review_draft" and task.state == "awaiting_review")
        assert (await backend.approve_task("plat"))["ok"]
        await wait_for(lambda: task.state == "awaiting_send")
        assert (await backend.send_task("plat"))["ok"]
        await wait_for(lambda: task.state == "resting")

    asyncio.run(go())

    (record,) = [json.loads(line) for line in (tmp_path / "history.jsonl").read_text().splitlines() if "run_id" in line]
    assert record["outcome"] == "completed"
    assert [(a["step"], a["kind"], a["user"]) for a in record["approvals"]] == [
        ("answers", "approve", "alice"), ("review_draft", "approve", "alice"), ("confirm_diff", "send", "alice")]
    for a in record["approvals"]:
        assert a["at"].endswith("+00:00")
    assert task.approvals == []  # cleared once written
    # and the history endpoint serves them
    runs = client().get("/tasks/plat/history").json()["runs"]
    assert runs[0]["approvals"][0]["user"] == "alice"


def test_approver_is_the_os_user_never_client_supplied(tmp_path, monkeypatch):
    form_task(tmp_path, answers={"shift:Ann": "KEEP", "note": "x"})
    monkeypatch.setattr(backend.getpass, "getuser", lambda: "os-user")
    task = backend.tasks["plat"]

    async def go():
        await backend.approve_task("plat")

    asyncio.run(go())
    assert task.approvals[0]["user"] == "os-user"
    assert task.approvals[0]["step"] == "answers"
    # the route takes no body/query: a client cannot influence the stamp
    backend.set_state(task, "awaiting_review", current_step="answers")
    resp = client().post("/tasks/plat/approve?user=mallory", json={"user": "mallory"})
    assert resp.json()["ok"] is True
    assert {a["user"] for a in task.approvals} == {"os-user"}


def test_unavailable_os_user_is_recorded_as_unknown(tmp_path, monkeypatch):
    def broken():
        raise OSError("no user")

    monkeypatch.setattr(backend.getpass, "getuser", broken)
    form_task(tmp_path, answers={"shift:Ann": "KEEP", "note": "x"})
    asyncio.run(backend.approve_task("plat"))
    assert backend.tasks["plat"].approvals[0]["user"] == "unknown"


def test_legacy_task_run_also_gets_approvals(tmp_path, monkeypatch):
    monkeypatch.setattr(backend.getpass, "getuser", lambda: "bob")
    make_legacy_task(tmp_path, steps=[
        {"id": "build", "type": "python", "cmd": "scripts/noop.py"},
        {"id": "review_gate", "type": "review"},
        {"id": "send_gate", "type": "confirm"},
        {"id": "ship", "type": "python", "cmd": "scripts/noop.py"},
    ])
    task = backend.tasks["legacy"]

    async def go():
        assert (await backend.start_task("legacy"))["ok"]
        await wait_for(lambda: task.state == "awaiting_review")
        await backend.approve_task("legacy")
        await wait_for(lambda: task.state == "awaiting_send")
        await backend.send_task("legacy")
        await wait_for(lambda: task.state == "resting")

    asyncio.run(go())
    runs = client().get("/tasks/legacy/history").json()["runs"]
    assert [(a["step"], a["kind"], a["user"]) for a in runs[0]["approvals"]] == [
        ("review_gate", "approve", "bob"), ("send_gate", "send", "bob")]


def test_failed_run_record_keeps_the_approvals_made_before_the_failure(tmp_path, monkeypatch):
    monkeypatch.setattr(backend.getpass, "getuser", lambda: "carol")
    folder = make_legacy_task(tmp_path, steps=[
        {"id": "review_gate", "type": "review"},
        {"id": "boom", "type": "python", "cmd": "scripts/boom.py"},
    ])
    write(folder, "scripts/boom.py", "import sys; sys.exit(1)")
    task = backend.tasks["legacy"]

    async def go():
        assert (await backend.start_task("legacy"))["ok"]
        await wait_for(lambda: task.state == "awaiting_review")
        await backend.approve_task("legacy")
        await wait_for(lambda: task.state == "error")

    asyncio.run(go())
    runs = client().get("/tasks/legacy/history").json()["runs"]
    assert runs[0]["outcome"] == "failed" and runs[0]["approvals"][0]["user"] == "carol"


def test_reject_and_reset_discard_pending_approvals(tmp_path):
    make_legacy_task(tmp_path)
    task = backend.tasks["legacy"]
    task.approvals = [{"step": "x", "kind": "approve", "user": "u", "at": "t"}]
    at_gate(task, "x")
    asyncio.run(backend.reject_task("legacy"))
    assert task.approvals == []
    task.approvals = [{"step": "x", "kind": "approve", "user": "u", "at": "t"}]
    asyncio.run(backend.reset_task("legacy"))
    assert task.approvals == []


def test_history_endpoint_adds_empty_approvals_to_old_records(tmp_path):
    make_legacy_task(tmp_path)
    old = {"run_id": "r1", "task_id": "legacy", "outcome": "completed", "started_at": "2026-01-01T00:00:00+00:00",
           "ended_at": "2026-01-01T00:00:01+00:00"}
    new = {**old, "run_id": "r2", "approvals": [{"step": "s", "kind": "send", "user": "u", "at": "t"}]}
    (tmp_path / "history.jsonl").write_text(json.dumps(old) + "\n" + json.dumps(new) + "\n")

    runs = client().get("/tasks/legacy/history").json()["runs"]

    by_id = {r["run_id"]: r for r in runs}
    assert by_id["r1"]["approvals"] == [] and by_id["r2"]["approvals"][0]["user"] == "u"
    assert "approvals" not in json.loads((tmp_path / "history.jsonl").read_text().splitlines()[0])  # file untouched


# --- reviewMessage notifications --------------------------------------------------

def test_review_gate_uses_manifest_review_message(tmp_path):
    form_task(tmp_path, state=None)
    task = backend.tasks["plat"]
    backend._review_gate(task, PLATFORM_STEPS[1])
    (note,) = task.notifications
    assert note["kind"] == "task.review_ready"
    assert note["body"] == "Questions are ready for you"
    assert note["title"] == "plat: your review is needed"


def test_review_gate_without_review_message_keeps_legacy_text(tmp_path):
    make_legacy_task(tmp_path)
    task = backend.tasks["legacy"]
    backend._review_gate(task, {"id": "g", "type": "review"})
    assert task.notifications[0]["title"] == "legacy: draft ready for your review"
    assert "Outlook" in task.notifications[0]["body"]
    backend._review_gate(task, {"id": "g", "type": "review", "reviewMessage": "   "})
    assert "Outlook" in task.notifications[1]["body"]  # blank message falls back too


def test_confirm_gate_notifies_only_when_review_message_present(tmp_path):
    make_legacy_task(tmp_path)
    task = backend.tasks["legacy"]
    backend._confirm_gate(task, {"id": "send_gate", "type": "confirm"})
    assert task.state == "awaiting_send" and task.notifications == []
    backend._confirm_gate(task, {"id": "c", "type": "confirm", "reviewMessage": "Review every changed cell, then confirm"})
    assert task.notifications[0]["body"] == "Review every changed cell, then confirm"
    assert task.notifications[0]["title"] == "legacy: your confirmation is needed"


def test_pipeline_pause_at_confirm_with_message_notifies(tmp_path):
    make_platform_task(tmp_path, steps=[
        {"id": "c", "type": "confirm", "reviewMessage": "Please confirm"},
    ], inputs=[], prepare=None)
    task = backend.tasks["plat"]
    asyncio.run(backend.run_steps(task, task.steps))
    assert task.state == "awaiting_send" and task.notifications[0]["body"] == "Please confirm"


# --- the workbook an Open button points at (platform tasks: task-relative paths) ------

def _report(folder, workbook_path, *, create=None, raw=None):
    write(folder, "output/report-data.json", raw if raw is not None else {"workbook_path": workbook_path, "stage": "draft"})
    if create:
        write(folder, create, b"PK-workbook")


def test_resolve_output_path_task_relative_path_is_resolved_against_the_task_folder(tmp_path, monkeypatch):
    folder = make_platform_task(tmp_path)
    _report(folder, "output/Roster DRAFT 2026-12.xlsx", create="output/Roster DRAFT 2026-12.xlsx")
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    monkeypatch.chdir(elsewhere)  # the backend's cwd is never the task folder

    resolved = backend.resolve_output_path(backend.tasks["plat"])

    assert resolved == str((folder / "output" / "Roster DRAFT 2026-12.xlsx").resolve())
    assert os.path.isabs(resolved)


def test_resolve_output_path_refuses_relative_paths_that_leave_the_task_folder(tmp_path):
    folder = make_platform_task(tmp_path)
    write(tmp_path, "outside.xlsx", b"PK")
    _report(folder, "../outside.xlsx")
    assert backend.resolve_output_path(backend.tasks["plat"]) is None
    _report(folder, "output/missing.xlsx")
    assert backend.resolve_output_path(backend.tasks["plat"]) is None


def test_resolve_output_path_keeps_legacy_absolute_paths_and_survives_bad_files(tmp_path):
    folder = make_platform_task(tmp_path)
    task = backend.tasks["plat"]
    absolute = write(tmp_path, "abs.xlsx", b"PK")
    _report(folder, str(absolute))
    assert backend.resolve_output_path(task) == str(absolute)  # exactly as written
    _report(folder, str(tmp_path / "gone.xlsx"))
    assert backend.resolve_output_path(task) is None
    for bad in (7, None, "", ["x"]):
        _report(folder, bad)
        assert backend.resolve_output_path(task) is None
    _report(folder, None, raw="[1, 2]")
    assert backend.resolve_output_path(task) is None
    _report(folder, None, raw=bytes([0xFF, 0xFE]) + b"{ not utf-8")  # undecodable bytes must not raise
    assert backend.resolve_output_path(task) is None
    # a UTF-8 BOM (Windows editors) and non-ASCII names are fine
    name = "r\u00e9sum\u00e9.xlsx"
    write(folder, f"output/{name}", b"PK")
    write(folder, "output/report-data.json",
          bytes([0xEF, 0xBB, 0xBF]) + json.dumps({"workbook_path": f"output/{name}"}).encode("utf-8"))
    assert backend.resolve_output_path(task) == str((folder / "output" / name).resolve())


def test_completed_message_replaces_the_sent_it_text(tmp_path):
    make_platform_task(tmp_path, extra={"completedMessage": "  The final roster is ready.  "})
    task = backend.tasks["plat"]
    assert task.completed_message == "The final roster is ready."
    backend._finish_task(task, task.steps)
    assert task.notifications[-1]["kind"] == "task.completed"
    assert task.notifications[-1]["body"] == "The final roster is ready."


def test_completed_message_absent_or_malformed_keeps_the_default_text(tmp_path):
    make_platform_task(tmp_path, extra={"completedMessage": 5})
    task = backend.tasks["plat"]
    assert task.completed_message is None
    backend._finish_task(task, task.steps)
    assert task.notifications[-1]["body"] == "Sent successfully - nothing else needed from you."
    task.apply_manifest({"id": "plat", "steps": [], "completedMessage": "   "})
    assert task.completed_message is None


# --- several output files: report-data `extra_paths` -> notification `outputPaths` -------------

def _extras_task(tmp_path, extras, *, workbook="output/main.xlsx", files=("output/main.xlsx", "output/other.xlsx")):
    folder = make_platform_task(tmp_path)
    for rel in files:
        write(folder, rel, b"PK-workbook")
    data = {"stage": "draft", "extra_paths": extras}
    if workbook is not None:
        data["workbook_path"] = workbook
    write(folder, "output/report-data.json", data)
    return folder, backend.tasks["plat"]


def test_output_paths_list_the_primary_then_the_labelled_extras(tmp_path):
    folder, task = _extras_task(tmp_path, [{"label": " Analytics plan ", "path": "output/other.xlsx"}])
    paths = backend.resolve_output_paths(task)
    assert paths == [
        {"label": None, "path": str((folder / "output" / "main.xlsx").resolve())},
        {"label": "Analytics plan", "path": str((folder / "output" / "other.xlsx").resolve())},
    ]
    assert all(os.path.isabs(p["path"]) for p in paths)
    primary, listed = backend.resolve_outputs(task)
    assert primary == paths[0]["path"] and listed == paths


def test_an_extra_naming_the_primary_file_labels_it_instead_of_duplicating_it(tmp_path):
    folder, task = _extras_task(tmp_path, [
        {"label": "Main plan", "path": "output/main.xlsx"},
        {"label": "Analytics plan", "path": "output/other.xlsx"},
        {"label": "Again", "path": "output/./other.xlsx"},
    ])
    paths = backend.resolve_output_paths(task)
    assert [p["label"] for p in paths] == ["Main plan", "Analytics plan"]
    assert len(paths) == 2 and paths[0]["path"] == backend.resolve_output_path(task)


def test_extra_paths_that_are_unsafe_missing_or_malformed_are_skipped(tmp_path):
    outside = write(tmp_path, "outside.xlsx", b"PK")
    folder, task = _extras_task(tmp_path, [
        {"label": "Escape", "path": "../outside.xlsx"},
        {"label": "Deep escape", "path": "output/../../outside.xlsx"},
        {"label": "Absolute outside", "path": str(outside)},
        {"label": "Missing", "path": "output/missing.xlsx"},
        {"label": "Not a path", "path": 7},
        {"label": "Empty", "path": ""},
        "output/other.xlsx",
        {"path": "output/other.xlsx"},  # no label is fine
        {"label": 5, "path": "output/other.xlsx"},
    ])
    paths = backend.resolve_output_paths(task)
    assert [p["path"] for p in paths] == [str((folder / "output" / "main.xlsx").resolve()),
                                          str((folder / "output" / "other.xlsx").resolve())]
    assert all(p["label"] is None for p in paths)
    assert "outside" not in json.dumps(paths)


def test_absolute_extra_inside_the_task_folder_is_accepted(tmp_path):
    folder, task = _extras_task(tmp_path, [])
    inside = str((folder / "output" / "other.xlsx").resolve())
    write(folder, "output/report-data.json", {"workbook_path": "output/main.xlsx",
                                              "extra_paths": [{"label": "Abs", "path": inside}]})
    assert backend.resolve_output_paths(task)[1] == {"label": "Abs", "path": inside}


def test_extra_paths_wrong_shape_or_too_many_never_raise(tmp_path):
    folder, task = _extras_task(tmp_path, "nope")
    assert [p["label"] for p in backend.resolve_output_paths(task)] == [None]
    write(folder, "output/report-data.json", {"extra_paths": {"a": 1}})
    assert backend.resolve_output_paths(task) == []
    many = [{"label": f"L{i}", "path": "output/other.xlsx"} for i in range(50)]
    write(folder, "output/report-data.json", {"workbook_path": "output/main.xlsx", "extra_paths": many})
    assert len(backend.resolve_output_paths(task)) == 2  # duplicates collapse
    write(folder, "output/report-data.json", {"extra_paths": [{"label": "Only extra", "path": "output/other.xlsx"}]})
    paths = backend.resolve_output_paths(task)
    assert [p["label"] for p in paths] == ["Only extra"]
    assert backend.resolve_outputs(task)[0] is None  # no primary: outputPath stays empty


def test_review_notification_carries_output_paths_and_keeps_output_path(tmp_path):
    folder, task = _extras_task(tmp_path, [{"label": "Analytics plan", "path": "output/other.xlsx"}])
    backend._review_gate(task, next(s for s in task.steps if s["id"] == "review_draft"))
    note = task.notifications[-1]
    assert note["outputPath"] == str((folder / "output" / "main.xlsx").resolve())
    assert [(e["label"], os.path.basename(e["path"])) for e in note["outputPaths"]] == [
        (None, "main.xlsx"), ("Analytics plan", "other.xlsx")]
    # a notification without any file still has the key, as an empty list
    backend.push_notification(task, "task.failed", "t", "b")
    assert task.notifications[-1]["outputPath"] is None and task.notifications[-1]["outputPaths"] == []
    backend.push_notification(task, "task.completed", "t", "b", str(folder / "output" / "main.xlsx"))
    assert task.notifications[-1]["outputPaths"] == [{"label": None, "path": str(folder / "output" / "main.xlsx")}]


def test_open_endpoint_opens_only_whitelisted_paths_of_the_notification(tmp_path, monkeypatch):
    folder, task = _extras_task(tmp_path, [{"label": "Analytics plan", "path": "output/other.xlsx"}])
    outside = write(tmp_path, "outside.xlsx", b"PK")
    write(folder, "output/not-listed.xlsx", b"PK")
    backend._review_gate(task, next(s for s in task.steps if s["id"] == "review_draft"))
    note = task.notifications[-1]
    opened = []
    monkeypatch.setattr(backend, "_open_with_default_app", opened.append)
    c = client()
    url = f"/tasks/plat/notifications/{note['id']}/open"
    main_path, other_path = (e["path"] for e in note["outputPaths"])

    assert c.post(url).json() == {"ok": True}  # no path: outputPath, as before
    assert opened == [main_path]
    assert c.post(url, params={"path": other_path}).json() == {"ok": True}
    assert opened[-1] == other_path
    # path comparison is normalised (separators on Windows), and the listed string is what opens
    assert c.post(url, params={"path": other_path.replace(chr(92), "/")}).json() == {"ok": True}
    assert opened[-1] == other_path

    count = len(opened)
    refused = {"ok": False, "reason": "that file is not part of this notification"}
    for bad in (str(folder / "output" / "not-listed.xlsx"),  # inside the task but not listed
                str(outside),  # outside the task
                "output/other.xlsx",  # a relative spelling is not the listed path
                str(folder / "output" / ".." / ".." / "outside.xlsx"),  # traversal
                str(folder / "task.json"), "", "C:/Windows/System32/calc.exe", "../outside.xlsx"):
        assert c.post(url, params={"path": bad}).json() == refused, bad
    assert len(opened) == count  # nothing was launched


def test_open_endpoint_rechecks_containment_and_existence_of_a_listed_path(tmp_path, monkeypatch):
    folder, task = _extras_task(tmp_path, [{"label": "Analytics plan", "path": "output/other.xlsx"}])
    outside = write(tmp_path, "outside.xlsx", b"PK")
    opened = []
    monkeypatch.setattr(backend, "_open_with_default_app", opened.append)
    c = client()
    # a forged notification listing a file outside the task folder is still refused at open time
    backend.push_notification(task, "task.completed", "t", "b", None,
                              [{"label": "Outside", "path": str(outside)}])
    note = task.notifications[-1]
    url = f"/tasks/plat/notifications/{note['id']}/open"
    assert c.post(url, params={"path": str(outside)}).json() == {"ok": False, "reason": "file not available"}
    assert c.post(url).json() == {"ok": False, "reason": "no output file for this notification"}
    # a listed file that has since disappeared
    gone = folder / "output" / "other.xlsx"
    backend.push_notification(task, "task.completed", "t", "b", None, [{"label": "Gone", "path": str(gone.resolve())}])
    note = task.notifications[-1]
    gone.unlink()
    assert c.post(f"/tasks/plat/notifications/{note['id']}/open",
                  params={"path": str(gone.resolve())}).json() == {"ok": False, "reason": "file not available"}
    assert opened == []
    # unknown task / notification
    assert c.post("/tasks/ghost/notifications/x/open", params={"path": "x"}).json() == {"ok": False, "reason": "unknown task"}
    assert c.post("/tasks/plat/notifications/nope/open", params={"path": "x"}).json()["ok"] is False
