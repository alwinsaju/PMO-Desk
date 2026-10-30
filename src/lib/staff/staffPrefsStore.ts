"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createServerBackedStorage } from "@/lib/persistedStorage";
import { DEFAULT_STAFF_PREFS, sanitizeStaffPrefs, type StaffPrefs } from "./staffPrefs";

interface StaffPrefsState extends StaffPrefs {
  /** Change the saved Staff settings with a pure function. */
  update: (change: (current: StaffPrefs) => StaffPrefs) => void;
}

const pick = (s: StaffPrefs): StaffPrefs => ({
  coverage: s.coverage,
  ptoAllowance: s.ptoAllowance,
  swaps: s.swaps,
  checklists: s.checklists,
  seenEmployees: s.seenEmployees,
  colourBlindSafe: s.colourBlindSafe,
});

/** Coverage rules, the leave allowance, swap requests and checklists. Kept on this computer like the rest. */
export const useStaffPrefs = create<StaffPrefsState>()(
  persist(
    (set) => ({
      ...DEFAULT_STAFF_PREFS,
      update: (change) => set((state) => change(pick(state))),
    }),
    {
      name: "staff-prefs",
      version: 1,
      storage: createJSONStorage(() => createServerBackedStorage("staff-prefs")),
      partialize: (state): StaffPrefs => pick(state),
      merge: (persisted, current) => ({ ...current, ...sanitizeStaffPrefs(persisted) }),
    },
  ),
);
