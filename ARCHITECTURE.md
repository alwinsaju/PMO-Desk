# Architecture

This document is for the next engineer or agent working on this repo — it
explains the module boundaries this foundation pass established, the public
contracts other code should go through, and where the four workstreams
built on top of it ended up living. If you're working on the dock, the
command bar, the app store, or a demo app, start here.

## What "foundation layer" means here

This pass built: design tokens, the window manager (state + chrome +
drag/resize), the app registry contract, a full Radix-based UI primitives
kit, and an empty desktop shell (wallpaper + window layer, nothing else). It
deliberately did **not** include the dock, the command bar, presence
avatars, any demo app, or the app store — those were four separate,
parallel workstreams, all now complete; see "V1 status" at the bottom of
this file for where each one landed.

## File/module boundaries

```
src/
  app/
    layout.tsx          Fonts (next/font/google) as CSS variables on <html>,
                         metadata, and global providers (currently just
                         Radix's TooltipProvider — add more here, e.g. a
                         toast/notification root, if a later phase needs one).
    page.tsx             Renders <Desktop /> and nothing else.
    globals.css          @import "tailwindcss", then @import "../styles/tokens.css".
                         Also owns the two keyframes (`overlay-in`/`overlay-out`)
                         the UI kit's overlay primitives animate with, and the
                         couple of true global resets (html/body height 100%,
                         overflow hidden — there is no document-level scroll,
                         only per-window scroll areas).

  styles/tokens.css      Tailwind v4 @theme block. THE source of truth for
                         color/radius/shadow/spacing/ease tokens. Read the
                         comments at the top of the file before adding to it.

  lib/
    tokens.ts             JS-readable mirror of tokens.css, for code that
                          needs a raw value outside a className (animation
                          math, canvas/DOM measurement). Hand-kept in sync
                          with tokens.css — not generated.
    motion.ts              Named spring/ease presets for the `motion` package,
                          plus the `overlayEnter`/`overlayExit` className
                          fragments the UI kit's overlay primitives use.
    cn.ts                   clsx + tailwind-merge, extended with this
                          project's custom theme keys (see the comment in the
                          file — without the extension, className overrides
                          like `<Button className="rounded-lg">` would not
                          correctly replace the base `rounded-pill`).

  components/
    window-manager/       See "The window manager" below.
    apps/                 See "The app registry" below.
    ui/                   Restyled Radix primitives. Import from
                          `@/components/ui` (barrel). Every primitive forwards
                          `ref` and merges an incoming `className` via `cn()`.
    desktop/               Desktop.tsx (the screen) + Wallpaper.tsx (the
                          original CSS gradient background). Desktop.tsx is a
                          Server Component on purpose — see the gotcha below
                          before adding a side-effect import to it.
```

## The window manager (`src/components/window-manager/`)

**State** lives in `windowStore.ts`, a Zustand store keyed by window id
(`Record<string, WindowState>`), plus a monotonic `nextZIndex` counter. Full
`WindowState` shape is in `types.ts` — notably `controlledBy: "human" | "ai"`,
the core product differentiator (a window can be driven by either, and
control can be reassigned after the window is already open).

