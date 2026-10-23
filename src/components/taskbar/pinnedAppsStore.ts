"use client";

import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { builtInAppIds } from "./pinnedApps";
import {
  defaultLayout,
  migrateLegacyPinned,
  pinId,
  placeId,
  reconcileBuiltIns,
  sanitizeIds,
  unpinId,
  type TaskbarLayout,
} from "./taskbarLayout";

/**
 * `"use client"` because this file now imports `pinnedApps.ts` (which holds
 * live Phosphor icon component values) for the built-in ids — see
 * ARCHITECTURE.md's third gotcha. Every consumer (Dock.tsx, AppMenu.tsx) is a
 * Client Component already; the directive just keeps this module safe to
 * import from anywhere.
 *
 * This store is the user's whole, editable taskbar: ONE ordered list of app
 * ids — built-in apps (`pinnedApps.ts`'s `builtInApps`) and App Store
 * catalog apps alike. A fresh install starts with every built-in pinned, in
 * `builtInApps` order; the user can unpin ANY of them (App Store included),
 * pin any app back, reorder tiles, and reset to that default. All the list
 * manipulation is pure and lives in `taskbarLayout.ts` (unit-tested); the
 * actions below just apply it to state.
 *
 * Shared, persisted, and reactive the same way `installedAppsStore.ts` is:
 * every Dock/AppMenu instance reads/writes this same state, and it survives
 * a reload via `persist` + `localStorage` (key `taskbar:pinned-apps`).
 *
 * Persistence is deliberately forgiving: the storage wrapper below swallows
 * every storage failure (blocked/disabled storage, quota errors, corrupt
 * JSON) so the taskbar still works — it just doesn't survive a restart —
 * and `merge` below only trusts a persisted list that is actually an array
 * of strings, falling back to the default taskbar otherwise. Persisted
 * shapes: v0 held ONLY the extra catalog pins (built-ins were implicit);
 * v1 holds the full layout and is what `migrate` upgrades v0 into.
 *
 * Public contract:
 *   - `usePinnedAppsStore` — the store hook, for reactive reads, e.g.
 *     `usePinnedAppsStore((s) => s.pinnedIds)`.
 *   - `isAppPinned(id)` / `pinApp(id)` / `unpinApp(id)` /
 *     `resetPinnedApps()` — plain imperative equivalents (via `getState()`)
 *     for call sites that don't need reactivity, mirroring
 *     `installedAppsStore.ts`'s `isAppInstalled`/`installApp`/`uninstallApp`.
 *   - `APP_DRAG_MIME_TYPE` — the `DataTransfer` type AppMenuEntry.tsx and
 *     DockTile.tsx set in `onDragStart` and Dock.tsx checks for in
 *     `onDragOver`/reads in `onDrop`, so a drag started from the App Menu OR
 *     from a dock tile is only ever recognized as an "app id dropped on the
 *     dock" gesture (pin it / move it) by that one drop target.
 */
export interface PinnedAppsStoreState {
  /** The user's taskbar, left to right: built-in AND catalog app ids. A
   *  plain array (not a keyed `Record` like `installedAppsStore`'s
   *  `installedIds`) because ORDER is the dock's display order. May hold an
   *  id that no longer resolves to an app; Dock.tsx drops those at render. */
  pinnedIds: string[];
  /** Built-in app ids this saved layout has already accounted for — what
   *  lets a built-in added to `builtInApps` in a later release appear once
   *  on an already-customized taskbar (see `reconcileBuiltIns`). */
  knownBuiltInIds: string[];
  pinApp: (id: string) => void;
  unpinApp: (id: string) => void;
  /** Put `id` before/after `targetId`, pinning it first if it isn't. */
  placeApp: (id: string, targetId: string, after?: boolean) => void;
  /** Back to the default taskbar: every built-in, in default order. */
  resetPinnedApps: () => void;
}

/** `localStorage`, minus its failure modes: never throws, and a missing
 *  storage object just means "nothing saved / can't save". */
