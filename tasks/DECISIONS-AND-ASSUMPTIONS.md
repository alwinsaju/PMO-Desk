# Decisions and assumptions (Shift Roster and December Disconnect)

Written at the end of the build, 2026-10-23. This is the one place that says what was decided,
by whom, and what was assumed. No real names or data appear here: people are described by role only.

How to read it:

* **PMO** = decided by the PMO (the spec, or an answer in chat). These are settled; change them only on purpose.
* **Assumed** = chosen during the build because nothing was specified. Please confirm or correct each one.
  Most are one-line config changes (where that is true the row says where).
* **Limit** = an engineering limitation or a thing that was not verified. Nothing to decide, but good to know.

Related documents: [`ACCEPTANCE.md`](./ACCEPTANCE.md) (each acceptance criterion against test evidence),
[`FIRST-RUN-GUIDE.md`](./FIRST-RUN-GUIDE.md) (how to test both tasks today),
[`TASK-PLATFORM-CONTRACT.md`](./TASK-PLATFORM-CONTRACT.md) (file and endpoint shapes),
[`shift-roster/README.md`](./shift-roster/README.md), [`december-disconnect/README.md`](./december-disconnect/README.md),
[`shared/roster_lib/README.md`](./shared/roster_lib/README.md), [`shared/winter_lib/README.md`](./shared/winter_lib/README.md).

## Open items to confirm first (the short list)

| # | Item | Why it matters | Where to act |
|---|---|---|---|
| a | **The 1 Jan 2027 row of the Holiday Roster is assumed** (a Common holiday ticked for all six India locations and Mexico). | It decides who gets HOL on 1 Jan 2027, which is inside the Dec 2026 - Jan 2027 cycle. | Check the row in your Holiday Roster 2026 file (the reference copy in `shared/roster-reference/`); fix the file and re-run. |
| b | **Two fuzzy name matches in the winter plan** (staff roster name vs shift roster name) need a yes or no. | The form asks for each one (`name:<staff name>`); "same person" makes the match an alias for that run only, "Skip" leaves the staff member unscheduled. | Answer them in the December Disconnect form. To make a match permanent add `name_aliases` to `december-disconnect/config/winter-config.json`. |
| c | **Rolled-off people must be listed in `exclusions.people`** of the winter config (the list is empty today). | The staff roster's roll-off column is a placeholder (one date for almost everybody), so it is read but not used. A rolled-off person who is not listed WILL be scheduled. | Edit `december-disconnect/config/winter-config.json` before the first real run. |
| d | **Six people have no shift history** (nothing in the four months before the window) and default to shift S1. | The form asks for each one with S1 pre-selected; an unchanged answer is recorded as an assumption and flagged `WINTER_SHIFT_ASSUMED`. | Answer each question in the form, or add `shift_overrides` / change `default_new_person_shift` in the winter config. |
| e | **DIS headcount per day is uneven** (the plan follows the spec weights; there is no balance term). | The minimum (2) is always met, but the days above the minimum are not spread evenly. | Say so if you want a balance weight added (a code change, not a config change). |
| f | **Stray HOLs in Bengaluru, Mexico, Gurgaon and Hyderabad stay flagged.** Against the real Holiday Roster the check finds HOL on days the location is not ticked: Pune 11 dates (the 7 + 4 you confirmed), Bengaluru 13, Mexico 10, Gurgaon 4, Hyderabad 1. | They are errors in the flags, never fixed automatically (some may be PTO typed as HOL). | Review them in the draft's Flags tab and decide cell by cell in Excel. |

## Shift Roster

