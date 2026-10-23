# winter_lib

Shared building blocks for the December Disconnect (winter coverage) task: the main plan
and the Analytics plan. Plain Python, deterministic, unit-tested with synthetic data only.
Run the tests from this folder with `..\..\.venv\Scripts\python.exe -m pytest -q`.

## Main winter plan

The PDT winter coverage ("December Disconnect") for the window Fri 25 Dec - Fri 1 Jan: who works
which days, on their usual shift, so that every team keeps its daily minimum and everybody works
3-5 days. Window dates, teams, minimums, weights and exclusions are all configuration, never code.

| Module | Role |
| --- | --- |
| `winter_config.py` | Config schema, loader, validator (`load_config`, `parse_config`, `save_config`, `WinterConfig`); `examples/winter_config.example.json` (synthetic) |
| `winter_inputs.py` | `read_staff_roster`, `usual_shift`, `build_inputs` -> people with team, location and usual shift; `needs_shift`, excluded, warnings |
| `winter_plan.py` | `solve_winter_plan(people, cfg, previous_plan=None) -> WinterPlan` (HiGHS MILP), `score_plan`, `WinterPlan.to_json/from_json` |
| `winter_workbook.py` | `write_winter_workbook(path, plan, cfg) -> WorkbookResult`: 3 formula-linked tabs + hidden `_snapshot` + `<file>.snapshot.json` |
| `winter_audit.py` | `audit_winter_plan(path, cfg, roster_names=None) -> AuditResult` read back from the finished file |
| `winter_build.py` | `build_winter_coverage(staff, roster, cfg, out, shifts=None, previous_plan=None) -> BuildResult` (inputs -> plan -> file -> audit) |
| `winter_snapshot.py`, `winter_types.py`, `xlsx_style.py` | snapshot sheet/sidecar reader+writer, shared types (`Finding`, `PlanPerson`, shift display table), the shared look |

```python
from winter_lib.winter_config import load_config
from winter_lib.winter_build import build_winter_coverage, NeedsShiftError

cfg = load_config("december-disconnect/config/winter-config.json")
try:
    res = build_winter_coverage("PDT Staff Roster.xlsx", "Shiftroster.xlsx", cfg,
                                "december-disconnect/output/winter-coverage-2026.xlsx")
except NeedsShiftError as e:      # people with no shift history: ask the user, then
    res = build_winter_coverage(..., shifts={p.name: "Shift-1" for p in e.people})
res.audit.ok, res.audit.errors, res.plan.run_info.mip_gap, res.inputs.findings
```

### Inputs (`winter_inputs`)

* Team membership comes from the staff roster (tolerant header detection: a `Team` column plus a
  full-name or first+last name columns; a second `Team` column is kept as a secondary label).
  `staff_team_map` maps staff-roster labels to teams, `team_aliases` the shift-roster sections
  (`L2` -> `DIS`).
* **Usual shift** = the modal working SHIFT code (canonical, `roster_lib.codes`; leave, on-call,
  blanks and custom hours do not count) over the lookback range that ENDS THE DAY BEFORE the window
  (default 4 months, `lookback_months`). Ties go to the most recent occurrence. The window's own
  cells (placeholders) are never read.
* `shift_overrides` beat history. People with no history and no override are returned as
  `needs_shift` (the UI asks); `default_new_person_shift` (off by default) assigns a shift with a
  warning instead; `build_winter_coverage(shifts={...})` carries the answers.
* Exclusions: `exclusions.team_patterns` (substring match on the staff-roster team labels and the
  shift-roster section, e.g. Leadership, Governance, PMO, Analytics), `people`, `name_patterns`.
  The staff roster's `Roll-off date` column is read but not used (in the real file it holds one
  placeholder date for almost everybody): list rolled-off people in `exclusions.people`.
* Staff-roster vs shift-roster differences are WARNINGS: `staff_not_on_shift_roster`,
  `shift_roster_not_on_staff` (not scheduled unless `include_shift_roster_only`), `unmapped_team`.
  Names match exactly, by the same words in another order, via `name_aliases`, then by a
  conservative same-team fuzzy rule that is reported (`name_fuzzy`) for confirmation.

### The solver (`winter_plan`)

