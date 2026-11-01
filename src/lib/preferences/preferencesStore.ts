"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createServerBackedStorage } from "@/lib/persistedStorage";
import {
  DEFAULT_PREFERENCES,
  appendCommandLog,
  rememberWindowRect,
  removeView,
  saveView,
  sanitizePreferences,
  toggleFavourite,
  type CommandLogEntry,
  type ConfirmKey,
  type DashboardPeriod,
  type Preferences,
  type SavedView,
  type WindowRect,
} from "./schema";

interface PreferencesState extends Preferences {
  setDashboardPeriod: (period: DashboardPeriod) => void;
  setInstantUnlock: (on: boolean) => void;
  setLockSummary: (on: boolean) => void;
  rememberWindow: (appId: string, rect: WindowRect) => void;
  setConfirmAction: (key: ConfirmKey, ask: boolean) => void;
  setReducedMotion: (on: boolean) => void;
  setHighContrast: (on: boolean) => void;
  setDesktopWidget: (on: boolean) => void;
  setAutoRecur: (on: boolean) => void;
  saveView: (view: SavedView) => void;
  removeView: (id: string) => void;
  logCommand: (entry: CommandLogEntry) => void;
  clearCommandLog: () => void;
  toggleFavourite: (prompt: string) => void;
}

/**
 * Small UI preferences that should survive a restart (and a change of port): the
 * Dashboard period, the lock-screen shortcut, where each app's window was last.
 * Saved through the same server-backed storage as the taskbar layout; what comes
 * back is passed through `sanitizePreferences`, so a bad file never breaks the app.
 */
export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      ...DEFAULT_PREFERENCES,
      setDashboardPeriod: (dashboardPeriod) => set({ dashboardPeriod }),
      setInstantUnlock: (instantUnlock) => set({ instantUnlock }),
      setLockSummary: (lockSummary) => set({ lockSummary }),
      rememberWindow: (appId, rect) =>
        set((state) => ({
          windowRects: rememberWindowRect(state.windowRects, appId, rect),
        })),
      setConfirmAction: (key, ask) =>
        set((state) => ({ confirmActions: { ...state.confirmActions, [key]: ask } })),
      setReducedMotion: (reducedMotion) => set({ reducedMotion }),
      setHighContrast: (highContrast) => set({ highContrast }),
      setDesktopWidget: (desktopWidget) => set({ desktopWidget }),
      setAutoRecur: (autoRecur) => set({ autoRecur }),
      saveView: (view) =>
        set((state) => ({ savedViews: saveView(state.savedViews, view) })),
      removeView: (id) =>
        set((state) => ({ savedViews: removeView(state.savedViews, id) })),
      logCommand: (entry) =>
        set((state) => ({ commandLog: appendCommandLog(state.commandLog, entry) })),
      clearCommandLog: () => set({ commandLog: [] }),
      toggleFavourite: (prompt) =>
        set((state) => ({ favourites: toggleFavourite(state.favourites, prompt) })),
    }),
    {
      name: "preferences",
      version: 1,
      storage: createJSONStorage(() => createServerBackedStorage("preferences")),
      partialize: (state): Preferences => ({
        dashboardPeriod: state.dashboardPeriod,
        instantUnlock: state.instantUnlock,
        lockSummary: state.lockSummary,
        windowRects: state.windowRects,
        confirmActions: state.confirmActions,
        reducedMotion: state.reducedMotion,
        highContrast: state.highContrast,
        desktopWidget: state.desktopWidget,
        autoRecur: state.autoRecur,
        savedViews: state.savedViews,
        commandLog: state.commandLog,
        favourites: state.favourites,
      }),
      merge: (persisted, current) => ({ ...current, ...sanitizePreferences(persisted) }),
    },
  ),
);

/** Add a command to the history from anywhere (the command bar). */
export const logCommand = (entry: CommandLogEntry): void =>
  usePreferences.getState().logCommand(entry);
