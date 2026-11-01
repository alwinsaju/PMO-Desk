"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { pushRecent, sanitizeRecents } from "@/lib/search/recentSearches";
import type { SearchItem } from "@/lib/search/searchIndex";

/** The last five things opened from Ctrl+K. Kept in this browser's localStorage only:
 *  it is a convenience list, not data worth syncing. */
interface RecentSearchState {
  recents: SearchItem[];
  remember: (item: SearchItem) => void;
  clear: () => void;
}

export const useRecentSearches = create<RecentSearchState>()(
  persist(
    (set) => ({
      recents: [],
      remember: (item) => set((s) => ({ recents: pushRecent(s.recents, item) })),
      clear: () => set({ recents: [] }),
    }),
    {
      name: "search:recents",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      merge: (persisted, current) => ({
        ...current,
        recents: sanitizeRecents((persisted as { recents?: unknown } | null)?.recents),
      }),
    },
  ),
);
