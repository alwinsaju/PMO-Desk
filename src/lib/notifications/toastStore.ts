"use client";

import { create } from "zustand";
import { focusModeActive } from "@/lib/focusModeStore";
import {
  clearHistory,
  dismissToast,
  EMPTY_TOAST_STATE,
  pushToast,
  type ToastInput,
  type ToastState,
} from "./toasts";

interface ToastStore extends ToastState {
  show: (input: ToastInput) => void;
  dismiss: (id: number) => void;
  clearHistory: () => void;
}

export const useToasts = create<ToastStore>()((set) => ({
  ...EMPTY_TOAST_STATE,
  show: (input) => set((state) => pushToast(state, input, Date.now(), focusModeActive())),
  dismiss: (id) => set((state) => dismissToast(state, id)),
  clearHistory: () => set((state) => clearHistory(state)),
}));

/** Show a toast from anywhere (components, stores, event handlers). */
export const toast = (input: ToastInput | string): void =>
  useToasts.getState().show(typeof input === "string" ? { message: input } : input);
