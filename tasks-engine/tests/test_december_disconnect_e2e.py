"""December Disconnect end to end through the REAL engine code.

Drives the whole lifecycle of the `december-disconnect` task (tasks/TASK-PLATFORM-CONTRACT.md)
through FastAPI's TestClient: manifest -> uploads (two required, two optional) -> prepare ->
options -> params -> start -> form gate (text + select answers, an availability exception, approve
refused while required answers are pending) -> build_draft -> flags gate -> the PMO edits BOTH
draft workbooks -> approve -> diff gate (Analytics rows are `Analytics <slot>`) -> send ->
finalize -> resting, then checks both final files, the audit log, the cross-task update of the
shift-roster rotation config, the notifications (one Open button per workbook) and the history.
The task's scripts really run as subprocesses with this interpreter, exactly as in production
(`[sys.executable, "-u", cmd]`, cwd = the task folder); each build solves two MILPs.

Hermetic by construction:
* TASKS_ROOT / HISTORY_FILE point at a temp dir; no engine is ever contacted or started;
* the task folder is a COPY of task.json + scripts/ plus the shared roster_lib and winter_lib the
  scripts import; every workbook and config comes from the task's own synthetic test helpers
  (`december-disconnect/tests/synth.py`: fictional "DIS01 Sample" / "Alpha Tester" names), which run
  in a SUBPROCESS so their module names (`synth`, `_common`, ...) never collide with the other
  e2e tests' in this pytest process. No real input, config or output is read;
* the shift-roster config the cross-task step edits is a synthetic copy in the temp tasks root;
* nothing here can reach Outlook/COM, and opening a file with the OS default app is stubbed.

The tests skip when the PMO Desk tasks folder is not on this machine
(override its location with AI_OS_TASKS_SRC).
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import warnings
from collections import defaultdict
from datetime import date, datetime
from getpass import getuser
from pathlib import Path

import pytest
from conftest import make_client

import main as backend

TASKS_SRC = Path(os.environ.get("AI_OS_TASKS_SRC") or Path(__file__).resolve().parents[2] / "tasks")
TASK_SRC = TASKS_SRC / "december-disconnect"
SHARED_SRC = TASKS_SRC / "shared"

pytestmark = pytest.mark.skipif(
    not (TASK_SRC / "task.json").exists()
    or not (SHARED_SRC / "roster_lib").is_dir()
    or not (SHARED_SRC / "winter_lib").is_dir(),
    reason="the PMO Desk december-disconnect task is not available here",
)

TASK_ID = "december-disconnect"
WINDOW = "2026-12-25..2027-01-01"
WINDOW_TEXT = "2026-12-25 to 2027-01-01"
MAIN_DRAFT = f"Winter Coverage DRAFT {WINDOW_TEXT}.xlsx"
AN_DRAFT = f"Analytics Winter Coverage DRAFT {WINDOW_TEXT}.xlsx"
MAIN_FINAL = f"Winter Coverage FINAL {WINDOW_TEXT}.xlsx"
AN_FINAL = f"Analytics Winter Coverage FINAL {WINDOW_TEXT}.xlsx"
STEP_TIMEOUT = 240.0
# Synthetic names the test data uses (staff/shift roster people, the fuzzy near-miss spelling and
# the Analytics people); none of them may appear in a script's log or an error text.
NAME_RE = re.compile(r"Sample|Sampel|Tester")
OS_USER = getuser()
CONFIG_ROTATION = "config/rotation-config.json"


# --- fixtures -----------------------------------------------------------------


_WORLD_BUILDER = """
import sys
from pathlib import Path
task, shared, dest = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
for p in (shared / "winter_lib" / "tests", shared, task / "tests", task / "scripts"):
    sys.path.insert(0, str(p))
