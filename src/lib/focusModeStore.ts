"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";
import { DEFAULT_FOCUS_MINUTES, focusEnd, isFocusActive } from "./focusMode";

interface FocusModeState {
  /** Epoch ms when focus mode ends; null = off. */
  until: number | null;
  start: (minutes?: number) => void;
  stop: () => void;
}

export const useFocusMode = create<FocusModeState>()((set) => ({
  until: null,
  start: (minutes = DEFAULT_FOCUS_MINUTES) =>
    set({ until: focusEnd(Date.now(), minutes) }),
  stop: () => set({ until: null }),
}));

/** Is focus mode on right now (non-reactive; for code outside React). */
export const focusModeActive = (): boolean =>
  isFocusActive(useFocusMode.getState().until, Date.now());

/** Reactive: true while focus mode is on, and flips back by itself when the time is up. */
export function useFocusActive(): boolean {
  const until = useFocusMode((s) => s.until);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null) return;
    setNow(Date.now());
    const wait = Math.max(0, until - Date.now()) + 50;
    const id = setTimeout(() => setNow(Date.now()), wait);
    return () => clearTimeout(id);
  }, [until]);
  return isFocusActive(until, now);
}
