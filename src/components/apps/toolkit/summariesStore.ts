"use client";

import { create } from "zustand";
import type { RegisterSummary } from "@/lib/registers/alerts";

/** The latest open, late and soon counts of every PMO tool, kept fresh by the shell's watcher. */
interface SummariesState {
  summaries: Record<string, RegisterSummary>;
  loaded: boolean;
  set: (list: readonly RegisterSummary[]) => void;
  /** One tool's counts after a save in the open tool, so the badge does not wait for the next poll. */
  setOne: (summary: RegisterSummary) => void;
}

export const useRegisterSummaries = create<SummariesState>()((set) => ({
  summaries: {},
  loaded: false,
  set: (list) =>
    set({ summaries: Object.fromEntries(list.map((s) => [s.id, s])), loaded: true }),
  setOne: (summary) =>
    set((state) => ({ summaries: { ...state.summaries, [summary.id]: summary } })),
}));
