# Shift Roster Agent

## Purpose
Builds the roster for one two-month cycle (rotation, PTO, fair holiday offs) as an Excel draft the user reviews, then writes the approved final roster. Plain Python on `../shared/roster_lib`, no LLM judgment. The master roster is never modified. Runs locally (`runtime: local`); `completedMessage` in `task.json` is the task-complete notification text. Real data is gitignored.

## Inputs
- `input/roster.xlsx` master roster (sheet `PDT Operate`); optional `input/holiday-roster.xlsx`, optional `input/pto-import.xlsx` (Name, From, To, Code).
- The Holiday Roster is OPTIONAL (the PMO shares it about once a year). An uploaded `input/holiday-roster.xlsx` wins (kept on file, `persist: true`); otherwise `_common.resolve_holiday_source` uses the best `Holiday Roster*.xlsx` in `../shared/roster-reference/` (covers the cycle's years; newest wins). New year: drop `Holiday Roster 2027.xlsx` there or upload one. An uncovered year greys the cycle out (a Dec-Jan cycle needs both years). The source (kind, file, sha256) is recorded in analysis, Run log, report, diff and audit and pinned, so diff/finalize use the same file. The assumed 1 Jan 2027 row counts as the 2027 row (see `../DECISIONS-AND-ASSUMPTIONS.md`).
- Clean-up: `task.json` has `cleanup: {onComplete: true}`: after a COMPLETED run the backend deletes this run's other uploads from `input/` (the master roster, the PTO import, `run-params.json`; dotfiles aside) but keeps an uploaded Holiday Roster; `config/` and `output/` are never touched (apart from the stale `output/options.json`, which is cleared too), a failed or abandoned run keeps its input, and no script in this folder deletes anything in `input/`.
- The cycle (`input/run-params.json`, e.g. `2026-12`), chosen from `output/options.json`, which `scripts/prepare_options.py` writes (a cycle is selectable only when the previous cycle has data; each reason is shown on hover). A next-year file is judged on the previous-cycle weeks inside it.
- `config/rotation-config.json` (rotation categories, minimum staffing, disconnect windows). Updated by the last step; the old file is kept in `config/backups/`.

## Current Workflow
1. `analyze.py`: finds new people, who must be asked, close PTO name matches. Writes `output/ask-me.json` (form) and `output/analysis.json`. Exits non-zero if the cycle cannot be built.
2. Gate `answers`: the user answers the form (`output/ask-me-answers.json`, flat `{fieldId: value}`).
3. `build_draft.py`: rotation (incl. PATTERN weekly-template groups), preserved leave, PTO, holidays, checks. HOL flags carry `origin` (master/program). Writes `output/plan.json`, `output/Roster DRAFT <cycle>.xlsx` (+ snapshot sidecar), `output/flags.json`, `output/report-data.json`.
4. Gate `review_draft`: the user edits the draft in Excel, saves it in place, approves.
5. `diff_draft.py`: lists every changed cell and the flag changes in `output/roster-diff.json`. `blocking` issues stop the next gate.
6. Gate `confirm_diff`: the user confirms the changed cells.
7. `finalize.py`: final roster in `output/final/`, master copy in `output/backups/`, audit log in `output/audit/`, a next-year file when the cycle runs past the roster's last date, then the new config. The master's sha256 is checked.

## Review loop
Flags are never auto-fixed: the user decides in Excel. Every script is headless and prints one readable line to stderr with a non-zero exit on failure. Steps refuse to run when an input changed since the analysis.

## Testing
From this folder: `..\.venv\Scripts\python.exe -m pytest -q`. Synthetic data only; the real-file smoke test is skipped when the gitignored reference files are absent.

## Details
Rules (rotation Sunday, swap Sunday, fairness, minimum staffing, PTO, year boundary), the answers schema and how to change the config are in `README.md`. Library behavior: `../shared/roster_lib/README.md`. File contracts: `../TASK-PLATFORM-CONTRACT.md`.
