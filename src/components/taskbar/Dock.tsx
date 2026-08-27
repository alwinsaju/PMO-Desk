"use client";

import { PlusIcon } from "@phosphor-icons/react";
import { IconButton, Tooltip } from "@/components/ui";
import { useWindowStore } from "@/components/window-manager";
import { DockTile } from "./DockTile";
import { pinnedApps, pinnedAppIcons, type PinnedApp } from "./pinnedApps";

// "app-store" is always present — it's part of the static list above, and
// this workstream owns keeping the two in sync.
const appStoreApp = pinnedApps.find((app) => app.id === "app-store")!;

/**
 * Top-centered floating pill dock — the app launcher/taskbar. A plain
 * launcher only: the command bar, AI cursor, and presence avatars are a
 * separate, later workstream (the AI Agent Layer) and don't belong here.
 *
 * Frosted/translucent chrome at the `z-chrome` layer, mounted as a sibling
 * of `<WindowManager />` from Desktop.tsx. Renders one `DockTile` per
 * `pinnedApps` entry — the shared contract the App Store and Demo Apps
 * workstreams register their apps under — plus a trailing "+" that opens
 * the App Store, same destination as its own tile.
 *
 * Until those workstreams land, opening any of these ids shows Window.tsx's
 * "No app is registered for X" fallback. That's expected, not a bug here.
 */
export function Dock() {
  const openWindow = useWindowStore((s) => s.openWindow);

  function open(app: PinnedApp) {
    const IconGlyph = pinnedAppIcons[app.icon];
    openWindow(app.id, { title: app.title, icon: <IconGlyph /> });
  }

  return (
    <nav
      aria-label="App dock"
      className="absolute top-4 left-1/2 z-[var(--z-chrome)] -translate-x-1/2"
    >
      <div className="h-dock rounded-pill border-border/60 bg-surface-elevated/70 shadow-float flex items-center gap-1.5 border px-2.5 backdrop-blur-xl">
        {pinnedApps.map((app) => (
          <DockTile
            key={app.id}
            label={app.title}
            icon={pinnedAppIcons[app.icon]}
            onClick={() => open(app)}
          />
        ))}

        <div aria-hidden className="bg-border mx-1 h-6 w-px" />

        <Tooltip label="App Store">
          <IconButton
            aria-label="Open App Store"
            onClick={() => open(appStoreApp)}
            variant="ghost"
            size="lg"
            className="rounded-control h-11 w-11"
          >
            <PlusIcon size={20} />
          </IconButton>
        </Tooltip>
      </div>
    </nav>
  );
}
