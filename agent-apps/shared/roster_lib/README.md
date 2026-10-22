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
`resolve_location_code`, `min_staff_for(subteam)`.
