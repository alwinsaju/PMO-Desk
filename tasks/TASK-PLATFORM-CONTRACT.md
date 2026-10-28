# Task platform contract (inputs, forms, diff gates)

Shared contract between three parts of the Shift Roster / December Disconnect work:
the Tasks engine (`tasks-engine/`), the task scripts (`tasks/<task>/scripts`),
and the AI OS Tasks app (`src/components/apps/tasks-app`). All three code against
this file. The existing behavior for the four older tasks and the hard-coded
`review_incidents` gate MUST keep working unchanged.

Conventions already in force: every endpoint replies HTTP 200 with `{ok: bool, reason?: str}`;
scripts are headless (stdin closed, never prompt), pass data via files in the task's
`input/` and `output/`, and use plain args without spaces. `input/`, `output/`, `config/`
are gitignored (real employee data).

**Where the files live.** In the repo a task runs in place (`tasks/<task>/`). In the installed
app the task folders are read-only, so the engine runs every task from a working copy at
`<app data>\tasks-engine\tasks\<task>\` (`tasks-engine/workcopy.py`, switched on by
`AI_OS_TASKS_DATA_DIR`). At every engine start the definition files (`task.json`, `scripts/`,
`templates/`, docs, everything in `shared/`) are mirrored from the install, and the task's data is
left alone: `input/`, `output/`, `reference/` and `config/` are never overwritten or deleted
(`config/` and `reference/` are seeded once from the shipped defaults; `input/`, `output/` and `config/` are always created, empty if need be), so a reinstall keeps the
user's work, the persisted inputs and the audit logs. The run history is
`<app data>\tasks-engine\history.jsonl` and starts empty on a new machine. Every path in a manifest
or a task script (`dest: input/...`, `optionsFile: output/...`, `../shared`, `../shift-roster/config`)
is relative to the task folder as the engine sees it, so none of this changes a manifest or a script.
In the repo too, the engine creates a task's `input/`, `output/` and `config/` folders (and the folders its manifest paths, such as an input `dest` or a gate file, live in) when it discovers the task and again before every step, prepare and upload, because those folders are gitignored and a script may write into `output/` without creating it.

## 1. Manifest additions (task.json)

All optional; tasks without them behave as today.

```json
{
  "id": "shift-roster",
  "displayName": "Shift Roster",
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

- `completedMessage` (optional, task level): plain-words body of the task-complete notification, used instead of the legacy "sent it" text.
- `steps[].label` / `reviewMessage` (optional): UI text; the engine uses `reviewMessage` for the review-ready notification instead of the hard-coded text.
- `steps[].gate` (optional, only meaningful on `review` / `confirm` steps): `type` is `form` | `flags` | `diff` | `none`; file paths are relative to the task folder.
- `inputs[].type`: `file` (upload; `accept` extension allow-list; `dest` is under the task's `input/` (per-run files), under its `config/` or `reference/` (settings and reference files that outlive runs; use `persist: true`), or under `shared/roster/` / `shared/roster-reference/` for a file several tasks read, e.g. `shared/roster/Names.xlsx`; a shared file is one copy for every task that declares it; none of these except `input/` is ever touched by cleanup) or `select` (options come from a JSON file written by the `prepare` script; `optionsKey` names the array in that file).
- `prepare`: a read-only computation script run on demand while the task is `resting`, after the listed inputs exist; it writes `output/options.json`.
- Step ids stay unique. `GET /tasks` exposes `inputs` (each entry also carries `persist`, always a boolean), `prepare` (bool), `cleanup` (the normalised manifest object or `null`), and each step's `id`, `type`, `label`, `gate: {type, ...file names}`.
- `inputs[].persist` (optional, `true` only; default false): the file is **kept on file** across runs (e.g. the Holiday Roster, which is also `required: false` and then falls back to a reference file; the app shows it as "on file" with its `modified` date, and the task's scripts must treat it as read-only and may check its coverage themselves, e.g. `prepare_options.py` disables a cycle whose calendar year has no row in it). It stays after a run, is never removed by cleanup (automatic or manual), and the `required` check is satisfied while the file exists. Re-uploading replaces it atomically like any other upload; if the input is listed in `prepare.after`, the existing rule still applies (options and saved select params are invalidated). An optional kept file (`required: false`) is left out of `prepare.after` so it never gates Check inputs or Start; the Tasks app shows an "Optional" tag and, while it is absent, "Not uploaded - the reference file will be used.", re-runs an earlier Check when it is uploaded, and shows options.json's optional `holiday_source` (`kind` `uploaded|reference`, `file`, `covers_years`) as a quiet line under the Check.
- `cleanup` (optional, task level; absent = no cleanup, so tasks without it behave exactly as before): `{"onComplete": true, "keep": ["input/some-relative-path", ...]}`. `onComplete` must be exactly `true` to clean after runs (anything else, or an empty object, means manual cleanup only); `keep` lists paths relative to the task folder under `input/` (a file, or a folder to keep whole), matched case-insensitively; unsafe entries (`..`, absolute, drive letters, outside `input/`) never match anything. A task that declares `cleanup` must mark its main weekly/monthly upload `required: true` (after a cleanup the next run needs a fresh upload). `config/` and `output/` (apart from the stale options file below) are never touched, and a failed or abandoned run keeps its input so it can be retried.
  - When a run finishes SUCCESSFULLY (outcome `completed`, task back to `resting`; every step type, including runs ended by a `confirm`/send) the engine deletes the task's input files: every regular file under `input/` (recursively, then the now-empty subfolders) EXCEPT inputs flagged `persist`, `cleanup.keep` paths, dotfiles (`.gitkeep`) and anything that is a symlink/junction (never followed or deleted through; skipped and counted). It also deletes `input/run-params.json`, the `input/.uploads-meta.json` entries of removed files (the file itself when it ends up empty) and the stale prepare options file (the manifest options file, `output/options.json` by default - only for tasks that declare `prepare` or a `select` input). It NEVER deletes anything else under `output/` (finals, drafts, audit logs, backups stay).
  - Failed runs, `reset` and `reject` do not trigger cleanup, and input is never deleted while a run is in progress.
  - A file that cannot be deleted (e.g. open in Excel on Windows) is skipped and counted in `skipped`; the run's outcome stays `completed`.
  - The run's history record gains `cleanup: {"removed": n, "bytes": n, "skipped": n}` (counts only, no file names; the key is absent for tasks without `cleanup.onComplete`). When the run has a completion notification, its body gains a trailing " Cleaned up N input file(s) (12.4 MB)." (and " N input file(s) could not be removed (open in another program?)." when `skipped` > 0); the legacy/`completedMessage` text is otherwise unchanged. A run whose last step is the `confirm` has no completion notification (as before) but still cleans and records.

## 2. Tasks engine endpoints (all JSON, all `ok`/`reason`)

| Method | Path | Behavior |
|---|---|---|
| GET | `/health` | `{ok: true, service: "tasks-engine", instance: <AI_OS_ENGINE_INSTANCE or null>}`. The identity probe the launcher uses to tell the engine from any other process on a port (and to adopt only the engine it launched). Request guard on every route: the `Host` header must be loopback (403 otherwise); a non-GET request carrying an `Origin` must come from a loopback page; and when `AI_OS_ENGINE_TOKEN` is set every request except `GET /health` and CORS preflights must send it in `X-AI-OS-Token` (403 otherwise). |
| GET | `/tasks/{id}/inputs` | `{ok, inputs: [{id,label,type,required,persist,present,modified,filename?,size?,sha256?}], params: {...saved}, cleanable: {files, bytes}}`. `persist` is a boolean; `modified` is the file's ISO-8601 UTC mtime (e.g. `2026-10-23T08:15:02.123456+00:00`), `null` when the input is absent (always `null` for `select` inputs); `cleanable` counts what a cleanup would remove right now (zeros when the task has neither `cleanup` nor inputs), so the UI can show "Clear input files (3 files, 12 MB)". |
| POST | `/tasks/{id}/cleanup` | Clears the task's input files on demand with exactly the same rules and exclusions as the after-run cleanup. Only while `resting` (refused while running / awaiting / erroring, and while a prepare is running). Available for any task that declares `cleanup` OR any `inputs`; a task with neither replies `{ok:false, reason:"Nothing to clean"}`. Reply `{ok, removed, bytes, skipped}`. Does not write a history record (it is not a run). |
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
| GET | `/tasks/{id}/draft-summary` | `{ok, summary: {to:[str], cc:[str], subject:str, attachments:[fileName]} \| null}` for the 'Confirm & send' dialog. Read-only; reads ONLY `output/email-data.json` and returns just those whitelisted keys (`to` / `cc`: a `;`-separated string or a list of display-name + address strings; `attachments`: paths reduced to file names), strings trimmed and capped at 300 characters, lists at 50 entries. `null` when the file is missing, unreadable, not an object, or has neither `to` nor `cc`. Mail tasks' `build_email_data.py` write these keys; `create_draft.ps1` builds the Outlook draft from the same values. |
| GET | `/tasks/{id}/history` | EXISTING; each record gains `approvals: [{step, kind: "approve"|"send", user, at}]` for every task, and, for tasks with `cleanup.onComplete`, `cleanup: {removed, bytes, skipped}` on completed runs. |

Approver stamp (ALL tasks): `approve` and `send` record `getpass.getuser()` (OS user) and a UTC timestamp on the run; it is written into the run's history record and shown in the Tasks app history tab. Never trust a client-supplied name.

Safety: none of the new endpoints may touch Outlook; cleanup deletes only regular files below the task's `input/` (plus the stale options file), through lstat/realpath checks that never follow a symlink or junction; `upload`/`form`/`params` must refuse writing anywhere outside the task's own `input/` or `output/` folders; reject path traversal and symlinks. Backend tests follow `test_main.py` (`isolate_state` fixture, TestClient, temp TASKS_ROOT), never the live port, keep coverage >= 80%.

## 3. JSON files written by task scripts (read by the engine and UI)

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
`workbook_path` may be relative to the task folder (as below); the engine resolves it against the task folder.
```json
{"workbook_path": "output/<file>.xlsx", "stage": "draft|final",
 "extra_paths": [{"label": "Analytics plan", "path": "output/<other>.xlsx"}],
 "summary": {"cycle": "2026-12", "flags": {"error": 2, "warning": 14, "info": 65}, "shift_changes": 14}}
```
`extra_paths` (optional) lists more files the Tasks app offers an Open button for, `[{label, path}]`, `path` task-relative like `workbook_path` (at most 10 entries). The engine puts every file that exists and stays inside the task folder on the review/confirm/completed notification as `outputPaths: [{label, path}]` with ABSOLUTE paths: first `workbook_path` (`label` null, or the label of an `extra_paths` entry naming the same file, so a task may list its main file there too), then the extras (duplicates, missing files, absolute paths outside the task folder and malformed entries are dropped). `outputPath` (the `workbook_path` alone) stays for older clients; `outputPaths` is `[]` when no file is known. The notification's `outputPaths` is the only set of files the open endpoint will launch. A task without `extra_paths` behaves as before (one unlabelled file). Examples: shift-roster final lists `[{"label": "Next-year roster", ...}]` when it built a next-year file; december-disconnect lists `Main plan` and `Analytics plan` at both the draft and the final stage.

## 4. Task-side file layout (shift-roster)

`input/roster.xlsx`, `input/holiday-roster.xlsx`, `input/pto-import.xlsx` (optional), `input/run-params.json`;
`config/rotation-config.json` (gitignored; edited by finalize); `output/` holds options/ask-me/answers/plan/flags/diff JSON, the draft, final, next-year file, `backups/`, `audit/`.

## 5. Out of scope here

Task B (December Disconnect) now runs on this platform (`tasks/december-disconnect`, `type: "text"` form fields for availability dates, two workbooks via `extra_paths`).
