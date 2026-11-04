"use client";

import { useWindowStore } from "@/components/window-manager";
import { usePreferences } from "@/lib/preferences/preferencesStore";
import { launchBuiltInApp } from "./launchBuiltInApp";
import { builtInApps, toolApps } from "./pinnedApps";
import { appsToRestore, sameIds, sessionAppIds } from "./sessionApps";

/** Apps launch can reopen: the same set `launchBuiltInApp` opens. */
const restorable: ReadonlySet<string> = new Set(
  [...builtInApps, ...toolApps].map((app) => app.id),
);

let started = false;

/** Remember which apps are open (only while the setting is on). Writing the list is cheap:
 *  nothing is saved unless it changed, and the preferences store debounces the file write. */
function remember(): void {
  const prefs = usePreferences.getState();
  if (!prefs.reopenLastApps) return;
  const ids = sessionAppIds(useWindowStore.getState().windows, restorable);
  if (!sameIds(ids, prefs.lastOpenApps)) prefs.rememberOpenApps(ids);
}

function restoreThenTrack(): void {
  const prefs = usePreferences.getState();
  if (prefs.reopenLastApps) {
    const open = new Set(
      Object.values(useWindowStore.getState().windows).map((w) => w.appId),
    );
    // The normal open path, bottom to top, so the window that was in front ends up in front.
    for (const id of appsToRestore(prefs.lastOpenApps, restorable, open)) {
      launchBuiltInApp(id);
    }
  }
  // Tracking starts only now: before this, an empty desktop must not overwrite the saved list.
  useWindowStore.subscribe(remember);
  usePreferences.subscribe((state, previous) => {
    if (state.reopenLastApps && !previous.reopenLastApps) remember();
  });
  remember();
}

/**
 * Once per page load: when the saved preferences have arrived, reopen last session's apps
 * (if the setting is on), then keep the remembered list up to date. Safe to call again.
 * The preferences load from the app's server a moment after start, so this waits for them
 * rather than reading the defaults.
 */
export function startSessionRestore(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  if (usePreferences.persist.hasHydrated()) restoreThenTrack();
  else usePreferences.persist.onFinishHydration(restoreThenTrack);
}
