"use client";

import { create } from "zustand";

interface TitleSuffixState {
  /** Text shown in brackets after every window of an app, by app id. */
  suffixes: Record<string, string>;
  setAppTitleSuffix: (appId: string, suffix: string | null) => void;
}

/** Lets an app (or its background poller) add live status to its windows' titles. */
export const useTitleSuffixes = create<TitleSuffixState>()((set) => ({
  suffixes: {},
  setAppTitleSuffix: (appId, suffix) =>
    set((state) => {
      if ((state.suffixes[appId] ?? null) === suffix) return state;
      const next = { ...state.suffixes };
      if (suffix) next[appId] = suffix;
      else delete next[appId];
      return { suffixes: next };
    }),
}));
