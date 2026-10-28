# AI OS

A local, desktop-style "AI Operating System": a virtual desktop in which a person and a
local AI can drive the same windows and apps, with handoff between them. It runs entirely
on the user's computer (loopback only; the AI is a local Ollama model, no cloud model).

## What it is today

- **Desktop shell**: wallpaper, a dock, a window manager (drag, resize, minimize, maximize,
  per-window human/AI control), light/dark and Deloitte themes, a tray icon, and a Settings
  menu (gear) with _Setup and health check_ and _Restart Tasks engine_.
- **Command bar with a local AI**: the AI can open, focus, minimize, maximize and close windows
  with a visible cursor and ownership handoff, and create, update and delete notes when Notes
  is focused. It uses Ollama on `127.0.0.1`.
- **PMO To-Do**: turns messages dropped in a PMO inbox folder (Power Automate, an Outlook
  export script, or the Paste button) into reviewed to-dos with reminders, chasers, sign-off
  tracking and a weekly report. Nothing becomes a to-do without a human approving it.
- **Tasks engine** (`tasks-engine/`, Python/FastAPI) and the **Tasks app**: runs the task
  folders under `tasks/` (Shift Roster, December Disconnect, the weekly and monthly reports,
  the deployment mailer) through prepare, review, approve and send gates.
- **Staff Management** (`src/lib/staff/`, `src/components/apps/staff-app/`): the roster of
  people. A Directory (the main columns in a list, everything else in a right-hand detail pane),
  a Shift roster (teams from the directory, each with its own shift schedule, in Today, Week,
  Month and two-month Cycle views, with holidays by location and approved time off; it can be
  imported from the team's roster workbook), a Time-off tracker and an Offboarded list (people removed from the
  roster, kept on file and editable, restorable or deletable). It is meant to be the one list of people that
  the other apps read instead of an uploaded Excel file.
- **First-run Setup screen**: checks and installs what a new computer lacks (Ollama, the AI
  model, the PMO inbox folder, classic Outlook, the Tasks engine).
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
  `X-AI-OS-Token` (only `GET /health` is open). The Tasks app fetches the token from this
  app's own `/api/tasks-engine/token` route, which only answers its own origin. The desktop
  app adopts only an engine whose `/health` reports its instance id.
- **Content-Security-Policy and headers** (`next.config.mjs`): `frame-ancestors 'none'`,
  `X-Frame-Options: DENY`, `nosniff`, a restrictive `connect-src` (this app and loopback).
  The Browser app deliberately allows framing arbitrary sites; its embeddability check refuses
  private, loopback and link-local targets.
- **Child processes** never inherit `NODE_TLS_REJECT_UNAUTHORIZED` or `PYTHON*` settings.
- **Review gates**: the mail-sending tasks never send without an explicit approval, and the
  PMO inbox never creates a to-do on its own.
- Dependencies are audited with `pnpm audit --prod`.

## Where data lives

