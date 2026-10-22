# roster_lib

Shared, deterministic building blocks for the Shift Roster agents. Plain Python,
unit-tested, no LLM judgment. Run the tests from this folder:

    ..\..\.venv\Scripts\python.exe -m pytest -q

## Logic modules (cycles, codes, holiday matrix, config)

Dates are plain `datetime.date` (no time zones). Example/template files live in
`examples/`. No real names or data appear in code, tests or examples.

### `cycles.py` - cycle calendar

- A cycle is two months; first months are Feb, Apr, Jun, Aug, Oct, Dec.
- Rotation Sunday: if the month before the cycle's first month ends on a Sunday,
  Monday or Tuesday, it is the last Sunday of that month; otherwise the first
  Sunday of the cycle's first month. No special-case exceptions.
- A cycle runs from its rotation Sunday to the Saturday before the next
  cycle's rotation Sunday (whole Sunday-Saturday weeks; cycles tile exactly).

API: `Cycle(first_month, start, end, rotation_sunday)` (+ `.label`, `.days`,
`.contains(d)`), `cycle_for(year, month)`, `previous_cycle(c)`, `next_cycle(c)`,
`cycles_in_year(year)`, `cycle_containing(date)`, `weeks(c)`,
`crosses_date(c, last_column_date)`, `split_at_year_boundary(c, last_date)` ->
`(part_in_file, remainder)` as `DateSpan | None`,
`cycle_availability(cycle, cells, active_people, counts_as_code, threshold=0.95,
bootstrap=False)` -> `Availability(enabled, reason, coverage, failing_people)`.
A cycle is selectable only if every active person has a shift/leave code in at
least `threshold` of the previous cycle's weeks; `bootstrap=True` allows a
previous cycle with no data at all. `cells` is `{person: {date: raw text}}`, so
it does not depend on the workbook reader.

### `codes.py` - code normalizer and table

`parse_code(text)` -> `ParsedCode(raw, canonical, custom)`; `raw` is kept so the
exact original string can be written back. Raises `UnknownCode` (never guesses);
`try_parse_code` returns `None` instead. Canonical codes: S1-S5, NS, US-CST,
US-PST, 11AM-8PM, MX-8-5 (8am-5pm CST), HOL, P, T, SL, COMP (parsed, never
generated), OC, BLANK (empty cell), CUSTOM (a time range such as
`IST 6:00-3:00AM`, kept verbatim).

Also: `counts_as_code(text)`, `hours_of(code, timing_key=None)`,
`lane_of(code, timing_key=None)` (Morning < 12:00, Evening 12:00-18:00, Night/US
> 18:00 by IST start), `default_pattern(code)`, `forced_pattern(code)` (S2/S4 ->
Wed-Sun), `works_on(pattern, date)`, `is_working_code`, `is_leave_code`,
`partner_shift` (S1<->S2, S3<->S4), `resolve_table(timing_key)`.

- `Pattern.MON_FRI` / `Pattern.WED_SUN` belong to a person-cycle, not a code;
  only the default is in the table.
- `TimingKey` ({code: ("HH:MM", "HH:MM")}) replaces hours per team (Device
  Support, Lab, LNS 2.0); behaviour is unchanged.
- Assumptions: MX-8-5 is 19:30-04:30 IST (CST = UTC-6) so it is a Night/US lane;
  OC counts as a working code; CUSTOM has no lane.

### `holiday_matrix.py` - Holiday Roster

`load_holiday_matrix(worksheet_or_path, sheet_name=None, location_codes=None)`
-> `HolidayMatrix`. Columns: Holiday name, Date, Bengaluru, Chennai, Gurgaon,
Hyderabad, Kolkata, Pune, Mexico (optional). `X` (or tick, Y, Yes, 1) = off.
Any problem raises `HolidayMatrixError` listing all issues with row numbers.

`Holiday(name, date, off_locations, type, common_india_mexico)`; `type` is
`COMMON` (all six India locations), `LOCATION_SPECIFIC` (some India locations,
with or without Mexico) or `MEXICO_ONLY`. Helpers: `holidays_in_range`,
`holiday_on`, `holidays_on`, `is_off(matrix, location_code, date)`,
`label_mismatches(matrix, row12_labels, start=None, end=None)` and
`write_template(path)` (example in `examples/holiday_roster_template.xlsx`).
`pto_template.write_pto_template(path)` makes `examples/pto_import_template.xlsx`
(Name, From, To, Code; PTO only on working days, PTO beats HOL, no replacements).

