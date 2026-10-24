"use client";

import { create } from "zustand";

/**
 * Count badges on dock tiles, keyed by app id (the same ids as `builtInApps`).
 * Not persisted: a badge is live state some feature pushes (today the PMO
 * reminder poller, see usePmoReminders.ts) and the dock only displays. A tile
 * with no entry, or 0, shows no badge. Kept apart from `pinnedAppsStore` so
 * badge churn never touches the persisted, user-edited taskbar layout.
 */
interface DockBadgeState {
  badges: Record<string, number>;
  setBadge: (appId: string, count: number) => void;
}

export const useDockBadgeStore = create<DockBadgeState>()((set) => ({
  badges: {},
  setBadge: (appId, count) =>
    set((state) => {
      const next = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
      return (state.badges[appId] ?? 0) === next
        ? state
        : { badges: { ...state.badges, [appId]: next } };
    }),
}));
