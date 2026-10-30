# Tasks engine

The local service behind the Tasks app. It discovers the task folders under `tasks/`
(each has a `task.json` manifest and its own scripts), runs their steps as subprocesses,
pauses at the human gates (review, confirm) and serves the endpoints the Tasks app calls
(uploads, prepare, options, params, form, diff, flags, cleanup, history). It holds no
business logic of its own. The manifest keys and endpoint shapes are in
[`../tasks/TASK-PLATFORM-CONTRACT.md`](../tasks/TASK-PLATFORM-CONTRACT.md).

## Running it from the repo

Set up a Python venv once, from the same hash-locked packages the installer ships (Python 3.11+):

```powershell
python -m venv tasks-engine\.venv
tasks-engine\.venv\Scripts\python.exe -m pip install --require-hashes -r scripts\python-runtime\requirements.lock.txt
tasks-engine\.venv\Scripts\python.exe -m pip install -r tasks-engine\requirements-dev.txt
```

`pnpm dev` and `pnpm desktop` start the engine for you (the Tasks app calls
`POST /api/tasks-engine/start`). Python is picked in this order: `AI_OS_TASKS_PYTHON`
(path to any interpreter with the packages above installed), `tasks-engine/.venv`,
then `pythonw`/`python` on PATH.

The engine listens on **127.0.0.1 only**, on the port it is given: `python main.py --port N`.
The launcher takes the first free port from 8000 to 8019 and tells the UI where it is
(`GET /api/tasks-engine/config`); nothing is hardcoded. `GET /health` answers
`{"ok": true, "service": "tasks-engine"}` so the launcher can tell it from any other process.

To run it by hand: `cd tasks-engine` then `python main.py --port 8123`, and set
`AI_OS_TASKS_ENGINE_URL=http://127.0.0.1:8123` for the UI server so it uses that engine
instead of starting its own.

## Settings

| Variable | Meaning |
| --- | --- |
| `AI_OS_TASKS_DIR` | Folder holding the task folders and `shared/`. Default: `../tasks`. |
| `AI_OS_TASKS_DATA_DIR` | Switches on the working copy (see below): tasks run from `<dir>/tasks`, history is `<dir>/history.jsonl`. Unset (the default from the repo): tasks run in place and history is `tasks-engine/.data/history.jsonl` (gitignored). The installed app sets it to a `tasks-engine` folder inside its app-data folder. |
| `AI_OS_TASKS_PYTHON` | Python used to launch the engine (and so every task step). The installed app points it at the Python it bundles. |
| `AI_OS_TEMPLATES_DIR` | Folder holding the Template library's `library.json`. The UI server sets it for the engine it launches (default: `templates` inside the PMO data folder); the mail tasks read their subject, recipients and message from it through `tasks/shared/template_lib`. Unset or empty library = each task's own wording. |
| `AI_OS_TASKS_ENGINE_URL` | Set on the UI server to use an engine you started by hand. |

## Data and the installed app

The installed task folders are read-only. With `AI_OS_TASKS_DATA_DIR` set, `workcopy.py` keeps a
working copy under that folder and the engine runs tasks from it: task definitions (`task.json`,
`scripts/`, `templates/`, `shared/`) are refreshed from the install on every start, while `input/`,
`output/`, `reference/` and `config/` (seeded once from the shipped defaults) are never overwritten.
A reinstall therefore keeps everyone's work. See `../tasks/TASK-PLATFORM-CONTRACT.md`.

`shared/` is mirrored exactly too (stale code is removed on every start), with one exception: the
user data that lives in it. The installer does not ship it, so the mirror must not delete it. The
rule is `workcopy.is_protected_shared()`: a file under `shared/` is **protected** (never overwritten,
never deleted) when its first folder is `roster` or `roster-reference` and its name ends in
`.xlsx`, `.xlsm`, `.xls`, `.csv` or `.json`, at any depth. That covers `shared/roster/Names.xlsx`
and the Holiday Roster and other reference workbooks in `shared/roster-reference/`. Matching ignores
case and accepts `/` and `\`. Python modules, READMEs and everything else in those folders, and all
of the rest of `shared/`, stay mirrored exactly. Task `templates/` are not protected (they hold
shipped templates only). To protect another kind of file, extend `PROTECTED_SHARED_DIRS` or
`PROTECTED_SHARED_EXTS` in `workcopy.py`.

The Python the installed app runs the engine and every task step with is built by
`../scripts/build-python-runtime.py` (a pinned embeddable CPython plus the hash-locked wheels in
`../scripts/python-runtime/requirements.lock.txt`).

## Tests

```powershell
cd tasks-engine
.venv\Scripts\python.exe -m pytest -q
```

The e2e tests (`tests/test_*_e2e.py`) copy the two real tasks into a temp folder and run them
on synthetic data. They never touch Outlook and never start the real service. If your
temp path is long, pass a short `--basetemp` (Windows paths over 260 characters break the
upload tests).