import synth
synth.build_world(dest)
"""


@pytest.fixture(scope="session")
def world_template(tmp_path_factory):
    """The task's synthetic inputs and configs (built once per session by the task's own helper,
    in a subprocess with its own interpreter state)."""
    dest = tmp_path_factory.mktemp("dd-world") / "world"
    done = subprocess.run([sys.executable, "-c", _WORLD_BUILDER, str(TASK_SRC), str(SHARED_SRC), str(dest)],
                          capture_output=True, text=True, stdin=subprocess.DEVNULL, timeout=300)
    assert done.returncode == 0, done.stderr[-800:]
    return dest


def sha(path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class Env:
    """A temp tasks root holding a copy of the december-disconnect task, the shared libraries and a
    synthetic shift-roster rotation config (the cross-task target)."""

    def __init__(self, tmp_path: Path, world: Path):
        self.tmp = tmp_path
        self.apps = tmp_path / "apps"
        self.task = self.apps / TASK_ID
        ignore = shutil.ignore_patterns("__pycache__")
        shutil.copytree(TASK_SRC / "scripts", self.task / "scripts", ignore=ignore)
        shutil.copy2(TASK_SRC / "task.json", self.task / "task.json")
        shutil.copytree(SHARED_SRC / "roster_lib", self.apps / "shared" / "roster_lib",
                        ignore=shutil.ignore_patterns("__pycache__", "tests", "examples"))
        shutil.copytree(SHARED_SRC / "winter_lib", self.apps / "shared" / "winter_lib",
                        ignore=shutil.ignore_patterns("__pycache__", "tests"))
        # the synthetic inputs, as the user would upload them (kept outside the task folder)
        self.files = {"roster": world / "input" / "roster.xlsx", "staff": world / "input" / "staff-roster.xlsx",
                      "analytics_a": world / "input" / "analytics-a.xlsx",
                      "analytics_b": world / "input" / "analytics-b.xlsx"}
        assert all(p.is_file() for p in self.files.values())
        # the yearly configs are files the user keeps in config/ (never uploaded, never edited)
        (self.task / "config").mkdir()
        for name in ("winter-config.json", "analytics-config.json"):
            shutil.copy2(world / "config" / name, self.task / "config" / name)
        self.config_hashes = {n: sha(self.task / "config" / n) for n in ("winter-config.json", "analytics-config.json")}
        # the Shift Roster task's rotation config: a synthetic copy at the default sibling location
        # (no task-config.json: the default `../shift-roster/config/rotation-config.json` applies)
        self.rotation = self.apps / "shift-roster" / "config" / "rotation-config.json"
        self.rotation.parent.mkdir(parents=True)
        shutil.copy2(world / "other-task" / "config" / "rotation-config.json", self.rotation)
        self.rotation_before = self.rotation.read_bytes()
        assert not (self.task / "config" / "task-config.json").exists()
        self.opened: list[str] = []

    def p(self, rel: str) -> Path:
        return self.task / rel

    @property
    def main_draft(self) -> Path:
        return self.p(f"output/{MAIN_DRAFT}")

    @property
    def an_draft(self) -> Path:
        return self.p(f"output/{AN_DRAFT}")


@pytest.fixture
def env(monkeypatch, world_template):
    # A SHORT temp root (not pytest's tmp_path): the task's archive step nests long file names
    # ("Analytics Winter Coverage DRAFT <window>.xlsx.snapshot.json") three folders deeper, which
    # overflows Windows' 260 character limit under a deep --basetemp. The real task lives in a
    # short path, so this is a test-environment concern only.
    root = Path(tempfile.mkdtemp(prefix="dd-"))
    try:
        monkeypatch.setattr(backend, "TASKS_ROOT", root / "apps")
        monkeypatch.setattr(backend, "HISTORY_FILE", root / "history.jsonl")
        e = Env(root, world_template)
        monkeypatch.setattr(backend, "_open_with_default_app", lambda path: e.opened.append(str(path)))
        backend.discover_tasks()
        assert set(backend.tasks) == {TASK_ID}  # the shift-roster config folder is no task
        assert backend.tasks[TASK_ID].folder.resolve().is_relative_to(root.resolve())
        assert backend.HISTORY_FILE.resolve().is_relative_to(root.resolve())
        yield e
    finally:
        shutil.rmtree(root, ignore_errors=True)


@pytest.fixture
def client(env):
    # the context manager keeps ONE event loop alive across requests, so the
    # fire-and-forget pipeline task created by /start survives between calls
    with make_client() as c:
        yield c


# --- helpers ------------------------------------------------------------------


def task_json(c):
    return next(t for t in c.get("/tasks").json() if t["id"] == TASK_ID)


def wait_for_state(c, state, step=None, timeout=STEP_TIMEOUT):
    """Poll GET /tasks until the task is in `state` (at `step`); fail fast on an error state."""
    deadline = time.monotonic() + timeout
    while True:
        t = task_json(c)
        if t["state"] == state and (step is None or t["currentStep"] == step):
            return t
        if t["state"] == "error":
            pytest.fail(f"the task hit an error while waiting for {state}/{step}: {t['error']}")
        if time.monotonic() > deadline:
            pytest.fail(f"timed out waiting for {state}/{step}; the task is {t['state']}/{t['currentStep']}")
        time.sleep(0.2)


def wait_for_error(c, timeout=STEP_TIMEOUT):
    deadline = time.monotonic() + timeout
    while True:
        t = task_json(c)
        if t["state"] == "error":
            return t
        if time.monotonic() > deadline:
            pytest.fail(f"timed out waiting for an error; the task is {t['state']}/{t['currentStep']}")
        time.sleep(0.2)


def post(c, path, **kw):
    r = c.post(f"/tasks/{TASK_ID}{path}", **kw)
    assert r.status_code == 200, (path, r.status_code, r.text[:200])
    return r.json()


def get(c, path):
    r = c.get(f"/tasks/{TASK_ID}{path}")
    assert r.status_code == 200, (path, r.status_code, r.text[:200])
    return r.json()


def upload(c, input_id, name, data):
    r = c.post(f"/tasks/{TASK_ID}/upload", params={"input": input_id},
               files={"file": (name, data, "application/octet-stream")})
    assert r.status_code == 200, r.text[:200]
    return r.json()


def upload_world_file(c, env, input_id):
    return upload(c, input_id, f"{input_id}.xlsx", env.files[input_id].read_bytes())


def prepare_and_choose_window(c, env, *, optional=True):
    for input_id in ("roster", "staff") + (("analytics_a", "analytics_b") if optional else ()):
        assert upload_world_file(c, env, input_id)["ok"]
    prepared = post(c, "/prepare")
    assert prepared["ok"], prepared
    assert post(c, "/params", json={"params": {"window": WINDOW}})["ok"]


def start(c):
    r = post(c, "/start")
    assert r["ok"], r
    return r


def default_answers(schema, *, only_required=True):
    """What the form's single Save posts for the required fields: each required select takes its default,
    else its first option that is not SKIP (a name confirmation takes the suggested roster name)."""
    answers = {}
    for f in schema["fields"]:
        if only_required and not f.get("required"):
            continue
        values = [o["value"] for o in f.get("options") or []]
        if f["id"].startswith("name:"):
            answers[f["id"]] = next(v for v in values if v != "SKIP")
        elif f.get("default") in values:
            answers[f["id"]] = f["default"]
        elif values:
            answers[f["id"]] = next(v for v in values if v != "SKIP")
    return answers


def answer_form(c, extra=None):
    """Save the required answers (plus `extra`), as the UI's Save does."""
    form = get(c, "/form")
    assert form["ok"], form
    answers = {**default_answers(form["schema"]), **(extra or {})}
    saved = post(c, "/form", json={"answers": answers})
    assert saved == {"ok": True, "pending": []}, saved
    return answers


def all_log_text(c):
    entries = c.get(f"/tasks/{TASK_ID}/log").json()
    assert isinstance(entries, list)
    return entries, "\n".join(e["text"] for e in entries)


def history(c):
    body = get(c, "/history")
    assert body["ok"]
    return body["runs"]


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def save_replacing(tmp: Path, target: Path):
    for attempt in range(20):  # a scanner/indexer may hold the fresh file for a moment (as on a real desktop)
        try:
            os.replace(tmp, target)  # a save in place replaces the file
            return
        except PermissionError:
            if attempt == 19:
                raise
            time.sleep(0.25)


# --- the PMO's edits (what Excel does to the two drafts) ---------------------------


def main_plan(env):
    """({person: {date: code}}, {person: team}, {person: usual shift as the workbook shows it})"""
    if str(SHARED_SRC) not in sys.path:
        sys.path.append(str(SHARED_SRC))  # winter_lib's names are unique, unlike the task scripts'
    from winter_lib.winter_types import display_code

    plan = load_json(env.p("output/plan.json"))
    cells = defaultdict(dict)
    for name, d, code in plan["cells"]:
        cells[name][date.fromisoformat(d)] = code
    team = {x["name"]: x["team"] for x in plan["people"]}
    usual = {x["name"]: display_code(x["usual_shift"]) for x in plan["people"]}
    return cells, team, usual


