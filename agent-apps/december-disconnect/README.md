# December Disconnect task

Builds the winter holiday coverage ("December Disconnect") for one window, by default Fri 25 Dec to
Fri 1 Jan, as two Excel drafts the PMO reviews, and writes the confirmed result as final files:

* the MAIN plan: which PDT team members work which days (on their usual shift) so that every team
  keeps its daily minimum and everybody works 3-5 days;
* the ANALYTICS plan: the 34-slot grid (30 IST slots, 4 Mexico slots) with one person on call every day.

It is deterministic Python on the shared library `../shared/winter_lib` (a MILP solved by HiGHS, the
workbook writers, the audits). There is no LLM judgment in any step. Nothing the PMO provides is
modified: the rosters and both configs are only read.

**Documents.** First run (click path, what to check in Excel, bugs, rollback):
[`../FIRST-RUN-GUIDE.md`](../FIRST-RUN-GUIDE.md). What was decided and what is assumed (including the open items):
[`../DECISIONS-AND-ASSUMPTIONS.md`](../DECISIONS-AND-ASSUMPTIONS.md). Acceptance criteria against test evidence:
[`../ACCEPTANCE.md`](../ACCEPTANCE.md). File and endpoint contract with the Tasks app and the backend:
[`../TASK-PLATFORM-CONTRACT.md`](../TASK-PLATFORM-CONTRACT.md). Library behavior:
[`../shared/winter_lib/README.md`](../shared/winter_lib/README.md).

## How it works

    prepare_options.py          (not a step: runs on demand, fills the window list)
    analyze.py            -> questions the PMO must answer
    [answers gate]        -> the PMO answers a form
    build_draft.py        -> two Excel drafts + flags
    [review_draft gate]   -> the PMO edits both drafts in Excel, saves, approves
    diff_draft.py         -> every changed cell of both files + the audit results
    [confirm_diff gate]   -> the PMO confirms the changed cells
    finalize.py           -> final files, audit log, disconnect days into the Shift Roster config

The manifest is `agent.json` (runtime `local`; inputs, `prepare`, steps and gates as in
`../TASK-PLATFORM-CONTRACT.md`, plus `completedMessage`). `AGENT.md` is the short instruction file for
the runtime. Every script is headless (stdin closed, never prompts), finds the task folder from its own
location (`--task-dir PATH` overrides it for tests), prints a few COUNTS-ONLY progress lines (no person
name is ever printed) and, on failure, ONE `ERROR: <reason>` line on stderr with a non-zero exit code
(`DECEMBER_DISCONNECT_DEBUG=1` adds a traceback). Run them with the venv python:
`..\.venv\Scripts\python.exe scripts\analyze.py`. Shared helpers: `scripts/_common.py`, the comparison
logic shared by the diff and the finalize step: `scripts/_diffing.py`.

## Inputs and where files land

All of `input/`, `output/` and `config/` hold real employee data and are gitignored.

