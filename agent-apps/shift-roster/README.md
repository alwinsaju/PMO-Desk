# Shift Roster task

Builds the shift roster for one two-month cycle and writes the approved result as a new
file. It is deterministic Python on the shared library `../shared/roster_lib` (rotation, PTO,
fair holiday offs, checks, draft/diff/final workbook writing). There is no LLM judgment in
any step. The master roster is never modified.

    prepare_options.py          (not a step: runs on demand, fills the cycle list)
    analyze.py            -> questions the user must answer
    [answers gate]        -> the user answers a form
    build_draft.py        -> an Excel draft + flags
    [review_draft gate]   -> the user edits the draft in Excel, saves, approves
    diff_draft.py         -> every changed cell + the flag changes
    [confirm_diff gate]   -> the user confirms the changed cells
    finalize.py           -> final roster, backup, audit log, next-year file, new config

The manifest is `agent.json` (runtime `local`; inputs, `prepare`, steps and gates as in
`../TASK-PLATFORM-CONTRACT.md`). `AGENT.md` is the short instruction file for the runtime.
The optional top-level `completedMessage` is the plain-words body of the task-complete notification
(it says the final roster, the next-year file when there is one, and the audit log are ready in the
output folder). `workbook_path` in `output/report-data.json` is relative to the task folder.

## Inputs and where files land

All of `input/`, `output/` and `config/` hold real employee data and are gitignored.

| File | What |
|---|---|
| `input/roster.xlsx` | the master roster (sheet `PDT Operate`); only ever read |
| `input/holiday-roster.xlsx` | the Holiday Roster (Holiday name, Date, one column per location; `X` = off) |
| `input/pto-import.xlsx` | optional PTO import (Name, From, To, Code P/T/SL) |
| `input/run-params.json` | `{"params": {"cycle": "2026-12"}}`, written by the app |
| `config/rotation-config.json` | rotation categories, staffing minimums, disconnect windows |
| `config/backups/rotation-config.<UTC time>.json` | the config as it was before each finalization |
| `output/options.json` | the cycle list (`prepare_options.py`) |
| `output/ask-me.json`, `output/ask-me-answers.json` | the form and the flat answers |
| `output/analysis.json` | the cycle, the sha256 of every input, availability, answer-conversion info |
| `output/plan.json` | the whole plan (`Plan.to_json()`, deterministic) |
| `output/Roster DRAFT <cycle>.xlsx` (+ `.snapshot.json`) | the draft the user edits |
| `output/flags.json`, `output/roster-diff.json`, `output/report-data.json` | what the app shows |
| `output/final/<master> - final <cycle label>.xlsx` | the final roster |
| `output/final/<master> - <next year>.xlsx` | the next-year file (only when the cycle runs past the file end) |
| `output/backups/<master>.<sha8>.xlsx` | hash-verified copy of the master |
| `output/audit/<run id>.json`, `audit.log.jsonl` | who approved which cells (append-only) |

`<master>` is `roster` (the uploaded file always lands as `input/roster.xlsx`).

## The scripts

All scripts are headless (stdin closed, they never prompt), find the task folder from their own
location (`--task-dir PATH` overrides it for tests), take no other arguments, print a few
progress lines and, on failure, ONE `ERROR: <reason>` line on stderr with a non-zero exit code
(`SHIFT_ROSTER_DEBUG=1` adds a traceback). Run them with the venv python:
`..\.venv\Scripts\python.exe scripts\analyze.py`. Shared helpers: `scripts/_common.py`.

**`prepare_options.py`** (read-only) writes `output/options.json`: the roster's first/last date and
people count, one entry per cycle that overlaps the roster plus the next cycle after its last
date (`id` like `2026-12`, `label`, `start`, `end`, `enabled`, `reason`, `coverage`, plus
`filled`, `previous`, `crosses_file_end`), the `default` (earliest enabled cycle that is not
filled yet, else the latest enabled one) and `problems` (`severity` + `message`). A cycle is
enabled only when every active person has a code in at least 95% of the weeks of the previous
cycle; `reason` explains it and is shown on hover. A cycle is also disabled while the config
or the Holiday Roster cannot be used. Expected problems are reported in `problems` and the
script still exits 0.

**`analyze.py`** removes the derived files of an earlier run (answers, plan, flags, diff, report
data: stale answers must never satisfy a new form), runs `cycle_builder.analyze_cycle` and writes
`output/ask-me.json` and `output/analysis.json`. It exits non-zero with the reason when the
cycle is unavailable, the Holiday Roster is unusable or the PTO import has bad rows. With
nothing to ask the form has no fields.

**`build_draft.py`** refuses to run when an input changed since the analysis, converts the
answers, runs `build_plan` (seed from the config, printed) and writes `plan.json`, the draft
workbook with its snapshot sidecar, `flags.json` and `report-data.json` (`stage: draft`). The
same inputs and answers give the same cell content, `plan.json` and `flags.json`.

