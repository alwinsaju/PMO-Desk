# Roster workbook structure (name-free findings)

Structural notes from inspecting the reference files in
`tasks/shared/roster-reference/` (gitignored, real data). Only layout and
feature inventory are recorded here: no person names, no cell values that
identify people. `roster_io.py` / `xlsx_patch.py` are written against this.

## Which file is the live `PDT Operate` roster?

`Shiftroster_Takeda_Redesigned_v2.xlsx` contains a visible sheet named exactly
`PDT Operate` with the full roster grid, so it is the structural twin of the
live workbook. It is probably **not** the live master itself:

- it carries only 33 conditional-format rules (the user reports 130k+ in the
  master), so it looks like a cleaned/redesigned copy;
- its one hyperlink points at a SharePoint file called `Shiftroster_Takeda.xlsx`
  (the live master) under a team-governance folder.

The code makes no assumption that the live file is small; the reader and
patcher never parse the conditional-format section (see `README.md`).

Other reference files (not read by `roster_io`):

| File | Sheets | Notes |
|---|---|---|
| `PDT Staff Roster.xlsx` | `Takeda PDT Operate Team` (visible, A1:AE95), `Contact-duplicate` (hidden) | Staff list/contact table, not a date grid. No CF, no validation. Has a sensitivity label, customXml, a drawing, calcChain. |
| `Dec Disconnect Coverage - PDT.xlsx` | `Winter Coverage`, `Winter Daily Roster`, `Winter Plan` (all visible) | Formula-driven winter-coverage views (24 CF rules on the daily sheet, name lists joined with line breaks, dates 25 Dec .. 1 Jan). No threaded comments, no persons part. |
| `Dec Disconnect Coverage - Analytics.xlsx` | `Daily View`, `Winter Roster`, `By Person` | Same family for Analytics. |
| `Shift Roster - Analytics_October_2026.xlsx` / `_November_2026.xlsx` | `Master`, `Schedule`, `Holiday Coverage`, `TRF Monitoring`, `OC Schedule`, `Contact Details` (+ `BotData` in November) | A different layout (not the `PDT Operate` grid). The `Schedule` sheet has hundreds of accumulated CF rules (496 / 424): that growth pattern is what the master suffers from. |

## Package inventory of the Redesigned v2 workbook

Six sheets: `PDT Operate` (sheet1.xml, visible, ~850 KB XML), `Notes` (hidden),
`PDT Analytics` (hidden), `Holiday Roster 2026` (visible), `December 2025
disconnect` (hidden), `Monitoring+MIM+Patching Escalat` (hidden). Defined names:
three hidden per-sheet `_FilterDatabase`, `JA` (the whole column `DT` of
`PDT Operate`), `Print_Titles` (columns A:D, rows 12:14). `calcPr` has only a
`calcId` (no forced full calc).

Parts present (all must survive a patch untouched):

- 1 `xl/threadedComments/threadedComment1.xml` (18 threaded comments, all on
  `PDT Operate`: 16 on date cells, 2 on name cells) with its legacy mirror
  `xl/comments1.xml` and `xl/drawings/vmlDrawing1.vml`; `xl/persons/person.xml`
- `docMetadata/LabelInfo.xml` + `docProps/custom.xml` (7 `MSIP_Label_*`
  properties): the sensitivity label
- `customXml/item1..3.xml` + props + rels (SharePoint/content-type metadata)
- `xl/webextensions/` (taskpane add-in)
- 3 drawings + 4 PNG media (logo images), 5 printerSettings
- `xl/calcChain.xml` (~35 KB), `xl/sharedStrings.xml` (~19 KB), `xl/styles.xml` (~150 KB)

`PDT Operate` sheet XML specifics:

- 88 rows, 28,824 `<c>` elements, dimension `A1:NF88`
- text storage: shared strings (11,471 `t="s"`), 365 `t="str"` (the weekday
  formula results), **no** `inlineStr`
- 812 formulas, 760 of them shared-formula children; none in the people data
  region
- 3 `<conditionalFormatting>` blocks / 33 `<cfRule>`: holiday row (`E12:NE12`,
  4 rules), "today" highlight on the date/weekday rows (1 rule), data region
  (`E16:NE88`, 28 rules). **No** `x14` / `extLst` conditional formatting or
  validation on this sheet (there is no `<extLst>` at all); other sheets were
  not checked for it.
- The data-region rules test the cell **text** with `SEARCH(...)` substrings
  (`shift-1`..`shift-5`, `ns`, `hol`, `us-cst`, `us-pst`, `pto`, `comp`,
  `on-call`/`on call`, `am`, `pm`, `ist`, ...) plus exact matches (`"P"`, `"T"`,
  `"OC"`, `"SL"`); rules are priority-ordered with `stopIfTrue` on some. Colour
  is therefore a function of the exact text typed, and short tokens (`ns`, `am`,
  `pm`, `ist`) match inside longer strings.
- 1 data validation (list, `errorStyle="information"`, so any text is
  accepted): `Shift-1..Shift-5, NS, US-CST, US-PST, HOL, P, PTO, T, COMP, OC,
  On-call, Shift-Swap`; its `sqref` covers the people rows only (not section
  headers or legends).
- 1 external hyperlink sitting on a **data cell** inside the people area
  (`hyperlink` element with an `r:id`; the URL embeds tenant/user data, not
  recorded here).
- 13 merged ranges: title (`C1:D1`), top note (`A11:D11`), label block
  (`A12:D14`), holiday label spans on row 12 (e.g. the last five columns), and
  one `A:B` merge per section header row.