### `config.py` - rotation config

`load_config(path)` / `parse_config(dict)` -> `RotationConfig`; `save_config`
writes deterministically (people sorted by name, fixed key order). Schema is in
the module docstring; see `examples/rotation_config.example.json`.
Rotation categories: `PERMANENT` (copy forward), `AUTO_SWAP` (flip to the
partner shift; weekly-off pattern follows the new code), `ASK_ME`,
`UNCLASSIFIED` (asked every run). Validation errors are all reported in one
`ConfigError`. API: `classify(person)`, `next_shift(person)`, `name_key(name)`,
`cfg.find(name)`, `add_person`, `update_person`, `remove_person`,
`resolve_location_code`, `team_of(section | roster Person | config Person)`,
`min_staff_for_team(team)` (`min_staff_for` is the old name). `min_staff` is keyed by
TEAM (3 for DIS, DEP and L3, 2 for every other team, per shift code per day);
`team_aliases` maps roster section titles to teams (default `L2` -> `DIS`; a map
in the file replaces the default). A per-team `min_staff` override may be 0 (no
minimum: not staffing-checked, everyone may be off on a common holiday).
`excluded_sections` / `excluded_section_patterns` (defaults: `Governance`; patterns
Leadership, Governance, PMO, Analytics, case-insensitive substrings) name the roster
sections the program never touches (`cfg.is_excluded_section`); `disconnect_windows`
(inclusive ISO date ranges, default none) are December Disconnect days that the
holiday assignment, HOL check and counters skip (`cfg.disconnect_dates()`).

## Workbook I/O (roster_io, xlsx_patch, pkgdiff)

Layout notes for the real files are in `STRUCTURE.md`. The rule behind all
three modules: **the live workbook is never loaded into an object model and
never saved by a library that drops parts**. openpyxl is slow on the master
(130k+ conditional-format rules) and would silently lose threaded comments,
persons, the sensitivity label, extLst conditional formatting/validation and
some drawings. Instead the xlsx is treated as a zip of byte blobs and exactly one
part, the target `xl/worksheets/sheetN.xml`, is rewritten by splicing text
inside `<sheetData>`. Everything before `<sheetData>` and after `</sheetData>`
(conditional formatting, validation, hyperlinks, merges, extLst) is carried over
as raw bytes without being parsed or decoded.

### `roster_io.py` - read-only reader

`load_roster(path, sheet_name="PDT Operate", *, section_aliases=None,
location_aliases=None) -> Roster`. Reads raw text only; code normalisation is
done elsewhere. Nothing is hard-coded to row numbers: the date row is the row
with the longest run of consecutive date serials (min 7), the weekday row is the
row near it whose text matches each date's weekday, the holiday-label row is the
row above, the column-header row is the first row below with `Loc` and `Team`
labels (these give the location/team columns; name is the column left of Loc).
Below it each row is a person (name + location/serial/data), a section header
(title in the first label column, no name/location), a legend line (key text in
the label columns, no person cues) or a spacer. Full cue list: module docstring.

- `Roster`: `dates`, `first_date`, `last_date`, `date_to_col`, `col_to_date`,
  `date_row`, `weekday_row`, `holiday_row`, `header_row`, `name_col`,
  `location_col`, `team_col`, `serial_col`, `first_date_col`, `last_date_col`,
  `people`, `sections`, `legends`, `preamble`, `warnings`.
- `cell(person, date) -> str` (blank is `""`), `row_texts(person, start, end)`
  (inclusive, default whole roster), `address(person, date) -> (row, col)`,
  `address_map(person, start, end) -> {date: (row, col)}` (feeds the patcher),
  `holiday_labels(expand_merges=False) -> {date: raw label}`, `weekday_label`,
  `is_formula`, `find(name)`, `person_at(row)`, `people_in(section)`.
  `person` may be a `Person` or a bare row number.
- `Person(name, location_code, team_label, section, row)`: `location_code` is the
  raw Loc text (a city name in the real file) after `location_aliases`;
  `team_label` is the raw Team text (`L2 DIS USI`, `Complaints`, ...);
  `section` is normalised (`DEFAULT_SECTION_ALIASES` maps the typed `L N S 2.0`
  to `LNS 2.0`; pass `section_aliases` to add more, keys are case/space
  insensitive).