Everything the installed app writes is under `%APPDATA%\ai-os` (Electron's user-data folder),
never in the install folder, so a reinstall keeps it: `tasks-engine\` (task inputs, outputs,
config, run history), `pmo\` (the PMO data folder: to-dos, queue, audit log, reports),
`pmo\staff\` (the Staff Management roster, shifts, time off and profile pictures),
`desktop.log`, and the app's settings files. The first-run Setup screen and `docs/clean-machine-test.md`
describe how to test this on a new computer.

## Installing (unsigned build)

The installer (`AI OS Setup x.y.z.exe`) and `AI OS.exe` are **not code-signed**. Windows
SmartScreen will warn on the first run: choose **More info > Run anyway**. On a managed
computer where Smart App Control, AppLocker or Windows Defender Application Control blocks
it, ask IT to allow the installer / the folder `%LOCALAPPDATA%\Programs\AI OS`.

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

## Running AI OS as a desktop app

AI OS includes an Electron launcher for a desktop-only installation. It starts
the local AI OS and Tasks engine services, opens a standalone application
window, and stops both owned services when the final AI OS window closes.

Create the Windows launcher:

```powershell
pnpm desktop:package
```

The command first builds the private Python the installer carries (`pnpm runtime:python`; it needs any
Python 3.9+ with pip on this machine and network access the first time, and reuses its download cache after).
See `scripts/build-python-runtime.py` for how it is pinned. The installer is built from the working tree, so the gitignored files the tasks need (`tasks/*/templates`, `tasks/*/config`, `tasks/shared/roster-reference`, `tasks/shared/roster/Names.xlsx`) must be present on the machine that builds it; a fresh clone does not have them. The Version 2 installer is written to
`release/AI OS Setup 3.0.0.exe`. Run it
once to install AI OS under `%LOCALAPPDATA%\Programs\AI OS` (or select a
different folder in the installer). The installer creates Start-menu and
desktop shortcuts; pin either to the Windows taskbar. The installed app does
not need HTTPS, a browser tab, or a terminal.

### First run on a new computer

The installer carries the app, the Tasks engine, its task folders and a private Python, so Tasks work
straight away. The local AI is not in the installer: on first start the **Set up AI OS** screen checks
Ollama, the AI model (about 12 GB), the PMO inbox folder (is OneDrive signed in?), classic Outlook (the four
mail tasks need it; report only) and the Tasks engine, and installs or downloads what is missing. It opens by
itself while something required is open and from the gear menu > _Setup and health check_ at any time. Task
inputs, outputs, config and run history live in `%APPDATA%\ai-os\tasks-engine`, not in the install folder, so a
reinstall keeps them. How to test all of this on a clean machine: [`docs/clean-machine-test.md`](./docs/clean-machine-test.md).

### Getting fixes without reinstalling

An installed (packaged) build defaults to `bundled`, the production server
shipped with the app. A live mode that runs the UI from the project folder
(`C:\Projects\AI OS`, or `AI_OS_PROJECT_DIR`; it needs `package.json` and
`node_modules`) is opt-in. A run from source (`pnpm desktop`, i.e. `electron .`)
instead defaults to `live-dev` when the project folder is usable.

| Mode                                                                               | What runs                                                                                       | When to use                                                             |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `live-dev` (default for `pnpm desktop` from source; opt-in for an installed build) | `next dev` (Turbopack, as `pnpm dev`) from the project folder, on the first free port from 3100 | Development: edits to `src/**` hot-reload in the open window            |
| `live-build`                                                                       | `next start` from the project folder's own `.next`                                              | Run `pnpm build`, then View > Reload (or Developer > Restart UI server) |
| `bundled` (default for an installed build)                                         | `next start` from the copy installed with the app                                               | Normal installed use, and the fallback when a live mode is unusable     |

Choose the mode and folder with, in order of priority: the environment
variables `AI_OS_MODE` (`live-dev`, `live-build`, `bundled`) and
`AI_OS_PROJECT_DIR`; a `live-config.json` next to `AI OS.exe` or in the app's
`desktop` folder (`{ "projectDir": "C:\\Projects\\AI OS", "mode": "live-dev" }`, both keys
optional; see `desktop/launch-config.cjs`); then the default. The installer
removes `live-config.json` on every reinstall, so to keep an installed build in
a live mode set `AI_OS_MODE` (for example as a persistent user environment
variable); `live-config.json` only lasts until the next reinstall. If a live mode
cannot be used (folder missing, no `node_modules/next`, no build for
`live-build`) or the server does not answer within 90 seconds, AI OS logs the
reason in `%APPDATA%\ai-os\desktop.log` and starts the bundled app instead
(Help > About AI OS shows the reason). The window title shows the active mode,
for example `AI OS (live-dev: C:\Projects\AI OS)`.

The **Developer** menu has _Restart UI server_ (stops and respawns the server
and the Tasks engine it owns, then reloads; it warns first if a task is running),
_Open project folder_ and _Open logs folder_. If the UI server crashes, AI OS
offers to restart it. Do not run `pnpm dev` or `pnpm build` against the same
folder while a live mode is running (they share `.next`); live mode replaces
the dev server.

How updates reach the app now:

- **UI changes** (`src/**`): live-reload in `live-dev`; nothing to do.
- **Engine and task changes** (tasks-engine `main.py`, `tasks/**`
  scripts and manifests): gear menu (top right) > **Restart Tasks engine**. It checks
  for running tasks first and asks for confirmation if any are not idle. It only
  restarts an engine that this AI OS started; one started from a terminal is
  reported and left alone.
- **Reinstall** only when `desktop/` (the Electron shell) or the `build`
  config in `package.json` changes, or to refresh the bundled fallback.

For development without installing, `pnpm desktop` opens the Electron shell
from the project folder (same modes). The PWA manifest remains available for
browser-based use on `localhost`, but the Electron launcher is the supported
option when the application and Tasks engine must stop together on close.

Other scripts:

```bash
pnpm build         # production build
pnpm lint          # ESLint
pnpm typecheck     # tsc --noEmit
pnpm format        # Prettier — write
pnpm format:check  # Prettier — check only
```

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