Public actions (call these — don't reach into `windows` and mutate it):

```
openWindow(appId, options?) -> id     minimizeWindow(id)
closeWindow(id)                        restoreWindow(id)
focusWindow(id)                        maximizeWindow(id)   // toggles; restores prior bounds on toggle-off
moveWindow(id, position)               setWindowControlledBy(id, controlledBy, aiTaskId?)
resizeWindow(id, size)                 // clamps to minSize
```

Defaults: 900×600 open size, 360×240 minimum, +32px cascade offset per newly
opened window (wraps after 10 so a long session doesn't walk new windows off
the edge of the screen). All of these numbers live in `src/lib/tokens.ts`'s
`windowDefaults`, not hardcoded in the store.

**Selectors**: prefer `useWindowStore((s) => s.windows[id])` (a per-window
selector) over subscribing to the whole store. The store's internal actions
are written to only create a new object reference for a `WindowState` that
actually changed — e.g. focusing one window does NOT create new references
for every other window — so a component using a per-id selector genuinely
only re-renders when its own window changes. `useVisibleWindowIds()` /
`useAllWindowIds()` are the pre-built list selectors (id arrays, safe with
`useShallow` because array elements are string primitives).

**Chrome**: `Window.tsx` owns one window's chrome + resolves its app content
via the registry; `WindowTitleBar.tsx` + `WindowControls.tsx` render the
title bar (drag handle, understated minimize/maximize, always-visible
close); `ResizeHandles.tsx` renders the 8 edge/corner handles as **siblings**
of the clipped/rounded chrome (not children of it — an `overflow-hidden`
ancestor would clip a handle that straddles the visual edge).

**Drag/resize performance pattern**: `useWindowDrag.ts` / `useWindowResize.ts`
mutate the window's DOM node (`ref.current.style.transform`/`width`/`height`)
directly on every pointer-move frame and touch neither React state nor the
Zustand store until pointer-up, when they commit once
(`moveWindow`/`resizeWindow`). Window.tsx's DOM is split into an OUTER plain
div (position/size authority, what the gesture hooks mutate) and an INNER
`motion.div` (owns only the open/close pop animation) specifically so the
gesture hooks' direct style mutation never fights `motion`'s own animation
engine — they're on different nodes.

**Close/minimize are animation-gated**: clicking close/minimize doesn't call
the store action immediately. `Window.tsx` snapshots the window's data,
flips a local `exitIntent` flag (which drives the `motion.div`'s `animate`
target to the closed/minimized visual state), and only calls the real
`closeWindow`/`minimizeWindow` store action from `onAnimationComplete`. This
is what lets the window visually animate out before it's actually removed
from the store (removing it first would make `Window.tsx` render from data
that no longer exists mid-animation). `maximizeWindow` doesn't need this —
it doesn't remove the window from the visible-ids list, so there's nothing to
keep alive.

**Maximize/restore is a different kind of animation-gated.** OUTER (the
plain, ref-mutated div drag/resize depend on) is deliberately never a
`motion.div`, so maximize/restore's spring can't be a reactive `animate`
prop the way open/close/minimize's is; `Window.tsx`'s `handleMaximizeToggle`
instead calls `motion`'s imperative `animate()` directly on OUTER's DOM
node, the same "mutate the ref" category as the gesture hooks, just spring-
rather than pointer-driven. The store commit (`maximizeWindow(id)`) happens
immediately, for instant control-icon feedback either direction, while a
local `transitionRect` (the current rect, frozen for the animation's
duration, set via `flushSync` before `animate()` starts) takes over
rendering OUTER's transform/width/height so React's own re-renders never
have a different value to apply there and stomp on `animate()`'s
in-progress ones. It clears on `animate()`'s `onComplete`, handing
rendering back to the plain store-driven styles, which by then exactly
match where the spring landed.

## The app registry (`src/components/apps/`)

The contract: `registerApp(appId, Component)` / `getAppComponent(appId)`
(`registry.ts`), backed by a plain `Map`. `AppComponent` is
`ComponentType<{ windowId: string }>` (`types.ts`) — an app receives only its
own window id and reads everything else (its title, focus state, etc.) from
`useWindowStore` selectors keyed on that id.

Every app package registers itself as a side effect of importing its own
module, then adds **one import line** to `src/components/apps/index.ts`:

```ts
// src/components/apps/index.ts
import "./notes-app";
```

```ts
// src/components/apps/notes-app/index.tsx (or wherever)
import { registerApp } from "../registry";
registerApp("notes", NotesApp);
```

### Gotcha: where the registry's side-effect import lives matters

`src/components/apps/index.ts` is imported for its side effects from
**`WindowManager.tsx`**, not from `Desktop.tsx`. This is deliberate, and
getting it wrong produces a bug that is genuinely confusing to debug: every
window just renders "No app is registered for X" with no error anywhere.

Here's why: `Desktop.tsx` is a Server Component. A **bare side-effect
import** (`import "./something";`, no bindings used) that only reaches the
client bundle _transitively through a Server Component_ can get dropped by
Next.js's client bundler — nothing in the actual render tree references an
export from that module, so from the bundler's perspective there's no proof
anything needs it in the browser, even though the module's top-level
`registerApp(...)` call is exactly the thing you need to run there. This was
caught during this pass's manual verification (a temporary test app
registered via `apps/index.ts` silently failed to appear — 200 OK on every
request, zero console errors, just an empty registry — until the import was
moved into `WindowManager.tsx`, which is unambiguously a Client Component
that always renders).