- `Section(name, raw_name, header_row, person_rows)`; `Legend(first_row,
  last_row, lines, after_section, before_section)` are raw key blocks (not
  interpreted) with `lines_text()`; `preamble` is the same for rows above the
  holiday row (title and top key).
- Errors are `RosterFormatError`: sheet missing, no date row, duplicate dates,
  dates not contiguous (any stray date-like cell on the date row), no
  `Loc`/`Team` header row, no people.
- Rows can shift (a person added mid-sheet) without affecting results. Cost:
  about half a second for the 1 MB real file.

### `xlsx_patch.py` - sheet-XML cell patcher

`patch_workbook(src_path, dst_path, sheet_name, edits, *, allow_formula_overwrite=False,
overwrite_nonblank=True, reuse_shared_strings=True, new_cell_style=None,
verify=True) -> PatchResult`. `edits` maps `(row, col)` (1-based) or `"E16"` to a
string; `None` or `""` clears the cell (blank = weekly off) and keeps its style.
Sheet name is resolved through workbook.xml and its rels (never assumes
`sheet1.xml`).

- Existing cells keep every attribute except `t` (so the style `s` is kept).
  Missing cells/rows are created in order; the dimension (and row `spans`) grow
  only when needed. A new cell gets `new_cell_style`, else the row's own style if
  the row has `customFormat`, else none.
- **Text storage**: conditional formatting reads the cell text, and Excel
  resolves shared and inline strings to the same text before any rule or
  validation runs. The patcher never edits `sharedStrings.xml`: if the exact text
  already exists as a plain shared string (`Shift-1`, `NS`, `HOL`, ...) the cell
  references that index (`t="s"`, exactly what Excel writes), otherwise it writes
  `t="inlineStr"` (valid, Excel converts it on its next save). `t="str"` is never
  used (that is the cached-result type of a formula cell). Text is always stored
  as text, so `"12"` stays a string; `=...` is not a formula. `reuse_shared_strings=False`
  forces inline strings everywhere. Excel does not validate the stale
  `sst@count`.
- **Formula cells are refused** (`FormulaOverwriteError`); with
  `allow_formula_overwrite=True` plain/shared-child formulas are replaced and
  their `calcChain` entries pruned (the only other part that can change). A
  shared/array formula master is always refused.
- `overwrite_nonblank=False` refuses to replace a cell that already has content,
  for fill-only runs that must never clobber PMO edits.
- `dst_path` must differ from `src_path` (the source is never touched); the output
  is written to a temp file and moved into place only after a self-check:
  patched `sheetData` is well-formed, edited cells read back as requested, every
  other cell is unchanged. Re-writing the same values is a no-op (byte-identical
  output). Other parts are copied entry-for-entry (name, order, timestamp,
  compression method).
- Reading helpers: `load_sheet(path, sheet)` (all cell texts, formula flags,
  merges, without openpyxl), `read_cell_texts(path, sheet, refs=None)`,
  `list_sheets`, `resolve_sheet_part`, `parse_ref` / `format_ref` /
  `col_to_num` / `num_to_col`.

### `pkgdiff.py` - proof that only the sheet changed

`diff_packages(a, b) -> PackageDiff` (`changed`, `reserialised` (bytes differ,
canonical XML equal), `only_in_a/b`, `compression_changed`, `order_preserved`,
`byte_changed`, `identical`); `assert_only_changed(src, dst, allowed_parts,
strict=True)` for pytest; `diff_sheet_xml(a_bytes, b_bytes) -> SheetXmlDiff`
(changed/added/removed cells and rows, top-level elements outside `sheetData`
that changed); `assert_sheet_only_changed(src, dst, part, allowed_cells)`.
The central acceptance test (`tests/test_xlsx_patch.py`) builds a synthetic
workbook with threaded comments, persons, a sensitivity label, extLst CF/DV, a
hyperlink, a drawing, a calcChain and a hidden sheet, patches it, and asserts
that only the target sheet part differs and that, inside it, only the edited
cells differ.