| File | What |
|---|---|
| `input/roster.xlsx` | the shift roster (sheet `PDT Operate`); usual shifts are read from it |
| `input/staff-roster.xlsx` | the PDT staff roster (team per person; a `Team` column and a name column) |
| `input/analytics-a.xlsx`, `input/analytics-b.xlsx` | OPTIONAL monthly Analytics rosters (Oct, Nov): refresh each Analytics person's usual shift; without them `config/analytics-config.json` is used as is |
| `input/run-params.json` | `{"params": {"window": "2026-12-25..2027-01-01"}}`, written by the app |
| `config/winter-config.json` | the main plan's rules (see "Rules"); a yearly input, kept by hand |
| `config/analytics-config.json` | the Analytics people, roles, slot grid, weights |
| `config/task-config.json` | OPTIONAL: `{"shift_roster_config": "<path>"}`, where the Shift Roster task keeps `rotation-config.json` (default `../shift-roster/config/rotation-config.json`; relative paths are relative to this task). It is its own file because `winter_lib` rejects unknown keys in the winter config |
| `output/options.json` | the window list (`prepare_options.py`) |
| `output/ask-me.json`, `output/ask-me-answers.json` | the form and the flat answers |
| `output/analysis.json` | the window, the sha256 of every input, counts, answer-conversion info |
| `output/Winter Coverage DRAFT <window>.xlsx` (+ `.snapshot.json`) | the main plan draft |
| `output/Analytics Winter Coverage DRAFT <window>.xlsx` (+ `.snapshot.json`) | the Analytics plan draft |
| `output/plan.json`, `output/analytics-plan.json` | both plans (deterministic) |
| `output/winter-config.effective.json`, `output/analytics-config.effective.json` | the configs the plans were built with (the real configs + the PMO's answers) |
| `output/draft-meta.json` | file names, plan hashes, roster names: what the diff step needs |
| `output/flags.json`, `output/roster-diff.json`, `output/report-data.json` | what the app shows |
| `output/previous-plan.json`, `output/previous-analytics-plan.json` | the plans of the previous run (stability reference) |
| `output/archive/<UTC time>/` | earlier drafts, kept when a run is repeated |
| `output/final/Winter Coverage FINAL <window>.xlsx` | the final main plan |
| `output/final/Analytics Winter Coverage FINAL <window>.xlsx` | the final Analytics plan |
| `output/audit/<run id>.json`, `audit.log.jsonl` | who approved which cells (append-only) |

Clean-up: `agent.json` has `"cleanup": {"onComplete": true}`. After a SUCCESSFUL run the backend deletes this task's `input/` files (the uploaded rosters and `run-params.json`; dotfiles and any `cleanup.keep` path stay), so the next run asks for fresh uploads. The stale `output/options.json` is cleared too; `config/` and the rest of `output/` (the finals and the audit log) are never touched; a failed or abandoned run keeps its input.

`<window>` reads like `2026-12-25 to 2027-01-01`. The Tasks app shows one Open button per workbook:
`report-data.json` lists both files in `extra_paths` (`[{"label": "Main plan", "path": ...},
{"label": "Analytics plan", "path": ...}]`, task-relative, draft files at the draft stage and the finals
after `finalize.py`); `workbook_path` stays the main plan. The Analytics workbook is also named in the flags
(`ANALYTICS_DRAFT_FILE`), in `summary.analytics_workbook_path` and in the final `summary.message`.

## The scripts

**`prepare_options.py`** (read-only) writes `output/options.json`: roster and staff counts, the
Analytics config counts and ONE window, the one in `winter-config.json` (`id` `2026-12-25..2027-01-01`,
`label`, `start`, `end`, `days`, `enabled`, `reason`, `lookback`) plus `problems`. The window is
disabled (with the reason, shown on hover) while a config is missing or invalid, a roster is unreadable,
the two configs disagree on the window, or the shift roster has no data in the lookback (the months before
the window). Expected problems are reported and the script still exits 0.

**`analyze.py`** removes the derived files of an earlier run (answers, plans, flags, diff, report data,
effective configs: stale answers must never satisfy a new form), keeps the previous plans as the
stability reference, merges the staff roster and the shift roster (`winter_inputs.build_inputs`) and
writes the form and `analysis.json`. It exits non-zero when the window cannot be built.

**`build_draft.py`** refuses to run when an input changed since the analysis, converts the answers
(strict: unknown ids, values outside the options, unanswered required questions and bad dates stop the
step with kinds and counts, never names), merges them into COPIES of the configs, solves both plans and
writes everything listed above. A re-run first ARCHIVES the earlier drafts into `output/archive/`, then
re-solves the main plan with stability against the previous plan. Same inputs and answers give the same
plans and flags.

**`diff_draft.py`** compares EACH saved workbook with its snapshot (the hidden `_snapshot` sheet
cross-checked with the sidecar file and with the plan the draft step wrote), re-runs both audits on the
saved files (Excel-resaved files work: the tables are found by their header text) and writes
`output/roster-diff.json` per the contract:

* `changes`: `{person, date, before, after}`. Main plan: the team member and the Winter Plan cell text
  (`""` = not working). Analytics: `person` is `Analytics <slot label>` (`Analytics S2-A`,
  `Analytics On call`), `before`/`after` are the assigned names.
* `blocking`: audit ERRORS in either file (kinds `WINTER_*` / `ANALYTICS_*`), `SNAPSHOT_TAMPERED`,
  `SNAPSHOT_MISSING`, `DRAFT_MISSING`, `DRAFT_UNREADABLE`, `PERSON_MISSING`, `INPUT_CHANGED`,
  `CONFIG_CHANGED`, `PLAN_CHANGED`, `FILE_CHANGED` (the file changed while it was compared).
* `flags`: `new` / `resolved` / `remaining` compare the audit findings (errors and warnings) of
  `flags.json` with the audits of the saved files; `remaining` also counts the plan-time flags that cannot
  be re-checked (`not_rechecked`).
* extras: `saved_drafts` with the sha256 of both files, `counts`, `audits`, `snapshot_sources`.

It exits 0 whenever a comparison could be made, also with blocking issues and also when a draft file is
missing (that is a blocking row); it exits non-zero only when it cannot compare at all.

**`finalize.py`** refuses unless no input changed, the confirmed diff has no blocking issue, BOTH saved
drafts are byte for byte the files the PMO confirmed (sha256) and a fresh comparison (both audits, the
snapshots) shows no blocking issue and the same changes. It then copies each saved draft unchanged to
`output/final/` (formulas intact, nothing regenerated), writes the audit entry (`roster_lib.audit`
conventions: the OS user as approver, sha256 of every input and output, the confirmed diff), updates the
Shift Roster config (below) and writes `report-data.json` (`stage: final`). Running it again is safe.

## Rules

### Main plan (`config/winter-config.json`)

Everything below is configuration, never code. The schema is documented in
`../shared/winter_lib/winter_config.py`; `../shared/winter_lib/examples/winter_config.example.json` is a
synthetic example.

* **Window.** `window.start` / `window.end` (inclusive), `holidays` (day labels, Dec 25 and Jan 1),
  `fair_days` (the holiday/weekend days that should be spread fairly).
* **Minimum staffing per team.** `teams[]` with `min_per_day` (DIS 2, DEP 2, CMS 2.0 1, LNS 2.0 1,
  Integration HUB 1 in the real config). A shortfall is penalised heavily and reported, never silently
  accepted: a rule the data makes impossible is an error flag with a count-based reason.
* **3-5 days.** Everybody works at least `rules.min_days` (3) and at most `rules.max_days` (5) days, on
  their USUAL shift, one slot per person per day. The 4th and 5th day cost extra and are only added when a
  team needs the slot.
* **Best-effort teams.** `best_effort: true` teams (L3, Device Support, Lab, EKS, R&D, ...) have no minimum;
  a day with nobody is a warning (`WINTER_BEST_EFFORT_GAP`), never an error. Their members work at most
  `rules.best_effort_max_days` (3) days: they never get extra days.
* **Lanes and sub-teams.** For teams of 5+ people with a lane (Morning / Evening / Night-US by IST start of
  the usual shift) of 3+ people, an uncovered lane on a day is penalised; so is an uncovered sub-team
  (Complaints, Loyalty).
* **Fairness.** Each person should have 1-2 of the `fair_days` (Dec 25, 26, 27, Jan 1); one contiguous
  block of days is preferred.
* **Usual shift.** The modal working shift over the `lookback_months` (4) before the window; `shift_overrides`
  beat history.
* **Weights** (`weights` in `winter-config.json`, the defaults are what the real file uses):

  | Term | Default |
  | --- | --- |
  | required-team shortfall, per missing head | 1000 x day weight |
  | best-effort team with nobody on a day | 100 x day weight |
  | 4th / 5th day of a person (`extra_day`) | 400 / 600 |
  | lane uncovered (`lane`) | 60 x day weight |
  | sub-team uncovered (`subteam`) | 40 x day weight |
  | person without 1-2 fair days (`fairness`) | 5 per day |
  | extra contiguous block (`block`) | 1 |
  | changed person-day when re-solving (`stability`) | 30 |
  | person below 3 days, only when availability forces it (`days_shortfall`) | 5000 per day |

  Day weights: weekday 3, holiday 2, weekend 1 (`weights.day_weight`). To change how hard a rule is pushed,
  edit the number in `config/winter-config.json` and run the task again; to change a team's minimum edit its
  `min_per_day`. The MILP is deterministic (HiGHS, seed `solver.seed`, tie-break by a hash).
* **New people** (no shift history in the lookback and no override): the form asks for each one's shift
  (default `default_new_person_shift` from the config, `S1` when unset). The answer is recorded as source
  `answer` and flagged `WINTER_SHIFT_ASSUMED`.
* **Exclusions.** `exclusions.team_patterns` (Leadership, Governance, PMO, Analytics), `exclusions.people`
  and `exclusions.name_patterns`. **Rolled-off people** must be listed in `exclusions.people`: the staff
  roster's roll-off column is a placeholder (one date for almost everybody), so it is read but NOT used.
* **Availability exceptions.** From the config (`availability`: `unavailable` dates or `allowed` dates per
  person) and from the form (up to 5 rows: person, dates, "not available on" / "available ONLY on"). The
  form's rows are merged into the effective copy of the config, never into the real file. A person who is
  unavailable is never planned that day; when that makes 3 days impossible, the audit reports a warning,
  not an error.
* **Names.** Staff roster and shift roster names are matched exactly, by the same words in any order, via
  `name_aliases`, then by a conservative same-team fuzzy rule. Every fuzzy match is a form question
  (`name:<staff name>`): confirm = same person (becomes an alias for this run), SKIP = the staff person is
  not scheduled. People only on one roster are warnings.

### Analytics plan (`config/analytics-config.json`)

* **34 slots**: 30 IST slots (S1 08:00, S2 11:00, S3 14:00) and 4 Mexico slots (S4 22:00 IST, Dec 28-31),
  an explicit `slots` list in the real config (the default generator is described in the library README).
* **On call**: exactly one person on call every day; the two on-call people take 4 days each and one slot;
  nobody works a slot on their own on-call day.
* **Mexico slot**: only the person with role `mexico`.
* **Counts**: every support person works 4 slots (fewer when availability forbids). When the standard counts
  do not add up to the 34 slots, the missing slot(s) go to the best-fitting eligible person (EXTRAS); each
  extra is explained in plain English as an INFO flag (`ANALYTICS_NOTE`) and in the workbook.
* **Soft preferences** (`weights`): usual shift (S1-S2-S3 distance), 1-2 holiday/weekend duty days, contiguous
  blocks, no S3 followed by S1.
* **Usual shifts** are refreshed from the uploaded Oct/Nov rosters (the modal S1-S3 shift; people, roles and
  the on-call / Mexico assignments stay as configured). The analytics lead who is not on last year's list is
  not in the config, so is excluded.
* **Exceptions** from the form (up to 3 rows, same shape) become explicit `available` date lists in the
  effective copy.

## The form and the answers

`output/ask-me.json` is `{"title", "fields": [...]}` with `id`, `group`, `label`, `description`, `type`
(`select` or `text`), `options` (`value`, `label`), `required`, `default`. The answers file is a FLAT
`{fieldId: value}`; `build_draft.py` is strict.

| Field id | Group | Required | Values |
|---|---|---|---|
| `shift:<person>` | New people | yes (default = `default_new_person_shift`, else `S1`) | `S1`..`S5`, `NS`, `US-CST`, `US-PST`, `11AM-8PM`, `MX-8-5` |
| `name:<staff name>` | Name matches | yes | the shift-roster name, or `SKIP` |
| `avail_person_<n>`, `avail_dates_<n>`, `avail_mode_<n>` (n = 1..5) | Availability exceptions | no | person or `NONE`; `YYYY-MM-DD,YYYY-MM-DD` (ranges `YYYY-MM-DD..YYYY-MM-DD` work too); `unavailable` / `only_available` |
| `aavail_person_<n>`, `aavail_dates_<n>`, `aavail_mode_<n>` (n = 1..3) | Availability exceptions | no | the same for the Analytics plan (Analytics people by their short name) |

## Review and confirm

The draft is a normal Excel file: the PMO fixes cells in the main plan's `Winter Plan` grid (a dropdown
offers the shift codes) and in the Analytics `Winter Roster` (`Assigned` dropdown), saves BOTH files under
the same names and approves. The other tabs recalculate from those cells. Flags are never auto-fixed.

