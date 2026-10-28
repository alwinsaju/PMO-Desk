// This file has no component/hook of its own, but needs "use client" anyway
// because it imports live Phosphor icon component VALUES (not just types) —
// see the `icon` of each `builtInApps` entry below. Without this directive, a Server
// Component reaching this module through an unprotected path (e.g. this
// package's own barrel re-exporting it alongside a "use client" component)
// pulls those icon components into the SERVER/RSC compilation, where
// Phosphor's internal `createContext` call for its shared IconContext blows
// up with `(0 , d.createContext) is not a function` at "Collecting page
// data" time — a genuinely confusing failure with no stack frame in any of
// this project's own code. Caught while wiring the dock + desktop icon grid
// into Desktop.tsx (a Server Component) via `@/components/taskbar`'s barrel:
// `pnpm build` failed exactly this way until this directive was added; `pnpm
// dev`/typecheck/lint all stayed silent about it. If you add another data
// file that imports real icon/component values from a UI library, give it
// the same treatment.
"use client";

import {
  ClipboardTextIcon,
  FolderIcon,
  GlobeIcon,
  IdentificationBadgeIcon,
  ListChecksIcon,
  NotePencilIcon,
  SquaresFourIcon,
  type Icon,
} from "@phosphor-icons/react";

export interface BuiltInApp {
  /** Doubles as the appId passed to `windowStore.openWindow` and as the
   *  key the app registers under via `registerApp`. */
  id: string;
  title: string;
  icon: Icon;
}

/**
 * Every built-in app, in the order they appear on a DEFAULT taskbar — the
 * single place to add one. A built-in is just a window-manager app id with a
 * title and an icon; `id` is also what the app registers itself under (see
 * ARCHITECTURE.md's "app registry" section), which is what makes its tile /
 * App Menu entry resolve to a real app.
 *
 * This list is the DEFAULT, not a fixed baseline: the user can unpin any of
 * these (including App Store) from the taskbar, reorder them, and bring them
 * back with "Pin to taskbar" or "Reset taskbar to default" — see
 * pinnedAppsStore.ts and taskbarLayout.ts. An unpinned built-in is still
 * listed in the App Menu, still opens, and still gets a (temporary) taskbar
 * tile while one of its windows is open. Ids remain a shared contract:
 * other workstreams register their apps under these exact ids, so never
 * rename or reuse one — adding is fine, changing is not.
 *
 * ADDING A BUILT-IN APP is one entry here (plus its icon in the import list
 * above), e.g. `{ id: "pmo-todo", title: "PMO To-Do", icon: ClipboardTextIcon }`,
 * and the app's own `registerApp("pmo-todo", ...)` import in
 * `src/components/apps/index.ts`. Nothing else: the dock, the App Menu and
 * the persisted-layout migration all derive from this array. Anyone who
 * already saved a customized taskbar gets the new app appended once (see
 * `reconcileBuiltIns` in taskbarLayout.ts) rather than never seeing it.
 *
 * Renamed from `pinnedApps` to `builtInApps` when the App Menu workstream
 * added the growable ADDITIONALLY-pinned list; that list and this one are
 * now merged into one user-editable layout in pinnedAppsStore.ts.
 */
export const builtInApps = [
  { id: "pmo-todo", title: "PMO To-Do", icon: ClipboardTextIcon },
  { id: "tasks", title: "Tasks", icon: ListChecksIcon },
  { id: "staff", title: "Staff Management", icon: IdentificationBadgeIcon },
  { id: "files", title: "Files", icon: FolderIcon },
  { id: "notes", title: "Notes", icon: NotePencilIcon },
  { id: "browser", title: "Browser", icon: GlobeIcon },
  { id: "app-store", title: "App Store", icon: SquaresFourIcon },
] satisfies readonly BuiltInApp[];

export type PinnedApp = BuiltInApp;

/** Ids of every built-in app, in default taskbar order. */
export const builtInAppIds: readonly string[] = builtInApps.map((app) => app.id);