Tests use synthetic workbooks from `tests/xlsx_fixtures.py`. Two smoke tests run
against the real reference file when it is present (`roster-reference/`,
skipped otherwise) and assert structure only.

## Rotation, PTO, roster changes

Shared shapes: a schedule is `{person name: {date: raw cell text}}` (blank `""` =
weekly off; names exactly as in the roster); an edit set is
`{(person name, date): new raw text}` (`""` clears). Everything is deterministic.

### `rotation.py` - Step 2 "Rotate"

`rotate(prev_schedule, config, cycle, answers=None, *, people=None, history=None,
replaces=None) -> RotationResult(schedule, changes, warnings, old_states, .edits)`.
Leave (PTO/HOL) is not written here. `derive_state(cells, prev_cycle)` reads each
person's current code, exact string and weekly-off pattern from the previous
cycle (leave and on-call ignored, odd weeks skipped, a mid-cycle change uses the
last full weeks, custom time-range text copied verbatim).

- PERMANENT: same string, same pattern. AUTO_SWAP: S1<->S2, S3<->S4, pattern
  follows the new code. Swap Sunday needs no special case: the pattern rule gives
  Wed-Sun movers a work Sunday (Mon-Tue off) and Mon-Fri movers a Sunday off.
- String written for a swapped code, first hit wins: the person's own most recent
  string for that code (previous cycle, then `history`) -> the team's most common
  string for it in the previous cycle -> the person's own string restyled
  (`Shift-1` -> `Shift-2`) -> canonical `Shift-N`.
- `headcount_by_shift(schedule, roster_people, date)`; the rotation warns when a
  team's headcount per shift differs before/after (new seats excluded).
- Missing answers raise `MissingAnswers(.names, .reasons)`; unusable ones raise
  `InvalidAnswers(.problems)`. Nothing is guessed.

`answers` (rotation form; key = person name, matched case/space-insensitively):

    {"<name>": {"shift": "S3",            # S1-S5, NS, US-CST, US-PST, 11AM-8PM, MX-8-5, or "KEEP"
                "pattern": "MON_FRI",     # or "WED_SUN"; optional
                "text": "Shift-3"}}       # optional exact string to write

Needed for ASK_ME / UNCLASSIFIED people, people with no previous-cycle data (new
seats), and AUTO_SWAP people whose current shift has no partner. Omitted `pattern`
keeps the current pattern if the shift is unchanged, else the code's default
(S2/S4 are always Wed-Sun; asking for S2 with MON_FRI is invalid). `ShiftChange`
carries person, old/new shift, `effective` (rotation Sunday), `first_worked`, and
old/new pattern.

### `pto.py` - Step 3 PTO import

`read_pto_workbook(path) -> list[PtoEntry]` (columns Name, From, To, Code; header
found by content; code defaults to `P`; only P, T, SL accepted; all bad rows
reported together in `PtoImportError` with sheet row numbers).
`match_names(import_names, roster_names, confirmed) -> PtoMatchReport(exact,
needs_confirmation, unmatched)`: exact (words, any order/case) is silent; one
word more/less, a one-word typo or a whole-name edit distance <= 2 returns
candidates and is never accepted until the caller passes
`confirmed={import name: roster name}`.
`apply_pto(schedule, entries, cycle, confirmed, needed=None, min_staff_for=None)
-> PtoResult(edits, clashes, notes, match, skipped_entries)`: the code goes only on
days the person would work (a working code, or HOL: PTO beats HOL); weekly offs
and other leave stay; out-of-cycle ranges are ignored with a note; no
replacements. Clashes (`PtoClash(person, date, kind, detail)`; kinds SWAP_SUNDAY,
NEEDED, BELOW_MIN, OVERLAP) are reported, not blocked. `shift_group_rule(schedule,
team_of, minimum_for)` builds the `min_staff_for` callable (group = team + shift).

### `roster_changes.py` - Step 0 and the ask-me list

