# AI OS 2.0.0 — Manual QA plan

Date: 2026-10-25. Build under test: `release/AI OS Setup 2.0.0.exe` (built 07:49 local). HEAD at planning time: `6dba299`.
Note: two commits landed after the installer was built (`a7af903` Force reset stops the run in flight; `6dba299` PMO structuring v4). Findings touching those areas are tagged `[post-build]` and must be re-checked on the next package.

## Ground rules (safety)

* All GUI testing happens inside **Windows Sandbox** (disposable, no OneDrive, no Outlook, no real data). Nothing is run against the real PMO inbox, the old agent-office engine on :8000, or Outlook.
* Never run the four mailer tasks (`weekly-aging-report`, `weekly-backlog-report`, `deployment-dep-weekend-mailer`, `monthly-report-deck`) past their review gate; never press Send. They are inert in the sandbox (no Outlook COM) but the rule stands.
* No app source is modified during QA. Bugs are logged, not fixed.
* The PMO inbox is always pointed at an empty folder inside the sandbox (`AI_OS_PMO_INBOX_DIR`).

## Severity scale

S1 crash / data loss / unsafe action · S2 feature broken, no workaround · S3 feature impaired, workaround exists · S4 cosmetic / polish · IMP improvement suggestion.

## Tracks

| # | Track | How | Owner |
|---|-------|-----|-------|
| A | Clean-machine install, first run, uninstall, reinstall, upgrade over 1.0.0 | Sandbox + `scripts/clean-machine` | sandbox agent |
| B | Feature-by-feature manual test of every app and shell feature (below) | Sandbox, Electron driven over DevTools protocol, screenshots | sandbox agent |
| C | UI pass: idle behaviour, visual defects, theming, resize/maximize, lean mode, lag/jank/CPU/memory while idle and while running a feature | Sandbox, CDP performance + process counters | sandbox agent |
| D | UX pass: discoverability, copy, empty/error states, keyboard, focus, accessibility basics | Sandbox + code reading | sandbox agent + review agent |
| E | Code quality: lint, typecheck, tests, dead code, unused deps/exports, duplication, bundle size | Static, host | code-quality agent |
| F | Logic / workflow review: PMO intake→todo→report, Tasks engine state machine, setup flow, desktop main process, data safety | Static + targeted runtime | workflow-review agent |

## Feature checklist (track B)

**Shell**: boot/splash/login screen, wallpaper, top dock (launch, hover, running indicators), window manager (open, focus, drag, resize, minimise, maximise/restore, close, snap, multi-window z-order, window persistence across restart), taskbar (editable), spotlight/search, context menus, tooltips, theme (light/dark/brand), display settings (lean mode, hardware acceleration + relaunch), settings (gear), notifications, tray ("keep running in tray"), single-instance behaviour, window-close vs quit.

**AI layer**: command bar (bottom pill), cursor, annotations, presence avatars, handoff to AI-controlled window glow, AI runtime start/stop/model watch, behaviour with Ollama missing, AI log view.

**Setup**: "Set up AI OS" dialog; Ollama card (install/proxy message/manual steps), model card (download, cancel, resume, low-RAM smaller model), PMO inbox card (path, browse, use this folder), Outlook card (none/new/classic), engine self-test card, "Check again", reopening from Settings.

**Apps**: Files, Notes, Browser (embeddable vs new-tab fallback), App Store (install/uninstall web apps, detail view), Tasks, PMO To-Do (inbox ingest, structuring, review queue, todos CRUD, due dates/reminders, waiting-on, chasers, sign-off, reports/narrative, quote, dedupe, filters, manual intake, Outlook export, editable taskbar).

**Tasks app + engine** (synthetic fixtures only): task list, task detail dialog, run → review gate → approve/reject, Force reset (incl. mid-run), history, log, shift-roster, december-disconnect, config editing, input/output folders under `%APPDATA%\AI OS\tasks-engine`, port selection 8000–8019, engine restart, engine stop on quit, data survives reinstall, `shared/` roster data protected from workcopy sync.

**Robustness**: kill engine/Next server mid-use, disk-full-ish paths with spaces and non-ASCII, rapid open/close of windows, 10+ windows, long text, window off-screen, DPI/scale 100/150/200 %, offline network, second launch while running, quit cleans up child processes (python, ollama).

## Evidence

Screenshots and logs under `docs/qa/evidence/`. Findings are collected in `docs/qa/QA-REPORT.md`, one ID per finding (`QA-001` …) with severity, area, steps, expected, actual, evidence, build/commit.
