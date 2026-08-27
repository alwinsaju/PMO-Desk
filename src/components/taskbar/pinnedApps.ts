// This file has no component/hook of its own, but needs "use client" anyway
// because it imports live Phosphor icon component VALUES (not just types) —
// see the `pinnedAppIcons` map below. Without this directive, a Server
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
  FolderIcon,
  GlobeIcon,
  ListChecksIcon,
  NotePencilIcon,
  SquaresFourIcon,
  type Icon,
} from "@phosphor-icons/react";

/**
 * The 5 apps pinned to the dock. `id` doubles as the appId passed to
 * `windowStore.openWindow`.
 *
 * This exact list is the shared contract with the App Store and Demo Apps
 * workstreams: they register their apps under these same ids via
 * `registerApp` (see ARCHITECTURE.md's "app registry" section), which is
 * what makes a tile here resolve to a real app once those workstreams land.
 * Until then, opening one of these shows Window.tsx's registry fallback
 * ("No app is registered for X") — expected, not a bug in this workstream.
 * Keep this list's ids/shape exactly as specified; other workstreams depend
 * on them matching byte for byte.
 */
export const pinnedApps = [
  { id: "files", title: "Files", icon: "Folder" },
  { id: "notes", title: "Notes", icon: "NotePencil" },
  { id: "browser", title: "Browser", icon: "Globe" },
  { id: "tasks", title: "Tasks", icon: "ListChecks" },
  { id: "app-store", title: "App Store", icon: "SquaresFour" },
] as const;

export type PinnedApp = (typeof pinnedApps)[number];

/**
 * Resolves each entry's `icon` field to the actual Phosphor component that
 * renders it. Kept as a separate map (rather than storing the component
 * itself on `pinnedApps`) so `pinnedApps` stays plain, framework-agnostic
 * data — a plain string is also what's specified by the shared contract.
 */
export const pinnedAppIcons: Record<PinnedApp["icon"], Icon> = {
  Folder: FolderIcon,
  NotePencil: NotePencilIcon,
  Globe: GlobeIcon,
  ListChecks: ListChecksIcon,
  SquaresFour: SquaresFourIcon,
};