The rule going forward: **the side-effect import must live in a module that
is itself a Client Component and is guaranteed to render** — not merely be
importable from one. If you ever add a second registry-like pattern (e.g.
the AI layer's future annotation/cursor scripts), give it the same shape:
one small "barrel" file of commented-out import lines, imported for its side
effects from a real, always-rendering Client Component, not from a Server
Component.

## Another gotcha worth knowing: theme CSS variables that reference next/font variables

`tokens.css`'s `--font-sans` resolves `var(--font-figtree)`. The
`figtree.variable`/`ibmPlexMono.variable` classes from `next/font/google` are
applied to `<html>` in `layout.tsx` — **not** `<body>`. This matters more
than it looks: a CSS custom property's value is resolved against its own
element's available properties, and that _resolved_ value (not the original
unresolved reference) is what inherits to descendants. If the font variable
classes were on `<body>` instead, `--font-sans` (declared on `:root`, i.e.
`<html>`) would fail to resolve `--font-figtree` right there at `:root`
(computed to the CSS-wide "guaranteed-invalid" value, since `--font-figtree`
doesn't exist at that element), and _that_ invalid value is what would
inherit down — `--font-figtree` existing on some descendant wouldn't help,
because by the time inheritance reaches it the value's already broken. This
was also caught during manual verification (the whole app was silently
rendering in the browser's default system-font stack). If a later phase adds
another font or a theme variable that references a next/font variable, keep
the variable class on `<html>`.

## A third gotcha worth knowing: Server Components and client-only icon/library imports

`src/components/taskbar/pinnedApps.ts` is a plain data file — no component,
no hook of its own — but it still carries a `"use client"` directive at the
top, because it imports live Phosphor icon **component values**
(`FolderIcon`, `NotePencilIcon`, etc. — not just the `Icon` type) into its
`pinnedAppIcons` lookup map. Without that directive, `pnpm dev`,
`pnpm typecheck`, and `pnpm lint` all stay completely silent, but `pnpm
build` fails at "Collecting page data" with `(0 , d.createContext) is not a
function` and no stack frame pointing at any of this project's own code.

Why: `Desktop.tsx` (a Server Component) reaches `pinnedApps.ts` by importing
`Dock` from `src/components/taskbar/index.ts`'s barrel, and that same
barrel also re-exports `pinnedApps`/`pinnedAppIcons` directly
(`export { pinnedApps, pinnedAppIcons } from "./pinnedApps"`). The barrel
file itself has no `"use client"` of its own, so by default it (and
anything it re-exports that also lacks the directive) is compiled as more
server code. Phosphor's icon components call React's `createContext`
internally (for their shared `IconContext`) — fine on the client, but there
is no client React runtime to call into during server/RSC compilation, so
evaluating that module server-side crashes outright. This is the same
"Server Component boundary" family of bug as the app-registry gotcha above,
but the failure mode is a hard build-time crash rather than a silently
empty registry — and it's triggered by importing a live value from _any_
client-oriented library at module scope (icon sets here, but the same
applies to anything else that assumes a browser/client React runtime), not
just icons specifically.

The rule going forward, applied throughout this pass's `ai-layer/*` (the
Phosphor-icon-heavy status badges, the AI cursor, the presence avatars, and
the one Zustand store, `agentStore.ts`): **a file needs its own `"use
client"` the moment it renders JSX, uses a hook, or imports a live
icon/component value — even if, today, it also happens to only ever be
reached through a path that already crossed a client boundary earlier.**
Don't rely on "something upstream already has the directive" — new
barrels/imports get added later and that guarantee is easy to break by
accident. The only files that should stay directive-free are genuinely
framework-agnostic data/logic with no live client-library imports of their
own (plain types, constants, or a store like `agentStore.ts`/`windowStore.ts`
that only imports `zustand` + local types).

## The UI primitives kit (`src/components/ui/`)

Thin, fully-restyled wrappers around Radix Primitives — Radix's unstyled
behavior, 100% our own visual layer from `tokens.css`. Explicitly **not**
shadcn/ui (shadcn's default look is exactly the generic "AI SaaS" aesthetic
this product is avoiding). Import from the barrel: `@/components/ui`.

Every primitive: forwards `ref`, accepts and merges an incoming `className`
via `cn()` (so consumers can always override), and uses the token system
(`rounded-window`/`rounded-pill`/`rounded-control`, `shadow-float*`,
`bg-accent`/`text-ink`/etc., `ease-standard`/`ease-entrance`/`ease-exit`) —
never a raw hex or an arbitrary shadow value. Overlay-based primitives
(Tooltip, Popover, DropdownMenu, ContextMenu, Dialog) all share the same
open/close treatment via `overlayEnter`/`overlayExit` from `src/lib/motion.ts`.

`Avatar` has a `presence?: "none" | "active" | "idle"` prop that draws the
accent ring reserved for presence indicators — built now, intended for the
AI Agent Layer's corner presence avatars later.

## The ONE accent color

The design spec is explicit that there is exactly one accent color (a deep
teal), reserved for AI/interactive moments — not decorative use. In this
pass it shows up in: focus rings across the whole UI kit, `Button`/`IconButton`'s
`solid` variant, `Switch`/`Slider`'s checked/filled state, and an animated
glow (`AIGlowBorder.tsx`) Window.tsx draws around a window when
`controlledBy === "ai"` (not explicitly listed in the original spec's
examples, but squarely in the same category — it's arguably the single most
important "this is AI-driven" signal in the whole product). It started as a
static single-hue ring, then became a breathing/traveling glow (still
single-hue), and — by explicit design direction, after feedback that the
single-hue version read as flat and needed to match Apple's own Siri/Apple
Intelligence glow — is now a full-spectrum "Siri / Apple Intelligence"-style
treatment: blue through violet, magenta, crimson, orange, and gold,
continuously rotating around the window's border plus a separate breathing
intensity pulse (see globals.css's `.ai-glow-halo`/`.ai-glow-sweep` comment
for the exact mechanism and color-stop rationale). This is a deliberate,
one-off exception scoped to that single effect, not a precedent — don't add
a second accent color anywhere else, and don't reach for `bg-accent` just
because something needs visual emphasis — that's what the neutral scale's
contrast is for.

## Z-index layers

Three layers, as plain CSS custom properties in `tokens.css` (`--z-window-base`,
`--z-chrome`, `--z-overlay` — see that file for why these are plain `:root`
variables rather than a Tailwind `@theme` namespace) and mirrored as numbers
in `tokens.ts`'s `zIndex`:

- **desktop** (0) — the wallpaper.
- **window-base** (100+) — `WindowManager`'s wrapper establishes its own
  stacking context at this layer, so every individual window's dynamic
  zIndex (100, 101, 102, ...) is only ever compared against _other windows_.
  No amount of focusing in a long session can make a window outrank the
  layers below.
- **chrome** (2000) — reserved for the dock, command bar, and presence
  avatars. Use it via `z-[var(--z-chrome)]`.
- **overlay** (3000) — anything portaled: dialogs, popovers, menus, tooltips.
  Already wired into every overlay-based UI kit primitive.

## V1 status: the shell is feature-complete

Earlier revisions of this doc described four parallel workstreams still
to be built. All four have since landed, and nothing is currently
outstanding — the section below is now a map of where each one lives and
what it consumes, kept for the next engineer or agent orienting
themselves, not a task list.

1. **Desktop Shell & Chrome** (`src/components/desktop/*`,
   `src/components/taskbar/*`) — the top floating dock (`Dock.tsx` and
   `DockTile.tsx`, driven by the shared `{ id, title, icon }` contract in
   `taskbar/pinnedApps.ts`) and a right-click context menu on the desktop
   background (`DesktopContextMenu.tsx`), plus a top-right settings gear
   (`SettingsMenu.tsx` — the single home of the dark-mode switch; add new
   settings as rows in its `settingsRows` list), mounted as siblings of
   `<WindowManager />` in `Desktop.tsx` at the `z-chrome` layer. There is no
   desktop icon grid — the dock is the only app launcher; an earlier V1 had
   a `DesktopIcons.tsx` mirroring the dock's 4 pinned apps, since removed.

2. **AI Agent Layer** (`src/components/ai-layer/*`) — the bottom command
   bar (`CommandBar.tsx`), the AI cursor overlay (`AICursor.tsx`, riding
   `springTrailing` from `src/lib/motion.ts`), an inline annotation bubble
   (`AIAnnotationBubble.tsx`), the corner presence avatars
   (`PresenceAvatars.tsx`, using the UI kit's `<Avatar presence="active">`),
   and a collapsible task history panel (`TaskList.tsx`/`TaskListItem.tsx`).
   Drives `windowStore`'s `setWindowControlledBy` to hand a window between
   human and AI control, plus its own single Zustand store (`agentStore.ts`)
   for task/cursor/annotation state.

3. **App Store** (`src/components/app-store/*`) — `AppStoreApp`, registered
   under `"app-store"`: a mocked, browsable catalog (search + category
   tabs; no per-app detail view — cards show just a name/icon and an
   Install/Open control). Install state lives in `installedAppsStore.ts`,
   a small `persist`-backed Zustand store shaped like `windowStore.ts`/
   `agentStore.ts`, shared across every open App Store window and
   surviving reloads. It's the intended cross-directory contract for
   anything else that needs to know which catalog entries are installed —
   `useInstalledAppsStore` for reactive reads, plus plain
   `isAppInstalled`/`installApp`/`uninstallApp` helpers — e.g. a future App
   Menu listing installed apps. No real backend.

4. **Demo Apps bundle**
   (`src/components/apps/{files-app,notes-app,browser-app}/*`) — a file
   browser (breadcrumb navigation over a static mock tree, file names/paths
   in `font-mono`), a notes editor (sidebar list and a `<textarea>` pane,
   local create/select/edit/delete), and a fake browser-in-a-window (mocked
   address-bar chrome around 3 static internal page templates, with
   in-page links wired to the same navigation as the chrome). Each
   registers under its own id (`"files"` / `"notes"` / `"browser"`) via the
   same one-line-in-`apps/index.ts` pattern as the App Store.

All four consume only the public contracts documented earlier in this
file (`windowStore`'s actions, `registerApp`/`getAppComponent`, the UI
kit) — none of them needed to touch `windowStore.ts`, `Window.tsx`, the
gesture hooks, or each other's directories. That constraint doesn't
disappear now that everything's merged: a future change to any of those
shared foundation pieces still affects every app package built on top of
it, so treat it as worth discussing rather than changing silently.

The next planned step for this repo is a final visual QA pass across
everything above, not new feature work.

## Agent apps: Shift Roster and December Disconnect (outside the desktop shell)

`agent-apps/` is not part of the Next.js app. It holds task folders (`agent.json` manifest, `scripts/`, tests)
and shared Python libraries (`shared/roster_lib`, `shared/winter_lib`). The Tasks app
(`src/components/apps/tasks-app/`) is a client of the separate agent-office FastAPI backend
(`C:\Projects\Agents-workspace\agent-office`, port 8000), which discovers the task folders, runs each step as a
subprocess and serves the platform endpoints (uploads, prepare, options, params, questions form, diff, flags,
approver stamp). The next dev server starts that backend through `src/app/api/agent-office/start/route.ts`. The
shapes the three parts share (manifest keys, endpoints, JSON files) are fixed in
[`agent-apps/TASK-PLATFORM-CONTRACT.md`](./agent-apps/TASK-PLATFORM-CONTRACT.md). Task decisions and assumptions:
[`agent-apps/DECISIONS-AND-ASSUMPTIONS.md`](./agent-apps/DECISIONS-AND-ASSUMPTIONS.md); how to run them the first
time: [`agent-apps/FIRST-RUN-GUIDE.md`](./agent-apps/FIRST-RUN-GUIDE.md).
