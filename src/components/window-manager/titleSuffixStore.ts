"use client";

import { useEffect } from "react";
import { create } from "zustand";

interface TitleSuffixState {
  /** Text shown after every window of an app, by app id (e.g. "3 need attention"). */
  suffixes: Record<string, string>;
  setAppTitleSuffix: (appId: string, suffix: string | null) => void;
  /** Where the user is inside one window (e.g. the open tab), by window id. */
  contexts: Record<string, string>;
  setWindowContext: (windowId: string, context: string | null) => void;
}

function withEntry(
  record: Record<string, string>,
  key: string,
  value: string | null,
): Record<string, string> | null {
  if ((record[key] ?? null) === value) return null;
  const next = { ...record };
  if (value) next[key] = value;
  else delete next[key];
  return next;
}

/** Lets an app (or its background poller) add live status to its windows' titles, and a
 *  window say where the user is inside it. */
export const useTitleSuffixes = create<TitleSuffixState>()((set) => ({
  suffixes: {},
  setAppTitleSuffix: (appId, suffix) =>
    set((state) => {
      const next = withEntry(state.suffixes, appId, suffix);
      return next ? { suffixes: next } : state;
    }),
  contexts: {},
  setWindowContext: (windowId, context) =>
    set((state) => {
      const next = withEntry(state.contexts, windowId, context);
      return next ? { contexts: next } : state;
    }),
}));

/** Shows `context` after the app name in this window's title bar ("Staff Management ·
 *  Shift roster") for as long as the calling component is mounted. Pass null for none. */
export function useWindowContext(windowId: string, context: string | null): void {
  useEffect(() => {
    useTitleSuffixes.getState().setWindowContext(windowId, context);
    return () => useTitleSuffixes.getState().setWindowContext(windowId, null);
  }, [windowId, context]);
}