def safe_main_edit(env):
    """A valid edit: a DIS/DEP person with exactly 3 days also works a 4th day on their usual shift."""
    cells, team, usual = main_plan(env)
    all_days = sorted({d for days in cells.values() for d in days})
    for name, days in sorted(cells.items()):
        if len(days) == 3 and team[name] in ("DIS", "DEP"):
            d = next(x for x in all_days if x not in days)
            return {(name, d): usual[name]}
    raise AssertionError("no 3-day person in the synthetic plan")


def breaking_main_edit(env):
    """An edit that breaks a rule: a DIS person with exactly 3 days drops one (below 3 days)."""
    cells, team, _ = main_plan(env)
    for name, days in sorted(cells.items()):
        if len(days) == 3 and team[name] == "DIS":
            return {(name, sorted(days)[0]): ""}
    raise AssertionError("no 3-day DIS person")


def analytics_by_day(env):
    plan = load_json(env.p("output/analytics-plan.json"))
    by_day = defaultdict(list)
    for a in plan["assignments"]:
        if a["zone"] == "IST":
            by_day[a["date"]].append(a)
    return by_day


def safe_analytics_swap(env):
    """Swap the people of two IST slots on one day (counts, double slots and on-call stay valid)."""
    for day, rows in sorted(analytics_by_day(env).items()):
        for i, a in enumerate(rows):
            for b in rows[i + 1:]:
                if a["person"] != b["person"]:
                    d = date.fromisoformat(day)
                    return ({(d, a["label"]): b["person"], (d, b["label"]): a["person"]},
                            (a["label"], a["person"], b["label"], b["person"]))
    raise AssertionError("no swappable analytics slots")


def double_slot_analytics_edit(env):
    """Give a person a second slot on a day: a hard-rule error."""
    for day, rows in sorted(analytics_by_day(env).items()):
        if len(rows) >= 2 and rows[0]["person"] != rows[1]["person"]:
            return {(date.fromisoformat(day), rows[1]["label"]): rows[0]["person"]}
    raise AssertionError("no day with two IST slots")


def _open_workbook(path):
    import openpyxl

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return openpyxl.load_workbook(path)


def edit_main_in_place(env, edits):
    """The PMO sets cells of the Winter Plan grid ({(person, date): text}; "" clears) and saves the
    draft under the same name in Excel (the hidden snapshot sheet and the sidecar stay)."""
    wb = _open_workbook(env.main_draft)
    ws = wb["Winter Plan"]
    hdr = next(r for r in range(1, 15) if "Team member" in (ws.cell(r, 1).value, ws.cell(r, 2).value))
    cols = {}
    for r in range(hdr, hdr + 3):
        for c in range(1, ws.max_column + 1):
            v = ws.cell(r, c).value
            if isinstance(v, datetime):
                cols[v.date()] = c
        if cols:
            break
    rows = {str(ws.cell(r, 2).value): r for r in range(hdr + 1, ws.max_row + 1)}
    for (person, d), text in edits.items():
        ws.cell(rows[person], cols[d]).value = text or None
    tmp = env.main_draft.with_name("excel-save-main.xlsx")
    wb.save(tmp)
    save_replacing(tmp, env.main_draft)


def edit_analytics_in_place(env, edits):
    """The PMO sets Assigned cells of the Analytics Winter Roster ({(date, slot label): name})."""
    wb = _open_workbook(env.an_draft)
    ws = wb["Winter Roster"]
    hdr = next(r for r in range(1, 20) if ws.cell(r, 1).value == "Date")
    todo = dict(edits)
    for r in range(hdr + 1, ws.max_row + 1):
        v = ws.cell(r, 1).value
        d = v.date() if isinstance(v, datetime) else v
        key = (d, ws.cell(r, 4).value)
        if key in todo:
            ws.cell(r, 8).value = todo.pop(key) or None
    assert not todo, "cells not found"
    tmp = env.an_draft.with_name("excel-save-analytics.xlsx")
    wb.save(tmp)
    save_replacing(tmp, env.an_draft)


def run_to_flags_gate(c, env, extra_answers=None):
    """start -> answers -> approve -> build_draft -> parked at the flags gate."""
    start(c)
    wait_for_state(c, "awaiting_review", "answers")
    answers = answer_form(c, extra_answers)
    assert post(c, "/approve") == {"ok": True}
    t = wait_for_state(c, "awaiting_review", "review_draft")
    return answers, t




# --- the full lifecycle ---------------------------------------------------------


