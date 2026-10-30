"""Task packs: checksummed, validated, installable without reinstalling the app."""
import hashlib
import io
import json
import os
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

import main as engine
import pack_mailer
import taskpacks
from conftest import make_client

REPO_SHARED = Path(engine.__file__).resolve().parent.parent / "tasks" / "shared"

TASK = {
    "id": "demo-pack",
    "displayName": "Demo pack",
    "inputs": [{"id": "f", "label": "File", "type": "file", "accept": [".csv"], "dest": "input/f.csv", "required": True}],
    "steps": [
        {"id": "make", "type": "python", "cmd": "scripts/make.py"},
        {"id": "review", "type": "review"},
    ],
}


def files(**over):
    base = {
        "task.json": json.dumps(TASK).encode(),
        "scripts/make.py": b"print('hi')\n",
        "config/seed.json": b'{"a": 1}',
    }
    base.update(over)
    return {k: v for k, v in base.items() if v is not None}


def pack(**over) -> bytes:
    return taskpacks.build_pack("demo-pack", "Demo pack", "1.0", files(**over))


def raw_zip(entries: dict, manifest: dict | None = None, **zip_kwargs) -> bytes:
    """A zip assembled by hand so a test can break one rule at a time."""
    manifest = manifest if manifest is not None else {
        "format": taskpacks.FORMAT, "version": 1, "id": "demo-pack", "name": "Demo pack", "packVersion": "1",
        "files": {k: hashlib.sha256(v).hexdigest() for k, v in entries.items()},
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(taskpacks.MANIFEST, json.dumps(manifest))
        for name, content in entries.items():
            z.writestr(name, content)
    return buf.getvalue()


def refused(data: bytes, match: str):
    with pytest.raises(taskpacks.PackError, match=match):
        taskpacks.inspect_pack(data)


def test_a_built_pack_inspects_with_a_stable_fingerprint():
    info = taskpacks.inspect_pack(pack())
    assert info["id"] == "demo-pack"
    assert [f["path"] for f in info["files"]] == ["config/seed.json", "scripts/make.py", "task.json"]
    assert [f["runs"] for f in info["files"]] == [False, True, False]
    assert [s["id"] for s in info["steps"]] == ["make", "review"]
    assert len(info["fingerprint"]) == 64
    assert taskpacks.inspect_pack(pack())["fingerprint"] == info["fingerprint"]
    assert taskpacks.inspect_pack(pack(**{"scripts/make.py": b"print('changed')\n"}))["fingerprint"] != info["fingerprint"]
    assert "_entries" not in taskpacks.public_info(info)


def test_a_changed_file_breaks_its_checksum():
    entries = files()
    good = raw_zip(entries)
    manifest = json.loads(zipfile.ZipFile(io.BytesIO(good)).read("pack.json"))
    tampered = raw_zip({**entries, "scripts/make.py": b"print('evil')\n"}, manifest=manifest)
    refused(tampered, "does not match its checksum")


def test_files_must_match_the_list_exactly():
    entries = files()
    manifest = {
        "format": taskpacks.FORMAT, "version": 1, "id": "demo-pack", "name": "Demo", "packVersion": "1",
        "files": {k: hashlib.sha256(v).hexdigest() for k, v in entries.items()},
    }
    refused(raw_zip({**entries, "extra.py": b"x"}, manifest=manifest), "unlisted")
    refused(raw_zip({k: v for k, v in entries.items() if k != "config/seed.json"}, manifest=manifest), "missing")


@pytest.mark.parametrize("name", ["../x.py", "/abs.py", "C:/x.py", "a/../b.py"])
def test_unsafe_names_are_refused(name):
    entries = files(**{name: b"x"})
    refused(raw_zip(entries), "Refused")


def test_a_link_inside_the_pack_is_refused():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        info = zipfile.ZipInfo("scripts/link.py")
        info.external_attr = (0o120777 << 16)
        z.writestr(info, "target")
    # Not a pack at all (no pack.json), but the link check comes first.
    refused(buf.getvalue(), "is a link")


def test_not_a_zip_and_not_a_pack():
    refused(b"hello", "not a zip")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("a.txt", "x")
    refused(buf.getvalue(), "no pack.json")
    refused(raw_zip(files(), manifest={"format": "other", "version": 1}), "cannot read")
    refused(raw_zip(files(), manifest={"format": taskpacks.FORMAT, "version": 1, "id": "Bad Id", "name": "x", "files": {}}), "id must be")


def test_only_allowed_kinds_of_file():
    refused(raw_zip(files(**{"bin/tool.exe": b"MZ"})), "may not contain")
    refused(raw_zip(files(**{"run.bat": b"echo"})), "may not contain")


def test_size_limits(monkeypatch):
    monkeypatch.setattr(taskpacks, "MAX_FILE_BYTES", 10)
    refused(pack(**{"scripts/make.py": b"x" * 50}), "larger than 5 MB")
    monkeypatch.setattr(taskpacks, "MAX_FILE_BYTES", 5 * 1024 * 1024)
    monkeypatch.setattr(taskpacks, "MAX_FILES", 2)
    refused(pack(), "limit is 2")
    monkeypatch.setattr(taskpacks, "MAX_FILES", 200)
    monkeypatch.setattr(taskpacks, "MAX_ZIP_BYTES", 10)
    refused(pack(), "larger than 30 MB")


def task_with(**changes) -> bytes:
    return pack(**{"task.json": json.dumps({**TASK, **changes}).encode()})


def test_the_task_must_be_sound():
    refused(task_with(id="other-id"), "different id")
    refused(task_with(steps=[]), "no steps")
    refused(task_with(steps=[{"id": "x", "type": "shell", "cmd": "scripts/make.py"}]), "does not allow")
    refused(task_with(steps=[{"id": "x", "type": "python", "cmd": "../outside.py"}]), "outside the pack")
    refused(task_with(steps=[{"id": "x", "type": "python", "cmd": "C:\\x.py"}]), "outside the pack")
    refused(task_with(steps=[{"id": "x", "type": "python", "cmd": "scripts/missing.py"}]), "not in the pack")
    refused(task_with(steps=[{"id": "x", "type": "python", "cmd": "scripts/make.py", "args": [1]}]), "not text")
    refused(task_with(inputs=[{"id": "f", "dest": "shared/roster/Names.xlsx"}]), "under input/ or config/")
    refused(task_with(inputs=[{"id": "f", "dest": "../x"}]), "outside the pack")
    refused(task_with(prepare={"cmd": "scripts/nope.py"}), "prepare step")


def test_install_needs_the_confirmed_fingerprint_and_never_replaces_a_builtin(tmp_path):
    data = pack()
    fp = taskpacks.inspect_pack(data)["fingerprint"]
    with pytest.raises(taskpacks.PackError, match="fingerprint"):
        taskpacks.install_pack(data, tmp_path, set(), "0" * 64)
    assert not (tmp_path / "demo-pack").exists()
    with pytest.raises(taskpacks.PackError, match="built-in"):
        taskpacks.install_pack(data, tmp_path, {"demo-pack"}, fp)
    installed = taskpacks.install_pack(data, tmp_path, set(), fp)
    assert installed["id"] == "demo-pack"
    assert (tmp_path / "demo-pack" / "scripts" / "make.py").read_bytes() == b"print('hi')\n"
    assert taskpacks.list_packs(tmp_path) == [
        {"id": "demo-pack", "name": "Demo pack", "packVersion": "1.0", "fingerprint": fp}
    ]
    assert not [p for p in tmp_path.iterdir() if p.name.startswith(".")]


def test_an_upgrade_keeps_the_persons_data(tmp_path):
    first = pack()
    taskpacks.install_pack(first, tmp_path, set(), taskpacks.inspect_pack(first)["fingerprint"])
    folder = tmp_path / "demo-pack"
    (folder / "input").mkdir()
    (folder / "input" / "f.csv").write_text("mine")
    (folder / "output").mkdir()
    (folder / "output" / "result.json").write_text("{}")
    (folder / "config" / "seed.json").write_text('{"a": 99}')  # the person edited the seed

    second = pack(**{"scripts/make.py": b"print('v2')\n", "config/seed.json": b'{"a": 2}', "config/new.json": b"{}"})
    taskpacks.install_pack(second, tmp_path, set(), taskpacks.inspect_pack(second)["fingerprint"])
    assert (folder / "scripts" / "make.py").read_bytes() == b"print('v2')\n"
    assert (folder / "input" / "f.csv").read_text() == "mine"
    assert (folder / "output" / "result.json").exists()
    assert (folder / "config" / "seed.json").read_text() == '{"a": 99}'
    assert (folder / "config" / "new.json").exists()
    assert not (tmp_path / ".demo-pack.old").exists()


def test_a_failed_upgrade_leaves_the_old_pack(tmp_path, monkeypatch):
    first = pack()
    taskpacks.install_pack(first, tmp_path, set(), taskpacks.inspect_pack(first)["fingerprint"])
    second = pack(**{"scripts/make.py": b"print('v2')\n"})
    real_rename = Path.rename

    def flaky(self, target):
        if self.name == ".demo-pack.installing":
            raise OSError("disk full")
        return real_rename(self, target)

    monkeypatch.setattr(Path, "rename", flaky)
    with pytest.raises(OSError):
        taskpacks.install_pack(second, tmp_path, set(), taskpacks.inspect_pack(second)["fingerprint"])
    monkeypatch.undo()
    assert (tmp_path / "demo-pack" / "scripts" / "make.py").read_bytes() == b"print('hi')\n"
    assert not (tmp_path / ".demo-pack.installing").exists()


def test_remove_pack(tmp_path):
    data = pack()
    taskpacks.install_pack(data, tmp_path, set(), taskpacks.inspect_pack(data)["fingerprint"])
    assert taskpacks.remove_pack(tmp_path, "../x") is False
    assert taskpacks.remove_pack(tmp_path, "nothing-here") is False
    assert taskpacks.remove_pack(tmp_path, "demo-pack") is True
    assert taskpacks.list_packs(tmp_path) == []
    assert taskpacks.list_packs(tmp_path / "missing") == []


# --- over HTTP, inside the engine ---------------------------------------------------

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(engine, "PACKS_ROOT", tmp_path / "task-packs")
    return make_client()


def test_http_inspect_install_list_remove(client):
    data = pack()
    fp = taskpacks.inspect_pack(data)["fingerprint"]
    seen = client.post("/task-packs/inspect", content=data).json()
    assert seen["ok"] and seen["pack"]["fingerprint"] == fp and seen["installed"] is False
    assert client.get("/task-packs").json()["packs"] == []

    bad = client.post("/task-packs/install?fingerprint=nope", content=data)
    assert bad.status_code == 400 and "fingerprint" in bad.json()["reason"]
    assert "demo-pack" not in engine.tasks

    done = client.post(f"/task-packs/install?fingerprint={fp}", content=data).json()
    assert done["ok"] and done["pack"]["id"] == "demo-pack"
    assert "demo-pack" in engine.tasks
    assert [t["id"] for t in client.get("/tasks").json()] == ["demo-pack"]
    assert client.get("/task-packs").json()["packs"][0]["id"] == "demo-pack"
    assert client.post("/task-packs/inspect", content=data).json()["installed"] is True

    assert client.delete("/task-packs/demo-pack").json() == {"ok": True}
    assert "demo-pack" not in engine.tasks
    assert client.delete("/task-packs/demo-pack").status_code == 404


def test_http_refuses_a_bad_pack_and_a_running_task(client):
    assert client.post("/task-packs/inspect", content=b"junk").status_code == 400
    data = pack()
    fp = taskpacks.inspect_pack(data)["fingerprint"]
    client.post(f"/task-packs/install?fingerprint={fp}", content=data)
    engine.tasks["demo-pack"].state = "working"
    again = client.post(f"/task-packs/install?fingerprint={fp}", content=data)
    assert again.status_code == 400 and "Finish or reset" in again.json()["reason"]
    assert client.delete("/task-packs/demo-pack").status_code == 409
    engine.tasks["demo-pack"].state = "resting"
    assert client.delete("/task-packs/demo-pack").status_code == 200


def test_a_pack_cannot_take_a_builtin_tasks_id(client, tmp_path):
    engine.tasks["demo-pack"] = engine.Task({"id": "demo-pack", "steps": []}, tmp_path)
    data = pack()
    fp = taskpacks.inspect_pack(data)["fingerprint"]
    reply = client.post(f"/task-packs/install?fingerprint={fp}", content=data)
    assert reply.status_code == 400 and "built-in" in reply.json()["reason"]


def test_installed_packs_come_back_when_the_engine_restarts(client, tmp_path):
    data = pack()
    fp = taskpacks.inspect_pack(data)["fingerprint"]
    client.post(f"/task-packs/install?fingerprint={fp}", content=data)
    engine.discover_tasks()
    assert "demo-pack" in engine.tasks
    # a broken pack folder is reported, not fatal
    broken = engine.PACKS_ROOT / "broken-pack"
    broken.mkdir()
    (broken / "task.json").write_text("{nope")
    engine.discover_tasks()
    assert "demo-pack" in engine.tasks
    assert any(e["folder"] == "task-packs/broken-pack" for e in engine.task_load_errors)


def test_steps_find_the_shared_libraries(client):
    assert engine._step_env()["AI_OS_TASKS_SHARED"] == str(engine.TASKS_ROOT / "shared")


# --- the mailer wizard ------------------------------------------------------------------

ANSWERS = {
    "name": "Weekly Vendor Mail",
    "to": "team@example.com",
    "cc": "",
    "subject": "Vendors: {{rows}} items on {{date}}",
    "body": "Hello,\n\n{{#if rows > 1}}There are {{rows}} rows.{{else}}One row.{{/if}}\n\nThanks",
    "tableType": "csv",
    "columns": [],
}


def test_the_wizard_builds_a_valid_pack():
    pack_id, data = pack_mailer.build_mailer_pack(ANSWERS, set())
    assert pack_id == "mailer-weekly-vendor-mail"
    info = taskpacks.inspect_pack(data)
    assert info["name"] == "Weekly Vendor Mail"
    assert [s["id"] for s in info["steps"]] == ["build_email_data", "create_draft", "review_gate", "send_gate", "send_draft"]
    assert {f["path"] for f in info["files"]} == {
        "README.md", "config/mail.json", "scripts/build_email_data.py", "scripts/create_draft.ps1",
        "scripts/send_draft.ps1", "task.json",
    }
    task = json.loads(zipfile.ZipFile(io.BytesIO(data)).read("task.json"))
    assert task["inputs"][0]["dest"] == "input/table.csv" and task["inputs"][0]["accept"] == [".csv"]


@pytest.mark.parametrize(
    "patch, match",
    [
        ({"name": ""}, "required"),
        ({"name": "ab"}, "3 characters"),
        ({"name": "!!!"}, "letters or digits"),
        ({"tableType": "pdf"}, "xlsx"),
        ({"subject": "", "body": ""}, "subject and a message"),
        ({"columns": ["x"] * 31}, "30 columns"),
        ({"to": "x" * 600}, "longer than 500"),
        ({"body": 5}, "must be text"),
    ],
)
def test_the_wizard_checks_its_answers(patch, match):
    with pytest.raises(pack_mailer.WizardError, match=match):
        pack_mailer.build_mailer_pack({**ANSWERS, **patch}, set())


def test_the_wizard_refuses_a_taken_name():
    with pytest.raises(pack_mailer.WizardError, match="already exists"):
        pack_mailer.build_mailer_pack(ANSWERS, {"mailer-weekly-vendor-mail"})
    # a template name alone is enough wording
    pack_mailer.build_mailer_pack({"name": "Only template", "templateName": "Chaser"}, set())


def test_http_wizard_installs_a_mailer(client):
    made = client.post("/task-packs/mailer", json={"answers": ANSWERS}).json()
    assert made["ok"] and made["pack"]["id"] == "mailer-weekly-vendor-mail"
    task = next(t for t in client.get("/tasks").json() if t["id"] == "mailer-weekly-vendor-mail")
    assert task["displayName"] == "Weekly Vendor Mail"
    assert [s["type"] for s in task["steps"]] == ["python", "powershell", "review", "confirm", "powershell"]
    again = client.post("/task-packs/mailer", json={"answers": ANSWERS})
    assert again.status_code == 400 and "already exists" in again.json()["reason"]
    assert client.post("/task-packs/mailer", json={"answers": {"name": ""}}).status_code == 400


def run_build_script(folder: Path, env_extra: dict) -> subprocess.CompletedProcess:
    env = {**os.environ, "AI_OS_TASKS_SHARED": str(REPO_SHARED), "PYTHONUTF8": "1", **env_extra}
    env.pop("AI_OS_PMO_DATA_DIR", None)
    return subprocess.run(
        [sys.executable, "scripts/build_email_data.py"], cwd=folder, env=env, capture_output=True, text=True, timeout=60,
    )


def make_mailer(tmp_path, answers, table_name, table_bytes):
    _, data = pack_mailer.build_mailer_pack(answers, set())
    folder = tmp_path / "packs" / "mailer"
    taskpacks.install_pack(data, folder.parent, set(), taskpacks.inspect_pack(data)["fingerprint"])
    installed = folder.parent / "mailer-weekly-vendor-mail"
    (installed / "input").mkdir(exist_ok=True)
    (installed / "input" / table_name).write_bytes(table_bytes)
    return installed


def test_the_mailer_script_fills_the_wording_and_table(tmp_path):
    folder = make_mailer(tmp_path, ANSWERS, "table.csv", "Vendor,Amount\nAcme,10\nGlobex,<b>20</b>\n".encode())
    result = run_build_script(folder, {})
    assert result.returncode == 0, result.stderr
    data = json.loads((folder / "output" / "email-data.json").read_text(encoding="utf-8"))
    assert data["to"] == "team@example.com"
    assert data["subject"].startswith("Vendors: 2 items on ")
    assert "There are 2 rows." in data["body_html"]
    assert "<th" in data["table_html"] and "Acme" in data["table_html"]
    assert "&lt;b&gt;20&lt;/b&gt;" in data["table_html"] and "<b>20</b>" not in data["table_html"]
    assert data["attachments"] == []


def test_the_mailer_script_can_pick_columns_and_use_a_named_template(tmp_path):
    answers = {**ANSWERS, "columns": ["Vendor"], "templateName": "Vendor mail", "attachTable": True}
    folder = make_mailer(tmp_path, answers, "table.csv", b"Vendor,Amount\nAcme,10\n")
    library = tmp_path / "tpl"
    library.mkdir()
    (library / "library.json").write_text(json.dumps({"templates": [
        {"name": "Vendor mail", "kind": "email", "subject": "From template: {{rows}}", "to": "t@example.com",
         "cc": "", "body": "Template says {{rows}}", "usedBy": []},
    ]}), encoding="utf-8")
    result = run_build_script(folder, {"AI_OS_TEMPLATES_DIR": str(library)})
    assert result.returncode == 0, result.stderr
    data = json.loads((folder / "output" / "email-data.json").read_text(encoding="utf-8"))
    assert data["subject"] == "From template: 1" and data["to"] == "t@example.com"
    assert "Template says 1" in data["body_html"]
    assert "Amount" not in data["table_html"] and "Vendor" in data["table_html"]
    assert data["attachments"] == [str(folder / "input" / "table.csv")]
    assert "Using template: Vendor mail" in result.stdout


def test_the_mailer_script_explains_a_missing_or_empty_table(tmp_path):
    folder = make_mailer(tmp_path, ANSWERS, "other.txt", b"x")
    missing = run_build_script(folder, {})
    assert missing.returncode != 0 and "No table was uploaded" in missing.stderr
    (folder / "input" / "table.csv").write_bytes(b"")
    empty = run_build_script(folder, {})
    assert empty.returncode != 0 and "empty" in empty.stderr
    (folder / "input" / "table.csv").write_bytes(b"Vendor\nAcme\n")
    (folder / "config" / "mail.json").write_text(json.dumps({**json.loads((folder / "config" / "mail.json").read_text()), "columns": ["Nope"]}))
    wrong = run_build_script(folder, {})
    assert wrong.returncode != 0 and "None of the chosen columns" in wrong.stderr