const safeLocalStorage: StateStorage = {
  getItem: (name) => {
    try {
      return window.localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      window.localStorage.setItem(name, value);
    } catch {
      // Quota exceeded / storage blocked — keep running in memory.
    }
  },
  removeItem: (name) => {
    try {
      window.localStorage.removeItem(name);
    } catch {
      // Same as above.
    }
  },
};

export const usePinnedAppsStore = create<PinnedAppsStoreState>()(
  persist(
    (set) => ({
      ...defaultLayout(builtInAppIds),

      pinApp: (id) =>
        set((state) => {
          const pinnedIds = pinId(state.pinnedIds, id);
          return pinnedIds === state.pinnedIds ? state : { pinnedIds };
        }),

      unpinApp: (id) =>
        set((state) => {
          const pinnedIds = unpinId(state.pinnedIds, id);
          return pinnedIds === state.pinnedIds ? state : { pinnedIds };
        }),

      placeApp: (id, targetId, after = false) =>
        set((state) => {
          const pinnedIds = placeId(state.pinnedIds, id, targetId, after);
          return pinnedIds === state.pinnedIds ? state : { pinnedIds };
        }),

      resetPinnedApps: () => set(defaultLayout(builtInAppIds)),
    }),
    {
      name: "taskbar:pinned-apps",
      version: 1,
      storage: createJSONStorage(() => safeLocalStorage),
      partialize: (state) => ({
        pinnedIds: state.pinnedIds,
        knownBuiltInIds: state.knownBuiltInIds,
      }),
      migrate: (persisted, version) => {
        if (version === 0) {
          const legacy = (persisted as { pinnedIds?: unknown } | null)?.pinnedIds;
          return migrateLegacyPinned(legacy, builtInAppIds);
        }
        return persisted as TaskbarLayout;
      },
      merge: (persisted, current) => {
        const saved = persisted as Partial<TaskbarLayout> | undefined;
        const pinnedIds = sanitizeIds(saved?.pinnedIds);
        if (!pinnedIds) return current;
        const layout = reconcileBuiltIns(
          {
            pinnedIds,
            knownBuiltInIds: sanitizeIds(saved?.knownBuiltInIds) ?? [],
          },
          builtInAppIds,
        );
        return { ...current, ...layout };
      },
    },
  ),
);

/** Plain (non-hook) read — mirrors `installedAppsStore.ts`'s `isAppInstalled`. */
export function isAppPinned(id: string): boolean {
  return usePinnedAppsStore.getState().pinnedIds.includes(id);
}

/** Imperative equivalent of `usePinnedAppsStore((s) => s.pinApp)(id)`. */
export function pinApp(id: string): void {
  usePinnedAppsStore.getState().pinApp(id);
}

/** Imperative equivalent of `usePinnedAppsStore((s) => s.unpinApp)(id)`. */
export function unpinApp(id: string): void {
  usePinnedAppsStore.getState().unpinApp(id);
}

/** Imperative equivalent of `usePinnedAppsStore((s) => s.resetPinnedApps)()`. */
export function resetPinnedApps(): void {
  usePinnedAppsStore.getState().resetPinnedApps();
}

/**
 * `DataTransfer` type used for both "pin this app" (App Menu -> Dock) and
 * "move this tile" (Dock tile -> another Dock tile) drags (see
 * AppMenuEntry.tsx's and DockTile.tsx's `onDragStart`, and Dock.tsx's
 * `onDragOver`/`onDrop`). A custom, made-up type rather than a standard one
 * like `text/plain` so Dock's `onDragOver` can recognize (via
 * `dataTransfer.types.includes(...)`, readable mid-drag, unlike `getData`)
 * and accept ONLY this specific drag, ignoring any other native drag (e.g.
 * dragging selected text) that happens to pass over the dock.
 */
export const APP_DRAG_MIME_TYPE = "application/x-ai-os-app-id";
