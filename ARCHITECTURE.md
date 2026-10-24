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

Defaults: ONE 1120×680 open size for every app (shrunk to fit a small viewport),
360×240 minimum, and a ~24px cascade per newly opened window (centered as a
group, wraps after 8 so a long session doesn't walk new windows off the edge of
the screen). The numbers live in `src/lib/tokens.ts`'s `windowDefaults`; the
placement maths is the pure `window-manager/windowGeometry.ts` (unit-tested).

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

(The accent is now per-mode — deep teal by default, Deloitte green/neon in
Deloitte mode — and `text-accent-ink` is the text/icon form of it; see
"Design system / theming" below. The one-accent rule itself is unchanged.)

The design spec is explicit that there is exactly one accent color (a deep
teal), reserved for AI/interactive moments — not decorative use. In this
pass it shows up in: focus rings across the whole UI kit, `Button`/`IconButton`'s
`solid` variant, `Switch`/`Slider`'s checked/filled state, and an animated
ring (`AIGlowBorder.tsx`; since the redesign the design system's `ai-ring` conic border, the older `.ai-glow-*` globals.css classes are unused) Window.tsx draws around a window when
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

## Design system / theming

The look is a frosted-glass redesign with two independent switches on
`<html>`. Components never branch on either in JS: they read tokens, and
`src/styles/tokens.css` re-defines the tokens per combination.

| Attribute    | Values              | Persisted in  | Helpers                          |
| ------------ | ------------------- | ------------- | -------------------------------- |
| `data-theme` | `dark` / absent     | `ai-os:theme` | `src/lib/theme.ts`, `useTheme()` |
| `data-brand` | `deloitte` / absent | `ai-os:brand` | `src/lib/theme.ts`, `useBrand()` |

`getThemeInitScript()` (a `beforeInteractive` script in `layout.tsx`) sets
both attributes before hydration, so there is no flash. The single source of
truth is the attribute; the hooks are `useSyncExternalStore` over it. The
toggles live in the Settings popover (`SettingsMenu.tsx`: "Dark mode" and
"Deloitte mode"). Cascade order in tokens.css (later wins): default light,
`[data-theme=dark]`, `[data-brand=deloitte]` (shared: radii, font, ring),
`[data-brand=deloitte]:not([data-theme=dark])`,
`[data-brand=deloitte][data-theme=dark]`.

**Deloitte mode** uses only the brand palette (Green #86BC25, Neon #86EB22,
Blue #00A3E0, Light Blue #A0DCFF, Dark Blue #005587, Dark Gray #282728, Gray
#E6E6E6, Bright Lime #B7E320, Green #63C631, Sky #3FC3EC, Black) plus the
supplemental status amber/red. Light = white / #F5F5F5 surfaces, #282728 text,
green fills with BLACK text; dark = #282728 / #333 surfaces, #E6E6E6 text and
NEON (never plain #86BC25) as the accent. Open Sans (`--font-open-sans`,
loaded in `layout.tsx`), light-weight headlines, squarer radii, a 4px
green/neon/sky bar on every window, a grey/near-black wallpaper with drifting
glows and concentric ring outlines. No logo or tagline lockup.

### Token cheat-sheet (Tailwind utilities derive from these)

- **Text**: `text-ink` (primary), `text-ink-soft` (body-secondary),
  `text-ink-muted` (labels), `text-ink-faint` (placeholder/disabled),
  `text-ink-inverse` (on `bg-ink`).
- **Accent**: `bg-accent text-accent-contrast` for a solid fill (contrast is
  black in Deloitte mode); `hover:bg-accent-hover`; `bg-accent-soft` tint;
  `bg-accent-2` gradient end. **`text-accent-ink`** is the accent used AS text
  or icon color (teal by default, #282728 in Deloitte-light, neon in
  Deloitte-dark). Never use `text-accent` for text: green on white fails
  contrast. `ring-focus` / `border-focus` is the keyboard-focus color (Dark Blue
  in Deloitte-light, otherwise the accent).
- **Fills**: `bg-glass` / `bg-win` / `bg-pop` (translucent surfaces), `bg-card`,
  `bg-field` (inputs, active tab plate), `bg-chip` (resting small controls) and
  `bg-chip-strong` (their hover), `border-line` / `border-line-strong`,
  `border-glass-edge`, `bg-scrim`. `bg-surface-elevated` and `neutral-*` still
  work as solid fallbacks and flip with the theme.
- **Status**: `text-amber bg-amber-soft`, `text-red bg-red-soft`,
  `text-success bg-success-soft` (`bg-success-dot` for bare dots),
  `text-info bg-info-soft`.
- **Radius tiers**: `rounded-surface` (windows, dialogs, popovers: 24px),
  `rounded-card` (cards and rows: 18px), `rounded-control` (inputs, icon
  buttons, menu rows: 12px), `rounded-chip` (buttons, badges, tags: pill),
  plus `rounded-tile` (icon tiles), `rounded-bar` (search/command bars),
  `rounded-orb` (round icon buttons), `rounded-seg` / `rounded-seg-item`
  (segmented tabs). `rounded-pill` is always a full pill. Deloitte mode squares
  every tier (14 / 10 / 8 / 6) and also the legacy `rounded-xl` scale.
- **Height / spacing**: `h-control` (36px), `h-titlebar` (54px), `h-dock`
  (60px), `p-gutter` (24px).
- **Shadows**: `shadow-glass`, `shadow-pop`, `shadow-modal`, `shadow-window`,
  `shadow-window-focus`, `shadow-halo` (primary hover), `shadow-field-focus`,
  and the older `shadow-float-sm|float|float-lg`. All tint from `--sh`.
- **Easing / motion**: `ease-spring` `cubic-bezier(.34,1.5,.64,1)` (presses,
  toggles, popovers), `ease-smooth` `cubic-bezier(.22,.9,.28,1)` (fades,
  geometry); `--dur-fast|base|slow` (.2s/.35s/.55s). JS twins in
  `src/lib/motion.ts` (`easeSpring`, `easeSmooth`, `popEnter`/`dialogEnter`)
  and `src/lib/tokens.ts`.
- **Type**: `font-sans` follows the mode; `font-headline` is weight 700
  (300 in Deloitte).
- **Variants**: `dark:` and `brand-dl:` (use `brand-dl:` only for structural
  brand differences; anything a token can express belongs in tokens.css).

### Effects (utilities in `globals.css`; each has a usage comment there)

| Class                               | Use                                                                                                                     |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `glass` / `glass-pop` / `glass-win` | Frosted fill + blur + 1px light edge. Chrome (dock, command bar, pills) / popovers, menus, dialogs / window body.       |
| `spot`                              | Cursor-following card spotlight. Just add the class; `GlobalSpotlight` (mounted in layout) feeds `--mx/--my`.           |
| `sweep`                             | Diagonal light sweep on hover (buttons). Override `--sweep-color` for solid fills.                                      |
| `ai-ring`                           | Rotating conic AI border from `--ring-colors` (brand gradient in Deloitte). Hide with `[--ai-ring-opacity:0]`.          |
| `row-bar`                           | Accent bar sliding in on a list row on hover / `data-active="true"` / `aria-selected` / `aria-current`.                 |
| `morph`                             | Rounded square becomes a circle with accent glow on hover (dock tiles, menu icons). `morph-host` on a parent drives it. |
| `transition-ui`                     | The standard spring-press transition list.                                                                              |
| `scrim`                             | Blurred, tinted dialog backdrop (blur strength = `--scrim-blur`).                                                       |
| `accent-word`                       | One headline word: italic + green underline (Deloitte-light) / neon (Deloitte-dark).                                    |
| `brand-bar`                         | Deloitte-only 4px gradient bar across the top of a window (put on the clipped `relative overflow-hidden` body).         |
| `scroll-thin`                       | Slim token-tinted scrollbar for hand-rolled overflow.                                                                   |
| `animate-rise`, `animate-blink`     | Entrance for cards/rows; status-dot blink.                                                                              |
| `.progress*` / `<Progress/>`        | Segmented progress bar with `data-state` idle / run / gate / err / ok.                                                  |
| `.wp-*`                             | The four cross-fading wallpaper layers (`Wallpaper.tsx`).                                                               |

Pseudo-element budget (never stack two users of the same one): `spot` uses
`::before` + `::after`; `sweep`, `row-bar`, `ai-ring` use `::after`;
`brand-bar` uses `::before`. All motion effects switch off under
`prefers-reduced-motion`; overlays degrade to a plain fade.

Focus: a base-layer `:focus-visible` outline in `--color-focus` covers any
interactive element that does not bring its own ring; `focus-visible:ring-*`
and `outline-none` utilities still win.

### Using it in a component

```tsx
<section className="spot rounded-card bg-card border-line border p-5">
  <h2 className="font-headline text-3xl">
    Your <span className="accent-word">tasks</span>
  </h2>
  <Button>Run</Button> {/* 36px, accent fill, halo + light sweep */}
  <Badge variant="warning" dot pulse fixedWidth>
    Needs you
  </Badge>
  <Tabs>
    <TabsList>
      <TabsTrigger value="a" count={3}>
        Mine
      </TabsTrigger>
    </TabsList>
  </Tabs>
</section>
```

When adding or changing a token, update `tokens.css`, the mirror in
`src/lib/tokens.ts`, and the className-merge list in `src/lib/cn.ts` (so
`cn("rounded-chip", "rounded-lg")` still resolves the conflict). To eyeball a
primitive in all four theme x brand combinations open `/design` (dev only; a
gallery on the real wallpaper).

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

**Updates without reinstalling:** the Electron shell (`desktop/main.cjs`, mode logic in `desktop/launch-config.cjs`)
runs the UI as `next dev` from the project folder (`live-dev`; `live-build` and `bundled` are the alternatives, with
fallback to bundled), so `src/**` edits hot-reload; the backend and the task manifests already load from disk, and
the settings gear's "Restart backend" row (`src/lib/backendRestart.ts`, via the `/api/agent-office/{stop,start}`
routes only) reloads them. Reinstall is needed only for `desktop/` or `package.json` build-config changes.

## Local AI runtime (`src/lib/ai-runtime/`)

The firm does not allow internal messages to go to a cloud model, so AI
features run on a local Ollama model. This server-side module is the one
place that talks to it; feature code imports it and never names a model or a
URL. Import from server code only (route handlers, server modules).

```ts
import { generateJson, generateText, getRuntimeStatus } from "@/lib/ai-runtime";

const todo = await generateJson({ system, prompt: rawMessage, schema: todoZodSchema });
// -> z.output<typeof todoZodSchema>; optional: model, timeoutMs, think
const text = await generateText({ system, prompt }); // optional: model, timeoutMs, temperature, think
```

`generateJson` sends the zod schema as Ollama's structured-output `format`,
runs at temperature 0, validates the reply against the schema, and does one
repair round-trip (the validation problems are fed back) before giving up.
Failures reject with `AiRuntimeError` whose `code` is `"runtime-down"`,
`"model-missing"`, `"timeout"` or `"invalid-output"` (use `isAiRuntimeError`).
All calls go through one FIFO queue with concurrency 1. Inference is CPU-only
here (a cold load is ~15-20s, a warm short extraction ~3-5s, long inputs
minutes), so call it from background work, not a blocking UI path. The default
timeout is 280 s per attempt and does not count time spent waiting in the
queue. It is also the ceiling: every per-call `timeoutMs` (and
`AI_OS_AI_TIMEOUT_MS`) is clamped to `MAX_REQUEST_TIMEOUT_MS` (280 s), because
Node's fetch (undici) aborts a non-streaming request after 300 s without
response headers and that would otherwise look like a dead server. If it
happens anyway (a `UND_ERR_HEADERS_TIMEOUT` / `UND_ERR_BODY_TIMEOUT` cause) it
is mapped to `"timeout"`, not `"runtime-down"`; only a failure to connect is
`"runtime-down"`.

**Thinking is off for background work.** `think: false` goes to Ollama on
every PMO call (and on the warm-up and `/api/ai/command`). Reasoning models
(gemma4, qwen3.5) otherwise spend minutes thinking on this CPU, then truncate
or time out; do not enable it. `think` is left unset when a caller does not
pass it, and `false` is accepted by non-thinking models too.

Config (all optional env vars; defaults in `core.ts`): `OLLAMA_MODEL`
(default `gemma4:12b`; fallback `qwen3.5:9b`, also think off. Both model
choices come from a local bake-off on fictional messages: qwen2.5:7b obeyed
prompt injection and got weekday dates wrong), `OLLAMA_BASE_URL` (default
`http://127.0.0.1:11434`), `AI_OS_OLLAMA_EXE`, `AI_OS_AI_AUTOSTART=0` (never
spawn Ollama), `AI_OS_AI_PREWARM=0`, `AI_OS_AI_KEEP_ALIVE`,
`AI_OS_AI_TIMEOUT_MS`, `AI_OS_AI_NUM_CTX` (default 8192, sent on every call:
a changing `num_ctx` makes Ollama reload the model, so `/api/ai/command` sends
the same value).

**Lifecycle and ownership** (`lifecycle.ts`, mirroring the agent-office
backend's owned lifecycle): `src/instrumentation.ts` calls `ensureRuntime()`
when the Next server starts (`pnpm dev`, `next start`, and the server the
Electron shell spawns). If something already answers on the base URL it is
reused and is never killed (`ownedByUs: false`). Otherwise, and only for a
loopback URL, AI OS spawns `ollama serve` (resolved from `AI_OS_OLLAMA_EXE`,
then PATH, then `%LOCALAPPDATA%\Programs\Ollama`; fixed args, `shell: false`,
`windowsHide`, log in the OS temp dir) and owns it. `generateJson` also
re-runs this check before every call, so an Ollama that died is restarted
transparently. The default model is pre-warmed in the background (through the
queue) with a tiny real chat (one short message, a few tokens, `think: false`),
not an empty `/api/generate`: that only allocates the model and the first real
call still paid 60-90 s to page the weights in. `AI_OS_AI_PREWARM=0` turns it
off. `getRuntimeStatus().modelWarm` is true only when the model is loaded and a
real chat has run on it since (`modelLoaded` alone can still mean a slow first
call). On quit, an owned server has its models unloaded (`keep_alive: 0`) and
its process tree killed (`taskkill /T`): `desktop/main.cjs` calls
`POST /api/ai/runtime/stop` (desktop mode only) next to the Agent Office stop,
and a `process.on("exit")` hook covers dev-server exits. The Ollama child is
deliberately non-detached, so a hard kill of the Next process also takes it
down (Windows job object). As a last net, a pidfile in the OS temp dir lets
the next run adopt an Ollama that a crashed run left behind, but only if the
recorded owner process is dead and the PID's image is really `ollama.exe`.
Lifecycle state, and the queue, live on `globalThis` because Next compiles
instrumentation and each route into separate module graphs.

`GET /api/ai/runtime` is a read-only status snapshot (`running`, `ownedByUs`,
`modelLoaded`, `queue.waiting`/`active`, ...); it never starts or stops
anything. The PMO status bar is the only UI indicator. `/api/ai/command` shares
the config (so it also runs `gemma4:12b`, which advertises the `tools`
capability and was checked to make correct tool calls with `think: false`) but
still calls Ollama itself, because it needs `/api/chat` tool calling and
should not queue behind long background jobs. It sends `think: false` too. Tests (`core.test.mjs`) cover
the queue, JSON repair/validation, exe resolution and the client against a
fake `fetch`; none need a real Ollama. Pure logic lives in `core.ts` with no
extensionless sibling imports, which is what lets plain Node import it.

## PMO To-Do (`src/lib/pmo/`, `src/components/apps/pmo-todo-app/`, `pmo-intake/`)

A built-in app (`"pmo-todo"`, the sixth dock entry) for the PMO lead. Raw
Teams messages and Outlook emails arrive as JSON files in an inbox folder; the
**local** model (through `src/lib/ai-runtime`, never a cloud API) turns each
into a to-do _proposal_; proposals wait in a **Review Queue**, and only a human
**Approve** creates a to-do. **The app sends nothing anywhere** (no email, no
Teams post; the only notifications are local reminders on this computer, see
"Phase 3" below) and never calls agent-office: no code under
`src/lib/pmo`, `src/app/api/pmo` or the app imports
`src/app/api/agent-office/*`. Phase 1 was the inbox, filter, model and review
queue; phase 2 added the read-only Outlook COM producer, the Paste dialog, the
Settings dialog, the Filtered-tab guidance and the retention purge (below).
Phase 3 added full to-do editing, the reminder engine, the desktop and browser
notification paths and the dock badge ("Phase 3"). Phase 4 added waiting-on
tracking, local chaser drafts and thread-aware intake ("Phase 4" at the end of
this section).

**Runs inside the existing Next server.** No new process and no cloud store.
`ensureIngest()` (`server/service.ts`) starts the inbox poller and the
structuring worker lazily on the first `/api/pmo/*` call and keeps them on
`globalThis` (Next compiles every route into its own module graph).

```
pmo-intake/             The producer contract: PMO-INTAKE-CONTRACT.md,
                        intake.v1.schema.json, examples/, PA-FLOW-RECIPES.md
                        (click-by-click Power Automate flows, standard
                        connectors only), HOW-TO-GET-STARTED.md (the whole
                        set-up in order), scripts/New-SampleIntake.ps1, and
                        the Outlook producer: scripts/Export-OutlookToInbox.ps1
                        (READ-ONLY classic-Outlook COM export) with
                        scripts/OutlookMapping.ps1 (the mapping, on plain
                        objects) and scripts/tests/ (fake-Outlook harnesses).
src/lib/pmo/            Pure logic, one co-located *.test.mjs per area
                        (`pnpm test` imports the .ts directly, so imports
                        between these files carry the .ts extension, enabled by
                        `allowImportingTsExtensions`, and parameter properties /
                        enums are avoided).
  types.ts                zod: Intake, Proposal, Todo, TodoDraft, the model's
                          AiStructuredSchema (length limits live in the JSON
                          Schema via .meta(), clamping in transforms), config.
                          `confidence` stays in the schema as a rough model
                          estimate but the UI no longer shows it.
  filter.ts               The Deloitte-only filter (pure, first reject wins).
  dedupe.ts               source + sha256(sourceId), with the documented fallback.
  preprocess.ts           HTML -> text, strip quoted reply chains, drop base64 and
                          tracking links, truncate to ~12k chars. Client-safe.
  quote.ts                Hallucination guard: is `quote` really in the message?
  structurePrompt.ts      System/user prompts (message in <message> delimiters,
                          marked as untrusted data). `PROMPT_VERSION` is bumped
                          on every wording change and logged with each AI call.
                          The user turn ends with a computed "Date hints" block
                          (received day + next 14 days as `Mon 2026-10-26`, IST,
                          from time.ts) so the model copies dates instead of
                          counting; it sits outside the untrusted delimiters.
  todoLogic.ts            Draft -> Todo, derived stage/progress, patches (fields,
                          action items with owner/due, checkpoint add/rename/
                          reorder/remove/skip/complete, snooze). Client-safe.
  due.ts                  The reminder engine: computeDue(todos, now, prefs),
                          toastFor (privacy default), attentionSummary (the
                          badge), snooze presets, time-zone maths. Pure.
  thread.ts               threadKeyOf (the conversation key of an intake),
                          pickMatchingTodo, looksLikeReplyFrom. Pure, conservative.
  updateLogic.ts          planUpdate: the model's small answer -> a reviewable
                          before -> after change list and the merged TodoPatch.
  updatePrompt.ts         Prompts for "what does this new message change?".
  chaser.ts               Chaser prompts, cleanChaserText, buildMailto. Client-safe.
  desktopBridge.ts        Typing for window.aiOsDesktop (the Electron preload).
  checkpointTemplates.ts  The fixed catalog: simple, deliverable, approval, followup.
  server/                 Server only; never import from client code.
    store.ts, fsx.ts      Per-record JSON files, atomic temp-then-rename writes,
                          in-process promise-chain mutex (`withLock`).
    ingest.ts             Polls the inbox (readdir every 15 s, not fs.watch).
    structure.ts          FIFO queue, concurrency 1, injectable `Generator`.
    actions.ts            The ONLY code that creates/changes to-dos: approve,
                          reject, retry, manual create, patch, config.
    manual.ts             POST /api/pmo/intake/manual: validates a paste and
                          writes a source:"manual" pmo-intake/1 file into the
                          inbox (temp, then rename; sourceId = content hash;
                          a duplicate writes nothing). manualIntake.ts (client-
                          safe, one level up) holds the zod schema and builder.
    notify.ts             Reminder delivery: previewDue, claimDue, acknowledgeDue
                          (state/notify.json), remindersOwnedByDesktop.
    desktopPrefs.ts       Mirrors the tray setting into the shell's userData.
    retention.ts          The purge (see Retention below), run from service.ts
                          once at start and every 24 h; injectable clock.
    bodyCap.ts            Size-capped request body reader (512 KB for a paste).
    originCheck.ts, http.ts  Origin/Host guard + { ok, reason? } envelope.
    aiGenerator.ts        The real model (src/lib/ai-runtime generateJson,
                          `think: false`, 240 s timeout, clamped below 280 s)
                          and the runtime summary for the status bar.
    chaserDrafts.ts       In-memory "draft a chaser" jobs (local model, copy-only).
    stubGenerator.ts      Fake model for tests / `PMO_AI_STUB=1`; answers all three
                          tasks (proposal, update, chaser) deterministically.
src/app/api/pmo/        state, ingest/scan, intake/manual (POST, the Paste
                        dialog), queue/[id] (PATCH) + approve|reject|retry,
                        raw/[intakeId], todos, todos/[id], config, due (GET),
                        due/claim and due/ack (POST), queue/[id]/apply and
                        /separate (update cards), todos/[id]/chaser (POST
                        start, DELETE discard). Each route
                        checks Origin/Host first (raw message text is served),
                        touches only local files, replies HTTP 200 with
                        { ok, reason? }.
```

**Data directory**: env `AI_OS_PMO_DATA_DIR`; `desktop/main.cjs` sets it to
`<userData>\pmo`; the dev default is `%LOCALAPPDATA%\AI OS\pmo` (outside the
repo). Layout: `config.json`, `raw/<intakeId>.json` (immutable snapshot incl. the
original text), `quarantine/` (filtered items: metadata and reason, body
dropped), `rejected-files/` (unparsable producer files + `.reason.txt`),
`queue/<proposalId>.json`, `todos/<todoId>.json`, `state/seen.json` (dedupe
index), `state/notify.json` (reminders delivered / claimed), `logs/ingest.jsonl`, `logs/ai-calls.jsonl` (no message text),
`audit.jsonl` (approve/reject/edit/complete with the OS user).

**Inbox**: `config.inboxDir`, default
`C:\Users\alsaju\OneDrive - Deloitte (O365D)\PMO-Inbox` (a Power Automate flow writes
there, OneDrive syncs it), overridden by env `AI_OS_PMO_INBOX_DIR`. **Use temp
folders for every test**: `AI_OS_PMO_INBOX_DIR` + `AI_OS_PMO_DATA_DIR`, and
`PMO_AI_STUB=1` to skip the model. Files younger than 3 s and larger than 1 MB
are skipped; the app deletes each file it has dealt with, and its only write
into the folder is the Paste button's file (one more producer, same atomic
hand-off). **Teams is filtered by default** until a tenant ID or chat is
allowlisted (the tenant GUID ships empty): the status bar says so, a filtered
Teams item has an _Allow this tenant_ button, and the tenant goes in Settings
too (see PMO-INTAKE-CONTRACT.md).

**Producers** (all write the same `pmo-intake/1` file): Power Automate flows
(recipes; Teams trigger: tenant id, `LinkToMessage` and `messagePayload.id` are
confirmed, body/sender-name paths inside `messagePayload` are not), the Outlook
script, and Paste. The Outlook script (`Export-OutlookToInbox.ps1`) is a
read-only COM export from classic Outlook; "new Outlook" has no COM. It keeps
its own seen-file keyed by Message-ID, resolves Exchange X500 addresses to SMTP,
skips non-mail items, and is guarded by a test that fails if its text contains
any member that could change a mail (`outlookExport.test.mjs`, which also runs
the mapping and the script's control flow against fake Outlook objects under
`powershell.exe`, never real Outlook). **Paste** is user-vouched: it still gets
the blocked-domain/term rules (and a blocked domain anywhere in the pasted text
counts) but not the Teams default-deny.

**UI additions**: the status bar has _Paste_ and a gear. _Paste_
(`PasteIntakeDialog`) validates with the same zod schema as the server;
_Settings_ (`SettingsDialog`, form logic in `settingsForm.ts`) edits
`config.json` through GET/PUT `/api/pmo/config`, validated by the same
`PmoConfigPatchSchema` (GUID tenant ids, domains, emails, retention bounds) with
inline per-line errors, and shows the inbox and data paths read-only. The
Filtered tab filters by reason and, per item, offers the one-click rule change
(_Allow this tenant_ / _Allow \<domain\>_) and the steps to resend. It cannot
"move to review": the text of a filtered message is discarded at filter time on
purpose, and the tab says so.

**Retention** (`server/retention.ts`; `retentionDays` in `config.json`, default
90): logs older than that are dropped line by line; the saved text
(`raw/<id>.json`) of a closed to-do (done/cancelled) or a rejected proposal goes
once that decision is older than that; `quarantine/` and `rejected-files/` go
after 30 days. Never touched: raw text of an open to-do or an undecided
proposal, the proposal/to-do records, `audit.jsonl`, `state/seen.json`, config.
Idempotent, unit-tested with a fake clock. It starts with the service, i.e. on
the first `/api/pmo/*` call after the server starts.

**Review gate**: nothing but `POST /api/pmo/queue/[id]/approve` (or a manual
create, where the human is the reviewer) writes `todos/`. A proposal keeps the
model's `draft` untouched; the reviewer's changes are `edits`. Local model
failures are local state only: `runtime-down` / `model-missing` pause the queue
and leave items `pending` (banner in the UI; every scan retries), a timeout is
retried once then `failed`, `invalid-output` is `failed` after the runtime's own
repair, at most 3 model attempts per item, and failed items offer _Retry_ and
_Create manually from original_. `gemma4:12b` (think off) on this CPU takes
roughly 50-100 s per message, and the first one after a cold start 1-2 minutes
more (the status bar says so while the model is not yet warm), so structuring
is strictly background work.

### Phase 3: editing, reminders, badge

**Editing** (`TodoDetailDialog`, `TodoEditors`; everything goes through the one
PATCH route, validated by `TodoPatchSchema`, and every real edit is audit-logged
with the OS user and time): title, description, owner, due date (with Today /
Tomorrow / Next Monday chips), priority, waiting-on; action items with an
optional owner and due date (add, edit inline, tick, remove); checkpoints (add,
rename, move up/down, remove, skip, complete, reopen). The stage and the progress
bar are derived from the checkpoints on every read, never stored. Completing the
last checkpoint only _offers_ "Mark done" (a banner in the dialog and a button on
the list row); the to-do is never closed by itself. The list has Open / Overdue /
Due soon / Waiting / Snoozed / Done filters with counts and four sorts
(`queueView.ts`): "overdue" is due before today (IST), "due soon" is due today or
tomorrow. Limits: 50 action items and 20 checkpoints per to-do.

**Reminders** (`src/lib/pmo/due.ts`, pure, unit-tested with a fake clock).
`computeDue(todos, now, prefs)` returns `{ todoId, kind, key, title, body }`:

- `due-soon`: once per due date, while the due date (the _start_ of that day) is
  less than 24 h away, so the heads-up lands on the day before.
- `overdue`: from the start of the working day (09:00) on the due day, then once
  per working day (Saturday and Sunday skipped by default).
- `chaser`: a to-do with _waiting on_ set and no reply for N working days,
  repeating after each further N. The clock starts at `waitingSince` (phase 4; a
  to-do from before it falls back to its last update); N is the to-do's own
  `chaserDays`, else the global default (2). Editing the to-do does not restart
  the clock; "Mark waiting" again does. A snooze never does.
- `digest`: optional (off), one summary per working day.
- Quiet hours (default on): nothing is produced outside the working window
  (09:00-18:00 Mon-Fri). A held reminder is simply not yet delivered, so it
  appears when the window opens. Snooze: `todo.reminders.snoozedUntil` silences
  that to-do (not the digest) until then; presets are 1 h, tomorrow 09:00, next
  Monday 09:00, or a custom date and time, all read in the prefs' time zone.
- Prefs live in `config.json` under `reminders` (`ReminderPrefsSchema`: master
  switch, `timeZone` Asia/Kolkata, `workStart`, `workEnd`, `workDays`,
  `quietOutsideHours`, `chaserDays`, `digest`, `hideDetails`,
  `keepRunningInTray`) and are edited in the Settings dialog. A malformed block
  falls back to the defaults for that block only, not the whole config.
- **Privacy default**: `hideDetails` is on, so the notification text is only
  "PMO To-Do: N items need attention" (`toastFor`): no title, no name. Off, it
  shows the title (or a short list). The server builds the toast, so every client
  shows identical text. Reminders stay on this computer; nothing is sent anywhere.

**Delivery and claim semantics** (`server/notify.ts`). A client _claims_ the
reminders not yet delivered (`POST /api/pmo/due/claim { client }`). Under the
store lock the server runs `computeDue`, drops keys already delivered or held by a
fresh claim, records the claim in `state/notify.json` and returns
`{ claimId, notifications, toast, attention }`. After showing it the client calls
`POST /api/pmo/due/ack { claimId }` and the keys become delivered for good. An
unacknowledged claim expires after 3 minutes and its reminders are claimable
again, so a crashed client or a failed toast delays a reminder and never loses it
(worst case it repeats once). Two clients asking at the same moment get disjoint
sets. `GET /api/pmo/due` is the read-only preview (pending, attention counts,
prefs). All three are origin-checked like every `/api/pmo` route. When the server
belongs to the Electron shell (`AI_OS_DESKTOP_MODE=1`) only the shell may claim or
ack: it sends `x-ai-os-desktop: 1`, the same marker the AI-runtime stop route
requires (a custom header forces a CORS preflight, which a web page cannot get
through). A browser tab pointed at that server gets `desktopOwns: true` and just
reads the badge count.

**Electron** (`desktop/main.cjs`, `pmo-notifier.cjs`, `preload.cjs`). The main
process sets the AppUserModelID to `build.appId` (`com.aios.desktop`) and, every
60 s while the Next server is up (not starting, restarting or quitting), claims
reminders, shows one Electron `Notification` for the batch and then acks.
Clicking it shows and focuses the window (restoring it from the tray) and sends
`pmo:open-todo` to the page; if the page has not registered yet the request is
held and delivered when it does. `preload.cjs` (sandbox and context isolation stay
on; it requires only `electron`) exposes just
`window.aiOsDesktop = { isDesktop, onOpenTodo(cb), setBadge(n) }`, and the IPC
handlers accept only the main window's own page. `setBadge` draws a taskbar
overlay (a generated bitmap, no image file) and sets the tray tooltip. The
**tray option** "Keep running in the tray so reminders still fire" (Settings,
default OFF): when on, closing the window hides it and shows a tray icon (Open,
Quit). Quit is a normal `app.quit()`, so `before-quit` runs the usual shutdown,
including stopping the Ollama this app started. When off, closing quits as before
(`window-all-closed`). The main process reads the setting from
`<userData>\desktop-prefs.json`, which the Next server writes when the setting is
saved and at start (`AI_OS_DESKTOP_PREFS_FILE`, set by main.cjs); a missing or
unreadable file means off. `AI_OS_SKIP_AGENT_OFFICE=1` makes the shell skip its
Agent Office start/stop calls (for testing the shell without touching the real
backend). Because reminders need the data layer, the first claim also starts the
PMO service (inbox poller, structuring worker) shortly after launch instead of
when the PMO window is first opened.

**Browser mode** (`usePmoReminders`, mounted by `desktop/PmoReminders.tsx` from
`Desktop.tsx`, so it runs with the PMO window closed). Outside the shell it claims
every 60 s, shows a web `Notification` (if permission was granted) plus an in-app
toast, then acks. The PMO window shows an **Enable reminders** button (the
permission request needs a click) and says plainly that web reminders only fire
while the tab is open and that the desktop app is the reliable path. Without
permission the fallbacks are the count badge on the dock tile (a small generic
`dockBadgeStore`, display only, never touching the pinned layout) and a "(N)"
prefix on the tab title. Inside the shell the hook never claims; it only refreshes
the badge. The badge number is `attentionSummary`: open, un-snoozed to-dos that
are overdue, due today or tomorrow, or waiting past the chaser days.

Turning reminders on, and a manual check of the real notification path:
`pmo-intake/HOW-TO-GET-STARTED.md`, section 10.

### Phase 4: waiting, chaser drafts, thread-aware intake

Still human-gated, still local: **nothing is sent anywhere**. No SMTP, no Outlook
COM, no Graph, no agent-office. The one hand-off to the outside is a `mailto:` link
(below).

**Waiting on.** A to-do has `waitingOn`, `waitingSince` (ISO; the chaser clock) and
an optional `chaserDays` (null = the global default). _Mark waiting_ (a name, with
quick picks from the requester and the source sender) and _Got a reply (clear
waiting)_ are one click in the detail panel (`WaitingPanel`); the list row shows
"Waiting on X since Mon 19 Oct (7 days)", a "Time to chase" badge once the
cadence is reached, and a _Got a reply_ button. The since-date can be backdated
and the cadence set per to-do (1-10 working days, or the default). Approve carries
the AI proposal's `waitingOn` (trimmed) with `waitingSince` = the approval time,
unless the draft carries its own `waitingSince`. `due.ts` has one definition
(`waitingState`) used by the engine, the badge and the UI.

**Timeline.** `todo.history` (cap 60, the first entry always kept): created, linked
messages, waiting set/cleared, due-date and status changes, "chaser drafted"
(never the draft text). Shown newest first in the _Timeline_ tab; an entry that
links a message has _Open message_ (the immutable `raw/<intakeId>.json`, shown as
it arrived). Retention keeps those messages while the to-do is open, like its
source message.

**Thread-aware intake** (`thread.ts`, `ingest.ts`, `updateLogic.ts`). After
dedupe and the Deloitte-only filter, an intake whose key equals the key of an
_open_ to-do's source becomes an **update proposal** (`proposal.update`, `draft`
stays null) instead of a duplicate proposal. The key is built only from fields the
producer gave, and includes the source, so nothing matches across sources,
tenants or mailboxes: Outlook `outlook|<mailbox>|<conversationId>`; Teams
`teams|conv|<tenant>|<conversationId>`, else `teams|chat|<tenant>|<chatId>` (chat
id from the context or the deep link), and for a channel (`@thread.tacv2`)
`...|<root message id>` so only a post and its replies share a key; a paste never
matches. Several matches: most recently updated wins. A to-do from before phase 4
has no stored `source.threadKey`; it is derived from its source message when that
is still on disk. No match: exactly the old behaviour.