**`diff_draft.py`** compares the saved draft with its snapshot and re-checks the flags on the
edited schedule. `output/roster-diff.json`: `changes` (cells inside the cycle) and
`outside_changes` (cells elsewhere in the grid) as `{person, date, before, after}`, `issues`
(`severity`, `kind`, `message`), `blocking` (errors such as `SNAPSHOT_TAMPERED`,
`SNAPSHOT_MISSING`, `PERSON_MISSING`, `MASTER_CHANGED`, `INPUT_CHANGED`) and `flags`
(`new`, `resolved`, `remaining`, `not_rechecked`). The flag delta compares only what the
re-checker recomputes (HOL check, staffing, per-shift headcount); `remaining` also counts the
plan-time flags that cannot be re-checked (`not_rechecked`), so a rotation warning is never
reported as "resolved". The script exits 0 whenever it could compare (also with blocking
issues; the confirm gate refuses then). A failed comparison removes the previous
`roster-diff.json`.

**`finalize.py`** (after the confirm gate) refuses unless no input changed since the analysis,
the confirmed diff has no blocking issue, the saved draft is still the one that was confirmed
and a fresh comparison still gives the same changes. Then `final_build.build_final`
(`confirmed=True`, approver = the OS user) writes the final into `output/final/`, the backup and
the audit entry; a next-year file when `plan.remainder_edits` is not empty; and only then the new
config (`plan.config_after`), keeping the previous file in `config/backups/`. It writes
`report-data.json` (`stage: final`; the summary has the next-year file, audit, backup and config
backup paths) and asserts that the master's sha256 is unchanged. Because the config changes, a
finished run cannot be finalized again ("the rotation config changed since the analysis"): start
a new run. A run that died before the config was saved can simply be repeated (the identical
final is reused, a new audit line is appended).

## What the draft contains (rules)

Full detail and edge cases are in `../shared/roster_lib/README.md`.

- **Cycles.** A cycle is two months starting in Feb, Apr, Jun, Aug, Oct or Dec and always whole
  Sunday-Saturday weeks. Rotation Sunday: when the month before the cycle's first month ends on a
  Sunday, Monday or Tuesday it is that month's last Sunday, otherwise the first Sunday of the
  first month. No special cases.
- **Rotation.** PERMANENT people keep the observed shift and weekly-off pattern. AUTO_SWAP
  people flip to the partner of the shift observed in the previous cycle (S1<->S2, S3<->S4); the
  listed shift in the config is only a snapshot because shifts may be changed by hand in the
  roster. ASK_ME and UNCLASSIFIED people are asked every cycle, and so is an AUTO_SWAP person
  whose current shift has no partner. People in excluded sections (default Governance and names
  containing Leadership, Governance, PMO, Analytics) are never touched.
- **Swap Sunday.** No special case: S2/S4 are Wed-Sun (Mon-Tue off), S1/S3 are Mon-Fri. A person
  moving to S2/S4 therefore works the rotation Sunday and is off Mon-Tue; a person moving to
  S1/S3 has the Sunday off. PTO on the swap Sunday is flagged `PTO_SWAP_SUNDAY`.
- **Holidays and fairness.** Location-specific and Mexico-only holidays: everyone working at a
  ticked location gets HOL. Common holidays: per team and shift, people in other time zones count
  toward the minimum, then people with the MOST offs this year cover first, the rest get HOL; ties
  go to who was off most recently, then a seeded SHA-256 tie-break (the seed is in the config and
  in the Run log). Counters restart on 1 January. COMP is never generated.
- **Minimum staffing (option B).** `min_staff` is per team (default 3 for DIS, DEP and L3, 2 for
  the others, 0 = no minimum). `min_staff_mode` says how it is counted: `per_shift` (per team,
  shift code and day) or `per_team_day` (per team and day across all its shifts, using the smaller
  of the minimum and the members scheduled that day). Shortages are flagged, never fixed.
- **Preserved leave.** A leave code (P, T, SL, COMP, or a HOL typed by hand) already in the master
  for the cycle is never rewritten. The person is away that day (no generated HOL, a PTO import on
  it keeps the existing code), a preserved HOL on a common holiday counts as an off already taken,
  and each one is listed as an INFO flag `PRESERVED_LEAVE`.
- **PTO.** The import writes P/T/SL only on days the person would work (PTO beats a generated HOL;
  weekly offs and other leave stay), no replacements are arranged, clashes are flagged. A name that
  matches exactly (any order, any case) is silent; a close name is a question in the form and is
  never accepted without an answer; a name matching nobody is the error flag `PTO_UNMATCHED`.
- **Year boundary.** A roster file ends on a date (Jan 1) while the Dec-Jan cycle runs on to
  late January. The cycle is computed as a whole; cells inside the file are the draft, the rest
  (`remainder_edits`) goes into the next-year file, which starts the day after the file's last date,
  keeps its number of date columns, has its grid cleared and then filled with the remainder, and
  carries the holiday names the matrix has for those dates. Excel recalculates it on open. Open it
  once in Excel to check it (see "Known limits" in the library README).
- **December Disconnect.** `disconnect_windows` days are skipped by the holiday assignment, the HOL
  check and the counters.

