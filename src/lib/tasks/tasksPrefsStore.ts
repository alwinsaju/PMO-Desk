"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createServerBackedStorage } from "@/lib/persistedStorage";
import { DEFAULT_TASKS_PREFS, sanitizeTasksPrefs, type TasksPrefs } from "./tasksPrefs";

interface TasksPrefsState extends TasksPrefs {
  /** Change the saved Tasks preferences with a pure function. */
  update: (change: (current: TasksPrefs) => TasksPrefs) => void;
}

const pick = (s: TasksPrefs): TasksPrefs => ({
  schedules: s.schedules,
  handled: s.handled,
  checkedAt: s.checkedAt,
  snapshots: s.snapshots,
  recipients: s.recipients,
  queue: s.queue,
  notifyOnFinish: s.notifyOnFinish,
  lastFiles: s.lastFiles,
});

/** Schedules, the send-later queue, run snapshots and small memories for the Tasks app. Kept apart from
 *  the general preferences because the snapshots can be large. */
export const useTasksPrefs = create<TasksPrefsState>()(
  persist(
    (set) => ({
      ...DEFAULT_TASKS_PREFS,
      update: (change) => set((state) => change(pick(state))),
    }),
    {
      name: "tasks-prefs",
      version: 1,
      storage: createJSONStorage(() => createServerBackedStorage("tasks-prefs")),
      partialize: (state): TasksPrefs => pick(state),
      merge: (persisted, current) => ({ ...current, ...sanitizeTasksPrefs(persisted) }),
    },
  ),
);