The worker then asks the model (`generateJson`, `think: false`, schema
`AiUpdateSchema`: kind, summary, clearsWaiting, newDueAt, newActionItems, note,
quote) with the to-do and the new message (delimited, untrusted, date hints
appended). `kind: "unrelated"` (a Teams chat is one key for many topics), or a
to-do that closed meanwhile, converts the proposal into an ordinary one
automatically (audited `update-separate`). The model never writes the patch:
`planUpdate` builds it by code and drops no-op changes (same due date, an action
item the to-do has, clearing waiting on a to-do that is not waiting). The Review
Queue shows a distinct **Update to existing to-do** card: the to-do, the model's
sentence, each change as before -> after with a checkbox, the new message (quote
highlighted). _Approve_ (`POST /api/pmo/queue/[id]/apply { include }`, the only
door) applies the ticked changes with the audit line `update-apply` and links the
message into the timeline; _Reject_ discards it; _Create as separate to-do
instead_ (`.../separate`) turns it into a normal proposal. The ordinary approve and
the manual create refuse an update proposal. A failed update card offers Retry,
Separate and Dismiss.

**Reply hint.** If the to-do is waiting and the sender looks like the person
(`looksLikeReplyFrom`: address named in "waiting on", or enough shared name tokens;
"Priya Nair" matches "Priya", not "Priya Menon"), the card shows "Looks like a reply
from X: clear waiting?" as the waiting change. It is ticked only when the model also
says the message answers it; otherwise it is offered unticked. Still needs Approve.

