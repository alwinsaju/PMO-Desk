# PMO Desk

A local, desktop-style "AI Operating System": a virtual desktop in which a person and a
local AI can drive the same windows and apps, with handoff between them. It runs entirely
on the user's computer (loopback only; the AI is a local Ollama model, no cloud model).

## What it is today

- **Desktop shell**: wallpaper, a dock, a window manager (drag, resize, minimize, maximize,
  per-window human/AI control; each app's window reopens where you left it), light/dark and
  Deloitte themes, a tray icon, and a Quick
  settings (in the App Menu, top of the dock) with a _Fast AI model_ switch, _Skip the lock screen_, _Setup and health check_ and _Restart Tasks engine_.
  The dock shows a hover label for every icon (with what a badge means, for example "3 need
  attention: 2 PMO items, 1 time-off request"), an accent dot for open apps, the launchers in their
  own group and, on a narrow screen, the apps that do not fit under the App Menu's "+N". The lock
  screen greets you by name (the name set in PMO To-Do, else your computer account's first name)
  with your initials, and shows what needs you under the clock (Settings > General turns it off).
- **Command bar with a local AI**: the AI can open, focus, minimize, maximize and close windows
  with a visible cursor and ownership handoff, and create, update and delete notes when Notes
  is focused. It uses Ollama on `127.0.0.1`. It also answers PMO questions from the real data,
  by code (so a small model cannot invent a name or misread a date, and it works with Ollama
  stopped): _"Who's off next Monday?"_ (Staff time off and the shift roster), _"What's overdue?"_,
  _"What do I need to chase?"_, _"PMO status"_, and _"Prepare this week's aging report"_, which
  opens the Tasks app on that task's Run form (you add the files and press Run; nothing is sent
  without your approval). Anything it does not recognise goes to the model as before. An answer
  appears as a card with the question as its title and Copy and "Show me in ..." buttons in its
  footer; it stays until you dismiss it (Esc or the close button). The bar shows its Ctrl+Space
  hint, which jumps to it from anywhere; a misspelt day or task name gets a "Did you mean...?". It also
  creates, snoozes and closes to-dos ("remind me to send the invoice Friday"; it asks first), says
  when someone is back or what their shift is, lists what changed since yesterday, and can chain
  steps ("open Tasks, then what's overdue"). Ctrl+K searches everything in groups (Apps, People,
  To-dos, Templates, Records, Notes, Time off), highlights what you typed and lists the last five
  things you opened when the box is empty; Ctrl+, opens Settings.
- **Dashboard**: one screen for what needs you today: open to-dos (overdue, due today and
  tomorrow, waiting), overdue chasers, the status of the report tasks and the PMO weekly report
  (running, needs review, failed, last run), and who is out this week or next (approved time off,
  requests waiting, and the leave days the shift roster marks). It only reads; each card opens
  the app behind it. **Customise** shows, hides, drags to reorder (the Dashboard follows live; Up and
  Down arrows on the grip work too) and widens cards and saves named
  layouts. Extra cards: a merged Today list with an Open button per row, workload by person (late, due
  soon and other in one bar), how long to-dos have sat, the sign-off pipeline, report health as coloured
  chips and this week against last with sparklines. The desktop app shows a
  "needs you" count on the dock and taskbar, a once-a-day briefing, and exports the dashboard
  as a PNG or PDF.
- **Templates**: a library of email and report templates (`src/lib/templates/`,
  `src/components/apps/templates-app/`) so wording can be edited without touching a task
  folder. Write a template with `{{placeholders}}` and `**bold**`, see a live preview with example
  values, and choose which tasks and apps use it (the Aging, Backlog and Deployment mailers'
  subject, To, Cc and message; the PMO sign-off request, chaser and weekly report). Each place uses
  one template; choosing a place another template has moves it, and deleting a template puts a place
  back to its own wording. Templates can have `{{#if overdue > 0}}…{{else}}…{{/if}}` blocks, reusable
  snippets (`{{> Signature}}`), tags, other wordings per audience, a version history with
  Restore, a test draft (an unsent mail) and a preview in the mail layout. Packs export and
  import as one file. A new library starts with templates that reproduce today's wording, so
  nothing changes until one is edited, and _Restore original wording_ brings a starter back. See
  [`docs/templates.md`](./docs/templates.md).
- **PMO To-Do**: turns messages dropped in a PMO inbox folder (Power Automate, an Outlook
  export script, or the Paste button) into reviewed to-dos with reminders, chasers, sign-off
  tracking and a weekly report. Nothing becomes a to-do without a human approving it. Cancelled
  to-dos can be deleted for good (**Clear cancelled** in the Done list, or **Delete** in one).
  Repeating to-dos create their next round when you close one (with Undo). You can tick several
  to-dos for bulk actions, save views, filter by tag, use a Board (drag between columns) and a
  Week or Month Calendar (drag a to-do to a day), mark a to-do as blocked by another, rename a row in
  place, plan the week, add to-dos from pasted meeting notes, escalate a quiet chase and hand a
  to-do to a teammate from Staff. All of it stays on this computer; mail is only ever opened unsent.
- **Tasks app** extras: workflow cards show an icon, the last run ("Completed 2 h ago · 4 min") and a
  coloured step timeline; **Details** has a vertical step list with each step's status. A History
  table (status pill, workflow, when, how long, and **Open output** for the file a run made; a row opens
  to show who approved what and a failure in plain words, plus trends), a Schedule tab (a seven-day
  strip where you click a day to switch a weekly schedule on, move it or off, the table for monthly
  ones, optional self-preparing that always stops at the review step, a send-later queue) and, before a
  run, a checklist of what is still needed, a "What will happen" preview, a check
  of the uploaded export and a comparison with the last run. Mail recipients are checked before
  you confirm a send. In the desktop app, "Newest in Downloads" picks up a fresh export.
- **Tasks engine** (`tasks-engine/`, Python/FastAPI) and the **Tasks app**: runs the task
  folders under `tasks/` (Shift Roster, December Disconnect, the weekly and monthly reports,
  the deployment mailer) through prepare, review, approve and send gates. A **Packs** tab (a card per
  pack with its version and Remove) adds
  tasks without reinstalling: install a checksummed task pack (you confirm its fingerprint first),
  or build a mailer from a table and a template with a wizard. See
  [`docs/task-packs.md`](./docs/task-packs.md).
- **Settings** (Ctrl+,): a search box at the top filters every setting and jumps to its tab and row.
  General (profile, lock screen and desktop, to-dos, focus, command bar; each group is a card),
  Notifications, Shortcuts,
  Accessibility and four platform tabs. **Data** shows the data folder, a storage meter, the last backup
  time, and backs up,
  restores (after saving what it replaces) and exports to JSON or CSV. **Activity** is the audit log in
  plain words as a timeline with icons, day headings and filters. **Help** has a guided tour, sample data you can add and remove again, and three tasks
  for each app. **About** shows the version and what's new, an update check that is off until you turn
  it on (it only downloads an installer whose SHA-256 matches, and never runs it for you) and a
  diagnostics file for support with passwords, tokens, emails and user names removed.
- **Staff Management** (`src/lib/staff/`, `src/components/apps/staff-app/`): the roster of
  people. A Directory (the main columns in a list, everything else in a right-hand detail pane),
  a Shift roster (teams from the directory, each with its own shift schedule, in Day, Week,
  Month and two-month Cycle views, with holidays by location and approved time off; it can be
  imported from the team's roster workbook), a Time-off tracker and an Offboarded list (people removed from the
  roster, kept on file and editable, restorable or deletable). It is meant to be the one list of people that
  the other apps read instead of an uploaded Excel file. Leave emails and M365 profiles are read in the
  background while PMO Desk runs (light local model, no window needed); the AI orb at the bottom right
  tells you when a leave request waits for approval. An **Insights** tab adds capacity per team with
  minimum-cover rules, leave approval with a warning when cover would fall short and a templated reply
  (unsent), leave balances, shift swaps, a fair weekend and holiday on-call rotation, roll-off and
  contract-end alerts, birthdays and anniversaries, a skills matrix with "who can cover", an org
  chart, onboarding and offboarding checklists, public holidays by rule, and exports (CSV for Excel
  and calendar files). Click a name for a small profile card. Leave can be entered for several dates at once
  ("5–7 Nov, 12 Nov"), and Settings has a colour-blind-safe roster palette.
- **PMO Toolkit** (`src/lib/registers/`, `src/components/apps/toolkit/`): fourteen small tools, grouped on the
  launcher as Risks and decisions, People and time, Delivery, and Finance and contracts (each card has an open /
  late / soon count). A tool opens from
  the toolkit in the same window (with an "All tools" Back button), or in its own window from the command bar
  ("open raid log") or Ctrl+K: RAID log, meeting minutes
  (action lines become to-dos you tick), timesheet chaser (leave is skipped; one draft for everyone missing),
  decision log, SLA watcher (paste incidents; days per priority), change requests (weekly summary),
  governance calendar (prep to-dos dated back from the meeting), stakeholder register (contact cadence),
  vendor and contract tracker (notice deadlines), capacity planner (over-allocation against leave), invoice
  readiness (what each invoice still lacks, month-end check), status report builder (RAG roll-up and report)
  and lessons learned, and a document link library. Each shows what is late or due soon, can make a to-do
  or an unsent chaser mail, exports CSV and is included in backups and data export. Late items appear in
  the "needs you" count, the dock badge and an optional Dashboard card. Nothing is sent from any of them.
  Every list shows status, impact and likelihood in red/amber/green, type chips and owner initials, and can
  switch between a table and cards (remembered per tool); the RAID log adds an impact x likelihood heat map
  whose cells filter the list. Add and Edit forms group their fields (What, Who, When, Details).
- **Notes**: pin notes to the top, filter by `#tag` written in a note, and format with the toolbar (heading,
  bullet list, checklist, bold). A note is still plain text: `# ` heading, `- ` bullet, `- [ ] ` / `- [x] `
  checklist and `**bold**`; Ctrl+Enter ticks the checklist item under the cursor. Word count and a Saved
  indicator sit under the editor.
- **Browser**: tabs (up to 8), each with its own history. A new tab shows shortcuts and the last 8 sites you
  opened (kept on this computer; Clear removes them). A page that cannot be shown gets an error card with
  Retry and "Open in default browser".
- **App Store**: a hero for the featured apps, category chips with counts, and a detail sheet per app
  (description, what it does, size, Install / Open). The descriptions and sizes are sample copy
  (`app-store/appDetails.ts`).
- **First-run Setup screen**: checks and installs what a new computer lacks (Ollama, the AI
  model, the OneDrive folders, classic Outlook, the Tasks engine). A first install also creates one
  `OneDrive\AI-OS` folder for every flow and opens an animated first-time setup, one step at a time,
  ending with step-by-step Power Automate guides (`docs/pto-email-flow.md` has the PTO email flow).
- Demo apps (Notes, Browser, web apps) and an app store.

[`ARCHITECTURE.md`](./ARCHITECTURE.md) has the module boundaries, contracts and the security
model in detail.

## Security model

- **Loopback only.** The UI server and the Tasks engine listen on `127.0.0.1` (the engine on
  the first free port of 8000-8019). Every `/api/*` request must carry a loopback `Host`
  header (DNS-rebinding defence), and a request that changes something must not come from
  another origin (`src/middleware.ts`). The engine applies the same Host/Origin rules.
- **Per-launch engine token and instance id.** The server generates a random token and an
  instance id when it starts, and gives them to the engine it launches
  (`AI_OS_ENGINE_TOKEN`, `AI_OS_ENGINE_INSTANCE`). The engine rejects any request without
  `X-AI-OS-Token` (only `GET` and `HEAD` of `/health` are open). The Tasks app fetches the token from this
  app's own `/api/tasks-engine/token` route, which only answers its own origin. The desktop
  app adopts only an engine whose `/health` reports its instance id.
- **Content-Security-Policy and headers** (`next.config.mjs`): `frame-ancestors 'none'`,
  `X-Frame-Options: DENY`, `nosniff`, a restrictive `connect-src` (this app and loopback).
  The Browser app deliberately allows framing arbitrary sites; its embeddability check refuses
  private, loopback and link-local targets.
- **Child processes** never inherit `NODE_TLS_REJECT_UNAUTHORIZED` or `PYTHON*` settings.
- **Review gates**: the mail-sending tasks never send without an explicit approval, and the
  PMO inbox never creates a to-do on its own. A task pack must contain at least one review or
  confirm step or it is refused at install.
- **Outlook/Excel safety switch**: set `AI_OS_TASKS_OFFICE=off` (for the app, or the engine you
  start by hand) and every PowerShell step of a task, the ones that drive Outlook and Excel
  (pivot, draft, send, refresh), is skipped with a line in the task's log, so a tester or a dev
  machine can run the tasks without touching a mailbox. Python steps still run; the review
  and completion messages say that Outlook was skipped. Unset, tasks behave as normal.
- Dependencies are audited with `pnpm audit --prod`.

## Where data lives

Everything the installed app writes is under `%APPDATA%\ai-os` (Electron's user-data folder),
never in the install folder, so a reinstall keeps it: `tasks-engine\` (task inputs, outputs,
config, run history and `task-packs\`, the installed task packs), `pmo\` (the PMO data folder: to-dos,
queue, audit log, reports, and `backups\` with the safety copies Restore makes),
`pmo\staff\` (the Staff Management roster, shifts, time off and profile pictures),
`pmo\templates\` (the Template library, `library.json`; the Tasks engine reads the same file through
`AI_OS_TEMPLATES_DIR`),
`desktop.log`, and the app's settings files. The first-run Setup screen and `docs/clean-machine-test.md`
describe how to test this on a new computer.

The folder keeps the product's old name (`ai-os`) on purpose, and so do the OneDrive folder `AI-OS`
(`PMO-Inbox`, `Staff-Exchange`, `PTO-Inbox`, which live flows write into), the installer's `appId`
(`com.aios.desktop`) and the `AI_OS_*` environment variables: renaming any of them would orphan data
or flows. `desktop/user-data.cjs` pins the folder in code so the product name cannot move it.
The logo files are in `public/brand/` (from `docs/marketing/logo/`); `node scripts/build-brand-assets.mjs`
regenerates the `.ico`/`.png` files from them.

## Installing (unsigned build)

The installer (`PMO Desk Setup x.y.z.exe`) and `PMO Desk.exe` are **not code-signed**. Windows
SmartScreen will warn on the first run: choose **More info > Run anyway**. On a managed
computer where Smart App Control, AppLocker or Windows Defender Application Control blocks
it, ask IT to allow the installer / the folder `%LOCALAPPDATA%\Programs\PMO Desk`.

## Stack

- **[Next.js 15](https://nextjs.org/)** (App Router) + **React 19** + **TypeScript 5** (strict mode)
- **[Tailwind CSS v4](https://tailwindcss.com/)** — CSS-first `@theme` tokens, no `tailwind.config.js`
- **[Zustand 5](https://zustand.docs.pmnd.rs/)** — the window-manager state store
- **[motion](https://motion.dev/)** (`import ... from "motion/react"`) — the successor to Framer Motion, used for spring/ease-based animation
- **[@use-gesture/react](https://use-gesture.netlify.app/)** — pointer-drag/resize gesture handling
- **[Radix Primitives](https://www.radix-ui.com/primitives)** (`@radix-ui/react-*`) — unstyled, accessible behavior; every visual is our own (explicitly not shadcn/ui)
- **[@phosphor-icons/react](https://phosphoricons.com/)** — icons
- **[pnpm](https://pnpm.io/)** — package manager
- `clsx` + `tailwind-merge` (wrapped as `cn()`) — className composition
- `zod` — available for validating mock data shapes in later phases
- `prettier` + `prettier-plugin-tailwindcss` — formatting, including Tailwind class sorting

Fonts: **Figtree** (variable, sans, throughout) and **IBM Plex Mono** (reserved
for technical/file-path text), both loaded via `next/font/google`.

## Getting started

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). A blank desktop with the
original CSS wallpaper is the correct result — no windows are opened by
default in this pass.

## Running PMO Desk as a desktop app

PMO Desk includes an Electron launcher for a desktop-only installation. It starts
the local PMO Desk and Tasks engine services, opens a standalone application
window, and stops both owned services when the final PMO Desk window closes.

Create the Windows launcher:

```powershell
pnpm desktop:package
```

The command first builds the private Python the installer carries (`pnpm runtime:python`; it needs any
Python 3.9+ with pip on this machine and network access the first time, and reuses its download cache after).
See `scripts/build-python-runtime.py` for how it is pinned. The installer is built from the working tree, so the gitignored files the tasks need (`tasks/*/templates`, `tasks/*/config`, `tasks/shared/roster-reference`, `tasks/shared/roster/Names.xlsx`) must be present on the machine that builds it; a fresh clone does not have them. The installer is written to
`release/PMO Desk Setup 6.0.3.exe`. Run it
once to install PMO Desk under `%LOCALAPPDATA%\Programs\PMO Desk` (or select a
different folder in the installer). The installer wizard is branded to match the app (dark welcome and finish pages; the artwork is redrawn from `package.json`'s version by `pnpm installer:art` (part of `pnpm desktop:package`, needs Pillow, fonttools and brotli) into `build/installer/`). It creates Start-menu and
desktop shortcuts; pin either to the Windows taskbar. The installed app does
not need HTTPS, a browser tab, or a terminal.

### First run on a new computer

The installer carries the app, the Tasks engine, its task folders and a private Python, so Tasks work
straight away. The local AI is not in the installer: on first start the **Set up PMO Desk** screen checks
Ollama, the AI model (about 12 GB), classic Outlook (the four
mail tasks need it; report only) and the Tasks engine, and installs or downloads what is missing. It opens by
itself while something required is open and from the App Menu > _Settings_ > _Setup and health check_ at any time. Task
inputs, outputs, config and run history live in `%APPDATA%\ai-os\tasks-engine`, not in the install folder, so a
reinstall keeps them. How to test all of this on a clean machine: [`docs/clean-machine-test.md`](./docs/clean-machine-test.md).

### Getting fixes without reinstalling

An installed (packaged) build defaults to `bundled`, the production server
shipped with the app. A live mode that runs the UI from the project folder
(`C:\Projects\pmo-desk`, or `AI_OS_PROJECT_DIR`; it needs `package.json` and
`node_modules`) is opt-in. A run from source (`pnpm desktop`, i.e. `electron .`)
instead defaults to `live-dev` when the project folder is usable.

| Mode                                                                               | What runs                                                                                       | When to use                                                             |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `live-dev` (default for `pnpm desktop` from source; opt-in for an installed build) | `next dev` (Turbopack, as `pnpm dev`) from the project folder, on the first free port from 3100 | Development: edits to `src/**` hot-reload in the open window            |
| `live-build`                                                                       | `next start` from the project folder's own `.next`                                              | Run `pnpm build`, then View > Reload (or Developer > Restart UI server) |
| `bundled` (default for an installed build)                                         | `next start` from the copy installed with the app                                               | Normal installed use, and the fallback when a live mode is unusable     |

Choose the mode and folder with, in order of priority: the environment
variables `AI_OS_MODE` (`live-dev`, `live-build`, `bundled`) and
`AI_OS_PROJECT_DIR`; a `live-config.json` next to `PMO Desk.exe` or in the app's
`desktop` folder (`{ "projectDir": "C:\\Projects\\pmo-desk", "mode": "live-dev" }`, both keys
optional; see `desktop/launch-config.cjs`); then the default. The installer
removes `live-config.json` on every reinstall, so to keep an installed build in
a live mode set `AI_OS_MODE` (for example as a persistent user environment
variable); `live-config.json` only lasts until the next reinstall. If a live mode
cannot be used (folder missing, no `node_modules/next`, no build for
`live-build`) or the server does not answer within 90 seconds, PMO Desk logs the
reason in `%APPDATA%\ai-os\desktop.log` and starts the bundled app instead
(Help > About PMO Desk shows the reason). The window title shows the active mode,
for example `PMO Desk (live-dev: C:\Projects\pmo-desk)`.

The **Developer** menu has _Restart UI server_ (stops and respawns the server
and the Tasks engine it owns, then reloads; it warns first if a task is running),
_Open project folder_ and _Open logs folder_. If the UI server crashes, PMO Desk
offers to restart it. Do not run `pnpm dev` or `pnpm build` against the same
folder while a live mode is running (they share `.next`); live mode replaces
the dev server.

How updates reach the app now:

- **UI changes** (`src/**`): live-reload in `live-dev`; nothing to do.
- **Engine and task changes** (tasks-engine `main.py`, `tasks/**`
  scripts and manifests): App Menu > **Settings** > **Restart Tasks engine**. It checks
  for running tasks first and asks for confirmation if any are not idle. It only
  restarts an engine that this PMO Desk started; one started from a terminal is
  reported and left alone.
- **Reinstall** only when `desktop/` (the Electron shell) or the `build`
  config in `package.json` changes, or to refresh the bundled fallback.

For development without installing, `pnpm desktop` opens the Electron shell
from the project folder (same modes). The PWA manifest remains available for
browser-based use on `localhost`, but the Electron launcher is the supported
option when the application and Tasks engine must stop together on close.

Other scripts:

```bash
pnpm build          # production build
pnpm lint           # ESLint
pnpm typecheck      # tsc --noEmit
pnpm format         # Prettier — write
pnpm format:check   # Prettier — check only
pnpm test           # unit tests (node:test) for src/lib and desktop/
pnpm test:coverage  # the same, with a line/branch coverage report for src/lib and desktop/
pnpm test:engine    # Tasks engine tests (pytest, 80% coverage gate; see below)
pnpm check          # format:check + lint + typecheck + test, the same as CI's web job
```

## Development and CI

Needs Node 24 (`.nvmrc`), pnpm (version pinned in `package.json`) and Python 3.13 for the Tasks engine.
For the engine tests, create a virtual environment once so the task step subprocesses find their
packages (a bare system Python without them fails the end-to-end tests):

```powershell
python -m venv tasks-engine\.venv
tasks-engine\.venv\Scripts\python -m pip install -r tasks-engine\requirements-dev.txt -r tasks\requirements.txt
cd tasks-engine; .\.venv\Scripts\python -m pytest -q
```

GitHub Actions (`.github/workflows/ci.yml`) runs on every pull request and every push to `master`:
format check, lint, type-check, unit tests, a production build and `pnpm audit --prod` (web job), and the
engine's pytest suite with its coverage gate (engine job). Dependabot (`.github/dependabot.yml`) opens weekly
update pull requests for npm, pip and the workflow actions.

### Environment variables

All optional. The desktop shell sets most of them itself; set one only to override a default.

| Variable                                                                                                                                                                                             | Purpose                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AI_OS_MODE`, `AI_OS_PROJECT_DIR`                                                                                                                                                                    | Desktop run mode and project folder (see _Getting fixes without reinstalling_)                                                                         |
| `AI_OS_ENGINE_TOKEN`, `AI_OS_ENGINE_INSTANCE`                                                                                                                                                        | Per-launch Tasks engine token and instance id; generated, never set by hand                                                                            |
| `AI_OS_TASKS_ENGINE_URL`, `AI_OS_TASKS_PYTHON`, `AI_OS_SKIP_TASKS_ENGINE`                                                                                                                            | Where the engine is, which Python runs it, or not to start it                                                                                          |
| `AI_OS_TASKS_OFFICE`                                                                                                                                                                                 | `off` (also `0`, `false`, `no`, `disabled`) turns every Outlook/Excel step of a task into a logged no-op, for testers and dev machines; unset = normal |
| `AI_OS_TASKS_DIR`, `AI_OS_TASKS_DATA_DIR`, `AI_OS_TASKS_SRC`                                                                                                                                         | Task definitions folder, writable data folder, and the source the working copy follows                                                                 |
| `AI_OS_PMO_DATA_DIR`, `AI_OS_PMO_INBOX_DIR`, `AI_OS_PMO_SCAN_MS`                                                                                                                                     | PMO data folder, inbox folder, inbox scan interval                                                                                                     |
| `AI_OS_STAFF_EXCHANGE_DIR`, `AI_OS_PTO_INBOX_DIR`, `AI_OS_PTO_SCAN_MS`                                                                                                                               | Staff Management sync and PTO mail folders; how often they are read in the background (ms, `off` to stop)                                              |
| `AI_OS_AI_MODEL_FILE`, `AI_OS_AI_NUM_CTX`, `AI_OS_AI_KEEP_ALIVE`, `AI_OS_AI_TIMEOUT_MS`, `AI_OS_AI_MAX_OUTPUT_TOKENS`, `AI_OS_AI_AUTOSTART`, `AI_OS_AI_PREWARM`, `AI_OS_OLLAMA_EXE`, `OLLAMA_MODELS` | Local AI runtime (model, context size, timeouts, start-up behaviour)                                                                                   |
| `AI_OS_FORCE_FIRST_TIME`, `AI_OS_FOLDER_NAME`                                                                                                                                                        | Re-open the first-time setup; name of the OneDrive folder it creates                                                                                   |

ARCHITECTURE.md has the details of each area.

## Project layout

```
src/
  app/                    # Next.js App Router entry (layout, page, globals.css)
  styles/tokens.css        # Tailwind v4 @theme design tokens (source of truth)
  lib/                     # tokens.ts (JS mirror), motion.ts (spring/ease presets), cn.ts
  components/
    window-manager/        # WindowState, windowStore (Zustand), Window chrome, drag/resize hooks
    apps/                   # App registry (registerApp/getAppComponent) + registration barrel
    ui/                     # Restyled Radix primitives (Button, Dialog, DropdownMenu, ...)
    desktop/                # Desktop shell + original CSS wallpaper
```

See `ARCHITECTURE.md` for what each of these owns, the contracts other code
should go through, and how the next four workstreams (Desktop Shell & Chrome,
AI Agent Layer, App Store, Demo Apps) fit in.

## Tasks: Shift Roster and December Disconnect

Two deterministic (no LLM judgment) tasks live in `tasks/` and run from the Tasks app through the
Tasks engine: **Shift Roster** (builds the roster for one two-month cycle) and **December Disconnect**
(the winter holiday coverage: main plan and Analytics plan). Both write Excel drafts you review, then a confirmed
final; the master roster is never modified. Real data is gitignored (`input/`, `output/`, `config/`).

- First run (restart the Tasks engine, click path, what to check in Excel, bug reporting, rollback):
  [`tasks/FIRST-RUN-GUIDE.md`](./tasks/FIRST-RUN-GUIDE.md)
- What was decided, what is assumed, open items to confirm:
  [`tasks/DECISIONS-AND-ASSUMPTIONS.md`](./tasks/DECISIONS-AND-ASSUMPTIONS.md)
- Acceptance criteria against test evidence: [`tasks/ACCEPTANCE.md`](./tasks/ACCEPTANCE.md)
- Task docs: [`tasks/shift-roster/README.md`](./tasks/shift-roster/README.md),
  [`tasks/december-disconnect/README.md`](./tasks/december-disconnect/README.md)
- Task platform contract (manifest keys, endpoints, JSON files):
  [`tasks/TASK-PLATFORM-CONTRACT.md`](./tasks/TASK-PLATFORM-CONTRACT.md)
- Libraries: [`tasks/shared/roster_lib/README.md`](./tasks/shared/roster_lib/README.md),
  [`tasks/shared/winter_lib/README.md`](./tasks/shared/winter_lib/README.md)
