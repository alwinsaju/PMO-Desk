# First-run guide: test Shift Roster and December Disconnect today

For the PMO. About 30-45 minutes for both tasks. Everything here is safe for your data: the master roster is
never modified, and nothing is sent to anyone (neither task touches Outlook).

Companion documents: [`DECISIONS-AND-ASSUMPTIONS.md`](./DECISIONS-AND-ASSUMPTIONS.md) (what was decided and what to
confirm), [`ACCEPTANCE.md`](./ACCEPTANCE.md) (test evidence per criterion),
[`shift-roster/README.md`](./shift-roster/README.md), [`december-disconnect/README.md`](./december-disconnect/README.md).

> **Live system warning.** The Tasks app talks to the agent-office backend, which also runs the older mailer and
> report tasks (Weekly Backlog Report, Weekly Aging Report, Deployment DEP Weekend Mailer, Monthly Report Deck).
> Those drive real Outlook and send real e-mail on **Send**. While testing, **never press Run, Approve, Confirm or
> Send on any task other than Shift Roster and December Disconnect.** Some older tasks can also be scheduled to start
> by themselves; do not approve what they produce.

## 0. Before you start (one-time, about 3 minutes)

1. **Restart the agent-office backend once.** It loads its code and the task manifests at start-up, so a backend
   that was already running does not know the new tasks, the file upload, the questions form or the diff review.
   - Look at the Tasks app first. If any task shows **working**, **needs review** or **needs confirm**, finish or
     reset it first: a restart forgets the state of any run in progress (the files on disk stay).
   - Stop the old backend (PowerShell):
     `Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`
     If nothing is listening on port 8000 there is nothing to stop.
   - Start it again by **opening the Tasks app**: AI OS (with `pnpm dev` running at http://localhost:3000) launches
     the backend by itself when the Tasks app opens and shows a launch screen until it answers. The launch log is
     `%TEMP%\ai-os-agent-office.log` (the loading screen quotes the last lines if it fails).
   - No auto-launch? Start it by hand: `cd C:\Projects\Agents-workspace\agent-office` then
     `..\.venv\Scripts\python.exe -m uvicorn backend.main:app --port 8000`.
2. **Check that the new code is loaded.** The Tasks app lists **Shift Roster** and **December Disconnect**, and
   pressing **Run** on either opens a dialog with file upload boxes. If Run just starts the task or the tasks are
   missing, the old backend is still running: repeat step 1. (Read-only check: open http://localhost:8000/tasks in a
   browser; the two tasks appear with an `inputs` list.)
3. **Have these files ready** (any location; you upload them in the app):
   - the live roster workbook (the file with the sheet `PDT Operate`);
   - optional: a new Holiday Roster (Holiday name, Date, one column per location, `X` = off). You do **not** need one:
     the Holiday Roster 2026 reference copy in `tasks\shared\roster-reference\` is used automatically. When the
     PMO shares next year's file, drop `Holiday Roster 2027.xlsx` into that folder (or upload it in the app); the file
     that covers the cycle (newest first) is chosen;
   - optional: a PTO import (Name, From, To, Code P/T/SL);
   - for December Disconnect: the PDT staff roster, and optionally the two monthly Analytics rosters (Oct, Nov).
   Templates: `tasks\shared\roster_lib\examples\holiday_roster_template.xlsx` and `pto_import_template.xlsx`.
4. **Before the first December Disconnect run, edit the winter config** if anybody has rolled off:
   `tasks\december-disconnect\config\winter-config.json`, list them in `exclusions.people` (the roll-off column
   in the staff roster is not used). Details: open item (c) in the decisions note.

## 1. Where files go

| What | Where |
|---|---|
| Files you upload in the app | The task's `input/` folder, renamed (`input/roster.xlsx`, `input/holiday-roster.xlsx`, ...). Your original file is never touched. |
| Everything a run produces | The task's `output/` folder: `tasks\shift-roster\output\` and `tasks\december-disconnect\output\` |
| The drafts you edit in Excel | `output\Roster DRAFT <cycle>.xlsx`; `output\Winter Coverage DRAFT <window>.xlsx` and `output\Analytics Winter Coverage DRAFT <window>.xlsx` |
| Final files | `output\final\` (`roster - final Dec 2026.xlsx`, the next-year file `roster - 2027.xlsx`, `Winter Coverage FINAL ...xlsx`, `Analytics Winter Coverage FINAL ...xlsx`) |
| Audit log (who approved which cells) | `output\audit\<run id>.json` and `output\audit\audit.log.jsonl` (append-only) |
| Backup of the master | `shift-roster\output\backups\roster.<hash>.xlsx` |
| Settings you can edit | `shift-roster\config\rotation-config.json`, `december-disconnect\config\winter-config.json`, `analytics-config.json`, optional `task-config.json` |
| Config backups | `shift-roster\config\backups\rotation-config.<UTC time>.json` (made before each change) |
| Reference copies | `tasks\shared\roster-reference\`: used by tests and the seed script; the Shift Roster task also reads its `Holiday Roster*.xlsx` file(s) when you do not upload a Holiday Roster (read-only, never changed or deleted) |

`input/`, `output/` and `config/` hold real employee data and are gitignored.

## 2. Shift Roster, step by step

1. In the Tasks app press **Run** on **Shift Roster**. The Run dialog opens.
2. **Upload** the roster workbook (drag and drop, or choose). Optionally upload the PTO import and, only if you have a
   newer one, a Holiday Roster; otherwise the reference file is used (the dialog says "Not uploaded - the reference
   file will be used").
3. Press **Check inputs** (available as soon as the roster is uploaded). It reads the files (up to a minute) and lists
   the cycles; a quiet line under it says which Holiday Roster will be used ("reference file (covers 2026-2027)" or
   "uploaded file"). Problems (for example a bad Holiday Roster row) appear in a list.
4. **Choose the cycle**: the default is Dec 2026 - Jan 2027 (`2026-12`). A greyed-out cycle explains itself when you
   hover (previous cycle not at 95% data, config or Holiday Roster unusable).
5. Press **Start**. The task analyses the roster and stops at **Answer questions** (a few seconds).
6. Open the task (click its card), tab **Questions**. Answer every required question (people whose shift is asked
   every cycle, new people: new seat or replaces whom, close PTO name matches). Press **Save answers**, then
   **Approve**. Approve is refused while a required answer is missing or unsaved.
7. The draft is built. When the task needs review, open the **Draft flags** tab. Read the flags (section 5), press
   **Open draft workbook** to open the draft in Excel.
8. **In Excel** (section 4 lists what to check): fix what needs fixing, then **save in place**: Ctrl+S, same file
   name, same folder, still `.xlsx`. Close Excel (an open file cannot be read). Do not use Save As, rename or move it.
9. Press **Approve**. The task compares your saved draft with what it wrote and stops at **Confirm the changes**.
10. Open the **Changes** tab. Look at every changed cell (tabs: Changed cells, Outside plan, Issues, Flag delta). If
    an **Issues** row is blocking, the confirm button is refused: see section 7.
11. Press **Confirm the changes**. The final is built.
12. The completed notification has **Open** buttons. The final roster is in `output\final\` and, when the cycle runs
    past the end of the roster file (Dec 2026 does), also the **next-year file**. Open both once in Excel.

## 3. December Disconnect, step by step

1. Press **Run** on **December Disconnect**.
2. **Upload** the shift roster workbook and the PDT staff roster workbook. Optionally upload the Analytics roster for
   the first month and for the second month (without them the Analytics config is used as is).
3. **Check inputs**, then pick the window (`2026-12-25..2027-01-01`), then **Start**.
4. **Questions** tab: shift for each person with no history (S1 is pre-selected: change it where wrong), a yes/no for
   each close name match (open item (b)), and optional **Availability exceptions** rows (person, dates
   `YYYY-MM-DD, comma separated`, "not available on" or "available ONLY on"; 5 rows for the main plan, 3 for
   Analytics). **Save answers**, then **Approve**.
5. **Two drafts** are built: the main plan and the Analytics plan. The Draft flags tab has **two Open buttons**
   ("Main plan" and "Analytics plan"). Open both.
6. Fix cells in Excel: main plan in the `Winter Plan` grid (dropdown of shift codes; empty = not working), Analytics
   in the `Winter Roster` sheet (`Assigned` dropdown). Other tabs recalculate. **Save BOTH files in place** (same
   names, same folder) and close Excel.
7. **Approve**, review the **Changes** tab (changes of both files; Analytics rows read `Analytics <slot>`), then
   **Confirm the changes**.
8. The finals are in `output\final\` (two Open buttons). The December days 26-31 Dec are added to the Shift Roster
   config automatically (a backup of the old config is kept in `shift-roster\config\backups\`).

## 4. What to check in Excel

Do this on the **first Shift Roster draft**, on **both** December Disconnect drafts, and again on the finals and the
next-year file. Nothing in this build has ever been opened in Excel (neither Excel nor LibreOffice was available), so
your eyes are the real test.

1. **Does it open cleanly?** A message like "We found a problem with some content... Do you want us to try to
   recover?" is a bug. Do **not** save; click **Yes** only to look, then report it (section 6) with a screenshot.
   A yellow "Protected View" bar is normal: click Enable Editing.
2. **Sheets.** Shift Roster draft: your original sheets plus `Draft Summary`, `Shift changes`, `Holiday assignments`,
   `Flags`, `Run log`. December Disconnect main plan: `Winter Coverage`, `Winter Daily Roster`, `Winter Plan`.
   Analytics plan: `Daily View`, `Winter Roster`, `By Person`. A hidden sheet called `_snapshot` is part of every
   draft (and final): it cannot be unhidden from Excel's menu; **never delete it or try to remove it**, the
   comparison depends on it.
3. **Styles and colours.** Roster cells for the cycle show the usual shift colours (Shift-1.., HOL, P/T/SL) from the
   master's own conditional formatting; weekly offs are blank. In the winter main plan the heat map is green
   (minimum met), amber (below) and red (nobody); a cell whose shift differs from the person's usual shift has an
   orange border. In `Flags` errors are red rows and warnings amber.
4. **Dropdowns.** Roster cells still offer whatever code list the master had; `Winter Plan` offers the shift codes;
   Analytics `Assigned` offers the people names. Picking something not on the list is refused (stop-style).
5. **Formulas.** Dates and weekdays across the top, totals, `Days worked`, the Analytics `By Person` RULE CHECK table
   (PASS / FAIL) should show numbers and words, never `#NAME?`, `#REF!` or `#VALUE!`. Change one cell and watch the
   totals follow.
6. **Comments and links.** Comments (also threaded) and hyperlinks of the master are still on their cells.
7. **Next-year file.** The date row starts the day after the roster's last date; the grid holds only the remainder
   of the cycle; the holiday row has the new labels; the title and key text may still say the old year (listed in
   its warnings). Excel recalculates it on open and may ask to save on close: that is expected.
8. **Final vs master.** The final differs from the master only in the cells you approved (the Changes tab is the
   list). Quick check: compare a few rows of cells by eye or with Excel's Spreadsheet Compare.

## 5. What the flags mean

Flags are shown in the Draft flags tab and in the draft's `Flags` sheet. They are **never auto-fixed**: you decide.
Severity: **error** = the plan breaks a rule or the data is wrong; **warning** = look at it; **info** = for your
information.

### Shift Roster

| Kind | Severity | Meaning |
|---|---|---|
| `HOL_STRAY` | error | A HOL in a cell where that person's location is not ticked in the Holiday Roster. Check whether it is a mistake or PTO typed as HOL. |
| `HOL_MISSING` | error | Someone works a holiday ticked for their location but has no HOL. |
| `HOL_MISSING_UNVERIFIED` | warning | Working India person on a Common holiday while no coverage information exists. |
| `HOL_ON_WEEKLY_OFF` | warning | HOL on a day that is the person's weekly off. |
| `HOL_MISMATCH_NO_LABEL`, `HOL_MISMATCH_NO_MATRIX` | warning | A holiday in the roster's label row that is not in the Holiday Roster, or the reverse. |
| `HOL_UNKNOWN_LOCATION` | info | A person's location is not one of the Holiday Roster columns. |
| `STAFFING_SHORTAGE` | error when nobody works, otherwise warning | A team has fewer people working than its minimum that day (DIS, DEP, L3 per shift; other teams per team per day). Flagged, not fixed. |
| `CANNOT_MEET_MINIMUM` | warning | On a Common holiday the group cannot reach its minimum even with nobody off. |
| `NO_OFF_AT_MINIMUM` | info | The group is exactly at its minimum, so nobody got a HOL that day. |
| `PRESERVED_LEAVE` | info | A leave code (P, T, SL, COMP or a hand-typed HOL) already in the roster was kept as typed. |
| `PTO_UNMATCHED` | error | A PTO import name matches nobody on the roster; that entry was not applied. |
| `PTO_NEEDED`, `PTO_BELOW_MIN`, `PTO_OVERLAP`, `PTO_SWAP_SUNDAY` | warning | PTO clashes: a person someone depends on, a team dropping below its minimum, overlapping entries, PTO on the swap Sunday. |
| `PTO_NOTE`, `PTO_SKIPPED` | info | A PTO entry kept an existing code, or you chose Skip. |
| `ROTATION_WARNING`, `HEADCOUNT_CHANGED`, `UNCLASSIFIED_PERSON` | warning | The rotation did something worth a look (an answer was ignored, a shift now has a different headcount, a person has no category). |
| `HEADCOUNT_BELOW_MIN` | warning | A per-shift team has fewer people on a shift than its minimum before any leave. |
| `HOLIDAY_MATRIX_NO_ROWS` | error inside the file, warning beyond it | The Holiday Roster has no rows for a calendar year the cycle touches, so no HOL was assigned there. |
| `YEAR_BOUNDARY`, `DISCONNECT_HOLIDAY_SKIPPED`, `OVERWRITES_EXISTING`, `CHANGE_NOTE`, `CONFIG_NOT_UPDATED` | info | The cycle crosses the file end (next-year file), a disconnect day was skipped, a non-blank cell was changed, a person change note, the config will be updated on finalize. |

### December Disconnect

Kinds start with `WINTER_` (main plan) or `ANALYTICS_` (Analytics plan); the message says `[Main]` or `[Analytics]`.

| Kind | Severity | Meaning |
|---|---|---|
| `WINTER_TEAM_MIN` | error | A team has fewer people than its daily minimum (DIS 2, DEP 2, CMS 2.0 1, LNS 2.0 1, Integration HUB 1). |
| `WINTER_DAYS_BELOW_MIN`, `WINTER_DAYS_ABOVE_MAX` | warning when availability forces it, otherwise error | A person works fewer than 3 or more than 5 days (best-effort teams: at most 3). |
| `WINTER_SHIFT_NOT_USUAL`, `WINTER_USUAL_SHIFT_EDITED` | error | A cell holds a shift that is not the person's usual one, or the usual-shift column was edited. |
| `WINTER_UNAVAILABLE_DAY`, `WINTER_DOUBLE_SLOT`, `WINTER_NOT_A_SHIFT` | error | Planned on a day they are unavailable, two slots in a day, a cell that is not a shift code. |
| `WINTER_BEST_EFFORT_GAP` | warning | A best-effort team (L3, Lab, ...) has nobody on a day. Allowed. |
| `WINTER_NAME_FUZZY`, `WINTER_STAFF_NOT_ON_SHIFT_ROSTER`, `WINTER_SHIFT_ROSTER_NOT_ON_STAFF`, `WINTER_UNMAPPED_TEAM` | warning | Name or team differences between the two rosters. |
| `WINTER_SHIFT_ASSUMED` | info | A person with no shift history was planned on the shift you answered (default S1). |
| `ANALYTICS_FILLED`, `ANALYTICS_GRID`, `ANALYTICS_ONE_ON_CALL`, `ANALYTICS_ON_CALL_DAY`, `ANALYTICS_DOUBLE_SLOT`, `ANALYTICS_AVAILABILITY`, `ANALYTICS_ROLES`, `ANALYTICS_SLOT_COUNTS`, `ANALYTICS_PEOPLE_LIST` | error | An Analytics rule is broken: an open slot, not exactly one person on call, a slot on the person's own on-call day, and so on. |
| `ANALYTICS_NOTE` | info | Why one person got an extra slot (the standard counts add up to 29 for 30 IST slots). |
| `ANALYTICS_AVAILABILITY_EXCEPTION`, `ANALYTICS_ROSTER_REFRESH`, `WINTER_STABILITY` | info | Your availability rows were applied, the usual shifts were refreshed from the Oct/Nov rosters, people kept their days from the previous run. |
| `WINTER_DRAFT_FILE`, `ANALYTICS_DRAFT_FILE` | info | Where each draft file is. |

An **error in the draft flags is not a blocker by itself** (you can still approve); an error that is still there when
the saved files are re-checked shows up as **blocking** in the diff and stops the confirm.

## 6. Reporting a bug

Say which task, which step and what you clicked. Then attach, in this order:

1. **The Log tab** of the task in the Tasks app (it refreshes live): the last lines show the failing step and the
   one-line `ERROR: ...` message. A screenshot is enough.
2. **The History tab** (past runs, with who approved what and when).
3. The task's **`output\` files**: `options.json`, `analysis.json`, `ask-me.json`, `flags.json`, `roster-diff.json`,
   `report-data.json`, `plan.json`, and the newest file in `output\audit\`. They contain real names: keep them on
   your machine and hand them to the developer directly.
4. For a launch problem: `%TEMP%\ai-os-agent-office.log`.
5. A screenshot of any Excel message, and the draft file you saved.

Scripts print counts only (no names) in their log lines, so the Log tab is safe to screenshot.

## 7. Common messages and fixes

| What you see | Why | What to do |
|---|---|---|
| A cycle is greyed out; hover says the previous cycle has too little data | Fewer than 95% of person-weeks of the previous cycle have a code | Fill the previous cycle in the roster, or pick the cycle that is enabled. |
| "no cycle can be selected" / "The Holiday Roster cannot be used: ..." | Bad or missing rows in the Holiday Roster (messages quote row numbers) | Fix the file, upload it again, **Check inputs** again. |
| A cycle is greyed out with "Holiday Roster (reference file) has no 2027 rows ..." | The reference Holiday Roster does not cover a year the cycle touches | Drop the new year's `Holiday Roster 2027.xlsx` into `tasks\shared\roster-reference\`, or upload it in the dialog, then **Check inputs** again. |
| "no Holiday Roster: upload one or add one to roster-reference" | No upload and no `Holiday Roster*.xlsx` in the reference folder | Upload a Holiday Roster, or put one in `tasks\shared\roster-reference\`. |
| **Run** does not show upload boxes | Old backend still running | Section 0, step 1. |
| Start is greyed out ("Still needed: ...") | A required file or the cycle/window is missing | Upload it or choose the option. |
| Approve is refused at Questions | A required answer is missing, or you have unsaved answers | Press **Save answers** first, answer the required (marked) questions. |
| "the answers are incomplete or invalid: ..." | The answers file does not match the form | Press Reject / Start over, run again, answer all questions. |
| "... changed since the analysis ... run the task again from the start" | An input file (roster, Holiday Roster, PTO, config) was replaced or edited after you started | Start over (Reject, or Start over) and run again. Do not edit config files while a run is open. |
| "the draft Roster DRAFT <cycle>.xlsx is missing from output/; save your edits ..." | The draft was renamed, moved or saved elsewhere | Put it back under its original name in `output\`, or start over. |
| "the saved draft cannot be read (is it still open in Excel?)" or "is not a valid .xlsx file" | Excel still has it open, or the file is damaged | Close Excel and approve again; if damaged, start over. |
| Confirm refused: blocking `SNAPSHOT_TAMPERED` or `SNAPSHOT_MISSING` | The hidden `_snapshot` sheet was altered or removed, or the sidecar `.snapshot.json` is missing | Do not edit it. Start over. |
| Confirm refused: blocking `MASTER_CHANGED` / `INPUT_CHANGED` / `CONFIG_CHANGED` / `PLAN_CHANGED` | A file the draft was built from changed | Start over and re-run. |
| Confirm refused: blocking `PERSON_MISSING` (renamed or deleted a name row) | A person row in the draft was renamed or removed | Restore it in Excel, save, approve again; otherwise start over. |
| Confirm refused: blocking `WINTER_*` / `ANALYTICS_*` | Your edit breaks a rule (team minimum, 3-5 days, usual shift, on-call, ...) | Read the row to learn which rule. You cannot go back to Excel from the confirm gate, so press **Start over**, run again and make a different edit. |
| **Blocked confirm: Start over, then run again** | The backend has no Reject at the confirm gate | Press **Start over**, then **Run** from the start. A Shift Roster re-run **overwrites** the draft (copy your edited draft first if you want to keep it); a December Disconnect re-run **archives** the old drafts in `output\archive\<UTC time>\` and builds new ones without your manual edits (re-apply the ones you want, or enter them as availability exceptions). |
| "the draft was changed after you confirmed the comparison" | The draft file was saved again after Confirm | Run the comparison again (start over if needed) and confirm. |
| "the master roster changed since the analysis: start a new run" | The roster input changed | Start a new run. |
| "the rotation config changed since the analysis" on a finished run | `finalize` updates the rotation config, so a finished run cannot be finalized twice | Start a new run. |
| "no idle agents" / Run greyed out | All four workers are busy with other tasks | Wait or press Reset on a stuck task (Force reset only clears the status, it does not stop a running script). |

## 8. Rollback and cleaning up

* **The master is untouched.** Neither task writes your original roster, the upload copy `input\roster.xlsx`, or the
  Holiday Roster. The final roster is a **new** file in `output\final\`; delete it if you do not want it.
* **Reject or Start over** at any gate abandons the run; drafts stay in `output\` and the next run replaces them
  (December Disconnect archives them).
* **Master backup**: `shift-roster\output\backups\roster.<hash>.xlsx` is a verified copy of the master as it was.
* **Config rollback** (Shift Roster): `finalize` replaced `config\rotation-config.json` and kept the old one in
  `config\backups\rotation-config.<UTC time>.json`. To undo, copy the backup over `config\rotation-config.json`.
  The December Disconnect also writes a backup there before it adds the disconnect days. After a rollback, delete the
  final files you do not want and start a new run.
* The **audit log** is append-only: leave it, it is the record of what was approved.

## 9. Try these once (quick sanity tests)

1. **One-cell edit.** In the draft change a single roster cell and save in place. After Approve the Changes tab
   should list exactly that one cell, no issues. Confirm: the final differs from the master in your cell plus the
   planned cells only.
2. **Break something on purpose** (December Disconnect): put a shift that is not the person's usual one into one
   `Winter Plan` cell. Approve. The Changes tab should show a blocking row and the confirm button should be refused.
   Press **Start over**.
3. **Open the Log tab** during a run to see the live progress lines.

## 10. Getting fixes without reinstalling

You should not need to reinstall AI OS when a bug is fixed:

* **Screen/layout fixes** (the Tasks app, dialogs, menus): an installed build runs its bundled copy by default, so
  these need a reinstall unless you opt into a live mode. Set the user environment variable `AI_OS_MODE=live-dev`
  (the persistent way; the installer deletes `live-config.json` on every reinstall) and the app runs the UI from
  the project folder (`C:\Projects\AI OS`) and reloads when the code changes. The window title shows
  `AI OS (live-dev: ...)` when this is active; `Help > About AI OS` explains it if it fell back to the bundled copy.
  If a page looks stale, use `View > Reload`, or `Developer > Restart UI server` (this also restarts the backend).
* **Task and backend fixes** (scripts, `task.json` manifests, the agent-office code) load when the backend
  restarts: click the **gear icon (top right) > Restart backend**. It first looks at the Tasks app state: if a task
  is **working**, **needs review** or **needs confirm**, it lists it and asks you to confirm, because a restart
  stops that run (default is Cancel). Finish or reset the run first when in doubt. It works only on a backend that AI
  OS itself started; if you started the backend by hand it tells you so and leaves it alone.
* A reinstall is needed only when the Electron shell itself changes (you will be told).
