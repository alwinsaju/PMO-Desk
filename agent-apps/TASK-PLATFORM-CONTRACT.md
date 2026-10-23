# Task platform contract (inputs, forms, diff gates)

Shared contract between three parts of the Shift Roster / December Disconnect work:
the agent-office backend (extensions), the task scripts (`agent-apps/<task>/scripts`),
and the AI OS Tasks app (`src/components/apps/tasks-app`). All three code against
this file. The existing behavior for the four older tasks and the hard-coded
`review_incidents` gate MUST keep working unchanged.

Conventions already in force: every endpoint replies HTTP 200 with `{ok: bool, reason?: str}`;
scripts are headless (stdin closed, never prompt), pass data via files in the task's
`input/` and `output/`, and use plain args without spaces. `input/`, `output/`, `config/`
are gitignored (real employee data).

## 1. Manifest additions (agent.json)

All optional; tasks without them behave as today.

```json
{
  "id": "shift-roster",
  "displayName": "Shift Roster",
  "runtime": "local",
  "completedMessage": "The final roster and the next-year file are ready in the output folder. The audit log is saved with them.",
  "inputs": [
    {"id": "roster",   "label": "Roster workbook",   "type": "file", "accept": [".xlsx"], "dest": "input/roster.xlsx",          "required": true},
    {"id": "holidays", "label": "Holiday Roster",    "type": "file", "accept": [".xlsx"], "dest": "input/holiday-roster.xlsx",  "required": true},
    {"id": "pto",      "label": "PTO import (optional)", "type": "file", "accept": [".xlsx"], "dest": "input/pto-import.xlsx", "required": false},
    {"id": "cycle",    "label": "Cycle",             "type": "select", "optionsFile": "output/options.json", "optionsKey": "cycles", "required": true}
  ],
  "prepare": {"cmd": "scripts/prepare_options.py", "after": ["roster", "holidays"]},
  "steps": [
    {"id": "analyze",       "type": "python", "cmd": "scripts/analyze.py", "label": "Analyze roster"},
    {"id": "answers",       "type": "review", "label": "Answer questions", "reviewMessage": "Questions are ready for you",
     "gate": {"type": "form", "schema": "output/ask-me.json", "answers": "output/ask-me-answers.json"}},
    {"id": "build_draft",   "type": "python", "cmd": "scripts/build_draft.py", "label": "Build draft"},
    {"id": "review_draft",  "type": "review", "label": "Review the draft in Excel", "reviewMessage": "Draft is ready: edit it in Excel, save, then approve",
     "gate": {"type": "flags", "file": "output/flags.json"}},
    {"id": "diff_draft",    "type": "python", "cmd": "scripts/diff_draft.py", "label": "Compare your edits"},
    {"id": "confirm_diff",  "type": "confirm", "label": "Confirm the changes", "reviewMessage": "Review every changed cell, then confirm",
     "gate": {"type": "diff", "file": "output/roster-diff.json"}},
    {"id": "finalize",      "type": "python", "cmd": "scripts/finalize.py", "label": "Build final roster"}
  ]
}
```