## The form and the answers

`output/ask-me.json` is `{"title", "fields": [...]}`; every field is a `select` with `id`, `group`,
`label`, `description`, `options` (`value`, `label`), `required` and `default`. The answers file is a
FLAT object `{fieldId: value}`; `build_draft.py` is strict (an unknown id, a value that is not an
option or a missing required answer stops the step with the list).

| Field id | Group | Required | Values | Becomes |
|---|---|---|---|---|
| `shift:<person>` | Ask-me | yes (default `KEEP`; no `KEEP` when no current shift was found) | `KEEP`, `S1`..`S5`, `NS`, `US-CST`, `US-PST`, `11AM-8PM`, `MX-8-5` | `answers.rotation[<person>].shift` |
| `pattern:<person>` | Ask-me | no (default `AUTO`) | `AUTO`, `MON_FRI`, `WED_SUN` | `.pattern` (AUTO = omitted: keep the pattern, or the shift's default) |
| `new:<person>` | New people | yes | `new_seat`, `replaces:<leaver>` | `answers.changes[<person>]` |
| `seat_shift:<person>` | New people | no | S1..MX-8-5 (default: the usual shift of the person's section last cycle) | `new_seat.shift` |
| `seat_pattern:<person>` | New people | no | `AUTO`, `MON_FRI`, `WED_SUN` | `new_seat.pattern` |
| `seat_team:<person>` | New people | no | the config's teams (default the most common) | `new_seat.team` |
| `seat_rotation:<person>` | New people | no (default `UNCLASSIFIED`) | `PERMANENT`, `AUTO_SWAP`, `ASK_ME`, `UNCLASSIFIED` | `new_seat.rotation` |
| `pto:<import name>` | PTO matches | yes | a candidate roster name, `SKIP` | `confirmed_pto` (SKIP drops the entry and adds an INFO flag) |

The `seat_*` follow-ups only matter when `new_seat` is chosen (they are optional because a form
cannot show them conditionally); the new seat's `subteam` is the roster section. A replacement
inherits the leaver's category, shift, team and holiday counter. When the inherited category is
asked every cycle (ASK_ME / UNCLASSIFIED) the replacement keeps the replaced seat's shift and
pattern (answer `KEEP`) and gets an INFO flag, so the user can correct it in Excel. For a new
person who already has codes in the roster, a PERMANENT category copies the observed shift forward
(a `ROTATION_WARNING` says the answer was ignored) and an AUTO_SWAP category flips it, so the shift
answer only counts for ASK_ME / UNCLASSIFIED seats and for people without any previous shift.

## Changing the config

`config/rotation-config.json` is edited by hand between runs (the app does not edit it) and by
`finalize.py` (shifts and person changes become the new baseline; the old file is kept in
`config/backups/`; restore a backup by copying it over the config). Schema and defaults: the
module docstring of `../shared/roster_lib/config.py` and `../shared/roster_lib/examples/
rotation_config.example.json`. Created once from the roster and a names file with
`cd ..\shared; ..\.venv\Scripts\python.exe -m roster_lib.seed_config --help`.

- `people[]`: `name`, `team`, `subteam` (= the roster section), `location`, `rotation`
  (`PERMANENT`, `AUTO_SWAP`, `ASK_ME`, `UNCLASSIFIED`), `shift` (snapshot).
- `min_staff` and `min_staff_mode`: per team, plus a required `default`. `0` means no minimum.
- `team_aliases`: maps a roster section title to a team (default `L2` -> `DIS`; a map in the file
  REPLACES the default, so list every alias you want).
- `excluded_sections` / `excluded_section_patterns`: sections the program never touches.
- `disconnect_windows`: `[{"start": "2026-12-26", "end": "2026-12-31"}]` (inclusive, ISO dates).
- `has_data_threshold` (default 0.95) and `seed` (int, holiday tie-break).

Changing the config after the analysis makes `build_draft.py` refuse ("the rotation config
changed since the analysis"): start the run again.

## Safety

- The master is read only. The draft, the final and the next-year file are new files; `final_build`
  proves with `pkgdiff` that only the roster sheet part differs and only the approved cells; the
  master's sha256 is compared in `analyze`, `build_draft`, `diff_draft` and `finalize`.
- Nothing is guessed: missing or invalid answers stop the step. Nothing flagged is fixed.
- The draft must be saved in place under its own name (`Roster DRAFT <cycle>.xlsx`) next to its
  `.snapshot.json`. Excel may rewrite the whole file; the diff reads text only.
- No script talks to Outlook or any service; they only read and write files in this folder.

## Testing

    cd agent-apps\shift-roster
    ..\.venv\Scripts\python.exe -m pytest -q

Synthetic data only (`tests/synth.py` builds a roster workbook with the library's fixture, a holiday
matrix, a PTO import and a config). The tests drive the scripts' `main()` in order, and once as
subprocesses; `tests/test_real_smoke.py` runs prepare/analyze/build_draft/diff on COPIES of
`../shared/roster-reference` and the real config when present (counts and structure only) and is
skipped otherwise.
