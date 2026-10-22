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