- `runtime: "local"`: the backend runs this task's python/powershell steps with its own subprocess path, never through a Claude-CLI worker.
- `completedMessage` (optional, task level): plain-words body of the task-complete notification, used instead of the legacy "sent it" text.
- `steps[].label` / `reviewMessage` (optional): UI text; the backend uses `reviewMessage` for the review-ready notification instead of the hard-coded text.
- `steps[].gate` (optional, only meaningful on `review` / `confirm` steps): `type` is `form` | `flags` | `diff` | `none`; file paths are relative to the task folder.
- `inputs[].type`: `file` (upload; `accept` extension allow-list; `dest` is under the task's `input/`) or `select` (options come from a JSON file written by the `prepare` script; `optionsKey` names the array in that file).
- `prepare`: a read-only computation script run on demand while the task is `resting`, after the listed inputs exist; it writes `output/options.json`.
- Step ids stay unique. `GET /tasks` exposes `inputs`, `prepare` (bool), `runtime`, and each step's `id`, `type`, `label`, `gate: {type, ...file names}`.

## 2. Backend endpoints (new; all JSON, all `ok`/`reason`)

| Method | Path | Behavior |
|---|---|---|
| GET | `/tasks/{id}/inputs` | `{ok, inputs: [{id,label,type,required,present,filename?,size?,sha256?}], params: {...saved}}` |
| POST | `/tasks/{id}/upload?input=<id>` | multipart field `file`. Only while the task is `resting`. Checks: input exists and is `file`, extension in `accept` (case-insensitive), size <= 50 MB, resolved `dest` stays inside the task's `input/`, atomic write (temp then replace). Returns `{ok, input, filename, size, sha256}`. |
| POST | `/tasks/{id}/prepare` | Only while `resting` and all `after` inputs present. Runs the manifest `prepare.cmd` with the task's python (timeout 120 s, cwd task folder, stdin closed). Returns `{ok, options: <parsed output/options.json>}` or `{ok:false, reason, stderr_tail}`. |
| GET | `/tasks/{id}/options` | `{ok, options: <output/options.json or null>}` |
| POST | `/tasks/{id}/params` | body `{params: {inputId: value}}`. Validates that select values exist in the options file and are `enabled` (an option with `enabled:false` is refused with its `reason`). Writes `input/run-params.json` = `{params, saved_at}`. |
| POST | `/tasks/{id}/start` | UNCHANGED, except: for a task that declares `inputs`, refuse with `{ok:false, reason, missing:[ids]}` when a required `file` input is absent or a required `select` has no saved param. |
| GET | `/tasks/{id}/form` | `{ok, schema: <gate.schema file>, answers: <answers file or {}>, pending: [fieldIds]}` where `pending` = REQUIRED fields without a non-empty answer (a text answer counts after trimming, so whitespace is not an answer; optional fields never pend, with or without a default, so a script must apply an optional field's `default` itself when the key is absent). |
| POST | `/tasks/{id}/form` | body `{answers: {fieldId: value}}`. Validates field ids exist; `select` values must be among option `value`s; a `text` value must be a string (stored TRIMMED, at most 500 characters after trimming, may be empty) else `{ok:false, reason, invalid:[ids]}`; a `null` value deletes that answer. Merges into the answers file (overwrite per key), returns `{ok, pending}`. Only while the task is `awaiting_review` at a `form` gate. |
| POST | `/tasks/{id}/notifications/{notificationId}/open` | EXISTING; opens the notification's file with the OS default app. Optional query `path=<absolute path>` opens that one of the notification's `outputPaths` (the whitelist: the exact listed path, compared after normalisation; anything else is refused with `{ok:false, reason}`); without `path` it opens `outputPath` as before. Either way the file must exist inside the task folder. |
| POST | `/tasks/{id}/approve` | EXISTING route. New generic refusal: at a `form` gate with pending required fields -> `{ok:false, reason, pending}`. (Keep the legacy hard-coded `review_incidents` refusal as is.) |
| GET | `/tasks/{id}/diff` | `{ok, diff: <gate.file contents or null>}` |
| POST | `/tasks/{id}/send` | EXISTING route. New generic refusal: at a `diff` gate when the diff file's `blocking` array is non-empty -> `{ok:false, reason, blocking}`. |
| GET | `/tasks/{id}/flags` | `{ok, flags: <output/flags.json or null>}` |
| GET | `/tasks/{id}/history` | EXISTING; each record gains `approvals: [{step, kind: "approve"|"send", user, at}]` for every task. |

Approver stamp (ALL tasks): `approve` and `send` record `getpass.getuser()` (OS user) and a UTC timestamp on the run; it is written into the run's history record and shown in the Tasks app history tab. Never trust a client-supplied name.

Safety: none of the new endpoints may touch Outlook; `upload`/`form`/`params` must refuse writing anywhere outside the task's own `input/` or `output/` folders; reject path traversal and symlinks. Backend tests follow `test_main.py` (`isolate_state` fixture, TestClient, temp TASKS_ROOT), never the live port, keep coverage >= 80%.

## 3. JSON files written by task scripts (read by backend and UI)

All dates ISO `YYYY-MM-DD`; UTF-8; deterministic key order.

`output/options.json` (written by `prepare_options.py`)
```json
{"roster": {"first_date": "2026-01-02", "last_date": "2027-01-01", "people": 47},
 "cycles": [{"id": "2026-12", "label": "Dec 2026 - Jan 2027", "start": "2026-11-29", "end": "2027-01-30",
             "enabled": true, "reason": "Previous cycle has data (100% of person-weeks covered, needs 95%)", "coverage": 1.0}],
 "default": "2026-12",
 "problems": [{"severity": "error", "message": "..."}]}
```

`output/ask-me.json` (written by `analyze.py`) – the form gate schema
```json
{"title": "Questions for cycle 2026-12",
 "fields": [
   {"id": "shift:<person>", "group": "Ask-me", "label": "<person>", "description": "Current: S3, Mon-Fri", "type": "select",
    "options": [{"value": "KEEP", "label": "Keep current"}, {"value": "S1", "label": "Shift 1"}], "default": "KEEP", "required": true},
   {"id": "pattern:<person>", "group": "Ask-me", "label": "<person> weekly off", "type": "select",
    "options": [{"value": "MON_FRI", "label": "Mon-Fri"}, {"value": "WED_SUN", "label": "Wed-Sun"}], "required": false},
   {"id": "new:<person>", "group": "New people", "label": "<person>", "type": "select",
    "options": [{"value": "new_seat", "label": "New seat"}, {"value": "replaces:<old>", "label": "Replaces <old>"}], "required": true},
   {"id": "pto:<import name>", "group": "PTO matches", "label": "<import name>", "type": "select",
    "options": [{"value": "<roster name>", "label": "<roster name>"}, {"value": "SKIP", "label": "Skip this entry"}], "required": true}
 ]}
```
Answers file `output/ask-me-answers.json` is a FLAT object `{fieldId: value}`; `build_draft.py` converts it to the library's structured answers.
A field's `type` is `select` (needs `options`) or `text` (free text; the app shows an input box with the field's `description` as its placeholder, e.g. `{"id": "avail_dates_1", "group": "Availability exceptions", "label": "...", "description": "YYYY-MM-DD, comma separated", "type": "text", "default": "", "required": false}`). The app also hints (never blocks) when a text field whose description contains `YYYY-MM-DD` holds something that is not a date list; the script does the real validation. Optional fields are not recorded until the user changes them: the script falls back to the field's `default` when its key is absent.

`output/flags.json` (written by `build_draft.py`)
```json
{"counts": {"error": 2, "warning": 14, "info": 65},
 "flags": [{"key": "...", "severity": "error|warning|info", "kind": "HOL_STRAY", "person": "...", "date": "2026-06-23", "message": "..."}]}
```

`output/roster-diff.json` (written by `diff_draft.py`)
```json
{"cycle": "2026-12", "changes": [{"person": "...", "date": "2026-12-08", "before": "Shift-2", "after": "P"}],
 "outside_changes": [{"person": "...", "date": "...", "before": "...", "after": "..."}],
 "issues": [{"severity": "warning|error", "kind": "...", "message": "..."}],
 "blocking": [{"kind": "SNAPSHOT_TAMPERED", "message": "..."}],
 "flags": {"new": [<flag>], "resolved": [<flag>], "remaining": 12}}
```

`output/report-data.json` (the UI's "Open" buttons + summaries)
`workbook_path` may be relative to the task folder (as below); the backend resolves it against the task folder.
```json
{"workbook_path": "output/<file>.xlsx", "stage": "draft|final",
 "extra_paths": [{"label": "Analytics plan", "path": "output/<other>.xlsx"}],
 "summary": {"cycle": "2026-12", "flags": {"error": 2, "warning": 14, "info": 65}, "shift_changes": 14}}
```
`extra_paths` (optional) lists more files the Tasks app offers an Open button for, `[{label, path}]`, `path` task-relative like `workbook_path` (at most 10 entries). The backend puts every file that exists and stays inside the task folder on the review/confirm/completed notification as `outputPaths: [{label, path}]` with ABSOLUTE paths: first `workbook_path` (`label` null, or the label of an `extra_paths` entry naming the same file, so a task may list its main file there too), then the extras (duplicates, missing files, absolute paths outside the task folder and malformed entries are dropped). `outputPath` (the `workbook_path` alone) stays for older clients; `outputPaths` is `[]` when no file is known. The notification's `outputPaths` is the only set of files the open endpoint will launch. A task without `extra_paths` behaves as before (one unlabelled file). Examples: shift-roster final lists `[{"label": "Next-year roster", ...}]` when it built a next-year file; december-disconnect lists `Main plan` and `Analytics plan` at both the draft and the final stage.

## 4. Task-side file layout (shift-roster)

`input/roster.xlsx`, `input/holiday-roster.xlsx`, `input/pto-import.xlsx` (optional), `input/run-params.json`;
`config/rotation-config.json` (gitignored; edited by finalize); `output/` holds options/ask-me/answers/plan/flags/diff JSON, the draft, final, next-year file, `backups/`, `audit/`.

## 5. Out of scope here

Task B (December Disconnect) now runs on this platform (`agent-apps/december-disconnect`, `type: "text"` form fields for availability dates, two workbooks via `extra_paths`).