**Chaser drafts** (`chaser.ts`, `server/chaserDrafts.ts`, `ChaserDialog`).
_Draft a chaser_ on a waiting to-do starts an in-memory job (one per to-do; a second
click shares it) and returns at once; the state document carries `chasers`, so the
dialog shows "Drafting... (can take a minute on this PC)" and then the text. The call
(`generateText`, `think: false`, temperature 0.4) goes through the same
concurrency-1 runtime queue as structuring. The prompt carries the title,
description, who it waits on, how long (calendar and working days) and the original
message excerpt (delimited, untrusted: a hostile message cannot close its tag), and
asks for a 2-5 sentence polite body with no invented facts. The result is plain text
in an editable textarea (never rendered as HTML) with _Copy_, an optional To (a
recipient of the original message that matches "waiting on", only when exactly one
does), a subject, _Draft again_ and _Discard_. A failure (runtime down, timeout,
unusable output) is a local message with _Try again_. Jobs are forgotten on restart
or after 12 h; only a one-line timeline note is stored.

_Open as unsent mail draft_ is a plain `<a href="mailto:...">` (`buildMailto`:
recipient used only if it is a bare address, subject and body URL-encoded with CRLF,
the whole link refused above 1800 characters, where the button is disabled and the
dialog says to copy instead). The browser or OS hands it to the user's own mail
program, which opens an _unsent_ compose window; the person checks it and presses
Send. No Outlook COM, no code that can send. `desktop/main.cjs`'s window-open
handler passes only http(s) and mailto: to `shell.openExternal` now (it passed
any scheme before).

**Stub model.** `PMO_AI_STUB=1` answers all three tasks: updates by simple rules
(delivered/attached -> reply + clears waiting, an ISO date -> due change, "could you
also" -> new action, a bare thanks -> nothing, `[[stub-unrelated]]`), chasers from the
facts block, the same failure markers (`[[stub-timeout]]`, `[[stub-invalid]]`) and
the `stub-runtime-down` switch, and `[[stub-waiting:Name]]` in a message makes the
proposal carry `waitingOn`.
