import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * No `"use client"` here, deliberately — same reasoning as
 * `installedAppsStore.ts` / `windowStore.ts` (see ARCHITECTURE.md's third
 * gotcha). This file imports only `zustand`/`zustand/middleware`, so it's
 * safe to evaluate anywhere; every actual consumer (Dock.tsx, AppMenu.tsx)
 * is already a Client Component in its own right.
 *
 * The dock's full pinned-app list has two parts: the 5 built-in apps
 * (Files, Notes, Browser, Tasks, App Store — see `pinnedApps.ts`'s
 * `builtInApps`), which are always present and NOT covered by this store,
 * plus a growable list of ADDITIONALLY-pinned App Store catalog entries,
 * which is what this store actually holds. There is deliberately no way to
 * remove one of the 5 built-ins this pass — Dock.tsx/AppMenu.tsx never
 * offer that action, and this store has no concept of them at all.
 *
 * Shared, persisted, and reactive the same way `installedAppsStore.ts` is:
 * every Dock/AppMenu instance reads/writes this same state, and it
 * survives a reload via `persist` + `localStorage`.
 *
 * Public contract:
 *   - `usePinnedAppsStore` — the store hook, for reactive reads, e.g.
 *     `usePinnedAppsStore((s) => s.pinnedIds)`.
 *   - `isAppPinned(id)` / `pinApp(id)` / `unpinApp(id)` — plain imperative
 *     equivalents (via `getState()`) for call sites that don't need
 *     reactivity, mirroring `installedAppsStore.ts`'s
 *     `isAppInstalled`/`installApp`/`uninstallApp`.
 *   - `APP_DRAG_MIME_TYPE` — the `DataTransfer` type AppMenuEntry.tsx sets
 *     in `onDragStart` and Dock.tsx checks for in `onDragOver`/reads in
 *     `onDrop`, so a drag started from the App Menu is only ever
 *     recognized as an "add to dock" gesture by that one drop target.
 */
export interface PinnedAppsStoreState {
  /** Additionally-pinned catalog app ids, beyond the 5 fixed built-ins.
   *  A plain array (not a keyed `Record` like `installedAppsStore`'s
   *  `installedIds`) because pin ORDER matters here — it's also the
   *  dock's left-to-right display order for these tiles — and the list is
   *  always small enough that an `includes` check costs nothing. */
  pinnedIds: string[];
  pinApp: (id: string) => void;
  unpinApp: (id: string) => void;
}

export const usePinnedAppsStore = create<PinnedAppsStoreState>()(
  persist(
    (set) => ({
      pinnedIds: [],

      pinApp: (id) =>
        set((state) =>
          state.pinnedIds.includes(id) ? state : { pinnedIds: [...state.pinnedIds, id] },
        ),

      unpinApp: (id) =>
        set((state) => {
          if (!state.pinnedIds.includes(id)) return state;
          return { pinnedIds: state.pinnedIds.filter((pinnedId) => pinnedId !== id) };
        }),
    }),
    {
      name: "taskbar:pinned-apps",
      partialize: (state) => ({ pinnedIds: state.pinnedIds }),
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

/**
 * `DataTransfer` type used for the App Menu -> Dock "pin this app" drag
 * gesture (see AppMenuEntry.tsx's `onDragStart` and Dock.tsx's
 * `onDragOver`/`onDrop`). A custom, made-up type rather than a standard one
 * like `text/plain` so Dock's `onDragOver` can recognize (via
 * `dataTransfer.types.includes(...)`, readable mid-drag, unlike `getData`)
 * and accept ONLY this specific drag, ignoring any other native drag (e.g.
 * dragging selected text) that happens to pass over the dock.
 */
export const APP_DRAG_MIME_TYPE = "application/x-ai-os-app-id";
