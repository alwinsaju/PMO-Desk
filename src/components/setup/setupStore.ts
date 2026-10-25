"use client";

import { create } from "zustand";

/** Whether the setup dialog is open. The launch check and the settings menu row
 *  both open it from here, so there is one dialog and one source of truth. */
interface SetupUiState {
  open: boolean;
  openSetup: () => void;
  closeSetup: () => void;
}

export const useSetupUi = create<SetupUiState>()((set) => ({
  open: false,
  openSetup: () => set({ open: true }),
  closeSetup: () => set({ open: false }),
}));
