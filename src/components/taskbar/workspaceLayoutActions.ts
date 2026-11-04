"use client";

import { useWindowStore } from "@/components/window-manager";
import { windowClampConfig } from "@/components/window-manager/windowStore";
import { usePreferences } from "@/lib/preferences/preferencesStore";
import type { WorkspaceLayout } from "@/lib/preferences/schema";
import { windowDefaults } from "@/lib/tokens";
import { launchBuiltInApp } from "./launchBuiltInApp";
import { builtInApps, toolApps } from "./pinnedApps";
import {
  captureLayoutWindows,
  deleteWorkspaceLayout,
  describeRestore,
  planLayoutRestore,
  renameWorkspaceLayout,
  saveWorkspaceLayout,
  type LayoutsResult,
} from "./workspaceLayouts";

/** Apps a layout can open: the same set `launchBuiltInApp` opens. */
const restorable: ReadonlySet<string> = new Set(
  [...builtInApps, ...toolApps].map((app) => app.id),
);

/** How many apps a layout saved from these windows would hold. */
export function layoutSizeOf(
  windows: Parameters<typeof captureLayoutWindows>[0],
): number {
  return captureLayoutWindows(windows, restorable).length;
}

/** Save the desktop as it is now under `name`. One preferences write, from a click. */
export function saveCurrentLayout(name: string): LayoutsResult {
  const prefs = usePreferences.getState();
  const result = saveWorkspaceLayout(
    prefs.workspaceLayouts,
    name,
    captureLayoutWindows(useWindowStore.getState().windows, restorable),
  );
  if (result.ok) prefs.setWorkspaceLayouts(result.layouts);
  return result;
}

export function renameLayout(from: string, name: string): LayoutsResult {
  const prefs = usePreferences.getState();
  const result = renameWorkspaceLayout(prefs.workspaceLayouts, from, name);
  if (result.ok) prefs.setWorkspaceLayouts(result.layouts);
  return result;
}

export function deleteLayout(name: string): void {
  const prefs = usePreferences.getState();
  prefs.setWorkspaceLayouts(deleteWorkspaceLayout(prefs.workspaceLayouts, name));
}

/**
 * Bring a saved layout back: open its apps that are not open, move the ones that are, and put
 * them in front in the saved stacking order, every rectangle fitted to the current screen.
 * Nothing is closed; windows the layout lacks stay open unless `minimizeOthers` (they are then
 * minimised, still open). Returns one line saying what happened.
 */
export function restoreLayout(layout: WorkspaceLayout, minimizeOthers: boolean): string {
  const plan = planLayoutRestore({
    layout: layout.windows,
    windows: useWindowStore.getState().windows,
    restorable,
    viewport:
      typeof window !== "undefined"
        ? { width: window.innerWidth, height: window.innerHeight }
        : null,
    fit: windowClampConfig,
    minSize: windowDefaults.minSize,
  });
  let opened = 0;
  let moved = 0;
  const placements: { id: string; geometry: (typeof plan.steps)[number]["geometry"] }[] =
    [];
  for (const step of plan.steps) {
    let id = step.windowId;
    if (id) moved++;
    else {
      id = launchBuiltInApp(step.appId, step.geometry) ?? null;
      if (id) opened++;
    }
    if (id) placements.push({ id, geometry: step.geometry });
  }
  useWindowStore.getState().placeWindows(placements, minimizeOthers);
  return describeRestore({
    opened,
    moved,
    skipped: plan.skipped.length,
    untouched: plan.untouched,
    minimized: minimizeOthers,
  });
}