`detect_changes(roster_people, config, prev_schedule) -> ChangeSet(new, removed)`:
NEW = in the roster but not the config, or in the config with no code in
`prev_schedule`; REMOVED = in the config but not the roster.
`apply_changes(config, answers, changes, roster_people=None) -> AppliedChanges`
(`config` deep copy, never saved; `inherited_counters`/`replaces` {new: old};
`pool_average_seats`; `rotation_answers`). `answers` (key = new person's name):

    {"<new name>": {"replaces": "<old name>"}}
    {"<new name>": {"new_seat": {"rotation": "PERMANENT|AUTO_SWAP|ASK_ME|UNCLASSIFIED",
                                 "shift": "S3", "pattern": "MON_FRI",   # pattern optional
                                 "team": "Operate", "subteam": "DIS",   # subteam optional
                                 "location": "Hyd"}}}                   # optional

A replacement inherits category, shift, partner, team, subteam and the holiday
counter, and takes the seat's next assignment from the old person's
previous-cycle cells (pass `replaces` to `rotate`). A new seat's `shift` is the
shift they work THIS cycle; its holiday counter starts at the pool average.
Unanswered new names raise `MissingAnswers`.
`ask_me_list(config, roster_people, prev_schedule, cycle=None, replaces=None) ->
list[AskMeItem(name, current_shift, current_pattern, category, current_text,
reason)]` for the ask-me form (category ASK_ME, UNCLASSIFIED, NEW_SEAT, or
AUTO_SWAP when it has no partner).

## Holiday engine and checks

Both modules work on a schedule `dict[person name, dict[date, raw text]]`
(`""` = weekly off; a date missing from the dict is "no data", not a blank) and
`roster_io.Person` objects; the team of a person is `config.team_of(person)`
(section after `team_aliases`). They are pure: they return data, never edit the
schedule, never print and never auto-fix a shortage. No names appear in code,
tests or docs.

### `checks.py`

- `staffing_check(schedule, people, config, start, end, team_of=None) ->
  [Shortage(team, shift, date, have, need)]`: per (team, shift code, day) for the
  shifts ACTIVE that day, people WORKING (a shift code in the cell; not leave, HOL,
  blank, on-call or custom hours) against `min_staff_for_team`. A shift is active
  when a member's pattern works it that day or someone works it, so S2/S4 groups
  are silent Mon-Tue but a Wednesday with everyone on leave or HOL is a shortage.
  A person on leave keeps the shift code of their nearest worked day (28 days).
  Mexico people count when working.
- `hol_check(schedule, people, matrix, roster_labels, start, end, coverage_ok=None,
  ignore_dates=(), ignore_label_pattern=...) -> [Finding(kind, severity, date,
  person, location, message)]`, sorted by date. Kinds: `STRAY` (HOL where the
  location is not ticked, error), `MISSING` (working at a ticked location with no
  HOL, error), `MISSING_UNVERIFIED` ("MISSING (unverified coverage)", warning: a
  working India person on a COMMON holiday when no coverage info was given),
  `HOL_ON_WEEKLY_OFF` (warning, pattern inferred from the surrounding weeks),
  `MISMATCH_NO_LABEL` / `MISMATCH_NO_MATRIX` (holiday vs the roster's holiday row
  labels, warning; labels such as shift swap, winter disconnect and lean shift are
  not holidays and are skipped by default), `UNKNOWN_LOCATION` (info).
  `coverage_ok` is a set of `(name, date)` or a `(name, date) -> bool` of people
  deliberately working a COMMON holiday (pass `HolidayResult.coverage` for a draft);
  when given, an uncovered working India person is a certain `MISSING`. Location-
  specific and Mexico-only holidays need no coverage info: everyone who works at a
  ticked location must have HOL. Leave codes and blank cells are never missing.
  `ignore_dates` skips December Disconnect days.
- Weekly-off pattern inference (`pattern_on`, `week_pattern`): Mon/Tue/Sat/Sun are
  the only days that tell Mon-Fri from Wed-Sun apart; working cells vote for the
  pattern that works them, blanks for the other, leave cells do not vote. The
  person's own Sunday-Saturday week decides, then up to two weeks either side;
  S2/S4 are always Wed-Sun.
- `schedule_from_roster(roster, start, end)`, `resolve_location(text, codes)`.

### `holiday_engine.py`

`assign_holidays(schedule, people, matrix, counters, config, start, end, *,
seed=None, inherited_counters=None, pool_average_seats=()) -> HolidayResult(edits,
assignments, counters_before, counters_after, flags, seed, coverage, pool_average)`.
Holidays in the cycle are processed in date order; only people working that day
are affected (PTO beats HOL and is never counted).

- Location-specific and Mexico-only holidays: everyone working at a ticked location
  gets `HOL`; no fairness, no counters; shortages are flagged (`STAFFING_SHORTAGE`),
  not fixed. Mexico staff always get HOL on any holiday that ticks Mexico, including
  Common India-Mexico rows (so many shifts are flagged on such days: expected).
- COMMON holidays: per (team, shift) group, `outside` (non-India staff, Mexico staff
  when Mexico is not off) count toward the minimum; `pool` = India people working;
  `need = max(0, min_staff(team) - len(outside))`; the pool is ordered by
  `offs_taken` DESC, then `last_off_date` DESC (never-off last), then a seeded
  SHA-256 tie-break; the first `need` cover (keep their shift), the rest get HOL and
  `offs_taken += 1`. So A with 4 offs covers and B with 3 is off; on a tie the person
  who was off most recently covers. Group at or below its minimum: nobody is off,
  flagged `NO_OFF_AT_MINIMUM` (`need == len(pool)`) or `CANNOT_MEET_MINIMUM`
  (`need > len(pool)`). Mexico staff are never in the pool and have no counter;
  COMP is never generated and comp-offs are not tracked.
- `GroupAssignment` per group and holiday: `off`, `straight_off`, `covering`,
  `outside`, `min_staff`, `need`, `shortage`, and the pool's counters before/after.
  `HolidayResult.coverage` is the set of `(name, date)` pairs that deliberately work
  a COMMON holiday (feed it to `hol_check(..., coverage_ok=...)`). The seed is
  recorded in the result and logged; the same inputs and seed always give the same
  result. `apply_edits(schedule, edits)` returns a copy with the edits applied.
- Counters: `OffCounter(offs_taken, last_off_date)` per India person.
  `build_counters(roster, matrix, year, config, cycle_start, disconnect_dates=())`
  (or `build_counters_from_schedule(schedule, people, ...)`) counts each India
  person's HOL cells in the calendar year before `cycle_start` on COMMON holidays
  that fell on a working day, ignoring PTO, December Disconnect days, stray HOLs
  (location not ticked that day), HOLs on a weekly off and HOLs on location-specific
  holidays. ASSUMPTION: only COMMON holidays count, because fairness only applies to
  them. A person with no counter who is not inherited, and every
  `pool_average_seats` name, starts at the pool average (floor of the mean
  `offs_taken` of India people who already have a counter, no last-off date);
  `inherited_counters` ({new name: old name}, from `roster_changes`) copies the
  leaver's counter to the replacement.

## Cycle builder

`cycle_builder.py` wires steps 0-6 into two pure entry points (no file is written, no
workbook touched; the draft is plain data and a later phase writes the xlsx).
`seed_config.py` creates the first rotation config from the roster and a (gitignored)
names file; run it from `agent-apps/shared` with
`..\.venv\Scripts\python.exe -m roster_lib.seed_config --help`. Real names live only in
gitignored files (`agent-apps/shift-roster/config/`, `.../output/`).

Scope: `active_people(roster.people, config)` = everyone not in an excluded section.
Excluded people are never rotated, given PTO or HOL, checked, listed as new/removed or
edited. Needs the roster's `people`, `first_date`, `last_date`, `row_texts` and
`holiday_labels` only.

### `analyze_cycle(roster, config, cycle, *, holiday_matrix=None, holiday_matrix_errors=(), pto_path=None, pto_entries=None, confirmed_pto=None, answers=None, bootstrap=False) -> Analysis`

What the UI shows before building. `Analysis` fields: `cycle`, `previous_cycle`,
`availability` (`cycles.Availability`: enabled, reason, coverage, failing_people),
`changes` (step 0: NEW and REMOVED), `ask_me` (`AskMeItem` list),
`required_answers` (`RequiredAnswer(stage, name, kind, reason, details)`; stage
`changes` / `rotation` / `pto`; only what is STILL missing given `answers` and
`confirmed_pto`), `pto` (entries, exact matches, `needs_confirmation` with candidates,
`unmatched`, `dropped_excluded`, `error` for a bad PTO workbook), `year_boundary`
(crosses, in-file span, remainder span), `holiday_matrix` (present, errors, rows in
the cycle, years without rows), `active_count`, `excluded_people`, `unclassified`,
`blockers`; `ready` is true when nothing blocks `build_plan`. `to_dict()`/`to_json()`.

### `build_plan(roster, config, cycle, answers=None, *, holiday_matrix, pto_entries=None, confirmed_pto=None, seed=None, history=None, bootstrap=False, library_commit=None) -> Plan`

Order: apply roster changes -> rotate -> PTO (PTO beats HOL; `shift_group_rule` driven
by `config.team_of` / `min_staff_for_team`, a minimum of 0 is "no rule") -> holidays
(counters from the roster via `build_counters_from_schedule`; the engine runs once per
calendar year of the cycle, so fairness counters restart on 1 January; December
Disconnect days are skipped) -> checks on the draft (the existing roster overlaid with the
new cycle: `hol_check` with `coverage_ok` from the holiday result, `staffing_check` over
the cycle, headcount per shift) -> assemble. Raises `CycleUnavailable` (previous cycle
has no data, unless `bootstrap`), `MissingInput` (no matrix) or `NeedsAnswers`
(`.missing` list of `MissingAnswer(stage, name, reason)`, `.invalid`, `.to_dict()` ->
`{"status": "needs_answers", ...}`); nothing is guessed.

`answers`: `{"changes": {"<new name>": {"replaces": "<old>"} | {"new_seat": {...}}},
"rotation": {"<name>": {"shift": "S3|KEEP|...", "pattern": "MON_FRI|WED_SUN", "text": "..."}}}`
(see `roster_changes` and `rotation` for the inner shapes). `confirmed_pto`:
`{import name: roster name}`. `KEEP` carries the observed shift AND pattern forward.

`Plan` fields: `cycle`; `edits` (`{(name, date): text}` for every new-cycle cell of
every in-scope person on dates inside the roster file, HOL/PTO included, "" = weekly off);
`remainder_edits` (same for dates after `roster.last_date`, for the next-year file;
holidays there come from the matrix when it has rows for that year); `shift_changes`;
`holiday_assignments` (one per holiday date and team/shift group: off, covering,
outside, need, shortage, counters); `flags`; `counters_before`/`counters_after`
(`next_year_counters` when the cycle crosses 1 January); `config_after` (the updated
config, never saved: roster changes applied, each person's `shift` set to the new
cycle's); `run_info` (cycle, roster span and counts, config version/seed/digest, seed
used and its source, answers digest, input counts, availability, year boundary, library
version and optional commit); `existing_roster_findings` (HOL check and staffing check on
the EXISTING roster for the cycle's calendar year, for the Draft Summary).
`to_json()` is deterministic (same inputs, byte-identical text); `Plan.from_json`.

`Flag(kind, severity, message, person, date, team, shift)`, severity ERROR / WARNING /
INFO, sorted by severity then date. Kinds: `STAFFING_SHORTAGE`, `CANNOT_MEET_MINIMUM`,
`NO_OFF_AT_MINIMUM`; `HOL_STRAY`, `HOL_MISSING`, `HOL_MISSING_UNVERIFIED`,
`HOL_ON_WEEKLY_OFF`, `HOL_MISMATCH_NO_LABEL`, `HOL_MISMATCH_NO_MATRIX`,
`HOL_UNKNOWN_LOCATION`; `PTO_SWAP_SUNDAY`, `PTO_NEEDED`, `PTO_BELOW_MIN`, `PTO_OVERLAP`,
`PTO_UNMATCHED` (error: nobody matches, not applied), `PTO_SKIPPED`, `PTO_NOTE`;
`HEADCOUNT_CHANGED`, `HEADCOUNT_BELOW_MIN` (a team has fewer people on a shift than its
minimum even before leave), `ROTATION_WARNING`, `UNCLASSIFIED_PERSON`, `CHANGE_NOTE`,
`CONFIG_NOT_UPDATED`; `YEAR_BOUNDARY`, `HOLIDAY_MATRIX_NO_ROWS` (a calendar year of the
cycle has no matrix rows: error inside the file, warning beyond it),
`DISCONNECT_HOLIDAY_SKIPPED`, `OVERWRITES_EXISTING`. Flagged problems are never fixed.
`headcount_table(schedule, people, config, cycle)` gives per team: headcount, people per
shift, spec minimum and whether that minimum is attainable per shift (feeds the min-staff
proposal written by `seed_config`).
