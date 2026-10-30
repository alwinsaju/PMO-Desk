"use client";

import { create } from "zustand";

export interface ActionRequest {
  title: string;
  /** What exactly will happen; line breaks are kept. */
  detail: string;
  confirmLabel: string;
}

interface Pending extends ActionRequest {
  id: number;
}

interface BarActionState {
  pending: Pending | null;
  ask: (request: ActionRequest) => Promise<boolean>;
  answer: (ok: boolean) => void;
}

let counter = 0;
let resolver: ((ok: boolean) => void) | null = null;

/**
 * The confirmation card in front of a command-bar action ("Mark this to-do done?").
 * `ask` resolves true on Confirm and false on Cancel or Esc; a second request replaces
 * the first (which counts as cancelled). Nothing happens until a person answers.
 */
export const useBarAction = create<BarActionState>()((set) => ({
  pending: null,
  ask: (request) =>
    new Promise<boolean>((resolve) => {
      resolver?.(false);
      resolver = resolve;
      set({ pending: { ...request, id: ++counter } });
    }),
  answer: (ok) => {
    const done = resolver;
    resolver = null;
    set({ pending: null });
    done?.(ok);
  },
}));
