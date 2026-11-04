"use client";

import { create } from "zustand";
import {
  isDockRecentApp,
  loadDockRecents,
  pushDockRecent,
  recentsStorage,
  saveDockRecents,
  syncDockRecents,
  type DockRecent,
  type DockRecentsMap,
} from "./dockRecents.ts";

interface DockRecentsState {
  recents: DockRecentsMap;
  /** An item was just opened in `appId`: it becomes the newest. */
  remember: (appId: string, item: DockRecent) => void;
  /** The app now knows what exists: drop vanished items, refresh renamed titles. */
  sync: (appId: string, lookup: (id: string) => string | undefined) => void;
}

/** Recent to-dos and templates for the dock menu. Kept in this browser's localStorage
 *  only. Read once when the store is created (on the server that gives none, and the
 *  menu only renders when opened, so nothing hydrates from it). */
export const useDockRecents = create<DockRecentsState>()((set, get) => {
  const commit = (recents: DockRecentsMap) => {
    set({ recents });
    saveDockRecents(recentsStorage(), recents);
  };
  return {
    recents: loadDockRecents(recentsStorage()),
    remember: (appId, item) => {
      if (!isDockRecentApp(appId)) return;
      const { recents } = get();
      commit({ ...recents, [appId]: pushDockRecent(recents[appId] ?? [], item) });
    },
    sync: (appId, lookup) => {
      const { recents } = get();
      const list = recents[appId];
      if (!list) return;
      const next = syncDockRecents(list, lookup);
      if (next === list) return;
      const rest = { ...recents };
      if (next.length > 0) rest[appId] = [...next];
      else delete rest[appId];
      commit(rest);
    },
  };
});
