"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createServerBackedStorage } from "@/lib/persistedStorage";
import {
  DEFAULT_PLATFORM_PREFS,
  sanitizePlatformPrefs,
  type PlatformPrefs,
} from "./platformPrefs";

interface PlatformPrefsState extends PlatformPrefs {
  /** Change the saved settings with a pure function. */
  update: (change: (current: PlatformPrefs) => PlatformPrefs) => void;
}

const pick = (s: PlatformPrefs): PlatformPrefs => ({
  profile: s.profile,
  lastSeenVersion: s.lastSeenVersion,
  tourDone: s.tourDone,
  sampleLoaded: s.sampleLoaded,
  updates: s.updates,
});

export const usePlatformPrefs = create<PlatformPrefsState>()(
  persist(
    (set) => ({
      ...DEFAULT_PLATFORM_PREFS,
      update: (change) => set((state) => change(pick(state))),
    }),
    {
      name: "platform-prefs",
      version: 1,
      storage: createJSONStorage(() => createServerBackedStorage("platform-prefs")),
      partialize: (state): PlatformPrefs => pick(state),
      merge: (persisted, current) => ({
        ...current,
        ...sanitizePlatformPrefs(persisted),
      }),
    },
  ),
);
