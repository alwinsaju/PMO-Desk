"use client";

import { create } from "zustand";

/** Whether the "Workspace layouts" dialog is open. The Quick settings row opens it from here;
 *  the dialog itself is mounted once (desktop/SettingsMenu.tsx), so closing the menu does not close it. */
interface WorkspaceLayoutsUiState {
  open: boolean;
  openLayouts: () => void;
  closeLayouts: () => void;
}

export const useWorkspaceLayoutsUi = create<WorkspaceLayoutsUiState>()((set) => ({
  open: false,
  openLayouts: () => set({ open: true }),
  closeLayouts: () => set({ open: false }),
}));