`x[person, day]` binary (one slot per person per day; the person works their usual shift).
Everything else is a penalised slack, so the model is always feasible: a rule the data makes
impossible is reported (`team_min` finding with a count-based reason), never crashes or is
silently weakened. Weights are configuration (`weights`), defaults:

| Term | Default |
| --- | --- |
| required-team shortfall, per missing head | 1000 x day weight |
| best-effort team with nobody on a day | 100 x day weight |
| 4th / 5th day of a person (only if a team needs the slot) | 400 / 600 |
| lane (Morning / Evening / Night-US) uncovered, teams of 5+ with a lane of 3+ | 60 x day weight |
| sub-team (Complaints, Loyalty) uncovered | 40 x day weight |
| person without 1-2 of the holiday/weekend days (Dec 25, 26, 27, Jan 1) | 5 per day |
| extra contiguous block per person | 1 |
| changed person-day when re-solving with `previous_plan` | 30 |
| person below 3 days (only when availability forces it) | 5000 per day |

Day weights: weekday 3, holiday (Dec 25, Jan 1) 2, weekend 1. Hard bounds: at most 5 days per person
(3 for best-effort team members: they never get extra days). Determinism: HiGHS is deterministic for
identical input and every x gets a sha256(seed|name|date)-derived tie-break cost below 1e-3 in total
per cell; the seed, options, weights, model size, status, objective, dual bound and gap are logged in
`plan.run_info`. A time-limit stop is flagged (`time_limit` finding); with no solution at all a
deterministic greedy fallback is returned and flagged (`solver_fallback`).

### The workbook (`winter_workbook`)

* `Winter Coverage`: KPI tiles, team x day heat map (green meets the minimum, amber below, red
  nobody), `Min / day`, people, days-minimum-met, person-days and a plain-English status per team.
* `Winter Daily Roster`: per date, Morning / Evening / Night-US rows by team (names only) and a
  `Total on shift` row; lane = IST start time of the code in the person's plan cell.
* `Winter Plan`: the editable grid grouped by team (team, location, usual shift, lane, one column per
  date), a stop-style dropdown from the `Shift key` table on the same sheet, Days worked and
  holiday/weekend day counts; a cell that differs from the usual shift gets an orange border.
* `_snapshot` (veryHidden) + `<file>.snapshot.json`: every grid cell as written + meta (plan hash,
  config hash, window, people, rules), same conventions as `roster_lib.draft_builder`.
* Formulas use only COUNTIF / COUNTIFS / SUMIF / SUMPRODUCT / IF / AND / MATCH / ISNUMBER / MID /
  CHAR / SUM / COUNT. Names on the daily roster are per-person IF terms joined with `&` and trimmed
  with `MID` (no TEXTJOIN, no dynamic arrays; works in every Excel). Every formula carries its cached
  value and the file recalculates on open. A team so large that one daily-roster formula would pass
  8,000 characters is refused (`ValueError`).

### The audit (`winter_audit`)

Reads the finished (or Excel re-saved) file: team minimums per day, 3-5 days per person (best-effort
members <= 3), one slot per person per day, shift == usual shift, no excluded person, every name on
the roster list you pass, unavailable days, window. Findings are structured (`severity`, `code`,
`team`, `person`, `date`); best-effort gaps are warnings, never failures. `result.ok` = no error.

### Tests and limitations

`tests/test_winter_*.py` use synthetic names only; `test_winter_real_files.py` runs on the real
reference files when they exist (counts only, output to the gitignored `december-disconnect/output/`).
Formula checking uses `tests/formula_eval.py`, a small restricted evaluator written for the subset above
(cached value == recalculated value, zero errors). **Limitation:** neither Excel nor LibreOffice was
available, and the pure-python `formulas` package gave wrong results for `COUNTIF(...,"?*")` and
`SUMPRODUCT(--ISNUMBER(MATCH(...)))` on a probe, so it was not used; the evaluator is an independent
implementation of the semantics, not Excel. Open the generated file once in Excel to confirm.

## Analytics winter plan

Analytics has its own shift process and its own workbook. This part of the package turns a
config (people, window, slot grid) into a solved plan, a formula-linked three-tab workbook,
and an audit that reads the finished file back.