`diff_draft.py` then lists every changed cell. If the diff has `blocking` rows the confirm gate refuses.

**Limitation.** A blocked confirm step cannot be repaired in place. If the audit errors came from the PMO's
edits, or a file was damaged, the PMO must start over (the Tasks app's "Start over" button next to the blocked Confirm, i.e. Reset) and run the task again from the start. The re-run
archives the old drafts (the PMO's edits stay readable in `output/archive/`), re-solves, and re-solves the
main plan with stability against the previous plan, so people whose days were fine keep them (the Analytics
solver has no stability term; it is deterministic, so unchanged inputs give the same plan). The new drafts do
NOT contain the PMO's manual edits: re-apply the ones that are still wanted, or put them into the form as
availability exceptions.

The hidden `_snapshot` sheet and the `.snapshot.json` sidecar record what the draft step wrote; the final
files keep the original snapshot (they are copies of the saved drafts), so they are not meant to be diffed again.

## The Shift Roster task and the disconnect days

When the final files are written, `finalize.py` adds the disconnect days, window start + 1 .. window end - 1
(the days strictly between the two holidays: 26-31 Dec in 2026), to `disconnect_windows` in the Shift Roster
task's `config/rotation-config.json`, unless they are already covered (windows that overlap or touch are
merged). A timestamped, hash-verified copy of the old file goes to that task's `config/backups/`. This is how
the Shift Roster task learns to ignore those days (holiday engine, HOL check, counters). The target path is
`shift_roster_config` in `config/task-config.json`; an absent file is skipped with an info note, an
unreadable one stops the step before anything is written. The Shift Roster task is never run or edited.

## Changing the config

The rules are data, never code. Edit the config between runs (the app does not edit it), then start a new run;
changing a config after the analysis makes `build_draft.py` refuse ("changed since the analysis").

**Examples** (synthetic, tracked) in `../shared/winter_lib/examples/`: `winter_config.example.json` (every key of
`config/winter-config.json`) and `analytics_config.example.json` (every key of `config/analytics-config.json`).
The schema and validation rules are the module docstrings of `winter_config.py` and `analytics_config.py`; an
invalid config is reported with every problem at once (no person is named in the message).

| To change | Edit |
|---|---|
| the window (another year or period) | `window.start` / `window.end` in `winter-config.json` AND `window` in `analytics-config.json` (both must agree, otherwise the window is disabled), plus `holidays` and `fair_days` |
| a team's daily minimum | `teams[].min_per_day`; `best_effort: true` removes the minimum |
| minimum / maximum days per person | `rules.min_days`, `rules.max_days`, `rules.best_effort_max_days` |
| how hard a rule is pushed | `weights` (see the table under Rules) |
| a rolled-off or excluded person | `exclusions.people`; whole teams: `exclusions.team_patterns` |
| a person's usual shift | `shift_overrides` (`{name: shift}`) |
| a spelling difference between the rosters | `name_aliases` (`{staff name: shift roster name}`) |
| the default shift of people with no history | `default_new_person_shift` |
| a person who cannot work certain days | `availability` (`unavailable` or `allowed` dates per person), or the form |
| the Analytics people, roles, on-call and Mexico assignments, slots | `analytics-config.json`: `people[]`, `slots`, `slots_per_person`, `on_call_slots_each`, `weights` |
| where the Shift Roster config lives (for the disconnect-day update) | `config/task-config.json` (`shift_roster_config`) |

## Decisions and assumptions

The full list, with who decided each point and the open items, is in
[`../DECISIONS-AND-ASSUMPTIONS.md`](../DECISIONS-AND-ASSUMPTIONS.md). In short:

* People with no shift history get a shift through the form; the default answer is the config's
  `default_new_person_shift` (S1 in the real config) and every such answer is flagged. Configurable.
* Fuzzy name matches are confirmed through the form, never accepted silently.
* The staff roster's roll-off column is unusable (a placeholder), so rolled-off people are listed explicitly
  in `exclusions.people`.
* The Analytics lead who is not on last year's list is not in the Analytics config and is excluded.
* The main plan's headcount per day follows the spec weights (day weights 3 / 2 / 1, shortfall 1000, ...);
  there is no extra balance term that evens the headcount out across days.
* The window is a configuration input: change `window` in BOTH configs to build another year or period.
* The Analytics solver has no stability term (the library has none); the main plan has one.
* `shift_roster_config` lives in `config/task-config.json`, not in the winter config, because `winter_lib`
  validates the winter config strictly.
* A draft file that was edited in Excel keeps formulas; Excel recalculates them on open. Neither Excel nor
  LibreOffice was available when the library was written, so open each final file once in Excel to confirm
  (see "Tests and limitations" in the library README).

## Tests

`..\.venv\Scripts\python.exe -m pytest -q` from this folder. Synthetic data only (the winter_lib sample
builders); the pipeline tests run every script's `main()` in order, the subprocess test runs them headless
with `--task-dir`, and the real-file smoke test (counts only, on COPIES, skipped when the gitignored
reference files or configs are absent) checks 34 of 34 Analytics slots and zero audit errors on the main plan.