def test_full_lifecycle(env, client):
    c = client
    started = time.monotonic()

    # 1. manifest parsed by GET /tasks: what the Tasks app renders
    t = task_json(c)
    assert {"id", "displayName", "state", "error", "currentStep", "steps",
            "notifications", "inputs", "prepare"} <= set(t)
    assert (t["state"], t["prepare"]) == ("resting", True)
    assert [i["id"] for i in t["inputs"]] == [
        "roster", "staff", "winter_config", "analytics_config", "analytics_a", "analytics_b", "window"]
    assert {i["id"]: i["required"] for i in t["inputs"]} == {
        "roster": True, "staff": True, "winter_config": True, "analytics_config": True,
        "analytics_a": False, "analytics_b": False, "window": True}
    assert {i["id"]: i["type"] for i in t["inputs"]} == {
        "roster": "file", "staff": "file", "winter_config": "file", "analytics_config": "file",
        "analytics_a": "file", "analytics_b": "file", "window": "select"}
    assert all(i["label"] for i in t["inputs"])
    assert [(s["id"], s["type"]) for s in t["steps"]] == [
        ("analyze", "python"), ("answers", "review"), ("build_draft", "python"), ("review_draft", "review"),
        ("diff_draft", "python"), ("confirm_diff", "confirm"), ("finalize", "python")]
    assert all(isinstance(s["label"], str) and s["label"] for s in t["steps"])
    gates = {s["id"]: s["gate"] for s in t["steps"] if s["gate"]}
    assert gates == {
        "answers": {"type": "form", "schema": "output/ask-me.json", "answers": "output/ask-me-answers.json"},
        "review_draft": {"type": "flags", "file": "output/flags.json"},
        "confirm_diff": {"type": "diff", "file": "output/roster-diff.json"},
    }
    manifest = load_json(env.p("task.json"))
    steps = {s["id"]: s for s in manifest["steps"]}
    assert backend.tasks[TASK_ID].completed_message == manifest["completedMessage"]
    assert "Analytics" in manifest["completedMessage"]

    # 2. nothing uploaded yet; start is refused with the missing REQUIRED inputs only
    inputs = get(c, "/inputs")
    assert inputs["ok"] and inputs["params"] == {}
    assert {i["id"]: i["present"] for i in inputs["inputs"]} == {
        "roster": False, "staff": False, "winter_config": True, "analytics_config": True,
        "analytics_a": False, "analytics_b": False, "window": False}
    refused = post(c, "/start")
    assert refused["ok"] is False and refused["missing"] == ["roster", "staff", "window"]
    assert task_json(c)["state"] == "resting"

    # 3. uploads; prepare is refused until its `after` inputs (roster, staff) exist; the optional
    #    Analytics rosters are not needed for it
    up = upload_world_file(c, env, "roster")
    roster_sha = sha(env.files["roster"])
    assert up["ok"] and up["sha256"] == roster_sha and sha(env.p("input/roster.xlsx")) == roster_sha
    early = post(c, "/prepare")
    assert early["ok"] is False and early["missing"] == ["staff"]
    assert upload_world_file(c, env, "staff")["ok"]
    prepared = post(c, "/prepare")
    assert prepared["ok"] and isinstance(prepared["options"], dict)

    # 4. options: the one window, enabled, with a default
    options = get(c, "/options")
    assert options == {"ok": True, "options": prepared["options"]}
    windows = options["options"]["windows"]
    assert [w["id"] for w in windows] == [WINDOW] and windows[0]["enabled"] is True
    assert {"label", "start", "end", "days", "reason"} <= set(windows[0])
    assert options["options"]["default"] == WINDOW and options["options"]["problems"] == []

    # 5. params: unknown windows and non-select inputs are refused; the real one is saved
    assert post(c, "/params", json={"params": {"window": "1999-01-01..1999-01-08"}})["ok"] is False
    assert post(c, "/params", json={"params": {"roster": "x"}})["ok"] is False
    assert not env.p("input/run-params.json").exists()
    assert post(c, "/params", json={"params": {"window": WINDOW}}) == {"ok": True, "params": {"window": WINDOW}}
    saved = load_json(env.p("input/run-params.json"))
    assert saved["params"] == {"window": WINDOW} and saved["saved_at"]
    # the optional uploads do not invalidate the choice made from the options
    for optional in ("analytics_a", "analytics_b"):
        assert upload_world_file(c, env, optional)["ok"]
    assert get(c, "/inputs")["params"] == {"window": WINDOW} and get(c, "/options")["options"] is not None
    assert all(i["present"] for i in get(c, "/inputs")["inputs"] if i["type"] == "file")
    input_hashes = {k: sha(env.p(f"input/{n}")) for k, n in
                    (("roster", "roster.xlsx"), ("staff", "staff-roster.xlsx"),
                     ("analytics_a", "analytics-a.xlsx"), ("analytics_b", "analytics-b.xlsx"))}

    # 6. start -> analyze -> the answers form gate; inputs are frozen while the run is in progress
    start(c)
    assert post(c, "/start")["ok"] is False  # already running
    t = wait_for_state(c, "awaiting_review", "answers")
    assert t["error"] is None
    assert post(c, "/prepare")["ok"] is False
    assert upload(c, "roster", "roster.xlsx", b"PK-other")["ok"] is False
    assert post(c, "/params", json={"params": {"window": WINDOW}})["ok"] is False
    assert sha(env.p("input/roster.xlsx")) == roster_sha
    answers_note = next(n for n in t["notifications"] if n["body"] == steps["answers"]["reviewMessage"])
    assert answers_note["outputPath"] is None and answers_note["outputPaths"] == []  # no file yet

    # 7. the form: select AND text fields, groups, defaults; approve refused while required fields are pending
    form = get(c, "/form")
    assert form["ok"] and form["answers"] == {}
    fields = form["schema"]["fields"]
    by_id = {f["id"]: f for f in fields}
    assert all(f["group"] and f["label"] for f in fields)
    assert {f["type"] for f in fields} == {"select", "text"}
    assert all(f["options"] for f in fields if f["type"] == "select")
    required = [f["id"] for f in fields if f.get("required")]
    assert len(required) == 4 and form["pending"] == required  # 3 new-people shifts + 1 name match
    assert [i for i in required if i.startswith("shift:")] and [i for i in required if i.startswith("name:")]
    availability = [f for f in fields if f["group"] == "Availability exceptions"]
    assert len(availability) == (5 + 3) * 3 and not any(f.get("required") for f in availability)
    text_fields = [f for f in availability if f["type"] == "text"]
    assert len(text_fields) == 8 and all(f["id"].startswith(("avail_dates_", "aavail_dates_")) for f in text_fields)
    assert all("YYYY-MM-DD" in f["description"] and f["default"] == "" for f in text_fields)
    selects = [f for f in availability if f["type"] == "select"]
    assert {f["default"] for f in selects if "_person_" in f["id"]} == {"NONE"}
    assert {f["default"] for f in selects if "_mode_" in f["id"]} == {"unavailable"}
    refusal = post(c, "/approve")
    assert refusal["ok"] is False and refusal["pending"] == required
    assert task_json(c)["state"] == "awaiting_review"

    # validation of the text fields, through the real endpoint: nothing is written on a refusal
    assert not env.p("output/ask-me-answers.json").exists()
    for bad in (5, ["2026-12-29"], {"a": 1}, True):
        r = post(c, "/form", json={"answers": {"avail_dates_1": bad}})
        assert r["ok"] is False and r["invalid"] == ["avail_dates_1"], bad
    too_long = post(c, "/form", json={"answers": {"avail_dates_1": "2026-12-29," * 60}})
    assert too_long["ok"] is False and too_long["invalid"] == ["avail_dates_1"] and "500" in too_long["reason"]
    assert post(c, "/form", json={"answers": {"avail_person_1": "Nobody"}})["invalid"] == ["avail_person_1"]
    assert post(c, "/form", json={"answers": {"avail_mode_1": "sometimes"}})["invalid"] == ["avail_mode_1"]
    assert not env.p("output/ask-me-answers.json").exists()
    # an optional text may be empty, a whitespace-only one too: neither changes `pending`
    assert post(c, "/form", json={"answers": {"avail_dates_1": "   ", "aavail_dates_1": ""}}) == {
        "ok": True, "pending": required}
    assert get(c, "/form")["pending"] == required  # optional answers (even defaults) never count as pending

    # the PMO answers: required defaults plus an availability exception for each plan
    main_person = next(o["value"] for o in by_id["avail_person_1"]["options"] if o["value"] == "DIS00 Sample")
    an_person = next(o["value"] for o in by_id["aavail_person_1"]["options"] if o["value"] != "NONE")
    exceptions = {
        "avail_person_1": main_person, "avail_dates_1": "  2026-12-29 , 2026-12-30\t ", "avail_mode_1": "unavailable",
        "aavail_person_1": an_person, "aavail_dates_1": "2026-12-28", "aavail_mode_1": "unavailable",
    }
    first = default_answers(form["schema"])
    one = post(c, "/form", json={"answers": {required[0]: first[required[0]]}})
    assert one == {"ok": True, "pending": required[1:]}
    assert post(c, "/approve")["ok"] is False  # still pending
    answers = answer_form(c, exceptions)
    answers_file = load_json(env.p("output/ask-me-answers.json"))
    assert answers_file["avail_dates_1"] == "2026-12-29 , 2026-12-30"  # trimmed by the backend
    assert answers_file["avail_person_1"] == main_person and answers_file["aavail_dates_1"] == "2026-12-28"
    assert answers_file["aavail_dates_1"] == "2026-12-28" and answers_file["avail_mode_1"] == "unavailable"
    assert all(k in answers_file for k in required)
    assert get(c, "/form")["pending"] == [] and get(c, "/form")["answers"] == answers_file

    # 8. approve -> build_draft (two MILPs) -> the flags gate; both drafts exist
    assert post(c, "/approve") == {"ok": True}
    t = wait_for_state(c, "awaiting_review", "review_draft")
    assert env.main_draft.exists() and env.an_draft.exists()
    assert Path(str(env.main_draft) + ".snapshot.json").exists() and Path(str(env.an_draft) + ".snapshot.json").exists()
    flags = get(c, "/flags")
    assert flags["ok"] and set(flags["flags"]) == {"counts", "flags"}
    counts, rows = flags["flags"]["counts"], flags["flags"]["flags"]
    assert set(counts) == {"error", "warning", "info"} and sum(counts.values()) == len(rows) > 0
    assert {sev: sum(1 for f in rows if f["severity"] == sev) for sev in counts} == counts
    assert counts["error"] == 0
    assert all({"key", "kind", "severity", "message"} <= set(f) for f in rows)
    assert any(f["person"] is None for f in rows) and any(f["date"] is None for f in rows)
    kinds = {f["kind"] for f in rows}
    assert {"WINTER_DRAFT_FILE", "ANALYTICS_DRAFT_FILE", "WINTER_AVAILABILITY_EXCEPTION",
            "ANALYTICS_AVAILABILITY_EXCEPTION"} <= kinds
    an_info = next(f for f in rows if f["kind"] == "ANALYTICS_DRAFT_FILE")
    assert an_info["severity"] == "info" and AN_DRAFT in an_info["message"] and an_info["message"].startswith("[Analytics]")
    assert any(f["kind"].startswith("WINTER_") for f in rows) and any(f["kind"].startswith("ANALYTICS_") for f in rows)
    # the answers reached the plans: the effective configs carry the availability exceptions
    eff = load_json(env.p("output/winter-config.effective.json"))
    assert eff["availability"][main_person]["unavailable"] == ["2026-12-29", "2026-12-30"]
    cells, _, _ = main_plan(env)
    assert date(2026, 12, 29) not in cells[main_person] and date(2026, 12, 30) not in cells[main_person]
    assert len(load_json(env.p("output/analytics-plan.json"))["assignments"]) == 34
    # report-data.json lists both workbooks; the notification carries both for the Open buttons
    report = load_json(env.p("output/report-data.json"))
    assert report["stage"] == "draft" and report["workbook_path"] == f"output/{MAIN_DRAFT}"
    assert report["summary"]["analytics_workbook_path"] == f"output/{AN_DRAFT}"
    assert report["summary"]["flags"] == counts
    assert report["extra_paths"] == [{"label": "Main plan", "path": f"output/{MAIN_DRAFT}"},
                                     {"label": "Analytics plan", "path": f"output/{AN_DRAFT}"}]
    draft_notes = [n for n in t["notifications"] if n["kind"] == "task.review_ready" and n["outputPath"]]
    assert len(draft_notes) == 1
    note = draft_notes[0]
    assert note["body"] == steps["review_draft"]["reviewMessage"]
    assert Path(note["outputPath"]) == env.main_draft.resolve() and Path(note["outputPath"]).is_absolute()
    assert [(e["label"], Path(e["path"])) for e in note["outputPaths"]] == [
        ("Main plan", env.main_draft.resolve()), ("Analytics plan", env.an_draft.resolve())]
    assert all(Path(e["path"]).is_absolute() for e in note["outputPaths"])
    assert get(c, "/diff") == {"ok": True, "diff": None}  # no comparison yet at this gate
    # the Open buttons: the backend opens exactly the listed files, nothing else
    open_url = f"/notifications/{note['id']}/open"
    assert post(c, open_url) == {"ok": True} and env.opened == [str(env.main_draft.resolve())]
    assert post(c, open_url, params={"path": note["outputPaths"][1]["path"]}) == {"ok": True}
    assert env.opened[-1] == str(env.an_draft.resolve())
    for sneaky in (str(env.p("output/plan.json")), str(env.p("task.json")), str(env.rotation),
                   str(env.p("output/../config/winter-config.json")), "output/analytics-plan.json"):
        assert post(c, open_url, params={"path": sneaky})["ok"] is False, sneaky
    assert len(env.opened) == 2
    # inputs and the yearly configs are still untouched
    assert {k: sha(env.p(f"input/{n}")) for k, n in
            (("roster", "roster.xlsx"), ("staff", "staff-roster.xlsx"),
             ("analytics_a", "analytics-a.xlsx"), ("analytics_b", "analytics-b.xlsx"))} == input_hashes
    assert {n: sha(env.p(f"config/{n}")) for n in env.config_hashes} == env.config_hashes

    # 9. the PMO edits BOTH drafts in Excel (a valid cell in the Winter Plan grid, an Analytics swap)
    main_edit = safe_main_edit(env)
    (edit_person, edit_day), edit_text = next(iter(main_edit.items()))
    swap, (label_a, name_a, label_b, name_b) = safe_analytics_swap(env)
    main_before, an_before = sha(env.main_draft), sha(env.an_draft)
    edit_main_in_place(env, main_edit)
    edit_analytics_in_place(env, swap)
    assert sha(env.main_draft) != main_before and sha(env.an_draft) != an_before
    assert post(c, "/approve") == {"ok": True}
    t = wait_for_state(c, "awaiting_send", "confirm_diff")

    # 10. the diff gate: exactly the three edited cells, Analytics rows as `Analytics <slot>`, nothing blocking
    diff = get(c, "/diff")["diff"]
    assert diff["cycle"] == WINDOW and diff["blocking"] == [] and diff["outside_changes"] == []
    assert all(set(x) >= {"person", "date", "before", "after"} for x in diff["changes"])
    main_rows = [x for x in diff["changes"] if not x["person"].startswith("Analytics ")]
    an_rows = [x for x in diff["changes"] if x["person"].startswith("Analytics ")]
    assert main_rows == [{"person": edit_person, "date": edit_day.isoformat(), "before": "", "after": edit_text}]
    assert sorted((x["person"], x["date"], x["before"], x["after"]) for x in an_rows) == sorted([
        (f"Analytics {label_a}", next(iter(d for (d, lab) in swap if lab == label_a)).isoformat(), name_a, name_b),
        (f"Analytics {label_b}", next(iter(d for (d, lab) in swap if lab == label_b)).isoformat(), name_b, name_a),
    ])
    assert len(diff["changes"]) == 3
    assert set(diff["flags"]) >= {"new", "resolved", "remaining"} and isinstance(diff["flags"]["remaining"], int)
    assert diff["saved_drafts"]["main"] == {"name": MAIN_DRAFT, "sha256": sha(env.main_draft)}
    assert diff["saved_drafts"]["analytics"] == {"name": AN_DRAFT, "sha256": sha(env.an_draft)}
    assert diff["counts"]["main_changes"] == 1 and diff["counts"]["analytics_changes"] == 2
    confirm_notes = [n for n in t["notifications"] if n["body"] == steps["confirm_diff"]["reviewMessage"]]
    assert len(confirm_notes) == 1
    assert [e["label"] for e in confirm_notes[0]["outputPaths"]] == ["Main plan", "Analytics plan"]
    # actions that do not belong to this gate are refused
    assert post(c, "/approve")["ok"] is False
    assert post(c, "/reject")["ok"] is False
    # a diff with blocking issues cannot be sent (the diff file is restored byte for byte after)
    diff_path = env.p("output/roster-diff.json")
    original_diff = diff_path.read_bytes()
    blocked = {**diff, "blocking": [{"kind": "ANALYTICS_DOUBLE_SLOT", "message": "synthetic blocker"}]}
    diff_path.write_text(json.dumps(blocked), encoding="utf-8")
    refused = post(c, "/send")
    assert refused["ok"] is False and refused["blocking"] == blocked["blocking"] and refused["reason"]
    assert task_json(c)["state"] == "awaiting_send"
    diff_path.write_bytes(original_diff)
    assert not env.p("output/final").exists() and not env.p("output/audit").exists()
    assert env.rotation.read_bytes() == env.rotation_before

    # 11. send -> finalize -> back to resting
    saved_main_sha, saved_an_sha = sha(env.main_draft), sha(env.an_draft)
    assert post(c, "/send") == {"ok": True}
    t = wait_for_state(c, "resting")
    assert t["error"] is None and t["currentStep"] is None

    # 12. both final files exist and ARE the confirmed saved drafts, byte for byte
    final_main, final_an = env.p(f"output/final/{MAIN_FINAL}"), env.p(f"output/final/{AN_FINAL}")
    assert final_main.exists() and final_an.exists()
    assert sorted(p.name for p in env.p("output/final").iterdir()) == sorted([MAIN_FINAL, AN_FINAL])
    assert sha(final_main) == saved_main_sha == diff["saved_drafts"]["main"]["sha256"]
    assert sha(final_an) == saved_an_sha == diff["saved_drafts"]["analytics"]["sha256"]
    assert sha(env.main_draft) == saved_main_sha and sha(env.an_draft) == saved_an_sha  # drafts untouched
    # input cleanup (manifest `cleanup.onComplete`): the uploads are removed once the run completed
    # (their hashes live on in the audit log); the yearly configs are not inputs and stay
    assert [p.name for p in env.p("input").iterdir() if not p.name.startswith(".")] == []
    assert not env.p("input/run-params.json").exists() and not env.p("output/options.json").exists()
    assert history(c)[0]["cleanup"]["removed"] == 4 and history(c)[0]["cleanup"]["skipped"] == 0
    assert {n: sha(env.p(f"config/{n}")) for n in env.config_hashes} == env.config_hashes

    # audit log with the approver (the OS user, never client-supplied), the hashes and the confirmed diff
    entries = sorted(env.p("output/audit").glob("*.json"))
    assert len(entries) == 1
    log_lines = env.p("output/audit/audit.log.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(log_lines) == 1
    audit = load_json(entries[0])
    assert audit["task"] == TASK_ID and audit["window"] == WINDOW
    assert (audit["approver"], audit["approver_source"]) == (OS_USER, "getpass")
    assert audit["outputs"]["final_main"]["sha256"] == saved_main_sha
    assert audit["outputs"]["final_analytics"]["sha256"] == saved_an_sha
    assert audit["saved_drafts"]["main"]["sha256"] == saved_main_sha
    assert audit["inputs"]["roster"]["sha256"] == roster_sha
    assert audit["diff"]["changes"] == diff["changes"] and audit["counts"]["changes"] == 3
    summary_line = json.loads(log_lines[0])
    assert summary_line["approver"] == OS_USER and summary_line["final_main_sha256"] == saved_main_sha
    assert summary_line["final_analytics_sha256"] == saved_an_sha and summary_line["cross_task"] == "updated"

    # cross-task: the disconnect days were added to the (synthetic) shift-roster config, old file kept verbatim
    rotation = json.loads(env.rotation.read_text(encoding="utf-8"))
    assert rotation["disconnect_windows"] == [{"start": "2026-12-26", "end": "2026-12-31"}]
    config_backups = list(env.rotation.parent.glob("backups/rotation-config.*.json"))
    assert len(config_backups) == 1 and config_backups[0].read_bytes() == env.rotation_before
    assert audit["cross_task"]["status"] == "updated" and audit["cross_task"]["backup"] == config_backups[0].name

    # report-data now points at the FINAL workbooks; the completed notification offers both
    report = load_json(env.p("output/report-data.json"))
    assert report["stage"] == "final" and report["workbook_path"] == f"output/final/{MAIN_FINAL}"
    assert report["extra_paths"] == [{"label": "Main plan", "path": f"output/final/{MAIN_FINAL}"},
                                     {"label": "Analytics plan", "path": f"output/final/{AN_FINAL}"}]
    s = report["summary"]
    assert (s["final_main_file"], s["final_analytics_file"]) == (MAIN_FINAL, AN_FINAL)
    assert s["analytics_workbook_path"] == f"output/final/{AN_FINAL}" and s["approver"] == OS_USER
    assert (s["user_changes"], s["main_changes"], s["analytics_changes"]) == (3, 1, 2)
    assert s["final_main_sha256"] == saved_main_sha and s["final_analytics_sha256"] == saved_an_sha
    assert s["cross_task"]["status"] == "updated"
    done_note = next(n for n in t["notifications"] if n["kind"] == "task.completed")
    assert done_note["body"].startswith(manifest["completedMessage"])  # + the cleanup sentence
    assert re.search(r" Cleaned up 4 input files \(.+\)\.$", done_note["body"])
    assert Path(done_note["outputPath"]) == final_main.resolve()
    assert [(e["label"], Path(e["path"])) for e in done_note["outputPaths"]] == [
        ("Main plan", final_main.resolve()), ("Analytics plan", final_an.resolve())]
    assert post(c, f"/notifications/{done_note['id']}/open", params={"path": done_note["outputPaths"][1]["path"]}) == {"ok": True}
    assert env.opened[-1] == str(final_an.resolve())
    assert post(c, f"/notifications/{done_note['id']}/open", params={"path": str(env.main_draft)})["ok"] is False

    # 13. history: one completed run with the approver stamps
    runs = history(c)
    assert len(runs) == 1
    run = runs[0]
    assert (run["outcome"], run["error"], run["task_id"]) == ("completed", None, TASK_ID)
    assert run["steps_completed"] == ["analyze", "build_draft", "diff_draft", "finalize"]
    assert [(a["step"], a["kind"], a["user"]) for a in run["approvals"]] == [
        ("answers", "approve", OS_USER), ("review_draft", "approve", OS_USER), ("confirm_diff", "send", OS_USER)]
    assert all(a["at"] for a in run["approvals"])
    assert not NAME_RE.search(json.dumps(run)), "a person name reached the history record"

    # 14. the scripts' logs hold counts and file names only, never a person's name
    entries, text = all_log_text(c)
    assert {e["step"] for e in entries} == {"analyze", "build_draft", "diff_draft", "finalize"}
    assert not NAME_RE.search(text), "a script printed a (synthetic) person name"
    assert not [e for e in entries if e["stream"] == "stderr"], "a successful step wrote to stderr"
    assert "Traceback" not in text and "ERROR" not in text
    assert all(len(e["text"]) <= 4000 for e in entries)
    assert f"output/final/{MAIN_FINAL}" in text and f"output/final/{AN_FINAL}" in text
    assert "34 of 34" in text  # the Analytics slots, as a count

    # a finished task takes no more gate actions
    for action in ("approve", "send", "reject"):
        assert post(c, f"/{action}")["ok"] is False
    assert time.monotonic() - started < 280


def test_run_without_optional_analytics_rosters_still_completes(env, client):
    """The optional uploads really are optional: the plan uses the Analytics config as is."""
    c = client
    prepare_and_choose_window(c, env, optional=False)
    assert not env.p("input/analytics-a.xlsx").exists()
    answers, t = run_to_flags_gate(c, env)
    assert env.main_draft.exists() and env.an_draft.exists()
    assert not [f for f in get(c, "/flags")["flags"]["flags"] if f["kind"] == "ANALYTICS_ROSTER_REFRESH"]
    assert post(c, "/approve") == {"ok": True}  # no edits at all
    wait_for_state(c, "awaiting_send", "confirm_diff")
    diff = get(c, "/diff")["diff"]
    assert diff["changes"] == [] and diff["blocking"] == []
    assert post(c, "/send") == {"ok": True}
    t = wait_for_state(c, "resting")
    assert sha(env.p(f"output/final/{MAIN_FINAL}")) == sha(env.main_draft)
    assert sha(env.p(f"output/final/{AN_FINAL}")) == sha(env.an_draft)
    assert [n["kind"] for n in t["notifications"]][-1] == "task.completed"
    assert json.loads(env.rotation.read_text(encoding="utf-8"))["disconnect_windows"] == [
        {"start": "2026-12-26", "end": "2026-12-31"}]


# --- failure and refusal paths ----------------------------------------------------


def test_rule_breaking_edits_block_send_and_a_changed_draft_fails_finalize(env, client):
    c = client
    prepare_and_choose_window(c, env)

    # run 1: the PMO breaks a rule in each workbook -> blocking diff -> send refused, nothing built
    run_to_flags_gate(c, env)
    main_break = breaking_main_edit(env)
    (broken_person, _), = main_break.keys()
    edit_main_in_place(env, main_break)
    edit_analytics_in_place(env, double_slot_analytics_edit(env))
    assert post(c, "/approve") == {"ok": True}
    t = wait_for_state(c, "awaiting_send", "confirm_diff")
    diff = get(c, "/diff")["diff"]
    blocking_kinds = sorted({b["kind"] for b in diff["blocking"]})
    assert "WINTER_DAYS_BELOW_MIN" in blocking_kinds and any(k.startswith("ANALYTICS_") for k in blocking_kinds)
    assert all(b["message"] for b in diff["blocking"])
    refused = post(c, "/send")
    assert refused["ok"] is False and refused["blocking"] == diff["blocking"] and refused["reason"]
    assert task_json(c)["state"] == "awaiting_send"
    assert not env.p("output/final").exists() and not env.p("output/audit").exists()
    assert env.rotation.read_bytes() == env.rotation_before and not (env.rotation.parent / "backups").exists()
    # reject does not exist at the confirm gate: Reset ("Start over" in the app) is the way out of a
    # blocked confirm step; an abandoned run leaves no record, inputs and the window choice are kept
    assert post(c, "/reset") == {"ok": True}
    assert task_json(c)["state"] == "resting" and history(c) == []
    assert get(c, "/inputs")["params"] == {"window": WINDOW}

    # run 2: the stale answers are gone (asked again) and the earlier drafts are archived, not destroyed
    start(c)
    wait_for_state(c, "awaiting_review", "answers")
    assert get(c, "/form")["answers"] == {} and get(c, "/form")["pending"]
    answer_form(c)
    assert post(c, "/approve") == {"ok": True}
    wait_for_state(c, "awaiting_review", "review_draft")
    archived = list(env.p("output/archive").rglob("*.xlsx"))
    assert sorted(p.name for p in archived) == sorted([MAIN_DRAFT, AN_DRAFT])  # the PMO's edits stay readable
    assert any("stability" in f["message"] or f["kind"] == "WINTER_STABILITY" for f in get(c, "/flags")["flags"]["flags"])
    edit_main_in_place(env, safe_main_edit(env))
    assert post(c, "/approve") == {"ok": True}
    wait_for_state(c, "awaiting_send", "confirm_diff")
    assert get(c, "/diff")["diff"]["blocking"] == []

    # the PMO touches a draft AFTER the comparison was shown: finalize must refuse, with a one-line,
    # name-free error that says what to do
    edit_analytics_in_place(env, safe_analytics_swap(env)[0])
    assert post(c, "/send") == {"ok": True}
    t = wait_for_error(c)
    assert "analytics draft was changed after you confirmed" in t["error"]
    assert "\n" not in t["error"].strip() and not NAME_RE.search(t["error"]) and len(t["error"]) < 400
    # nothing was built; the shift-roster config and the yearly configs are untouched
    assert not env.p("output/final").exists() and not env.p("output/audit").exists()
    assert env.rotation.read_bytes() == env.rotation_before and not (env.rotation.parent / "backups").exists()
    assert {n: sha(env.p(f"config/{n}")) for n in env.config_hashes} == env.config_hashes
    # the failed run is recorded once with the approver stamps of the clicks that happened
    runs = history(c)
    assert len(runs) == 1 and runs[0]["outcome"] == "failed" and runs[0]["current_step_at_end"] == "finalize"
    assert "analytics draft was changed after you confirmed" in runs[0]["error"]
    assert not NAME_RE.search(runs[0]["error"])
    assert [a["kind"] for a in runs[0]["approvals"]] == ["approve", "approve", "send"]
    assert all(a["user"] == OS_USER for a in runs[0]["approvals"])
    assert any(n["kind"] == "task.failed" and not NAME_RE.search(n["body"]) for n in t["notifications"])
    # a failed run's log is readable and name-free (the error line names kinds and counts only)
    entries, text = all_log_text(c)
    assert not NAME_RE.search(text)
    assert any(e["stream"] == "stderr" and e["text"].startswith("ERROR:") for e in entries)
    assert broken_person not in text


def test_tampered_snapshot_blocks_send(env, client):
    c = client
    prepare_and_choose_window(c, env)
    run_to_flags_gate(c, env)
    side = Path(str(env.an_draft) + ".snapshot.json")
    data = load_json(side)
    data["rows"][0][6] = "Someone Else"  # the hidden snapshot no longer matches its sidecar
    side.write_text(json.dumps(data), encoding="utf-8")
    assert post(c, "/approve") == {"ok": True}
    wait_for_state(c, "awaiting_send", "confirm_diff")
    diff = get(c, "/diff")["diff"]
    assert "SNAPSHOT_TAMPERED" in {b["kind"] for b in diff["blocking"]}
    refused = post(c, "/send")
    assert refused["ok"] is False and "SNAPSHOT_TAMPERED" in {b["kind"] for b in refused["blocking"]}
    assert not env.p("output/final").exists()


def test_inputs_negative_and_missing_files(env, client):
    c = client
    good = env.files["roster"].read_bytes()
    for name in ("roster.xls", "roster.xlsm", "roster.xlsx.exe", "evil.py", "noext"):
        r = upload(c, "roster", name, good)
        assert r["ok"] is False and r["reason"], name
    for input_id in ("nope", "../roster", "window", "analytics_c", ""):
        r = c.post(f"/tasks/{TASK_ID}/upload", params={"input": input_id},
                   files={"file": ("a.xlsx", good, "application/octet-stream")}).json()
        assert r["ok"] is False, input_id
    assert not env.p("input/roster.xlsx").exists()
    # the optional Analytics roster lands at its own destination only
    assert upload(c, "analytics_a", "..\\..\\evil\\analytics.xlsx", good)["ok"] is True
    assert sorted(p.name for p in env.p("input").iterdir() if not p.name.startswith(".")) == ["analytics-a.xlsx"]
    # prepare needs roster AND staff; the window cannot be chosen before options exist
    assert post(c, "/prepare")["missing"] == ["roster", "staff"]
    assert post(c, "/params", json={"params": {"window": WINDOW}})["ok"] is False
    assert post(c, "/start")["missing"] == ["roster", "staff", "window"]
    assert get(c, "/diff") == {"ok": True, "diff": None} and get(c, "/flags") == {"ok": True, "flags": None}
    assert post(c, "/form", json={"answers": {"a": "b"}})["ok"] is False  # not at the form gate
    # a roster that is not a workbook fails `prepare`/analyze with a readable, name-free message
    assert upload(c, "roster", "roster.xlsx", b"not a workbook")["ok"]
    assert upload_world_file(c, env, "staff")["ok"]
    prepared = post(c, "/prepare")
    assert prepared["ok"] is True  # prepare reports problems in options.json instead of failing
    window = next(w for w in prepared["options"]["windows"] if w["id"] == WINDOW)
    assert window["enabled"] is False and window["reason"] and not NAME_RE.search(window["reason"])
    assert post(c, "/params", json={"params": {"window": WINDOW}})["ok"] is False  # a disabled window is refused
    assert task_json(c)["state"] == "resting"
