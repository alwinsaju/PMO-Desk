"use client";

// This file has no component of its own, but needs "use client" anyway —
// same reasoning as appCatalog.ts (see ARCHITECTURE.md's third gotcha):
// `runAppPrimaryAction` below both renders JSX (an icon element) and reaches
// into `appIcons`, which holds live Phosphor icon COMPONENT VALUES. Keeping
// the directive here means this stays a safe import for ANY caller — not
// just the ones that happen to already cross a client boundary first.

import { useWindowStore } from "@/components/window-manager";
import { pinApp, unpinApp } from "@/components/taskbar/pinnedAppsStore";
import { toast } from "@/lib/notifications/toastStore";
import { appIcons } from "./appCatalog";
import { installApp, isAppInstalled, uninstallApp } from "./installedAppsStore";
import { demoOpenToast, installedToast, removedToast } from "./installFlow";
import type { AppListing } from "./types";

/**
 * The single, shared "primary action" for an App Store catalog entry —
 * what happens when its Install/Open control is used. Factored out of
 * AppStoreApp.tsx (where it used to live as `handlePrimaryAction`) so the
 * App Menu (`taskbar/AppMenu.tsx`) can open/toggle a catalog app exactly
 * the same way the App Store's own AppCard button does, instead of
 * reimplementing this branching logic a second time.
 *
 * A plain, non-hook function — reads/writes `installedAppsStore` and
 * `windowStore` imperatively via `getState()`, the same pattern
 * `installedAppsStore.ts`'s own `isAppInstalled`/`installApp`/
 * `uninstallApp` helpers use — so it can be called equally from a React
 * event handler in either AppStoreApp.tsx or AppMenu.tsx without either
 * needing to plumb the relevant store actions through as props.
 *
 * For a REAL entry (has `url`) that's already installed: opens the real
 * "web-app" window (see appCatalog.ts's "Real web apps" section). A fictional
 * (demo) entry that is already installed has nothing to open, so using it only
 * explains that; it is never uninstalled by "Open" (see `removeApp` and
 * `runStoreAction` for the explicit Remove). Not installed: installs (via
 * `completeInstall`: dock pin + confirmation toast).
 */
export function runAppPrimaryAction(app: AppListing): void {
  const installed = isAppInstalled(app.id);

  if (installed && app.url) {
    const IconGlyph = appIcons[app.icon];
    useWindowStore.getState().openWindow("web-app", {
      title: app.name,
      icon: <IconGlyph />,
      url: app.url,
      embeddable: app.embeddable,
    });
    return;
  }

  if (installed) {
    toast(demoOpenToast(app));
  } else {
    completeInstall(app);
  }
}

/** Takes an installed app off the dock and out of the installed list, with an Undo. */
export function removeApp(app: AppListing): void {
  uninstallApp(app.id);
  unpinApp(app.id);
  toast(removedToast(app, () => completeInstall(app)));
}

/** What the App Store's own button does: like `runAppPrimaryAction`, but an installed demo app's
 *  button says Remove and removes it. */
export function runStoreAction(app: AppListing): void {
  if (isAppInstalled(app.id) && !app.url) removeApp(app);
  else runAppPrimaryAction(app);
}

/** Installs, puts the app on the dock and confirms it with a toast. The card's
 *  "Installing" state (AppCard.tsx) runs before this is called. */
export function completeInstall(app: AppListing): void {
  installApp(app.id);
  pinApp(app.id);
  toast(installedToast(app, () => runAppPrimaryAction(app)));
}
