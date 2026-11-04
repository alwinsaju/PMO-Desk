"use client";

import { useWindowStore } from "@/components/window-manager";
import { planOpenApp } from "@/lib/ai-runtime/windowIntent";
import { builtInApps, toolApps } from "./pinnedApps";

/** Opens a new window for a built-in app — the one path the dock tiles and
 *  the AI command bar share. Returns the window id, or undefined for an
 *  unknown app id. `geometry` opens it at that rectangle instead of the usual place
 *  (restoring a saved layout). */
export function launchBuiltInApp(
  appId: string,
  geometry?: {
    position: { x: number; y: number };
    size: { width: number; height: number };
  },
): string | undefined {
  const app = [...builtInApps, ...toolApps].find((a) => a.id === appId);
  if (!app) return undefined;
  const IconGlyph = app.icon;
  return useWindowStore.getState().openWindow(app.id, {
    title: app.title,
    icon: <IconGlyph />,
    ...(geometry ? { position: geometry.position, size: geometry.size } : {}),
  });
}

/** Raises the app's window if one is open (restoring it if minimised), else opens one. */
export function openOrFocusBuiltInApp(appId: string): string | undefined {
  const store = useWindowStore.getState();
  const plan = planOpenApp(appId, Object.values(store.windows));
  if (plan.type === "focus") {
    store.restoreWindow(plan.windowId);
    return plan.windowId;
  }
  return launchBuiltInApp(appId);
}
