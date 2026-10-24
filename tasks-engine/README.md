# Tasks engine

The local service behind the Tasks app. It discovers the task folders under `tasks/`
(each has a `task.json` manifest and its own scripts), runs their steps as subprocesses,
pauses at the human gates (review, confirm) and serves the endpoints the Tasks app calls
(uploads, prepare, options, params, form, diff, flags, cleanup, history). It holds no
business logic of its own. The manifest keys and endpoint shapes are in
[`../tasks/TASK-PLATFORM-CONTRACT.md`](../tasks/TASK-PLATFORM-CONTRACT.md).

## Running it from the repo

Set up a Python venv once (Python 3.11+; the task scripts also need `tasks/requirements.txt`):

```powershell
python -m venv tasks-engine\.venv
tasks-engine\.venv\Scripts\python.exe -m pip install -r tasks-engine\requirements-dev.txt -r tasks\requirements.txt
```

`pnpm dev` and `pnpm desktop` start the engine for you (the Tasks app calls
`POST /api/tasks-engine/start`). Python is picked in this order: `AI_OS_TASKS_PYTHON`
(path to any interpreter with the two requirements files installed), `tasks-engine/.venv`,
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
| `AI_OS_TASKS_DATA_DIR` | Where run history is kept. Default: `tasks-engine/.data` (gitignored). |
| `AI_OS_TASKS_PYTHON` | Python used to launch the engine (and so every task step). |
| `AI_OS_TASKS_ENGINE_URL` | Set on the UI server to use an engine you started by hand. |

## Tests

```powershell
cd tasks-engine
.venv\Scripts\python.exe -m pytest -q
```

The e2e tests (`tests/test_*_e2e.py`) copy the two real tasks into a temp folder and run them
on synthetic data. They never touch Outlook and never start the real service. If your
temp path is long, pass a short `--basetemp` (Windows paths over 260 characters break the
upload tests).