| Topic | Decision or assumption | Status |
|---|---|---|
| Rotation Sunday | One pure rule: if the month before the cycle's first month ends on a Sunday, Monday or Tuesday the rotation Sunday is that month's last Sunday, otherwise the first Sunday of the first month. **No hard-coded June 2026 exception.** Cycles are two months (Feb, Apr, Jun, Aug, Oct, Dec) in whole Sunday-Saturday weeks and tile exactly. | PMO |
| Year boundary | The roster file ends on 1 Jan 2027 but the Dec cycle runs to late January. The cycle is computed as a whole; the cells inside the file become the draft and the rest goes into a **next-year file** (starts the day after the last date, same number of date columns, grid cleared then filled with the remainder). | PMO |
| Next-year file details | The file keeps the old title and key text, legends, comments and hyperlinks (they may still mention the old year; the task lists them in warnings). Merged cells on the holiday row are dropped and one label is written per date. A warning says when the span is not a full calendar year (it keeps the same number of columns, so a leap year shifts the end date). | Assumed |
| Swap Sunday | No special case. S2/S4 are Wed-Sun, S1/S3 Mon-Fri, so a mover to S2/S4 works the rotation Sunday and is off Mon-Tue; a mover to S1/S3 has the Sunday off. | PMO |
| Auto-swap | AUTO_SWAP people flip from the shift **observed** in the previous cycle (S1/S2, S3/S4), not the shift written in the config, so a manual shift edit in the roster flows into the next cycle. An observed shift with no partner (S5, NS, US-*, custom hours) puts the person on the ask-me list. | PMO |
| Text written for a swapped shift | First hit wins: the person's own most recent text for that code, the team's most common text, the person's own text restyled (`Shift-1` to `Shift-2`), then canonical `Shift-N`. | Assumed |
| Cycle availability | A cycle is selectable only when every active person has a code in at least **95%** of the weeks of the previous cycle (config `has_data_threshold`). The reason is shown on hover when it is disabled. | PMO |
| Holiday Roster file | One row per holiday, one column per location, **`X` = off** (a tick, Y, Yes and 1 also work). Optional Mexico column. A bad file lists every problem with row numbers and disables every cycle. | PMO |
| Holiday Roster is optional | The PMO shares it about once a year, so the task never requires it. An uploaded file wins; otherwise the best `Holiday Roster*.xlsx` in `shared/roster-reference/` is used (the one covering the cycle's calendar years, newest first). For next year, drop `Holiday Roster 2027.xlsx` there or upload it. The source (uploaded or reference, file name, sha256) is recorded in the analysis, the draft's Run log, the report data, the diff and the audit entry, and later steps refuse when that file changed. | PMO |
| Holiday types | Common = all six India locations; location-specific = some; Mexico-only. Everyone working at a ticked location gets HOL on the latter two. Mexico staff always get HOL on any holiday that ticks Mexico, including Common India-Mexico rows (so shifts are flagged short on those days: expected). | Assumed |
| Fairness on Common holidays | Per team and shift, people in other time zones count toward the minimum, then people with the **most** offs this year cover first and the rest get HOL (A with 4 offs covers, B with 3 gets the off). Ties go to whoever was off most recently, then a seeded SHA-256 tie-break (seed in the config, printed in the Run log). | PMO |
| US-hours India people | India people on US-hours shifts are in the India fairness pool. | PMO |
| Counters | Count **Common holidays only** (fairness applies only to them), **per calendar year** (restart on 1 January), ignoring PTO, disconnect days, stray HOLs, HOL on a weekly off and location-specific HOLs. A person with no counter starts at the pool average (floor); a replacement inherits the leaver's counter. | PMO (Common only, per year); the pool-average start is Assumed |
| COMP | Never generated. Comp-offs are not tracked. An existing COMP in the roster is preserved. | Assumed |
| Minimum staffing ("Option B") | DIS, DEP and L3 need **3 per shift per day**. Every other team is counted **per team per day** across all its shifts (minimum 2), capped at the number of members scheduled that day. Shortages are flagged (`STAFFING_SHORTAGE`) and **never auto-fixed**. Both numbers and the mode are in `config/rotation-config.json` (`min_staff`, `min_staff_mode`). | PMO |
| Shift lanes and codes | MX-8-5 is treated as 19:30-04:30 IST (CST = UTC-6), so a Night/US lane; OC counts as a working code; custom time-range text counts as working but has no lane. | Assumed |
| PTO import | Writes P, T or SL **only on days the person would work**; weekly offs and other leave stay; PTO beats a generated HOL; no replacements are arranged; clashes (swap Sunday, needed, below minimum, overlap) are flagged, not blocked. Only P, T and SL are accepted codes. | PMO |
| PTO names | An exact match (any word order, any case) is silent; a close match is a form question and is never accepted without an answer; a name matching nobody is the error flag `PTO_UNMATCHED` (not applied). | Assumed |
| Preserved leave | A leave code (P, T, SL, COMP, or a HOL typed by hand) already in the master for the cycle is never rewritten. The person is away that day, a PTO import on it keeps the existing code, a preserved HOL on a Common holiday counts as an off already taken, a preserved stray HOL stays flagged, and each one is an INFO flag `PRESERVED_LEAVE`. | PMO |
| HOL provenance | The "random HOL on Pune" report was investigated: all 41 stray Pune HOL cells (11 dates, every 8 weeks on a Tuesday and a Thursday) are in the MASTER roster; the program wrote only matrix-justified HOLs (2 for Pune in the Dec 2026 draft). The build keeps and flags master HOLs, so they looked app-generated. Now every `HOL_STRAY` / `PRESERVED_LEAVE` flag says "already in the master roster; not added by this run" and has `origin` (`master` / `program` / `user`) in `flags.json` and the draft's Flags tab, the Draft Summary counts HOL written versus kept, and the error `INTERNAL_STRAY_HOL_WRITTEN` would fire if the program ever wrote a stray HOL (never). Nothing was removed from the master. | PMO (keep and flag); the provenance fields are Assumed |
| Building from the next-year file | The next cycle (Feb-Mar 2027) is built from the 2027 file produced by the Dec-Jan cycle. Only the previous-cycle weeks that lie inside that file are judged for "has data" (4 of 9 weeks), shifts are derived from them and counters start at zero. A week that runs past the end of a file is NOT left out, so the old year's file never enables the cycle after the crossing cycle. The 1 Jan 2027 HOL (in the old file) is not counted in the 2027 counters; it is a Common holiday, so only a one-off fairness difference. | Assumed |
| Thin Holiday Roster | A Holiday Roster with fewer than 3 rows in a calendar year of the cycle, or no row inside that part of the cycle other than a 1 January row, gives the non-blocking warning `HOLIDAY_ROSTER_MAY_BE_INCOMPLETE` (flags and `options.json` problems) and the cycle stays selectable: with only the assumed 1 Jan 2027 row a Feb-Mar 2027 draft would otherwise get no holidays silently. | Assumed |
| Weekly-template groups (PATTERN) | Device Support (3 people) and CMS 2.0 (2 people) are PATTERN groups. Device Support: weekend duty (Saturday shift, Sunday on-call) passes A -> B -> C every 3 weeks (9-week rotation), and two of the three swap Shift-3/Shift-4 at every "Shift-swap" marker (every 6 weeks), so the full pattern is 36 weeks (not 3). CMS 2.0: two people alternate on-call weekends (Saturday and Sunday on-call), 2-week pattern. The program detects period and phase from the roster, continues the exact texts (on-call included) and stores the learned pattern in the config. A cycle with too little history to prove a 36-week pattern asks the people (`PATTERN_NOT_DETECTED`, KEEP = copy forward) instead of guessing. Please confirm the detected on-call day (Sunday; CMS also Saturday) against the legends. | PMO (rule described); detection, 36-week period, storage and fallback are Assumed |
| Stray HOLs | HOL on a day the location is not ticked is the error `HOL_STRAY`: flagged, **never auto-fixed or removed** (some may be PTO). The 2026 roster has the 7 Pune dates you named (23 Jun, 9 Jul, 18 Aug, 13 Oct, 29 Oct, 8 Dec, 24 Dec) plus 4 you confirmed as errors (28 Apr, 29 Apr, 14 May, 3 Sep). Other locations: see open item f. | PMO |
| December Disconnect days | Days in `disconnect_windows` (26-31 Dec 2026) are skipped by the holiday assignment, the HOL check and the counters. The December Disconnect task adds them to the Shift Roster config when it finalises (a timestamped, hash-verified backup of the old config is kept). | PMO (windows ignored); the automatic cross-task config update is Assumed |
| Excluded sections | Sections named in `excluded_sections` (default Governance) or matching the patterns Leadership, Governance, PMO, Analytics (case-insensitive substrings) are never touched: not rotated, no PTO, no HOL, not checked. | Assumed |
| Team aliases | The roster section `L2` counts as team `DIS`. A `team_aliases` map in the config **replaces** the default, so list every alias you want. | Assumed |
| Questions asked | ASK_ME and UNCLASSIFIED people every cycle, an AUTO_SWAP person whose shift has no partner, new people (new seat or replaces whom), close PTO name matches. A new person who already has codes keeps the observed shift for PERMANENT and flips it for AUTO_SWAP (a `ROTATION_WARNING` says the shift answer was ignored). | Assumed |
| Replacing an ASK_ME seat | A replacement inheriting an every-cycle category keeps the replaced seat's shift and pattern (answer KEEP) and gets an INFO flag so the shift can be corrected in Excel. | Assumed |
| Final build | The final roster is the master with **only the approved cells** written (package-level and cell-level proof before it is moved into place). The master is never written; a hash-verified backup copy goes to `output/backups/`. | PMO |
| Config after finalize | `finalize` rewrites `config/rotation-config.json` (shifts and person changes become the new baseline) and keeps the previous file in `config/backups/`. Because of that a finished run cannot be finalized again: start a new run. | Assumed |
| Draft re-run | A re-run **overwrites** `output/Roster DRAFT <cycle>.xlsx` (the Shift Roster does not archive drafts; the December Disconnect does). Copy a draft you edited first if you want to keep it. | Assumed |
| Seed | The holiday tie-break seed lives in the config and is printed in the Run log, so the same inputs give the same draft. | Assumed |

## December Disconnect

| Topic | Decision or assumption | Status |
|---|---|---|
| Window | Fri 25 Dec 2026 to Fri 1 Jan 2027 (8 days) by default. The window is configuration: change it in **both** `winter-config.json` and `analytics-config.json` for another year or period. | PMO |
| Main plan rules | Everybody works **3 to 5 days** on their **usual shift**, one slot per person per day. Minimums per day: DIS 2, DEP 2, CMS 2.0 1, LNS 2.0 1, Integration HUB 1. A shortfall is penalised heavily and reported, never silently accepted. | PMO |
| Best-effort teams | L3, Device Support, Lab, EKS, R&D and similar teams have no minimum; a day with nobody is a warning, and their members work at most 3 days. | Assumed |
| Usual shift | The modal working shift over the 4 months before the window (ties go to the most recent); `shift_overrides` beat history. | Assumed |
| People with no history | The form asks for each one's shift; the pre-selected answer is `default_new_person_shift` (S1 in the real config). Every such answer is recorded as source `answer` and flagged `WINTER_SHIFT_ASSUMED`. See open item d. | Assumed |
| Fairness and blocks | Each person should get 1-2 of the holiday/weekend days (25, 26, 27 Dec, 1 Jan) and one contiguous block of days is preferred. Both are soft weights. | Assumed |
| Weights | Shortfall 1000 per head times a day weight (weekday 3, holiday 2, weekend 1), 4th/5th day 400/600, lane 60, sub-team 40, fairness 5, block 1, stability 30, below 3 days 5000. All are in `winter-config.json`. | Assumed |
| Headcount evenness | The plan follows the weights above; there is **no balance term** that evens out headcount across days (open item e). | Assumed |
| Exclusions | Teams matching Leadership, Governance, PMO, Analytics are excluded. **Rolled-off people go in `exclusions.people`** (open item c): the staff roster's roll-off column is a placeholder and is read but not used. | PMO (excluded teams); the roll-off handling is Assumed |
| Name matching | Staff roster and shift roster names are matched exactly, then by the same words in any order, then via `name_aliases`, then by a conservative same-team fuzzy rule. **Every fuzzy match is a form question**, never accepted silently (open item b). People on only one roster are warnings. | Assumed |
| Availability exceptions | From the config and from the form (5 rows for the main plan, 3 for Analytics): "not available on" or "available ONLY on" a date list. Form rows go into a copy of the config, never the real file. A person who cannot work 3 days because of availability gives a warning, not an error. | Assumed |
| Analytics plan | 34 slots (30 IST, 4 Mexico), exactly one person on call every day (the two on-call people take 4 days each and one slot), Mexico slots to the Mexico person only, every support person 4 slots (fewer when availability forbids). | PMO |
| Analytics extra slots | The standard counts add up to 29 for 30 IST slots, so the missing slot goes to the best-fitting eligible person and is explained in plain English as an INFO flag (`ANALYTICS_NOTE`) and in the workbook. | Assumed |
| Analytics lead | The analytics lead who is not on last year's list is **not in the Analytics config and is excluded**. | Assumed |
| Analytics usual shifts | Refreshed from the optional Oct and Nov Analytics rosters (modal S1-S3 shift); people, roles and the on-call / Mexico assignments stay as configured. Without the rosters the config is used as is. | Assumed |
| Analytics solver | Deterministic, no stability term: the same inputs give the same plan, but a re-run does not try to keep the earlier plan. (The main plan has a stability term.) | Assumed |
| Review and confirm | The PMO edits both drafts in Excel (main plan `Winter Plan` grid, Analytics `Winter Roster` Assigned column), saves them under the same names and approves. Flags are never auto-fixed. | PMO |
| Finals | Each final file is a **byte-for-byte copy of the confirmed draft** (formulas intact, nothing regenerated), so the final keeps its hidden `_snapshot` and is not meant to be diffed again. | Assumed |
| Cross-task write | `finalize` adds 26-31 Dec to `disconnect_windows` in the Shift Roster config (path in `config/task-config.json`, not in the winter config because `winter_lib` validates that file strictly). | Assumed |

## Both tasks (platform and storage)

| Topic | Decision or assumption | Status |
|---|---|---|
| Deterministic code | No LLM judgment in any step; the AI only orchestrates. Every step is headless Python (runtime `local`), never a Claude-CLI session. | PMO |
| Storage | Everything real is under gitignored `input/`, `output/` and `config/` folders (and `shared/roster-reference/`). Nothing real is committed; tests use synthetic names. | PMO |
| Approver | Approve and Send record the **OS user** and a UTC time on the run, for **all** tasks (also the older ones). The client never supplies a name. | PMO |
| Platform changes ("Option A") | Additive changes to the agent-office backend were approved (uploads, prepare, options, params, form, diff, flags endpoints, approver stamp, `outputPaths`). The four older tasks and the incident-review gate behave as before. | PMO |
| Installed dependencies | `openpyxl`, `scipy`, `numpy`, `xlsxwriter`, `lxml`, `pillow` and `python-multipart` were installed into the tasks venv and into the agent-office venv. The solver is the HiGHS bundled in `scipy` (no extra package). | Assumed |
| Master protection | The master roster is never modified: every writer takes a source and a different destination, and the master's sha256 is compared before and after (analyze, build draft, diff, finalize). | PMO |
| Re-runnable | Re-running a step with the same inputs gives the same files; the audit log is append-only. | PMO |
| Blocked confirm | The backend refuses Reject at the confirm gate, so a blocked confirm cannot be repaired in place: the Tasks app shows **Start over** (Reset) and you run the task again. | Assumed |

## Engineering limits and unverified items

| Item | Detail |
|---|---|
| Excel not verified | **None of the written workbooks has been opened in Excel.** Neither Excel nor LibreOffice is installed on the build machine. Open the first draft, a final and the next-year file once in Excel and look for a repair prompt (see the first-run guide). |
| Restricted formula evaluators | The formulas (Analytics and winter workbooks) were checked with two small evaluators written for the functions used (cached value equals recalculated value, zero errors). They prove the formulas are consistent under those semantics, not that Excel agrees to the last detail. The pure-python `formulas` package gave wrong answers on a probe, so it was not used. |
| Excel re-save tolerance | The diff steps read text only and find tables by header text, so an Excel re-save (strings reindexed, styles rewritten, cached values recomputed) does not matter. Verified with synthetic re-save variants, not with real Excel output. A hyperlinked data cell re-saved through openpyxl shows as a spurious outside-plan change. |
| Diff compares text | A formula typed into a grid cell is compared by its cached text (and warned about); a date typed into a code cell shows up as its serial number. |
| Inline strings | The draft patcher writes text as inline strings when the text is not already in the shared strings; Excel converts them on its next save (harmless). |
| Reject at confirm | The backend does not offer Reject at the confirm gate; a blocked confirm needs **Start over** and a re-run. |
| Analytics re-run loses manual edits | A re-run builds fresh drafts without your manual edits. The December Disconnect archives the earlier drafts in `output/archive/<UTC time>/` so nothing is destroyed; re-apply the edits you still want or enter them as availability exceptions. |
| Backend restart | The agent-office backend keeps run state in memory and loads code at start-up, so it **must be restarted** once to load the new endpoints and manifests. A restart forgets any in-progress run (files on disk stay). |
| Interpreters | The Tasks app launches the backend with `Agents-workspace\.venv\Scripts\pythonw.exe` and the backend runs every step with that same interpreter. The README commands and the test suites use `tasks\.venv\Scripts\python.exe`. Both are Microsoft Store Python 3.13 venvs; a new dependency must be installed in both. |
| Real-file tests | Tests marked "real" read COPIES of the gitignored reference files and configs and skip when those are absent. They ran on this machine (see `ACCEPTANCE.md`). They assert counts and dates, never names. |
| Not tested | Real click-through of the Tasks app against a live backend with these two tasks (the lifecycle is tested through the backend's TestClient with subprocess steps, and the UI by its own tests). That is what the first run is for. |
