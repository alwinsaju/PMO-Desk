# AI OS

## Current behavior

The desktop includes a dock, demo apps, and an AI command bar. The AI can take
over desktop window operations (open, focus, minimize, maximize, and close)
with a visible cursor and ownership handoff. When Notes is focused, it can also
create, update, and delete notes.

## Historical foundation scope

A browser-based "AI Operating System" — a virtual desktop where a human and an AI
agent can both drive the same windows and apps, with seamless handoff between them.

This repository currently contains the **foundation layer** only: the design
token system, the window manager, a Radix-based UI primitives kit, and an
empty desktop shell. No dock, command bar, presence avatars, demo apps, or app
store yet — see [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the module
boundaries, public contracts, and the four parallel workstreams that build on
top of this.

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
the local AI OS and Agent Office services, opens a standalone application
window, and stops both owned services when the final AI OS window closes.

Create the Windows launcher:

```powershell
pnpm desktop:package
```

The Version 1 installer is written to `release/AI OS Setup 1.0.0.exe`. Run it
once to install AI OS under `%LOCALAPPDATA%\Programs\AI OS` (or select a
different folder in the installer). The installer creates Start-menu and
desktop shortcuts; pin either to the Windows taskbar. The installed app does
not need HTTPS, a browser tab, or a terminal.

For development, `pnpm desktop` opens the Electron shell against a local
production build. Run `pnpm build` first after source changes. The PWA manifest
remains available for browser-based use on `localhost`, but the Electron
launcher is the supported option when the application and Agent Office backend
must stop together on close.

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

## Agent apps: Shift Roster and December Disconnect

Two deterministic (no LLM judgment) tasks live in `agent-apps/` and run from the Tasks app through the
agent-office backend: **Shift Roster** (builds the roster for one two-month cycle) and **December Disconnect**
(the winter holiday coverage: main plan and Analytics plan). Both write Excel drafts you review, then a confirmed
final; the master roster is never modified. Real data is gitignored (`input/`, `output/`, `config/`).

- First run (restart the backend, click path, what to check in Excel, bug reporting, rollback):
  [`agent-apps/FIRST-RUN-GUIDE.md`](./agent-apps/FIRST-RUN-GUIDE.md)
- What was decided, what is assumed, open items to confirm:
  [`agent-apps/DECISIONS-AND-ASSUMPTIONS.md`](./agent-apps/DECISIONS-AND-ASSUMPTIONS.md)
- Acceptance criteria against test evidence: [`agent-apps/ACCEPTANCE.md`](./agent-apps/ACCEPTANCE.md)
- Task docs: [`agent-apps/shift-roster/README.md`](./agent-apps/shift-roster/README.md),
  [`agent-apps/december-disconnect/README.md`](./agent-apps/december-disconnect/README.md)
- Task platform contract (manifest keys, endpoints, JSON files):
  [`agent-apps/TASK-PLATFORM-CONTRACT.md`](./agent-apps/TASK-PLATFORM-CONTRACT.md)
- Libraries: [`agent-apps/shared/roster_lib/README.md`](./agent-apps/shared/roster_lib/README.md),
  [`agent-apps/shared/winter_lib/README.md`](./agent-apps/shared/winter_lib/README.md)
