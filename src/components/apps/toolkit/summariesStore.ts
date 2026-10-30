"use client";

import { create } from "zustand";
import type { RegisterSummary } from "@/lib/registers/alerts";

/** The latest open, late and soon counts of every PMO tool, kept fresh by the shell's watcher. */
interface SummariesState {
  summaries: Record<string, RegisterSummary>;
  loaded: boolean;
  set: (list: readonly RegisterSummary[]) => void;
}

export const useRegisterSummaries = create<SummariesState>()((set) => ({
  summaries: {},
  loaded: false,
  set: (list) =>
    set({ summaries: Object.fromEntries(list.map((s) => [s.id, s])), loaded: true }),
}));
