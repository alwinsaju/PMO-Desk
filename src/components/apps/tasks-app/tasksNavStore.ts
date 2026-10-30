"use client";

import { create } from "zustand";

/** The command bar asked for a task's Run form ("prepare this week's aging report"). */
export interface RunRequest {
  id: number;
  taskId: string;
  /** Epoch ms when it was made. */
  at: number;
}

/** An unconsumed request this old is ignored (the engine may have been down); the Run
 *  form should not pop up minutes later out of nowhere. */
export const RUN_REQUEST_TTL_MS = 60_000;

export const isFreshRunRequest = (
  request: RunRequest,
  now: number = Date.now(),
): boolean => now - request.at <= RUN_REQUEST_TTL_MS;

interface TasksNavState {
  runRequest: RunRequest | null;
  requestRun: (taskId: string) => void;
  clearRunRequest: (id: number) => void;
  /** The Dashboard asked to see a task's details (its last run and log). */
  detailRequest: RunRequest | null;
  requestDetail: (taskId: string) => void;
  clearDetailRequest: (id: number) => void;
}

let counter = 0;

/**
 * A request to show one task's Run form. TasksApp (highlighting the card) and that
 * task's TaskActions (opening the form) consume it, whether the window was already
 * open or has just been opened. It only opens the form: a person still adds the
 * files and presses Run.
 */
export const useTasksNav = create<TasksNavState>()((set) => ({
  runRequest: null,
  requestRun: (taskId) => set({ runRequest: { id: ++counter, taskId, at: Date.now() } }),
  clearRunRequest: (id) =>
    set((state) => (state.runRequest?.id === id ? { runRequest: null } : state)),
  detailRequest: null,
  requestDetail: (taskId) =>
    set({ detailRequest: { id: ++counter, taskId, at: Date.now() } }),
  clearDetailRequest: (id) =>
    set((state) => (state.detailRequest?.id === id ? { detailRequest: null } : state)),
}));
