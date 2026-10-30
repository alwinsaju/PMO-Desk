"use client";

import { create } from "zustand";

/** The guided tour: which step shows. The overlay lives in the desktop shell. */
interface TourState {
  open: boolean;
  index: number;
  start: () => void;
  go: (index: number) => void;
  close: () => void;
}

export const useTour = create<TourState>()((set) => ({
  open: false,
  index: 0,
  start: () => set({ open: true, index: 0 }),
  go: (index) => set({ index }),
  close: () => set({ open: false }),
}));