- `autoFilter` on `A15:D88`; frozen panes only split columns (`xSplit=4`).
- `<cols>`: A=13, B=26, C=9, D=30 wide, E..NE (5-369) width 10.

## Grid layout (content cues, no row hard-coded in code)

Row numbers below are those of the v2 file, listed to show the shape; the
reader finds them from content.

| Rows | What |
|---|---|
| 1 | Title in `C1` (merged `C1:D1`), tall row |
| 2-10 | **Top key**: col A shift code (Shift-1..5, US-CST, US-PST, NS, Swap), col B its timing text, cols C/D a second key (COMP, OC, HOL, P/PTO, T, Other) with descriptions |
| 11 | Merged note (`A11:D11`) |
| 12 | **Holiday-label row**: `A12`="Resource" (merged `A12:D14`); labels typed in the date columns (about 32 labels: public holidays with scope text such as "Only Gur", "MEX HOL", "Shift Swap", "Winter Disconnect"). Some labels sit in a merged span. |
| 13 | **Date row**: `E13` is a literal serial; `F13..NE13` are `prev+1` shared formulas in 6 chunks, with cached values. Serial 46024 = Fri 2026-01-02, so the grid runs **2026-01-02 .. 2027-01-01 (365 columns, E..NE)**; 1 Jan 2026 is not a column. |
| 14 | **Weekday row**: shared formula `TEXT(E13, "ddd")` (cached strings `Fri`, `Sat`, ...) |
| 15 | **Column-header row** `#` / (first section title) / `Loc` / `Team`. It doubles as the first section's header: col B holds the section title `L2`. |
| 16-88 | People and sections (below) |

Label columns: A = serial `#` (formula chain), B = name, C = `Loc`, D = `Team`.
`C` holds a **city name** in the real file (Bengaluru, Chennai, Gurgaon,
Hyderabad, Kolkata, Mexico, Pune, and `US` for governance), not a short code, so
`Person.location_code` carries the raw text unless `location_aliases` maps it.

**Column A chain**: `A16` is the literal `1`; every later person row holds
`=A{previous person row}+1` (some as shared formulas), skipping section header
and legend rows. Row insertion in Excel rewrites these references; programmatic
row insertion does not, so the program never inserts rows (see Risks).

**Sections** (header rows): `L2` (rows 16-37, 22 people), `DEP` (38; 8),
`L3` (47; 5), `Device Support` (59; 3), `Lab` (68; 3), `Device Support L3`
(72; 1), `CMS 2.0` (74; 2), `EKS` (77; 1), `L N S 2.0` (82; 2; typed with
spaces, aliased to `LNS 2.0`), `Governance` (85; 3). 50 people in total, matching
the final serial. Header cue: title text in col A (merged `A:B`), no name, no
location. Stray text can appear on a header row (a `Team` label in col D on the
DEP header; 9 stray cells in the date columns on the Device Support header), so
header detection must not require the rest of the row to be empty.

**Team labels** (col D, free text, independent of the section): `L2 DIS USI`,
`L2 DIS US`, `DIS USI`, `L2 Infra USI`, `Complaints`, `DEP USI`, `Loyalty`,
`L3`, `Device Support`, `Device Support L3`, `Lab`, `CMS 2.0`, `EKS`, `LNS 2.0`,
`Governance`. A person's team label can differ from the section they sit in.

**Legends / timing keys under sections** (3 blocks): rows 54-58 (after `L3`,
before `Device Support`), 64-67 (after `Device Support`, before `Lab`), 80-81
(after `EKS`, before `LNS 2.0`). Each block is one thin spacer row (height 7.95,
no content) followed by rows of `col A = shift key`, `col B = timing text`, with
columns C/D empty; a continuation row can have only col B. One block contains a
`Deployment (D)` key and another a `Weekend(W)` key. Which section a legend
documents is not machine-detectable (see Risks).

## Cell content

- People data cells exist for **every** date column in every people row (styled
  `<c r= s=/>`), blank or not: a blank styled cell is a weekly off. Only the
  string cells have `t="s"`.
- Roughly 38% of person x date cells are blank (weekly offs, not-yet-joined
  people and two of the three `Governance` rows).
- 45 distinct raw texts in the 2026 grid. Beyond the canonical codes
  (`Shift-1`..`Shift-5`, `NS`, `US-CST`, `US-PST`, `HOL`, `P`, `PTO`, `T`,
  `COMP`, `On-call`, `OC`, `SL`) there are free-text timings (`11AM-8PM`,
  `12PM-9PM`, `1PM-8PM`, `2PM - 11PM`, `IS 6:00-3:00AM`), and case/spelling
  variants (`shift-1`, `shift 2`, `Shift 3`, `p`, `ON-call`, `on-call`, `On call`,
  `Comp Off`, `comp off`, ...) and multi-line text (`Shift Swap` + a line break +
  `NS`, with a raw CR LF inside the XML).
- Raw CR LF inside XML text is normalised to LF by any XML parser, so the readers
  here do the same (`xlsx_patch.decode_text`).
- Cells carrying comments (18) and the one hyperlink are ordinary data/name
  cells; writing text into them leaves the comment/hyperlink attached but
  possibly stale.

## Risks for patching (details in README)

- Never write into formula cells (column A chain, date row, weekday row): the
  patcher refuses them by default; overwriting also needs `calcChain` edits.
- Commented cells: a changed code under an old comment is misleading.
- The roster is year-bound: the grid ends at the last date column; cycles that
  cross it need a second file/year.
- The file is a living SharePoint document: patch a **copy**, never save over
  the source; Excel may be holding the live file open.
