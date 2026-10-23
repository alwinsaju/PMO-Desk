# December Disconnect Agent

## Purpose
Builds the winter holiday coverage for one window (default Fri 25 Dec - Fri 1 Jan) as two Excel drafts the PMO reviews: the main PDT plan (who works which days on their usual shift) and the Analytics plan (34 slots, on call, Mexico slot). Writes the confirmed files as finals and teaches the Shift Roster task to ignore the disconnect days. Plain Python on `../shared/winter_lib`, no LLM judgment. Runs locally (`runtime: local`). Real data is gitignored; logs hold counts only, never names.

## Inputs
- `input/roster.xlsx` shift roster (sheet `PDT Operate`), `input/staff-roster.xlsx` PDT staff roster; optional `input/analytics-a.xlsx`, `input/analytics-b.xlsx` (Oct/Nov Analytics rosters: refresh the usual shifts).
- Clean-up: `agent.json` has `cleanup: {onComplete: true}`: after a COMPLETED run the backend deletes this run's uploaded files from `input/` (dotfiles aside), so upload them again for the next run; `config/` and `output/` (the finals, the audit log) are never touched, and a failed or abandoned run keeps its input.
- The window (`input/run-params.json`), chosen from `output/options.json` (written by `scripts/prepare_options.py` from the config).
- `config/winter-config.json` (teams, minimums, weights, exclusions) and `config/analytics-config.json` (people, slots, on call). Never edited by a script.

## Current Workflow
1. `analyze.py`: people without shift history, fuzzy name matches. Writes `output/ask-me.json`, `output/analysis.json`.
2. Gate `answers`: shifts for new people, name confirmations, up to 5 + 3 availability exceptions.
3. `build_draft.py`: solves both plans, archives any earlier draft into `output/archive/`. Writes both drafts (+ snapshots), `plan.json`, `flags.json`, `report-data.json`.
4. Gate `review_draft`: the PMO edits both drafts in Excel, saves under the same names, approves.
5. `diff_draft.py`: every changed cell of both files and the audit results in `output/roster-diff.json`. `blocking` stops the next gate.
6. Gate `confirm_diff`: the PMO confirms the changes. If blocked, start over (Reset) and run again.
7. `finalize.py`: checks the file hashes, re-audits, copies the drafts to `output/final/`, writes `output/audit/`, adds the disconnect days to the shift-roster task config (backup kept).

## Review loop
Flags are never auto-fixed. Every script is headless and prints one readable line to stderr with a non-zero exit on failure. Steps refuse to run when an input changed since the analysis.

## Testing
From this folder: `..\.venv\Scripts\python.exe -m pytest -q`. Synthetic data only; the real-file smoke test is skipped when the gitignored reference files are absent.

## Details
Rules, weights, answers schema, assumptions: `README.md`. Library: `../shared/winter_lib/README.md`. Contracts: `../TASK-PLATFORM-CONTRACT.md`.
