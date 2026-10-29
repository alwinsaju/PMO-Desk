"use client";

import { create } from "zustand";
import type { StepId } from "./firstTimeSteps";

/**
 * Whether the first-time setup page is showing. It opens by itself once after a fresh
 * install (the installer's marker), and from the Setup dialog in `guides` mode, which
 * shows only the Power Automate walkthrough and marks nothing as finished.
 */
interface FirstTimeUiState {
  open: boolean;
  mode: "first-time" | "guides";
  startAt: StepId;
  /** Opens the full page (after a fresh install). */
  openFirstTime: () => void;
  /** Opens just the flow guides. */
  openGuides: () => void;
  close: () => void;
}

export const useFirstTimeUi = create<FirstTimeUiState>()((set) => ({
  open: false,
  mode: "first-time",
  startAt: "welcome",
  openFirstTime: () => set({ open: true, mode: "first-time", startAt: "welcome" }),
  openGuides: () => set({ open: true, mode: "guides", startAt: "flows" }),
  close: () => set({ open: false }),
}));
