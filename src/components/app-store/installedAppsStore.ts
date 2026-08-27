import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * No `"use client"` here, deliberately — same reasoning as `windowStore.ts`
 * / `agentStore.ts` (see ARCHITECTURE.md's third gotcha). This file imports
 * only `zustand`/`zustand/middleware` and plain local types, so it's safe
 * to evaluate anywhere; every actual consumer is already a Client Component
 * in its own right.
 *
 * This is the shared, persisted source of truth for which App Store
 * *catalog* entries (`appCatalog.ts`) are installed — genuinely shared
 * (every open App Store window instance reads/writes the same state,
 * unlike the old per-instance `useState` it replaces) and genuinely
 * persisted (survives closing the window and reloading the page, via
 * `persist` + `localStorage`). It deliberately does NOT cover the 5 apps
 * pinned to the dock (Files/Notes/Browser/Tasks/App Store itself, see
 * `taskbar/pinnedApps.ts`) — those are always present regardless of install
 * state; this store only ever tracks `AppListing.id`s from the catalog.
 *
 * Public contract, for the App Menu workstream (or anything else outside
 * this directory) to import directly from
 * `@/components/app-store/installedAppsStore`:
 *   - `useInstalledAppsStore` — the store hook itself, for reactive reads
 *     inside a component, e.g.
 *     `useInstalledAppsStore((s) => Boolean(s.installedIds[id]))`.
 *   - `isAppInstalled(id)` / `installApp(id)` / `uninstallApp(id)` — plain
 *     imperative equivalents (via `getState()`) for call sites that don't
 *     need reactivity, e.g. a one-off check or mutation from outside a
 *     render (an event handler, another store's action, ...).
 *
 * SSR note: `persist`'s default storage factory only touches
 * `window.localStorage` inside a try/catch (see
 * `node_modules/zustand/esm/middleware.mjs`'s `createJSONStorage`), so
 * importing this module during Next.js's server render doesn't crash —
 * it just resolves to an in-memory, unpersisted store for that render.
 * In practice this never matters here anyway: `AppStoreApp` (the only
 * consumer today) is only ever mounted after a window is opened from a
 * click, i.e. already client-side, well after hydration — there's no
 * server-rendered markup that reads this store for a mismatch to occur
 * against.
 */
export interface InstalledAppsStoreState {
  /** Keyed for O(1) lookups (mirrors `windowStore.ts`'s `Record<id, ...>`
   *  shape) — presence of a key means installed. There is no `false`
   *  value; uninstalling deletes the key outright rather than setting it. */
  installedIds: Record<string, true>;
  installApp: (id: string) => void;
  uninstallApp: (id: string) => void;
}

export const useInstalledAppsStore = create<InstalledAppsStoreState>()(
  persist(
    (set) => ({
      installedIds: {},

      installApp: (id) =>
        set((state) =>
          state.installedIds[id]
            ? state
            : { installedIds: { ...state.installedIds, [id]: true } },
        ),

      uninstallApp: (id) =>
        set((state) => {
          if (!(id in state.installedIds)) return state;
          const next = { ...state.installedIds };
          delete next[id];
          return { installedIds: next };
        }),
    }),
    {
      name: "app-store:installed-apps",
      partialize: (state) => ({ installedIds: state.installedIds }),
    },
  ),
);

/**
 * Plain (non-hook) read for call sites outside a component render — e.g.
 * a one-off check in an event handler. A component that needs to
 * re-render when install state changes should select reactively instead:
 * `useInstalledAppsStore((s) => Boolean(s.installedIds[id]))`.
 */
export function isAppInstalled(id: string): boolean {
  return Boolean(useInstalledAppsStore.getState().installedIds[id]);
}

/** Imperative equivalent of `useInstalledAppsStore((s) => s.installApp)(id)`. */
export function installApp(id: string): void {
  useInstalledAppsStore.getState().installApp(id);
}

/** Imperative equivalent of `useInstalledAppsStore((s) => s.uninstallApp)(id)`. */
export function uninstallApp(id: string): void {
  useInstalledAppsStore.getState().uninstallApp(id);
}
