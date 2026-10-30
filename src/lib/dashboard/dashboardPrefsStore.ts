"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createServerBackedStorage } from "@/lib/persistedStorage";
import {
  DEFAULT_DASHBOARD_PREFS,
  sanitizeDashboardPrefs,
  type DashboardPrefs,
} from "./dashboardPrefs";

interface DashboardPrefsState extends DashboardPrefs {
  update: (change: (current: DashboardPrefs) => DashboardPrefs) => void;
}

const pick = (s: DashboardPrefs): DashboardPrefs => ({
  layout: s.layout,
  layouts: s.layouts,
  briefingEnabled: s.briefingEnabled,
  briefingTime: s.briefingTime,
  briefingDay: s.briefingDay,
});

/** The Dashboard layout, saved layouts and briefing settings, kept on this computer. */
export const useDashboardPrefs = create<DashboardPrefsState>()(
  persist(
    (set) => ({
      ...DEFAULT_DASHBOARD_PREFS,
      update: (change) => set((state) => change(pick(state))),
    }),
    {
      name: "dashboard-prefs",
      version: 1,
      storage: createJSONStorage(() => createServerBackedStorage("dashboard-prefs")),
      partialize: (state): DashboardPrefs => pick(state),
      merge: (persisted, current) => ({
        ...current,
        ...sanitizeDashboardPrefs(persisted),
      }),
    },
  ),
);