| Module | Role |
| --- | --- |
| `analytics_config.py` | JSON config schema, loader/validator, default slot-grid generator |
| `analytics_inputs.py` | Reads the Analytics people and each person's usual shift from the monthly Analytics rosters (tolerant detection) and drafts a config |
| `analytics_plan.py` | The solver: `solve_analytics_plan(config) -> AnalyticsPlan` (HiGHS MILP via `scipy.optimize.milp`) |
| `analytics_workbook.py` | `build_analytics_workbook(config, plan, path) -> BuildResult` (xlsxwriter, uses `xlsx_style`) |
| `analytics_audit.py` | `audit_analytics_plan(path, config) -> AuditResult`, `diff_against_snapshot(path)` |
| `analytics_formula_eval.py` | Restricted formula evaluator that verifies the workbook (see Limitations) |

```python
from winter_lib.analytics_config import load_analytics_config
from winter_lib.analytics_plan import solve_analytics_plan
from winter_lib.analytics_workbook import build_analytics_workbook
from winter_lib.analytics_audit import audit_analytics_plan

config = load_analytics_config("december-disconnect/config/analytics-config.json")
plan = solve_analytics_plan(config)   # plan.ok, plan.assignments, plan.on_call, plan.notes, plan.problems
build_analytics_workbook(config, plan, "december-disconnect/output/Analytics_Winter_Coverage_Dec25-Jan1.xlsx")
audit = audit_analytics_plan("...xlsx", config)   # audit.ok, audit.findings, audit.summary()
```

### Config (`examples/analytics_config.example.json`, synthetic)

* `window` (`start`, `end`; 2026: Fri 25 Dec to Fri 1 Jan, 8 days), `title`, `holiday_dates`
  (holiday/weekend days: Dec 25, 26, 27 and Jan 1), optional `day_labels`, `shift_hours`.
* `people[]`: `name` (full), `short_name` (the name written into the workbook and its
  dropdowns), `location`, `usual_shift` (S1-S3, from the Oct/Nov rosters; S4 for the Mexico
  colleague), `role` (`support` | `on_call` | `mexico`), `available` (`{from, to}` or a list of
  dates; omitted = every day), `can_take_extra`, `note`.
* `slots`: optional explicit list of `{date, code, start[, zone]}`; when absent the default
  generator builds the grid (below). `slot_profile` can override single days (`per_day`) or the
  Mexico days (`mexico_dates`).
* `slots_per_person` (4), `on_call_slots_each` (1), `weights`, `solver` (`seed`, `time_limit_s`).

The real config (names, usual shifts, who is on call, the Mexico person, the availability
exception) lives in the gitignored `agent-apps/december-disconnect/config/analytics-config.json`.
`analytics_inputs.draft_config_dict(...)` builds one from the monthly rosters; a person who
is not found raises instead of being skipped.

### Slot grid (default generator, derived from last year's Analytics layout)

34 slots: 30 IST slots (S1 08:00, S2 11:00, S3 14:00) and 4 Mexico slots (S4 22:00 IST, one
per day on the non-holiday days, Dec 28-31, always the Mexico person).

| Day | IST slots | Mexico |
| --- | --- | --- |
| Fri 25 Dec | S1, S2, S2, S3 (4) | - |
| Sat 26, Sun 27 Dec | S1, S3 (2 each) | - |
| Mon 28 Dec | S1 x2, S2 x2, S3 x2 (6) | S4 |
| Tue 29, Wed 30, Thu 31 Dec | S1, S2, S2, S3 (4 each) | S4 |
| Fri 1 Jan | S1, S2, S2, S3 (4) | - |

Repeated codes on a day are labelled `S2-A`, `S2-B`. The grid is an input: pass `slots` to
replace it.

### Rules

Hard (exact, never traded off): all slots filled; one slot per person per day; no slot on a
person's own on-call day; exactly one person on call every day (8 days = 2 x 4, so each
on-call person has 4 on-call days and 1 slot); standard slot counts (4 each, on-call people
1, fewer when availability does not allow it, e.g. a person available only Dec 28-30 works 3);
availability; Mexico slots to the Mexico person only.

