"use client";

import { create } from "zustand";

/** How many things need a person, by source. The PMO count and the pending leave are read where they live;
 *  the Tasks watcher writes `tasks` and the PMO toolkit's watcher writes `registers`. `NeedsYouBadge` adds
 *  them up for the dock and the tray. */
interface NeedsYouState {
  tasks: number;
  registers: number;
  setTasks: (count: number) => void;
  setRegisters: (count: number) => void;
}

export const useNeedsYou = create<NeedsYouState>()((set) => ({
  tasks: 0,
  registers: 0,
  setTasks: (tasks) => set((s) => (s.tasks === tasks ? s : { tasks })),
  setRegisters: (registers) =>
    set((s) => (s.registers === registers ? s : { registers })),
}));
