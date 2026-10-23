# winter_lib

Shared building blocks for the December Disconnect (winter coverage) task: the main plan
and the Analytics plan. Plain Python, deterministic, unit-tested with synthetic data only.
Run the tests from this folder with `..\..\.venv\Scripts\python.exe -m pytest -q`.

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