When the standard counts do not add up to the grid (2026: six people x 4, one person x 3 and
two on-call people x 1 give 29 for 30 IST slots), the missing slot(s) go to the best-fitting
eligible person and the plan says so in plain English in `plan.notes`, which also reach the
workbook (Daily View footer, By Person notes).

Soft (weights in `config.weights`): usual shift (cost per step away: S1-S2-S3), 1-2 holiday or
weekend duty days per person (a slot or an on-call day counts), contiguous slot blocks,
contiguous on-call halves, no S3 followed by S1 the next day, and a small cost for taking an
extra slot. The tally of missed preferences is in `plan.metrics` (information, not errors).

Deterministic: one binary variable per person/date/code (identical slots are interchangeable, so
there is no symmetry), solved to proven optimality (`mip_rel_gap = 0`), ties broken by tiny cost
perturbations from `random.Random(config.seed)`. `plan.plan_hash` is a stable hash of every
assignment. Infeasible input never raises: `plan.status == "infeasible"` and `plan.problems`
names the rule(s) that cannot be met (found by relaxing the hard rules one at a time, then in
pairs).

### Workbook

Three visible tabs plus a `veryHidden` `_snapshot`, in the same look as the main plan
(`xlsx_style`: Arial, #282728 / #86BC25, logo tile, KPI tiles, pastel chips):

* `Daily View`: KPI tiles (slots filled, IST, Mexico, on-call days, rule checks passing), then
  per date: day type, who works S1 / S2 / S3, the Mexico slot, who is on call, slots filled.
* `Winter Roster`: one row per slot (date, day type, holiday/weekend, slot, start IST, hours, time
  zone) plus an `On call` row per day. `Assigned` has a name dropdown (the people list on By
  Person); `Check` flags `Open`, `Not on list`, `Not available`, `Double slot`, `On call same
  day`, `Slot same day`, `Wrong zone`, `Not on-call person`. A hidden helper column feeds By Person.
* `By Person`: per person the slot or `OC` on every date, slots vs target, on-call days vs
  target, holiday/weekend days, rows flagged, Check, notes, the availability grid, and the RULE
  CHECK table (formulas, PASS / FAIL): all 34 slots filled, counts per person match the plan,
  no double slots, no slot on own on-call day, exactly one on call every day, availability, every
  name on the list, roles.

The workbook is formula-linked: editing names on `Winter Roster` updates the other tabs.
`_snapshot` and the sidecar `<file>.snapshot.json` (schema `analytics-winter-snapshot/1`) hold
every assignment as written plus meta (plan hash, config hash, seed, counts, notes), so
`diff_against_snapshot(path)` can list what the user changed (date, slot, was, now).

### Audit

`audit_analytics_plan(path, config)` reads the finished file (works on a hand-edited, Excel
re-saved file: the table is found by its `Date` / `Slot` / `Assigned` headers, rows or columns
may move) and returns `AuditResult` with structured `Finding`s (`severity`, `rule`, `message`,
`where`): `grid`, `filled` (34 of 34), `people_list`, `slot_counts` (exceptions such as a 5th
slot or an availability cut are `info`), `double_slot`, `on_call_day`, `one_on_call`,
`on_call_days`, `availability`, `roles`, `formula_errors`, `file`. A file that cannot be read gives
a `file` finding instead of an exception.

### Formula verification and its limits

Real Excel and LibreOffice were NOT available. The builder writes the file once, evaluates every
formula with `analytics_formula_eval` (an independent restricted evaluator: IF, IFERROR, AND, OR,
NOT, ISNA, ISNUMBER, INDEX, MATCH (exact), COUNTIF(S) with Excel criteria and wildcards, COUNTA,
SUM, TRIM, MID, CHAR and the operators used), writes the file again with those results as the
cached values, then re-checks: zero formula errors and cached value == recalculated value for
every formula cell (about 290). Tests also compare key cells with the plan independently of the
evaluator. This proves the formulas are consistent under the evaluator's semantics, not that
Excel agrees to the last detail; unsupported functions are reported as errors, never skipped.
The file asks Excel to recalculate fully on open.

### Tests

`tests/test_analytics_*.py` use synthetic names only. `tests/test_analytics_real_files.py` runs
on the real rosters / config when present (skipped otherwise), prints counts only and writes to
the gitignored `december-disconnect/output/`.
