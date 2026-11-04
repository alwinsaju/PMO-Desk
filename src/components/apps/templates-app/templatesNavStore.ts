"use client";

import { create } from "zustand";

/** A request to show one template (the dock's Recent list sends it). TemplatesApp consumes
 *  it, whether the window was already open or has just been opened. */
export interface TemplatesOpenRequest {
  id: number;
  templateId: string;
}

interface TemplatesNavState {
  openRequest: TemplatesOpenRequest | null;
  requestOpen: (templateId: string) => void;
  clearOpenRequest: (id: number) => void;
}

let counter = 0;

export const useTemplatesNav = create<TemplatesNavState>()((set) => ({
  openRequest: null,
  requestOpen: (templateId) => set({ openRequest: { templateId, id: ++counter } }),
  clearOpenRequest: (id) =>
    set((state) => (state.openRequest?.id === id ? { openRequest: null } : state)),
}));
