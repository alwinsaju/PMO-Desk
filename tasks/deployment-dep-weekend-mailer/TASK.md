# Deployment & DEP Weekend Activities Mailer

## Purpose
Generates and sends the recurring Deployment & DEP Weekend Activities mailer, run every Friday. Team leads report their weekend deployment/DEP activities during the week (via Teams — handled entirely by the user, out of scope for this task); the user consolidates those into the shared Excel workbook themselves. This task's job starts after that: pull the week's table straight out of that workbook and drop it into the fixed Outlook mailer template, then send once the user confirms the draft looks right. No filtering, matching, or aggregation of the underlying activity data — per the user, that's already done by the time the workbook lands in `input/`.

## Trigger
Manually started by the user from the Tasks app every Friday, after they've updated the workbook with the week's activities and provided it (the Run dialog's upload box, or dropped into `input/`). No Teams integration — Teams parsing is explicitly out of scope; the user consolidates inputs into the Excel workbook themselves before starting the task. No ServiceNow-style raw export either, unlike [weekly-backlog-report](../weekly-backlog-report/TASK.md) and [weekly-aging-report](../weekly-aging-report/TASK.md) — the workbook the user maintains already *is* the final table.

## Inputs (live in this folder)
- `input/Deployment and Activites.xlsx` — this week's workbook, maintained/updated in place by the user (same filename every week, not a dated export). `build_email_data.py` picks the most recently modified `.xlsx` in `input/` that isn't named `Template - ...`, so this convention can drift without breaking the task.
- Upload and clean-up: Run opens an upload dialog with one required input, the workbook, saved as `input/Deployment and Activites.xlsx`. Upload the whole maintained workbook each week (its `Deployment` history blocks and the `Activities` sheet are read from it). `task.json` has `cleanup: {onComplete: true}`: after a COMPLETED run the Tasks engine deletes this run's `input/` files (dotfiles aside), so upload a fresh file for the next run; `output/`, `reference/`, `templates/` and `config/` are never touched, and a failed or abandoned run keeps its input. Keep your own master copy of the workbook outside this folder.
  - **`Deployment` sheet** — accumulates one dated block per week (e.g. `Weekend Activities 02/23/2026`, `Deployment Activities 08/24/2026`), each starting with a merged A:E title row, older blocks left in place above as history. The task always reads the **bottom-most** block — that's this week's.
  - **`Activities` sheet** — the standing recurring schedule (APC, appointment cancellations, SFMC job monitoring, plus a `Weekly Activity` section). Not week-specific — read in full every run, unfiltered.
  - Point of Contact / Assignee cells are first-name-only (e.g. `Saranya`, `Tushar/Vansh` for multiple people) — resolved against `../shared/roster/Names.xlsx` by first-name match (see Name resolution below).
- `reference/Template - Deployment and Activites.xlsx` — a snapshot of the workbook from a prior week (last block dated 08/17/2026). Kept for reference on the expected sheet/column layout, not reprocessed as input.
- `templates/Deployment and POC Details 08172026  DEP Team Schedule.msg` — the actual mailer sent for that prior week: fixed To/Cc, subject pattern `Deployment and POC Details {M/D/YYYY} & DEP Team Schedule`, intro paragraph naming the date, the Deployment Activities table, then the Activities table, no workbook attached. Per the user, this run's output should be re-skinned with the **Deloitte x Takeda co-branding** built for the other two agents (see Branding below) rather than this template's original plain green header — everything else about its structure (both tables, the subject/intro pattern, no attachment) carries over as-is.
- `../shared/roster/Names.xlsx` — same roster the other two mailer tasks use, reused here for first-name resolution (see Name resolution).

## Workflow
1. User updates `input/Deployment and Activites.xlsx` with the week's activities (their own manual process, off the Teams inputs) and confirms it's in place.
2. User starts the task (Run in the Tasks app).
3. `scripts/build_email_data.py` finds the workbook, extracts the bottom-most dated block from `Deployment` (with Day/Date rowspans reconstructed from Excel's merged cells) and the full `Activities` sheet, resolves every POC/Assignee first name against `../shared/roster/Names.xlsx`, and writes `output/email-data.json` — including the subject's date string and a bolded/ordinal date phrase for the intro sentence.
4. `scripts/create_draft.ps1` builds the two Deloitte x Takeda co-branded HTML tables, creates the Outlook item with the fixed To/Cc and subject pattern, and calls `.Display()` so the draft opens visibly in the user's own Outlook window. It does **not** send. The draft's EntryID is written to both stdout and `output/draft-entry-id.txt` (the latter is what the Tasks engine's `capturesEntryId` step reads).
5. The task pauses at its `review_gate` so the user can look at the draft, then at the `send_gate` confirm gate and waits for explicit confirmation.
6. On confirmation, `scripts/send_draft.ps1 -EntryId <id>` sends via the user's Outlook desktop app. Nothing is sent before the user confirms at the `send_gate`, even after the draft itself was already approved.

## Name resolution (first-name-only POC/Assignee cells)
Unlike the other two tasks' ServiceNow-vs-roster matching (full names on both sides), this workbook's POC/Assignee cells are typically a single first name, sometimes several people separated by `/` (e.g. `Tushar/Vansh`). `build_email_data.py` resolves each independently against `../shared/roster/Names.xlsx`:
1. Exact full-name match (case-insensitive) — silent.
2. Unique first-name match against the roster — used, but flagged in the console for the user to confirm (first names are unique across the current roster, but this is re-checked every run rather than assumed).
3. Ambiguous (multiple roster members share that first name) or no match at all — falls back to plain, non-linked text in the mailer, flagged in the console as unresolved.

This is deliberately a separate, simpler matcher from `../shared/roster/name_matching.py` (built for full ServiceNow "Assigned to" text) rather than a reuse of it — that matcher's fuzzy logic doesn't handle a 3-token roster name (e.g. "Tushar Hemraj Rane") being referenced by first name only.

## Branding (Deloitte x Takeda)
Reuses the exact palette and logo lockup built for the other two mailer tasks — see [weekly-backlog-report/TASK.md](../weekly-backlog-report/TASK.md#branding-deloitte-x-takeda) for the full rationale. Same `../shared/assets/deloitte-logo.png` / `takeda-logo.png`, same Takeda red (`#E1242A`) table headers. This mailer goes to the same distribution list (`uspdtoperate@deloitte.com` / Sreela / Mani Deep / Rupavani) off the same engagement, so per the user it should look consistent with those two reports rather than the plain green-header styling `templates/*.msg` shows from before this task existed.

## Wording (Template library)
The subject, To, Cc and the greeting/message above the tables can be changed without touching this folder: in the PMO Desk **Templates** app, a template ticked for *Deployment & DEP Weekend Mailer* replaces them (placeholders `{{date}}`, `{{body_date}}`, `{{title}}`; `{{body_date}}` keeps the bold date with its raised "th"/"nd"). `build_email_data.py` asks `shared/template_lib` for the template for the key `task:deployment-dep-weekend-mailer` and writes the result into `email-data.json` (`subject`, `to`, `cc`, `body_html`); `create_draft.ps1` uses `body_html` when present and its own text otherwise, so with no library or no template for this task the draft is unchanged. The two tables and logos are not part of a template. See [docs/templates.md](../../docs/templates.md).

## Technical notes
- No workbook attachment — the real prior-week mailer in `templates/*.msg` didn't attach the workbook either, just the two tables in the body. If that's ever wanted, add an `$mail.Attachments.Add($data.workbook_path)` call to `create_draft.ps1` (pattern already used by the other two mailer tasks) and add `workbook_path` back into what `create_draft.ps1` reads (it's already in `email-data.json`, just unused today).
- Excel merged cells only store their value in the top-left cell; `build_email_data.py`'s `forward_fill_merged_column` reconstructs the effective value for every row in a merged range, and rowspans are recomputed from scratch rather than read off the merge geometry directly, so the HTML table's rowspans always match the grouping actually present in the data.
- The intro sentence's ordinal date phrase (e.g. "24th August") only renders the superscript-`th` form for a single-date block. A block spanning multiple dates falls back to a plain "Xth to Yth Month" phrase without the superscript, since no such block existed in the reference data to confirm the exact expected phrasing.
- Outlook desktop is controlled via COM automation (not the web app), since the send step must happen in the user's actual desktop Outlook.

## Data handling
Team leads' deployment/DEP activity data is real PMO-sensitive data. Never commit it anywhere in this workspace — `input/`, `output/`, and `reference/` are for local working files only.
