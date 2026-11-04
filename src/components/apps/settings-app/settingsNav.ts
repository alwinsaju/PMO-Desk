"use client";

import { create } from "zustand";
import { useWindowStore } from "@/components/window-manager";

export type SettingsTab =
  | "general"
  | "notifications"
  | "shortcuts"
  | "accessibility"
  | "data"
  | "activity"
  | "help"
  | "about";

interface SettingsNav {
  /** The tab the window should show next (consumed by SettingsApp). */
  request: { id: number; tab: SettingsTab; activitySince?: string } | null;
  clear: (id: number) => void;
}

let counter = 0;

export const useSettingsNav = create<SettingsNav>()((set) => ({
  request: null,
  clear: (id) => set((s) => (s.request?.id === id ? { request: null } : s)),
}));

/** Open (or raise) the Settings window, optionally on one tab. `activitySince` (an ISO time) opens
 *  Activity showing only the entries after that time. */
export function openSettings(
  tab: SettingsTab = "general",
  options: { activitySince?: string } = {},
): void {
  useSettingsNav.setState({
    request: { id: ++counter, tab, activitySince: options.activitySince },
  });
  const store = useWindowStore.getState();
  const existing = Object.values(store.windows).find((w) => w.appId === "settings");
  if (existing) store.restoreWindow(existing.id);
  else store.openWindow("settings", { title: "Settings" });
}
