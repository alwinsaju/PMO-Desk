"use client";

// This file has no component of its own, but needs "use client" anyway —
// same reasoning as appCatalog.ts (see ARCHITECTURE.md's third gotcha):
// `runAppPrimaryAction` below both renders JSX (an icon element) and reaches
// into `appIcons`, which holds live Phosphor icon COMPONENT VALUES. Keeping
// the directive here means this stays a safe import for ANY caller — not
// just the ones that happen to already cross a client boundary first.

import { useWindowStore } from "@/components/window-manager";
import { appIcons } from "./appCatalog";
import { installApp, isAppInstalled, uninstallApp } from "./installedAppsStore";
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
 * "web-app" window (see appCatalog.ts's "Real web apps" section). In every
 * other case — not installed yet, OR a fictional entry with no `url` at
 * all, installed or not — just flips shared install state: installs if not
 * installed, uninstalls if already installed. That second branch is
 * unchanged, pre-existing behavior for fictional entries (clicking "Open"
 * on an already-installed fictional app has always uninstalled it right
 * back off, since there's no real window content behind it either way) —
 * not something introduced here, and deliberately not special-cased any
 * differently for the App Menu.
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

  if (installed) uninstallApp(app.id);
  else installApp(app.id);
}
