# PMO Desk roadmap

Enhancement plan for PMO Desk, checked against the codebase. Generated 2026-11-04 from the audited roadmap page. All 45 items have since been built on four local branches (see [Build progress](#build-progress)); all were exercised live in the real desktop app on 2026-11-05, and the problems that found are fixed on the `qa-fixes` branch.

## How this was checked

1. A first pass scanned the code with searches and looked at the running app.
2. A second pass had seven separate audits read every cited file in full, re-verify every file and line reference, and check the claims against the running app.
3. A third review on 2026-11-04 re-read the cited code against every item, the dropped list, the build-order table and the rules. It was a read-only code review: the app was not run and the project checks (typecheck, tests, lint) were not run. Its corrections are folded into the entries below.
4. Anything the audits could not settle is listed in [Not verified](#not-verified). Treat those as open questions, not facts.

Result: 45 items on the roadmap (26 from the original 53 ideas, 19 added), and 27 of the original 53 dropped because they already exist, do not fit the app, or were merged.

Line numbers in the evidence were correct when checked. Files move, so open the file and search nearby if a line has shifted.

## Build progress

Work happens on one git branch per phase, each started from the previous phase's branch (later phases depend on earlier ones). Branches are local and have not been pushed.

| Phase        | Branch               | State              | Checks run on the branch                                                                                                                                                                                                                                                                                                                                                                               |
| ------------ | -------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 Foundation | `phase-1-foundation` | All 9 items built  | Typecheck clean. Formatting clean. 3060 of 3060 tests pass (baseline before any change: 3029 of 3030, the one failure a flaky Windows file-rename error in the backup test that passed on rerun). Lint could not run: `eslint-plugin-react-hooks` is missing from this checkout's `node_modules`.                                                                                                      |
| 2 Build      | `phase-2-build`      | All 16 items built | Typecheck clean. Formatting clean. 3158 of 3158 tests pass (one older staff-store test was updated for the new offboard reply). Lint could not run (same missing plugin).                                                                                                                                                                                                                              |
| 3 Scale      | `phase-3-scale`      | All 15 items built | Typecheck clean. Formatting clean. 3348 of 3348 tests pass. Lint could not run (same missing plugin).                                                                                                                                                                                                                                                                                                  |
| 4 Later      | `phase-4-later`      | All 5 items built  | Typecheck clean. Formatting clean. 3588 of 3588 tests pass. The production build (`next build --turbopack`) completes with no errors and includes all new routes; it ran against a throwaway home and OneDrive folder because the app's background scanners act on real files. That build covers all four phases, since each branch contains the one before. Lint could not run (same missing plugin). |

**What "built" means here:** the code is written, typechecks and has unit tests for its logic. Nobody has looked at the screens. The review machine has no Node on its PATH (the Electron binary in `node_modules` was used as Node), and a live run of the app uses the real OneDrive `AI-OS` folders, so it must not be started without a throwaway data folder. Look at each changed screen in a real run before release.

**Decisions made while building Phase 1** (change them if you disagree):

- `pm-9`: typed project names are stored as typed. Suggestions match without regard to case, but the text is not rewritten to an existing spelling.
- `q-7`: "In 3 days" is three calendar days and does not skip weekends, like Tomorrow.
- `ui-1`: at most 3 recent prompts show, and only answered or finished ones.
- `ui-3`: the tooltip shows on every template row, not only truncated names.
- `ai-1`: the command bar pill reads the model from `/api/ai/model` and refreshes when the status changes, not when the Settings toggle changes.
- `ui-2`: the 9009 mapping lives in a new `startFailure.ts`. `friendlyError.ts` was not changed, so other "exited (code N)" messages are still shown raw.

**Decisions made while building Phase 2** (change them if you disagree):

- `ui-8` and `q-9`: pins and the last-opened tool are kept in browser localStorage (per viewer, safe if storage fails), not in preferences. "Last opened" is a button, not an automatic reopen.
- `ui-10`: the reading card can be dismissed for the current reading run. Progress was not added to the AI activity panel, which only lists command-bar tasks.
- `ux-2`: one shared Toolkit help entry covers all register tools. The "?" button in each window title bar is hidden until hover or focus.
- `q-2`: Undo restores the profile, relinks the shift roster entry and re-adds the deleted time off. The Offboarded tab's Restore button still does not relink.
- `q-8`: off by default. Reopens one window per app. Settings and catalogue web apps are not remembered. The switches are in Quick settings only.
- `q-13`: Tidy overwrites the remembered position of every app it tidies.
- `ui-5`: labels apply to app tiles only. The dock is 68 px tall with labels on.
- `pm-2`: top 3 open risks per project (Type "Risk" only), ranked by impact times likelihood, plus open changes past their target date. Records whose Project matches no active status-report project appear under "Other projects" so none are dropped.
- `ops-2`: per-person drafts are copy or unsent-mail only. There is no per-person "mark chased".
- `pm-5`: bulk to-dos are RAID only. "Make N to-dos" works on any ticked open record without a to-do, not just late ones. If a to-do is made but its id cannot be saved, a retry would make a second one (the dialog warns).
- `q-10`: register Duplicate is in the record dialog only and opens an unsaved prefilled Add dialog. To-do Duplicate has an Undo toast.
- `pgm-1` and `ops-1`: both Dashboard cards are hidden by default so saved layouts do not change. The scorecard shows counts for the 8 registers with alert rules, not a percentage.
- `ops-4`: six optional vendor fields (two milestones and a payment note, each with a date). A passed date stays late until you clear it. All late and soon vendor alerts now reach Today. The morning briefing toast does not show contract rows.

**Decisions made while building Phase 3** (change them if you disagree):

- `ui-16`: the preview shows all six snap zones and is drawn by direct DOM updates from the drag callback. The controller is `snapPreviewController.ts` (a `snapPreview.ts` next to `SnapPreview.tsx` clashed on case-insensitive file systems).
- `q-22`: Recent covers PMO To-Do and Templates, last 4 each, kept in browser storage. Closed to-dos outside the server's capped list drop off.
- `q-15`: opt-in, off by default. Accelerator Ctrl+Shift+Space (it overrides Word's non-breaking space while the setting is on). A press focuses the command bar pre-filled with `/todo `, not the PMO To-Do quick-add box.
- `q-20`: slash commands apply only when the text starts with `/`. A recognised command is rewritten to a sentence the existing routers understand, and that sentence is what the history records. `/done <x>` with no match falls to the model, as "mark x done" does.
- `q-16`: all registers get tick boxes, bulk delete with one Undo, and Staff gets bulk offboard with one Undo. Bulk actions touch only ticked rows that are on screen. This also changed the Phase 2 to-do bulk action, which used to include hidden ticked rows. No bulk permanent delete.
- `q-21`: J, K, Home, End and E, with Up and Down also in Staff and Templates. Toolkit tiles get no arrow keys (grid). Register rows and cards got the keys too.
- `pm-7`: new optional long-text `impactNote` field on change requests (a required field would delete old records). The suggestion goes into the field for editing and is never saved by the route. The note check catches invented names, figures and dates but not a false claim made of true words, so a person must read it.
- `ops-5`: accepts only an exact existing Category, otherwise suggests nothing.
- `pgm-4`: no AI narrative (the existing helper works on to-do data). The pack groups by project only if any RAID or change record has a Project.
- `ai-3`: two new template places (`app:toolkit:timesheet-chaser`, `app:toolkit:status-report`). Starters are written only when a template library is first created, so an existing library needs the template created by hand. Once assigned, output goes through `tidyText`, which can trim blank-field whitespace.
- `ops-6`: all-day events only. The Time text is copied into the event description, not parsed. Only saved records are exported.
- `ops-3`: field names only, never values. Capped at 2000 entries per tool, so one active record can push out older entries. A history write failure never blocks a save.
- `q-1`: copies subject (or title line) and body with placeholders, including unsaved edits. To and Cc are left out.
- `q-17`: the last-opened time is saved at launch, not at close, so your own actions from the last session appear in the next recap. The recap covers the PMO audit log only and says so.
- `q-19`: CSV cells starting with `=`, `+`, `-` or `@` get an apostrophe. Excel stores text. The Staff, Activity and register CSV exports are still unguarded.

**Decisions made while building Phase 4** (change them if you disagree):

- `ui-18`: the plus button opens the tool with its Add dialog showing. The label is "Add a <tool name>", so plural tools read "Add a Meeting minutes". Timesheets has no plus.
- `ux-6`: restoring a layout never closes windows. An off-by-default switch minimises the others instead. One window per app is saved. Saving under an existing name is refused (delete and save again). Restore also updates each moved app's remembered position.
- `ui-20`: no italic, blockquotes, images or link titles. Links allow only http, https and mailto. The preview is bounded (100,000 characters, 4,000 lines, tables 20 columns by 500 rows). A link to the app's own address opens as an in-app window (existing shell behaviour for every app).
- `ai-6`: PMO structuring prompt only. Off by default. At most 2 examples, needing 2 shared meaningful words, capped at 2000 characters. With the switch off the prompt is byte-identical to the previous version (sha-256 checked in a test); `PROMPT_VERSION` is now 5. You can only save from a ready proposal while its review is open. No example text reaches any log or the audit trail.
- `q-18`: the location is a platform preference with a pick-list from the Staff holiday editor. Only a day that is itself a holiday moves, and a typed date like "25 Dec" moves too, with a "(skipped a holiday)" note. "In 3 days" and "In 1 hour" never move.

## Not finished, found while building

These are gaps the build left on purpose. None of them is fixed.

- **`q-18` server side.** The server reminder engine and chasers (`notify.ts`, `chaserDrafts.ts`, `state.ts`) do not know the holiday location or the roster, so reminders and "days waiting" counts ignore holidays while the screens do not. Fixing it means a server reader for the platform prefs file plus the roster. "Every weekday" recurrence keeps its own Sat/Sun skip, and meeting-notes action items do not use holidays.
- **`ops-4`:** the morning briefing toast does not list contract milestones.
- **`q-19`:** the Staff, Activity and register CSV exports do not guard against formula injection (only the to-do export does).
- **`q-17`:** the recap time is saved at launch, not close.
- **Existing template libraries** do not get the two new Toolkit templates (`ai-3`) automatically.
- **Offboarded tab Restore** does not relink the shift roster entry (only the Undo toast does).

## Live QA and fixes

On 2026-11-05 a separate QA run drove the real desktop app (Playwright, a throwaway profile, no OneDrive variables) through all 45 items; its report is `C:\Projects\pmo-qa\QA-REPORT.md`. It found 34 items working as described, 10 with small defects and 1 failure. All of it is fixed on the `qa-fixes` branch:

- **`q-16` (the one failure):** to-do bulk actions also changed ticked rows the filter hid. They now touch only rows on screen, the bar says "N more hidden by the filter, not included", and Undo covers exactly what changed.
- **Labels and text:** `ui-18` plus-button labels use each register's noun with the right a/an ("Add an SLA item"); `ai-6` rows say "Subject", not "From"; `pm-5` confirmation dates read "20 Oct"; `q-18` quick-add toast says "(skipped a holiday)".
- **Behaviour:** `q-10` Duplicate resets the created date (RAID Raised on, SLA Received, lesson date) to today; `ops-2` per-person chasers and the combined email leave you out; `q-20` the `/` menu lists all 15 commands and clears stale hints; `q-13` Tidy windows tiles 1 to 4 windows and cascades 5 or more by 48 px; `q-21` `E` and Enter in Templates move focus into the editor; `ui-10` the approval card shows "Still reading N more..." while leave emails are read; `ai-1` the model name no longer truncates in the status chip.
- **Windows:** a window reopened at a remembered position is now kept fully on screen (a remembered rectangle used to pass a check that only kept 80 px of the title bar reachable).
- **See-through windows (found by QA, not caused by these phases):** release 6.0.2 made hardware acceleration the default and removed the window blur but left window bodies 90% opaque in that mode, so text of windows behind showed through. Window bodies are now opaque in both modes (`tokens.css`).

Not changed: every download opens the native Save-as dialog because the desktop shell has no `will-download` handler (existing behaviour; a safe improvement is to pre-fill the name and folder, or save to Downloads and show it). Layout restore (`ux-6`) still uses the looser on-screen check. After the fixes, the full typecheck, formatting and test run are clean (3629 of 3629 tests); the fixes have not been re-run in the live harness.

QA could not prove: the 10 MB cap on dropped Staff files (`q-3`), that the saved examples really reach the prompt (`ai-6`, only a unit test), a physical keypress for the hotkey (`q-15`), and a failed (not cancelled) prompt outcome (`ui-1`).

## Before release

Install the missing lint plugin and run `pnpm check` (lint has never run on these branches). Re-run the live QA against the fixes: its harness is in `C:\Projects\pmo-qa` and uses a throwaway profile; never start the app against the real OneDrive folders. The gaps listed under "Not finished, found while building" are still open.

## Rules every item must respect

These come from `ARCHITECTURE.md` and the audits. If an item seems to need breaking one, stop and rethink the item.

- **Local only.** The app and AI stay on loopback with no cloud calls. No feature may send audio, text or data to an outside service.
- **Nothing is sent without you.** Chasers, sign-offs and reports are text to copy or an unsent compose window. The only real send path is a Tasks mailer pack, which sends through Outlook only after review and send confirmations.
- **Theming is token-only.** Colours come from `tokens.css`. Do not add per-app colour overrides or `dark:` classes.
- **Window drag and resize mutate the DOM directly** and commit to the Zustand store on pointer-up. Never write to the store while dragging.
- **App registry imports must be in a Client Component** (`WindowManager.tsx`), not a Server Component, or the bundler drops them.
- **Register records are re-validated on every read.** A new required field, or a new value outside a select list, makes existing records fail validation and disappear from view. Worse, the next save of any record rereads the file, drops them and writes the result back, so they are deleted permanently. New fields must be optional text.
- **Desktop shell messages** (IPC) accept only the main window as sender. Do not add a second window that needs to call them.
- **Effort and priority are estimates.** Effort scale: 1 = hours, 2 = a day or two, 3 = several days, 4 = a week or more, 5 = multi-week.

## Build order and dependencies

Do these in order where one item feeds another.

| First                            | Then                                                   | Why                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `pm-9` Optional Project field    | `pm-2` Status report adds risks and changes            | `pm-2` cannot match RAID or change records to projects without it                                                                            |
| `pm-9`                           | `pgm-1`, `pgm-4` (grouping RAID or changes by project) | They work flat without it, but need it to group by project. `ops-5` does not need `pm-9`: Lessons already has its own required Project field |
| `q-2` Undo for offboarding       | `q-16` Bulk select in registers and Staff              | Bulk delete on Staff needs undo first                                                                                                        |
| `q-8` Reopen last session's apps | `ux-6` Named workspace layouts                         | Layouts build on remembered open apps                                                                                                        |

Everything else is independent and can be built in any order.

## Roadmap by phase

### Phase 1: Foundation (next 2 to 4 weeks), 9 items

| ID     | Item                                                             | Area               | Priority | Effort | Status                                                   |
| ------ | ---------------------------------------------------------------- | ------------------ | -------- | ------ | -------------------------------------------------------- |
| `ui-1` | [Recent prompts as chips on an empty command bar](#ui-1)         | UI polish          | Medium   | 1      | **Built** (`phase-1-foundation`), live-tested 2026-11-05 |
| `ui-2` | [Plain-language Tasks engine start errors](#ui-2)                | UI polish          | High     | 2      | **Built** (`phase-1-foundation`), live-tested 2026-11-05 |
| `ui-3` | [Tooltip on truncated template names](#ui-3)                     | UI polish          | Medium   | 1      | **Built** (`phase-1-foundation`), live-tested 2026-11-05 |
| `ui-7` | [Notes text filter, and open the chosen note from Ctrl+K](#ui-7) | UI polish          | Medium   | 2      | **Built** (`phase-1-foundation`), live-tested 2026-11-05 |
| `pm-9` | [Optional Project field on RAID, changes and SLA](#pm-9)         | Project management | Medium   | 2      | **Built** (`phase-1-foundation`), live-tested 2026-11-05 |
| `ai-1` | [Show the model name on the status chip and pill](#ai-1)         | AI and automation  | Medium   | 1      | **Built** (`phase-1-foundation`), live-tested 2026-11-05 |
| `q-3`  | [Drop a roster file onto the Staff import box](#q-3)             | Quality of life    | Medium   | 1      | **Built** (`phase-1-foundation`), live-tested 2026-11-05 |
| `q-6`  | ["Draft kept" in the Template editor](#q-6)                      | Quality of life    | Low      | 1      | **Built** (`phase-1-foundation`), live-tested 2026-11-05 |
| `q-7`  | ["3 days" snooze preset](#q-7)                                   | Quality of life    | Low      | 2      | **Built** (`phase-1-foundation`), live-tested 2026-11-05 |

### Phase 2: Build (next 1 to 2 months), 16 items

| ID      | Item                                                   | Area                 | Priority | Effort | Status                                              |
| ------- | ------------------------------------------------------ | -------------------- | -------- | ------ | --------------------------------------------------- |
| `ui-5`  | [Optional "Show dock labels" setting](#ui-5)           | UI polish            | Low      | 2      | **Built** (`phase-2-build`), live-tested 2026-11-05 |
| `ui-8`  | [Filter box for Toolkit tools](#ui-8)                  | UI polish            | Medium   | 1      | **Built** (`phase-2-build`), live-tested 2026-11-05 |
| `ui-10` | [Progress and dismiss on the leave-email card](#ui-10) | UI polish            | Low      | 2      | **Built** (`phase-2-build`), live-tested 2026-11-05 |
| `ux-2`  | [Help entry inside each app window](#ux-2)             | User experience      | Low      | 2      | **Built** (`phase-2-build`), live-tested 2026-11-05 |
| `pm-2`  | [Status report adds top risks and late changes](#pm-2) | Project management   | Medium   | 3      | **Built** (`phase-2-build`), live-tested 2026-11-05 |
| `pm-5`  | [Bulk "make to-dos" for late RAID items](#pm-5)        | Project management   | Medium   | 3      | **Built** (`phase-2-build`), live-tested 2026-11-05 |
| `pgm-1` | [Portfolio RAG tile on the Dashboard](#pgm-1)          | Programme management | Medium   | 3      | **Built** (`phase-2-build`), live-tested 2026-11-05 |
| `ops-1` | [PMO health scorecard](#ops-1)                         | PMO operations       | Low      | 2      | **Built** (`phase-2-build`), live-tested 2026-11-05 |
| `ops-2` | [One timesheet chaser draft per person](#ops-2)        | PMO operations       | Medium   | 2      | **Built** (`phase-2-build`), live-tested 2026-11-05 |
| `ops-4` | [Milestone dates on vendor contracts](#ops-4)          | PMO operations       | Medium   | 4      | **Built** (`phase-2-build`), live-tested 2026-11-05 |
| `q-2`   | [Undo toast when offboarding staff](#q-2)              | Quality of life      | Low      | 2      | **Built** (`phase-2-build`), live-tested 2026-11-05 |
| `q-8`   | [Reopen last session's apps at launch](#q-8)           | Quality of life      | Medium   | 2      | **Built** (`phase-2-build`), live-tested 2026-11-05 |
| `q-9`   | [Pin favourite Toolkit tools](#q-9)                    | Quality of life      | Low      | 1      | **Built** (`phase-2-build`), live-tested 2026-11-05 |
| `q-10`  | [Duplicate for to-dos and register records](#q-10)     | Quality of life      | Medium   | 2      | **Built** (`phase-2-build`), live-tested 2026-11-05 |
| `q-11`  | [Copy a register record as email text](#q-11)          | Quality of life      | Medium   | 2      | **Built** (`phase-2-build`), live-tested 2026-11-05 |
| `q-13`  | [Show desktop and tidy windows](#q-13)                 | Quality of life      | Low      | 2      | **Built** (`phase-2-build`), live-tested 2026-11-05 |

### Phase 3: Scale (next quarter), 15 items

| ID      | Item                                                  | Area                 | Priority | Effort | Status                                              |
| ------- | ----------------------------------------------------- | -------------------- | -------- | ------ | --------------------------------------------------- |
| `ui-16` | [Live snap preview while dragging a window](#ui-16)   | UI polish            | Medium   | 2      | **Built** (`phase-3-scale`), live-tested 2026-11-05 |
| `pm-7`  | [AI-drafted impact note on change requests](#pm-7)    | Project management   | Low      | 3      | **Built** (`phase-3-scale`), live-tested 2026-11-05 |
| `pgm-4` | [Weekly pack: status, changes and late risks](#pgm-4) | Programme management | Medium   | 3      | **Built** (`phase-3-scale`), live-tested 2026-11-05 |
| `ops-6` | [Calendar file export for governance events](#ops-6)  | PMO operations       | Medium   | 2      | **Built** (`phase-3-scale`), live-tested 2026-11-05 |
| `ops-3` | [Local change history per register record](#ops-3)    | PMO operations       | Low      | 3      | **Built** (`phase-3-scale`), live-tested 2026-11-05 |
| `ops-5` | [AI suggestion for the lesson Category](#ops-5)       | PMO operations       | Low      | 3      | **Built** (`phase-3-scale`), live-tested 2026-11-05 |
| `ai-3`  | [Template targets for Toolkit drafts](#ai-3)          | AI and automation    | Medium   | 3      | **Built** (`phase-3-scale`), live-tested 2026-11-05 |
| `q-1`   | [Copy a template's wording](#q-1)                     | Quality of life      | Low      | 1      | **Built** (`phase-3-scale`), live-tested 2026-11-05 |
| `q-15`  | [Global quick-capture hotkey](#q-15)                  | Quality of life      | Medium   | 3      | **Built** (`phase-3-scale`), live-tested 2026-11-05 |
| `q-16`  | [Bulk select in registers and Staff](#q-16)           | Quality of life      | Medium   | 3      | **Built** (`phase-3-scale`), live-tested 2026-11-05 |
| `q-17`  | ["Since you last opened" recap](#q-17)                | Quality of life      | Medium   | 3      | **Built** (`phase-3-scale`), live-tested 2026-11-05 |
| `q-19`  | [Export the to-do list to Excel or CSV](#q-19)        | Quality of life      | Low      | 2      | **Built** (`phase-3-scale`), live-tested 2026-11-05 |
| `q-20`  | [Slash shortcuts in the command bar](#q-20)           | Quality of life      | Low      | 2      | **Built** (`phase-3-scale`), live-tested 2026-11-05 |
| `q-21`  | [Keyboard navigation in more lists](#q-21)            | Quality of life      | Low      | 3      | **Built** (`phase-3-scale`), live-tested 2026-11-05 |
| `q-22`  | [Recent items in the dock right-click menu](#q-22)    | Quality of life      | Low      | 3      | **Built** (`phase-3-scale`), live-tested 2026-11-05 |

### Phase 4: Later (only if needed), 5 items

| ID      | Item                                               | Area              | Priority | Effort | Status                                              |
| ------- | -------------------------------------------------- | ----------------- | -------- | ------ | --------------------------------------------------- |
| `ui-18` | [Add an item straight from a Toolkit tile](#ui-18) | UI polish         | Low      | 3      | **Built** (`phase-4-later`), live-tested 2026-11-05 |
| `ui-20` | [Notes: links, code blocks and tables](#ui-20)     | UI polish         | Low      | 3      | **Built** (`phase-4-later`), live-tested 2026-11-05 |
| `ux-6`  | [Named workspace layouts](#ux-6)                   | User experience   | Low      | 3      | **Built** (`phase-4-later`), live-tested 2026-11-05 |
| `ai-6`  | [Saved-examples library for prompts](#ai-6)        | AI and automation | Low      | 3      | **Built** (`phase-4-later`), live-tested 2026-11-05 |
| `q-18`  | [Holiday-aware due dates](#q-18)                   | Quality of life   | Medium   | 4      | **Built** (`phase-4-later`), live-tested 2026-11-05 |

## Item details

### Phase 1: Foundation

<a id="ui-1"></a>

#### `ui-1` Recent prompts as chips on an empty command bar

- **Area:** UI polish
- **Priority:** Medium
- **Effort:** 1 (hours)
- **Status:** Reshaped after the code check

History works through Up and Down, Tab completion and favourites, but you cannot see it. The empty bar shows favourites, app chips and starter chips (five starters in the running app), never recent prompts. The code has six default starter chips and caps the bar at six (the running app showed five; not re-checked). Show the last few prompts as chips. Recent prompts currently include failed and cancelled ones (the outcome can be answered, done, cancelled or failed), so filter those.

**Where to look:** `CommandBar.tsx:712-748`, `barSuggestions.ts:35-49`, `schema.ts:193-204`

<a id="ui-2"></a>

#### `ui-2` Plain-language Tasks engine start errors

- **Area:** UI polish
- **Priority:** High
- **Effort:** 2 (a day or two)
- **Status:** Reshaped after the code check

The raw "Python was not found" text appeared because this dev checkout has no tasks-engine/.venv, so the lookup fell through to the Microsoft Store python stub. A packaged app points at its bundled Python, but whether the installer really contains it cannot be seen from source. The generic error helper would not catch this text, so add a specific case for exit code 9009 in the start route with plain steps. CopyDetailsButton exists but the launch screen does not use it. Do not auto-install anything.

**Where to look:** `api/tasks-engine/start/route.ts:237-241`, `python.ts:18-28`, `EngineLaunchScreen.tsx:84-91`, `friendlyError.ts:60-112`, `desktop/main.cjs:341-353`

<a id="ui-3"></a>

#### `ui-3` Tooltip on truncated template names

- **Area:** UI polish
- **Priority:** Medium
- **Effort:** 1 (hours)
- **Status:** Fits as written

Names such as "Deployment & DEP weekend email" are cut off in the list with no title, and no tooltip appeared on hover in the running app. Use the existing Tooltip component.

**Where to look:** `TemplatesApp.tsx:395-397`

<a id="ui-7"></a>

#### `ui-7` Notes text filter, and open the chosen note from Ctrl+K

- **Area:** UI polish
- **Priority:** Medium
- **Effort:** 2 (a day or two)
- **Status:** Reshaped after the code check

Ctrl+K already searches notes. The Notes list has tag chips and pinning but no text filter. Also, choosing a note in Ctrl+K opens Notes without selecting that note. Add a filter box and make the search result select the note. The search target has no note id and its type has no note variant, so this needs a new target variant plus a hook that sets `selectedNoteId` in the notes store (like the Staff navigation hook).

**Where to look:** `NoteList.tsx` (lines 17-61 are only the tag filter), `GlobalSearch.tsx:46-57,76-91`, `searchIndex.ts:11-14,154`, `NotesApp.tsx`, `notesStore.ts`

<a id="pm-9"></a>

#### `pm-9` Optional Project field on RAID, changes and SLA

- **Area:** Project management
- **Priority:** Medium
- **Effort:** 2 (a day or two)
- **Status:** Added after the code check

Capacity, status report, lessons and doc links already have a free-text Project field, and decisions has "Related to". RAID, changes and SLA have none. Add an optional free-text field with name suggestions taken from the status-report register, matched case-insensitively. It must be optional text: a required field or a dropdown would make the app silently drop every existing record, because records are re-validated on every read, and the next save of any record writes back only the records that passed, deleting the rest permanently. Name suggestions need a change to `FieldInput.tsx`: only person fields get a suggestion list today, and it is filled from Staff, not projects. That means a new field type or prop plus a fetch of the status-report register.

**Where to look:** `defs.ts:16-47,167-230,387,462,517,565; records.ts:58-69,142; server.ts:40-55,89-119`, `FieldInput.tsx:122-130`

<a id="ai-1"></a>

#### `ai-1` Show the model name on the status chip and pill

- **Area:** AI and automation
- **Priority:** Medium
- **Effort:** 1 (hours)
- **Status:** Reshaped after the code check

Fast AI is an explicit Settings toggle with a hint naming the model, so the switch is not silent. The only automatic change is the "only installed" fallback, which carries a note. The fallback and light models are both qwen3.5:4b. The status chip appears only in the PMO To-Do window and its label omits the model name (the tooltip has it). The command bar pill shows only Idle, Thinking, Working or Completed. Add the model name to both.

**Where to look:** `toolbarView.ts:90,111-116`, `AgentStatusBadge.tsx:9-14`, `SettingsMenu.tsx:217-238`, `models.ts:9,14`, `modelChoice.ts:91-101`

<a id="q-3"></a>

#### `q-3` Drop a roster file onto the Staff import box

- **Area:** Quality of life
- **Priority:** Medium
- **Effort:** 1 (hours)
- **Status:** Added after the code check

The import dialog shows a dashed box that looks like a drop zone but only opens a file picker. Accept dropped files and reuse the existing reader, which enforces the 10 MB cap. Copy the drop pattern from the Tasks start dialog. A separate roster import dialog has a 20 MB cap.

**Where to look:** `ImportDialog.tsx:13,47-120`, `tasks-app/StartTaskDialog.tsx:563-582` (the `take()` helper plus the drag and drop handlers)

<a id="q-6"></a>

#### `q-6` "Draft kept" in the Template editor

- **Area:** Quality of life
- **Priority:** Low
- **Effort:** 1 (hours)
- **Status:** Added after the code check

Notes already shows Saving and Saved. The Template editor has a Save button that is disabled until something changes. The "Saved" note after saving is in `TemplatesApp.tsx:547-560`, not the editor. The editor's banner only says "Your unsaved changes from last time are back" after a draft is restored. The draft is saved on every edit, but nothing says so while you type. Show "Draft kept" while there are unsaved edits.

**Where to look:** `TemplateEditor.tsx:146-154,244-252,298-306`, `TemplatesApp.tsx:547-560`, `NoteEditor.tsx:124-133`

<a id="q-7"></a>

#### `q-7` "3 days" snooze preset

- **Area:** Quality of life
- **Priority:** Low
- **Effort:** 2 (a day or two)
- **Status:** Added after the code check

Snooze offers 1 hour, after lunch, tomorrow, next Monday and a custom time, for to-dos only. Adding 3 days means widening the snooze choice type and its date calculation, not just a menu line. Toolkit registers have no snooze. Whether chasers use a separate snooze was not checked.

**Where to look:** `SnoozeMenu.tsx:27-32,99-129`, `due.ts:206,227`

### Phase 2: Build

<a id="ui-5"></a>

#### `ui-5` Optional "Show dock labels" setting

- **Area:** UI polish
- **Priority:** Low
- **Effort:** 2 (a day or two)
- **Status:** Reshaped after the code check

Every dock tile already has a tooltip after 300 ms that also lists open windows. The dock hides when an app window is open and overflows into the App Menu on narrow screens, so always-on text would crowd it. Make labels an opt-in setting, off by default. Any colours it needs must come from tokens.

**Where to look:** `DockTile.tsx:98-126`, `Dock.tsx:208-229,243-248,381-394`

<a id="ui-8"></a>

#### `ui-8` Filter box for Toolkit tools

- **Area:** UI polish
- **Priority:** Medium
- **Effort:** 1 (hours)
- **Status:** Fits as written

Fourteen tiles in four groups, and the window has no input at all. Filter on tool name and description. Ctrl+K already searches records, so this is only for finding a tool.

**Where to look:** `ToolkitApp.tsx:63-137`

<a id="ui-10"></a>

#### `ui-10` Progress and dismiss on the leave-email card

- **Area:** UI polish
- **Priority:** Low
- **Effort:** 2 (a day or two)
- **Status:** Reshaped after the code check

The floating "Reading a leave email, N more waiting" card is the Staff leave-email nudge, polled every 20 seconds. It is not the PMO to-do intake. While reading it has no buttons and no progress bar, and the AI activity panel lists only command-bar tasks. Show the reading progress in the panel, or let the card be dismissed while reading.

**Where to look:** `AiNudge.tsx:13,34-146`, `ptoNudge.ts:45-51`, `TaskList.tsx:39-80`, `agentStore.ts:104`

<a id="ux-2"></a>

#### `ux-2` Help entry inside each app window

- **Area:** User experience
- **Priority:** Low
- **Effort:** 2 (a day or two)
- **Status:** Reshaped after the code check

One global 8-step tour exists. Per-app help text exists for 10 apps but not the PMO Toolkit, and it is only reachable from Settings, Help. The helper that returns it has no callers outside tests. Add a Help entry in each window and write the missing Toolkit text. The help entry type needs exactly three tasks per app. The 14 Toolkit tools and the `tasks` id have no entry, so decide whether the Toolkit gets one shared entry or one per tool.

**Where to look:** `tour.ts:11-58`, `appHelp.ts:16-239`, `HelpTab.tsx:92`

<a id="pm-2"></a>

#### `pm-2` Status report adds top risks and late changes

- **Area:** Project management
- **Priority:** Medium
- **Effort:** 3 (several days)
- **Status:** Reshaped after the code check
- **Needs first:** [`pm-9`](#pm-9) Optional Project field on RAID, changes and SLA

The status report is built only from each project's RAG, owner, commentary and next steps. Add the top open risks and late changes per project. The panel only receives its own register, but other registers can be fetched with the existing fetch helper, so no new API is needed.

**Where to look:** `reports.ts:19-58`, `StatusReportPanel.tsx:12-14`, `registersApi.ts:44`

<a id="pm-5"></a>

#### `pm-5` Bulk "make to-dos" for late RAID items

- **Area:** Project management
- **Priority:** Medium
- **Effort:** 3 (several days)
- **Status:** Reshaped after the code check

Late RAID items already alert, and one record can become a to-do. Making a to-do posts a real to-do immediately, with no proposal queue, so a bulk action needs one confirmation that lists the items. Save the to-do id on each record so none is made twice. Items with no review date never go late, and registers have no multi-select today.

**Where to look:** `todoBridge.ts:18-25`, `RecordDialog.tsx:154-173`, `alerts.ts:59-66`, `RegisterApp.tsx:76-81`

<a id="pgm-1"></a>

#### `pgm-1` Portfolio RAG tile on the Dashboard

- **Area:** Programme management
- **Priority:** Medium
- **Effort:** 3 (several days)
- **Status:** Reshaped after the code check

The status-report register is one row per project by convention only, with no uniqueness check. The Dashboard registers widget gets only per-tool counts of open, late and soon items, with no RAG counts or record lists, and it is hidden by default. A tile needs a new fetch of the status-report register. Grouping late items by project would also need pm-9.

**Where to look:** `defs.ts:462`, `alerts.ts:221-227`, `RegistersWidget.tsx:9-53`, `layout.ts:47-51`, `server.ts:125-139`

<a id="ops-1"></a>

#### `ops-1` PMO health scorecard

- **Area:** PMO operations
- **Priority:** Low
- **Effort:** 2 (a day or two)
- **Status:** Reshaped after the code check

The Dashboard already has hidden widgets for the PMO toolkit and report health, and the app has a late and soon count per tool. Only 8 of the 14 registers have alert rules (RAID, SLA, changes, governance, stakeholders, vendors, invoices, status report). Timesheets, decisions, lessons, minutes, capacity and doc links cannot be scored without new rules. The "Report health" widget is not a register or PMO health measure: it scores Tasks-engine report reliability (share of each report's last 5 runs that completed, minus a penalty while in error), so it cannot be reused here.

**Where to look:** `RegistersWidget.tsx:12-18`, `alerts.ts:166,229`, `server.ts:125`, `layout.ts:47-51`

<a id="ops-2"></a>

#### `ops-2` One timesheet chaser draft per person

- **Area:** PMO operations
- **Priority:** Medium
- **Effort:** 2 (a day or two)
- **Status:** Reshaped after the code check

The Timesheet chaser already builds one combined draft and has "Mark them chased today". The gap is one draft per person: with several recipients the combined mail link is still built but with an empty To address (it disappears only if the body is too long for a mail link). Sending stays manual. A gated send would have to go through a Tasks mailer pack, which sends via Outlook only after review and send confirmations.

**Where to look:** `timesheets.ts:93-119`, `TimesheetApp.tsx:92-102,187-194,276-281; pack_mailer.py:98-99`

<a id="ops-4"></a>

#### `ops-4` Milestone dates on vendor contracts

- **Area:** PMO operations
- **Priority:** Medium
- **Effort:** 4 (a week or more)
- **Status:** Reshaped after the code check

The vendor notice deadline is calculated (renewal date minus notice days, default 60), not stored, and there are no milestone or payment fields. Fields are flat, so milestones mean a few fixed date fields. Register late counts reach the PMO toolkit widget and also the needs-you count behind the dock and desktop badge, but not the Today list, so reaching Today also means extending the Today input.

**Where to look:** `defs.ts:341-378`, `alerts.ts:68-88`, `insights.ts:51,322-331`, `needsYouStore.ts`, `dockBadge.ts:25`

<a id="q-2"></a>

#### `q-2` Undo toast when offboarding staff

- **Area:** Quality of life
- **Priority:** Low
- **Effort:** 2 (a day or two)
- **Status:** Added after the code check

Offboarding already keeps the profile and photo and has a Restore button on the Offboarded tab. Only time off is deleted and never restored. Add an Undo toast that restores the profile and re-adds the removed time off, like the time-off tab does. Leave permanent delete behind its confirmation: it removes the photo, roster entry and shifts, and an undo would need a delayed server delete. The dialog says shifts "are dropped" but the server keeps them, so that text looks wrong. Offboarding also unlinks the person's shift roster entry, so decide whether Undo should relink it (the restore path in `server.ts` past line 459 was not read).

**Where to look:** `EmployeePane.tsx:383-392`, `OffboardedTab.tsx:88-108,241-248`, `server.ts:224-237,263`, `TimeOffTab.tsx:80-95`

<a id="q-8"></a>

#### `q-8` Reopen last session's apps at launch

- **Area:** Quality of life
- **Priority:** Medium
- **Effort:** 2 (a day or two)
- **Status:** Added after the code check

Window positions and sizes are remembered per app (capped at 64), but which apps were open is not, and nothing reopens them. Make it opt-in.

**Where to look:** `schema.ts:38,84`, `windowStore.ts:401-412`

<a id="q-9"></a>

#### `q-9` Pin favourite Toolkit tools

- **Area:** Quality of life
- **Priority:** Low
- **Effort:** 1 (hours)
- **Status:** Added after the code check

The open tool is plain local state, with no favourites or last-opened memory. Pin tools to the top and remember the last one. Typing "Open RAID log" in the command bar already works, so the gain is modest.

**Where to look:** `ToolkitApp.tsx:21`, `CommandBar.tsx:95`, `pinnedApps.ts:97-98`

<a id="q-10"></a>

#### `q-10` Duplicate for to-dos and register records

- **Area:** Quality of life
- **Priority:** Medium
- **Effort:** 2 (a day or two)
- **Status:** Added after the code check

Templates and shift schedules can be duplicated. To-dos and Toolkit records cannot.

**Where to look:** `TemplateEditor.tsx:273-275`, `ScheduleDialog.tsx:255-256`

<a id="q-11"></a>

#### `q-11` Copy a register record as email text

- **Area:** Quality of life
- **Priority:** Medium
- **Effort:** 2 (a day or two)
- **Status:** Added after the code check

Only the report dialogs have a copy action. Registers export statusReport, changeSummary, monthEndCheck and todoSeed but nothing for a single record, so a new formatter is needed. Lets a RAID entry, decision or change request be pasted into an email or minutes.

**Where to look:** `toolkit/ReportDialog.tsx`, `registers/reports.ts:19,67,120,158`

<a id="q-13"></a>

#### `q-13` Show desktop and tidy windows

- **Area:** Quality of life
- **Priority:** Low
- **Effort:** 2 (a day or two)
- **Status:** Added after the code check

The dock menu has New window, Unpin and Reset taskbar (checked in the running app), and Reset taskbar affects dock icons only. There is no minimise-all. Show desktop needs one new store action that updates in a single step, because looping the minimise call refocuses a window each time. Tidy can call the default-geometry helper once per window.

**Where to look:** `windowStore.ts:256,273,289,321`, `Dock.tsx:249,390`, `windowGeometry.ts:117`, `DockTile.tsx:153-167`

### Phase 3: Scale

<a id="ui-16"></a>

#### `ui-16` Live snap preview while dragging a window

- **Area:** UI polish
- **Priority:** Medium
- **Effort:** 2 (a day or two)
- **Status:** Reshaped after the code check

Snap happens on release when the pointer is within 8 px of the left or right edge, or within 90 px of a top or bottom corner for quarter zones, with no preview. The preview must show all six zones. The drag callback already has the pointer position every frame and writes to the store only on release, so one overlay can be moved by direct DOM updates. It must be a fixed element outside the window, because windows use layout containment while dragging. Build it from snapRect so it follows the insets if they change.

**Where to look:** `useWindowDrag.ts:41-79`, `windowSnap.ts:16-58`, `tokens.css:581-583`

<a id="pm-7"></a>

#### `pm-7` AI-drafted impact note on change requests

- **Area:** Project management
- **Priority:** Low
- **Effort:** 3 (several days)
- **Status:** Reshaped after the code check

The local model can draft an impact note from the change text and what you type. Save it as a suggestion you edit. Nothing in the registers calls the AI today, and AI calls run on the server, so this needs a new API route.

**Where to look:** `ai-runtime/core.ts (generateJson); no AI use in lib/registers`

<a id="pgm-4"></a>

#### `pgm-4` Weekly pack: status, changes and late risks

- **Area:** Programme management
- **Priority:** Medium
- **Effort:** 3 (several days)
- **Status:** Reshaped after the code check

The Toolkit has a status-report text builder and a change summary, but no summary of RAID items. Combine them into one copy-only dialog. The local-AI narrative helper in the PMO To-Do area is a safe pattern to follow: the model sees only structured data and code checks its output. A flat pack works without pm-9; grouping by project needs it. Also covers the dropped governance-pack idea.

**Where to look:** `reports.ts:19-103`, `ReportDialog.tsx`, `lib/pmo/reportNarrative.ts:1-9`

<a id="ops-6"></a>

#### `ops-6` Calendar file export for governance events

- **Area:** PMO operations
- **Priority:** Medium
- **Effort:** 2 (a day or two)
- **Status:** Reshaped after the code check

Prep to-dos are created when you click "Make prep to-dos"; until then the app only flags "Time to start prep". There is no Outlook write path. Reuse the existing calendar-file builder from Staff. It writes all-day events only, and the governance time field is free text, so events stay all-day unless the builder learns to read the time.

**Where to look:** `alerts.ts:107-125`, `GovernanceExtras.tsx:56-96`, `staff/exportFiles.ts:103`, `defs.ts:259`

<a id="ops-3"></a>

#### `ops-3` Local change history per register record

- **Area:** PMO operations
- **Priority:** Low
- **Effort:** 3 (several days)
- **Status:** Reshaped after the code check

Registers store only created and updated times. The audit log that exists covers PMO To-Do only. Add an append-only local log of which fields changed and when, storing field names and not content, to match the model log privacy stance. A local file cannot be truly immutable.

**Where to look:** `records.ts:213-214`, `server.ts:119`, `settings-app/ActivityTab.tsx:50`

<a id="ops-5"></a>

#### `ops-5` AI suggestion for the lesson Category

- **Area:** PMO operations
- **Priority:** Low
- **Effort:** 3 (several days)
- **Status:** Reshaped after the code check

Lessons already has a Category list (Planning, Delivery, People, Process, Tools, Stakeholders, Other). Suggest one from the text for you to confirm. Technology and governance are not categories today. Patterns across projects need a consistent project name, which is a required free-text field on Lessons today. This item does not depend on pm-9.

**Where to look:** `defs.ts:511-549`

<a id="ai-3"></a>

#### `ai-3` Template targets for Toolkit drafts

- **Area:** AI and automation
- **Priority:** Medium
- **Effort:** 3 (several days)
- **Status:** Reshaped after the code check

Chaser and sign-off drafts use the to-do, the source message and your own profile, not Staff data. Toolkit drafts (timesheet chaser, status report) use hard-coded text and have no template target. Add targets with placeholders filled by code, so users can edit the wording in Templates. No AI is needed. Staff templates for leave and birthdays already exist.

**Where to look:** `chaserDrafts.ts:99-135`, `targets.ts:174-240`, `timesheets.ts:93`

<a id="q-1"></a>

#### `q-1` Copy a template's wording

- **Area:** Quality of life
- **Priority:** Low
- **Effort:** 1 (hours)
- **Status:** Added after the code check

Templates has no copy action anywhere (the "…" menu has Restore, Duplicate and Delete). The preview shows example values, so copying that has little use. Copy the template wording with its placeholders instead. Reports and chasers already have copy buttons.

**Where to look:** `TemplateEditor.tsx:504`, `TemplatesApp.tsx:144-163`

<a id="q-15"></a>

#### `q-15` Global quick-capture hotkey

- **Area:** Quality of life
- **Priority:** Medium
- **Effort:** 3 (several days)
- **Status:** Added after the code check

There is no global shortcut in the desktop shell. Register one in the main process, show the main window, and send a new message to the existing page, the same way the open-to-do message works. A separate capture window will not work: every shell message handler requires that it came from the main window. The hotkey only works while the app is running; the tray is optional and off by default. Avoid the in-app combinations (Ctrl+K, Ctrl+Space, Ctrl+, Ctrl+W, M, Tab, Ctrl+Alt).

**Where to look:** `desktop/main.cjs:628-645,766,780-787,843-850`, `preload.cjs:74-83`, `shortcuts.ts:19-40`

<a id="q-16"></a>

#### `q-16` Bulk select in registers and Staff

- **Area:** Quality of life
- **Priority:** Medium
- **Effort:** 3 (several days)
- **Status:** Added after the code check

To-dos have multi-select with undo. Staff has single selection only. The registers have no selection at all: the first column opens the edit dialog, and there are two views (table and cards), so both need checkboxes. The bulk patch and undo helpers are specific to the to-do type, so they must be generalised. Registers already have per-record delete with undo; only Staff delete needs undo first (q-2).

**Where to look:** `ListTools.tsx:225-285`, `DirectoryTab.tsx:123,589-596`, `RegisterApp.tsx:79,117-120,317-320` (table row and delete-with-undo), `RecordCards`

<a id="q-17"></a>

#### `q-17` "Since you last opened" recap

- **Area:** Quality of life
- **Priority:** Medium
- **Effort:** 3 (several days)
- **Status:** Added after the code check

Needs a new last-opened preference plus a filter over the PMO audit log. That log covers PMO To-Do, messages, chasers, reports and settings only; Toolkit and Staff changes are not recorded. The viewer reads at most 2000 entries and shows 200 lines at a time. The change-count hook is only a re-render flash, not activity data.

**Where to look:** `ActivityTab.tsx:50`, `auditServer.ts:10-26`, `activityTimeline.ts:8-48`, `platformPrefs.ts:18,36`

<a id="q-19"></a>

#### `q-19` Export the to-do list to Excel or CSV

- **Area:** Quality of life
- **Priority:** Low
- **Effort:** 2 (a day or two)
- **Status:** Added after the code check

The to-do list has no export. CSV exists in the Toolkit, Staff and Activity. The Excel writer is in-house; it is used for blank import templates and for the Tasks incident review sheet (`tasks-app/reviewTemplate.ts`), which writes one row per incident, so a data list is not new ground, but a to-do export would be a new use. Templates already have Export pack.

**Where to look:** `lib/xlsx/writeXlsx.ts:1-25`, `RegisterApp.tsx:134`, `DirectoryTab.tsx:88`

<a id="q-20"></a>

#### `q-20` Slash shortcuts in the command bar

- **Area:** Quality of life
- **Priority:** Low
- **Effort:** 2 (a day or two)
- **Status:** Added after the code check

The local intent parsers use natural-language patterns only, with no "/" handling. Add a prefix that maps onto the existing intent router. No new AI path. The command bar file was only partly read.

**Where to look:** `localIntent.ts:8-18`, `localCommands.ts`, `barSuggestions.ts`

<a id="q-21"></a>

#### `q-21` Keyboard navigation in more lists

- **Area:** Quality of life
- **Priority:** Low
- **Effort:** 3 (several days)
- **Status:** Added after the code check

J, K, Home, End, E or Enter, D (done) and S (snooze) work only in the to-do list, and there is no Delete key. Staff rows already handle Up, Down, Enter and Space (`DirectoryTab.tsx:598-608`), so the Staff gap is J, K, Home, End, E, D and S. Extend the movement keys to Templates and Toolkit lists too; the template list itself has no key handling.

**Where to look:** `listKeys.ts:22-54`, `TodoList.tsx:49,175-180`, `shortcuts.ts:52-58`

<a id="q-22"></a>

#### `q-22` Recent items in the dock right-click menu

- **Area:** Quality of life
- **Priority:** Low
- **Effort:** 3 (several days)
- **Status:** Added after the code check

The dock menu has no recent-items support. Start with PMO To-Do and Templates.

**Where to look:** `DockTile.tsx:29-64,153-167`

### Phase 4: Later

<a id="ui-18"></a>

#### `ui-18` Add an item straight from a Toolkit tile

- **Area:** UI polish
- **Priority:** Low
- **Effort:** 3 (several days)
- **Status:** Reshaped after the code check

Adding is two clicks today (tile, then Add). A plus button saves one click, but each tile is a single button, so it must be restructured to avoid nesting buttons. Thirteen of the 14 tools share one component, so one prop covers them; Timesheets is separate and has no add dialog.

**Where to look:** `ToolkitApp.tsx:94-128`, `RegisterApp.tsx:79,169,362-368`, `tools.tsx:16-27`

<a id="ui-20"></a>

#### `ui-20` Notes: links, code blocks and tables

- **Area:** UI polish
- **Priority:** Low
- **Effort:** 3 (several days)
- **Status:** Reshaped after the code check

The editor is a plain text box with markdown-style markers and a toolbar for heading, bold, bullet and checklist. Notes are stored as plain text, so links, code and tables can be added as markdown with a rendered view and no format change. A migration is only needed if the text box is replaced by a rich-text engine, and the store already has a migrate hook.

**Where to look:** `NoteEditor.tsx:24-29,72-88,110-118`, `noteFormat.ts:1-2`, `notesStore.ts:158-162` (version and migrate hook)

<a id="ux-6"></a>

#### `ux-6` Named workspace layouts

- **Area:** User experience
- **Priority:** Low
- **Effort:** 3 (several days)
- **Status:** Fits as written

Window rectangles are stored per app, and named layouts exist only for the Dashboard. Save and restore a named set of open apps and positions. Overlaps q-8, so build that first.

**Where to look:** `schema.ts:38,121`, `windowStore.ts:22,399-411`, `lib/dashboard/layout.ts`

<a id="ai-6"></a>

#### `ai-6` Saved-examples library for prompts

- **Area:** AI and automation
- **Priority:** Low
- **Effort:** 3 (several days)
- **Status:** Reshaped after the code check

There is no training code, and a 12 GB model on a CPU-only 31 GB laptop makes fine-tuning impractical. The PMO structuring prompt carries four fixed in-prompt examples (no other prompt does). Let you save good outputs as extra examples that prompts can use. This targets the PMO prompts only: the Tasks engine incident classifier already retrieves "Examples from previous months" by nearest-neighbour search, so reuse that idea rather than starting from nothing.

**Where to look:** `core.ts:58-65`, `structurePrompt.ts:37-41`, `tasks/monthly-report-deck/scripts/ai_classify.py:158-223`

<a id="q-18"></a>

#### `q-18` Holiday-aware due dates

- **Area:** Quality of life
- **Priority:** Medium
- **Effort:** 4 (a week or more)
- **Status:** Added after the code check

Due dates skip non-work days only (a configurable work-days list, default Monday to Friday), and the due-date module is pure code with no files. Holidays live in Staff roster events, tied to locations, and a person's location comes from their city or home office. There is no user-level location setting. This needs a new preference and holiday data passed across the Staff and PMO areas.

**Where to look:** `due.ts:1-3,143`, `staff/holidays.ts:72-93`, `holidayRules.ts`

## Dropped after checking the code

Do not build these. Each was an idea from the first pass that the code check ruled out. A few have a small leftover gap, noted in the reason.

The three tables below hold 35 rows. Eight of them (`q-4`, `q-5`, `q-12`, `q-14`, `q-a`, `q-b`, `q-c`, `q-d`) were added after the first pass and then dropped, so the original 53 ideas lose 27 and 26 stay on the roadmap.

### Already built (22)

| ID      | Idea                              | Why                                                                                                                                                                                                                                                                                                                               | Evidence                                                                             |
| ------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `ui-4`  | Skip for now in the setup wizard  | Steps 2 and 3 already have Skip for now (it accepts the default). Steps 1 and 4 cannot be skipped by design. Closing the window keeps progress for 14 days.                                                                                                                                                                       | `FirstRunWizard.tsx:497-501, firstRunMemory.ts:17,144-159`                           |
| `ui-6`  | Dashboard sparkline trends        | The "This week vs last" card has sparklines but is hidden by default. Open to-dos and overdue chasers have no sparkline and no stored history. The real gap is discoverability.                                                                                                                                                   | `charts.ts:98-212, InsightWidgets.tsx:277-346, layout.ts:47-51`                      |
| `ui-12` | Toolkit urgency colours           | Late and soon badges already use danger and warning colours once the count is above zero. The tile border never changes, which is a minor gap. All tiles showed 0, so I could not see the badges live.                                                                                                                            | `ToolkitApp.tsx:98,117-126`                                                          |
| `ui-13` | Dark mode audit across apps       | All 10 apps were swept in light, dark, Deloitte-light and Deloitte-dark. The report found no clipping, horizontal scroll or contrast failures; its one fix (F1) was the quick settings menu running off the bottom of the screen. That sweep was automated, ran on an older build, and few screens were checked by eye.           | `docs/qa/uiux-2026-11-01/UX-REPORT.md, tokens.css`                                   |
| `ui-15` | Keyboard shortcut overlay         | The ? key opens Settings, Shortcuts. Small gap: the Notes shortcuts (Ctrl+B, Ctrl+Enter) are missing from that sheet.                                                                                                                                                                                                             | `shortcuts.ts:15-60, ShellEffects.tsx:36-45`                                         |
| `ui-17` | Dashboard drag to reorder         | Customise has drag grips, keyboard reordering, Hide and Wide checkboxes, Save layout and Reset. Reordering happens in the Customise list, not on the cards.                                                                                                                                                                       | `CustomiseList.tsx:28-176`                                                           |
| `ui-19` | Split-pane window mode            | Left and right half snapping already gives side-by-side windows, with no shared divider.                                                                                                                                                                                                                                          | `windowSnap.ts:16-39, WindowShortcuts.tsx:27`                                        |
| `ux-1`  | Scope commands to the focused app | The focused app is already passed to the model route and to local commands, and "Explain this" runs locally with live PMO numbers. Content tools exist only for Notes. Extending that is a large tool and safety design on a CPU-bound model.                                                                                     | `CommandBar.tsx:287-289,471, route.ts:289-292,383-385,475, localCommands.ts:190-213` |
| `ux-4`  | More sources in Ctrl+K            | Ctrl+K already searches apps, to-dos, templates, records, people, time off and notes. Confirmed live by searching a note and a template. The only gap is selecting the chosen note (ui-7).                                                                                                                                        | `GlobalSearch.tsx:76-91,171,297`                                                     |
| `pm-1`  | RAG status on all tools           | Every alert-enabled register already computes late, soon and info alerts, and the status report has a stored RAG per project.                                                                                                                                                                                                     | `alerts.ts:166,193-219, defs.ts:464-487`                                             |
| `pm-3`  | Risk heat map                     | A clickable 3x3 heat map already exists for RAID, filtering the list.                                                                                                                                                                                                                                                             | `HeatMap.tsx:50,97-104, defs.ts:6,57`                                                |
| `pm-6`  | Resource allocation view          | The capacity planner shows an 8-week paged grid of each person's allocation against leave and flags over-allocation.                                                                                                                                                                                                              | `CapacityGrid.tsx:10,32-96, capacity.ts:55`                                          |
| `ai-2`  | Chained commands                  | The command bar already splits "Open Tasks, then what's overdue?" into steps and runs them one after another, when each step resolves locally. The model route itself runs one tool call per request. Chaining model-route tools is not worth the risk on a CPU-bound model.                                                      | `ai-layer/CommandBar.tsx:640-658, route.ts:496-498`                                  |
| `ai-4`  | Confidence beside AI suggestions  | Incident suggestions already show a confidence badge, issue, vote label and reason, and the review panel has a "High confidence only" accept (shown only when some but not all suggestions are high confidence). The confidence badge is always shown; the issue, vote label, reason and new-category lines are each conditional. | `ReviewIncidentDialog.tsx:199-228, ReviewPanel.tsx:241`                              |
| `ai-5`  | Monday briefing                   | A morning briefing already exists ("Shown once a day while PMO Desk is open") with a time you set in Dashboard Customise, confirmed live.                                                                                                                                                                                         | `BriefingBackground.tsx:34-92, DashboardApp.tsx:380-412`                             |
| `q-5`   | Quick-add hint                    | The placeholder already reads "Add a to-do, e.g. Send deck to Priya Fri", with a live "Due …" line below the box.                                                                                                                                                                                                                 | `TodoList.tsx:400,414-422`                                                           |
| `q-12`  | Exact date on hover               | To-do chips already show the exact date as a title. Only the Dashboard to-do rows lack it.                                                                                                                                                                                                                                        | `ui/Chips.tsx:38, dashboard-app/widgets.tsx:213`                                     |
| `q-14`  | Link the roster export from Staff | There is no Staff-to-Outlook export to link. The "Outlook export" in the code is a read-only mail import script. Staff already has CSV and calendar-file exports.                                                                                                                                                                 | `PlanningPanels.tsx:408-440,675-700, staff/exportFiles.ts:103`                       |
| `q-a`   | Paste email to create a to-do     | The paste intake dialog queues pasted text into the inbox for review. It is a dialog, not a command-bar paste.                                                                                                                                                                                                                    | `PasteIntakeDialog.tsx:43-49,116-123`                                                |
| `q-b`   | Focus mode                        | Focus mode hides the dock, holds non-urgent toasts and quiets reminders, with a toggle in Settings. It lasts 25 minutes by default and is memory-only.                                                                                                                                                                            | `focusMode.ts, toastStore.ts:4,22, SettingsMenu.tsx:397-400`                         |
| `q-c`   | Backup and restore                | Backup is one click. Restore takes several steps (choose file, confirm, restore, restart) and keeps a safety copy. There is no automatic or scheduled backup, which could be a later item.                                                                                                                                        | `backup.ts:23,75,170-183, DataTab.tsx:176-255`                                       |
| `q-d`   | Natural-language dates            | Quick-add and the command bar resolve phrases like "Fri". Phrases such as "in 3 days" are not understood.                                                                                                                                                                                                                         | `whenPhrase.ts:115-164, barActions.ts:100,148`                                       |

### Does not fit or not worth it (12)

| ID      | Idea                             | Why                                                                                                                                                                                                                                                                      | Evidence                                                |
| ------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `ui-9`  | Collapsible Toolkit groups       | Missing, but low value for 14 tiles. The filter box in ui-8 covers the need.                                                                                                                                                                                             | `ToolkitApp.tsx`                                        |
| `ui-11` | Staff empty-state preview        | The directory already has an empty state with two actions. The preview illustration I proposed is low value.                                                                                                                                                             | `DirectoryTab.tsx:316-325`                              |
| `ui-14` | Template hover preview           | Selecting a template already shows a live "Preview with example values" with Plain and Mail layouts. A hover card would only save a click.                                                                                                                               | `TemplateEditor.tsx:166,499-531`                        |
| `ux-3`  | One-click approve on the AI card | The floating card is the leave-email nudge and already has Review, Later and Dismiss. To-do proposals are approved in the PMO To-Do review queue. Approving leave inline would skip the cover warning.                                                                   | `AiNudge.tsx:86-90,126-141, ProposalReview.tsx:377-379` |
| `ux-5`  | Voice commands                   | No speech code exists. The desktop shell only allows notifications and clipboard, so microphone access would need a deliberate change, and it would also need a local speech model. Whether browser speech sends audio to a cloud service cannot be shown from the repo. | `desktop/url-guard.cjs:50, main.cjs:854-870`            |
| `pm-4`  | Budget burndown                  | The app holds no spend or budget numbers. Cost, vendor value and invoice amount are free text, and budget on the status report is a Green, Amber or Red choice.                                                                                                          | `defs.ts:226,367,416,473-479`                           |
| `pm-8`  | Earned value (SPI and CPI)       | There are no task completion rates or cost figures. It would need a whole project-plan model.                                                                                                                                                                            | `registers/defs.ts, tasks-engine/main.py`               |
| `pgm-2` | Dependency graph                 | A Dependency type exists in RAID but nothing links one record to another. A graph needs a link on every record plus a graph UI.                                                                                                                                          | `defs.ts:21`                                            |
| `pgm-3` | Benefits realisation tracker     | No benefits, baseline or target data exists anywhere. It would be a new numeric register outside the app's purpose.                                                                                                                                                      | `no matches in src`                                     |
| `pgm-5` | Strategic alignment scoring      | The app has no strategic objectives or portfolio prioritisation workflow.                                                                                                                                                                                                | `no matches in src`                                     |
| `ops-8` | PMO maturity assessment          | Low value for a one-person desk tool. No code exists for it.                                                                                                                                                                                                             | `no matches in src`                                     |
| `q-4`   | "Don't show again" on AI nudges  | The nudge is only the leave-email card. Its approve state already has Review, Later and Dismiss and remembers seen requests. A permanent hide would also hide leave requests that need approval.                                                                         | `AiNudge.tsx:34-36,73-78,126-141`                       |

### Merged into another item (1)

| ID      | Idea                     | Why                                  | Evidence                   |
| ------- | ------------------------ | ------------------------------------ | -------------------------- |
| `ops-7` | Governance pack assembly | Folded into the weekly pack (pgm-4). | `toolkit/ReportDialog.tsx` |

## Not verified

These could not be settled by reading the code or the running app.

- Whether the packaged installer really contains Python (ui-2). Source only shows the setting that points at it.
- The Toolkit late and soon badges (ui-12). Every tile showed 0 open, so they never appeared.
- What the Dashboard "Report health" widget shows (ops-1). It was listed but not read.
- Whether Staff list rows have their own key handling (q-21), and whether chasers use a separate snooze (q-7).
- Whether the Template editor shows draft text while typing (q-6). Checked in code only, because typing would change your data.
- Ctrl+K people results (ux-4). The roster is empty.
- The theme sweep (ui-13) and the 11 UI proposals in docs/qa/uiux-2026-11-01/UX-REPORT.md come from the project's own QA report on an older build, before release 6.0.2. I did not repeat them.
- The 2026-11-04 review did not run the app, so the "running app" observations (five starter chips, no template tooltip, dock menu entries, empty Toolkit badges) were not re-checked. The code shows six default starter chips (ui-1).
- Typecheck, tests and lint were not run: Node and pnpm were not available on the review machine. Whether the code currently passes them is unknown.
- Whether the command bar turns "Open RAID log" into an action (q-9), only the title map was confirmed; whether template target keys are validated elsewhere (ai-3); and how q-2 Undo should handle the rest of the restore path.
- Nothing was built or run. Everything is from reading the source and looking at the running app without saving anything.
- Effort and priority numbers are my estimates. No tool can verify them.

## Existing UI backlog in the repo

`docs/qa/uiux-2026-11-01/UX-REPORT.md` already proposes 11 UI fixes (U1 to U11), with U1 to U4 marked first priority: snapped window gutters, the quick settings menu, and two PMO To-Do setup problems (placeholder text that looks like input and a hidden Finish button). It was run on build `e7becb9`, before release 6.0.2, and was not re-checked here. Check it before starting UI work so nothing is built twice. `ui-16` (snap preview) overlaps its U1.

## Suggested first batch

Small, self-contained, low risk, and each fixes something the audits confirmed.

1. `ui-3` Tooltip on truncated template names
2. `ui-7` Notes text filter, and open the chosen note from Ctrl+K
3. `ui-8` Filter box for Toolkit tools
4. `ai-1` Show the model name on the status chip and pill
5. `q-3` Drop a roster file onto the Staff import box
6. `ui-2` Plain-language Tasks engine start errors
7. `pm-9` Optional Project field (start here for anything touching status reports)
