"use client";

import { useState } from "react";
import type { DragEvent } from "react";
import { PlusIcon } from "@phosphor-icons/react";
import { appCatalog, appIcons } from "@/components/app-store/appCatalog";
import { runAppPrimaryAction } from "@/components/app-store/appActions";
import type { AppListing } from "@/components/app-store/types";
import { useWindowStore } from "@/components/window-manager";
import { IconButton, Tooltip } from "@/components/ui";
import { cn } from "@/lib/cn";
import { AppMenu } from "./AppMenu";
import { DockTile } from "./DockTile";
import { builtInApps, pinnedAppIcons, type PinnedApp } from "./pinnedApps";
import { APP_DRAG_MIME_TYPE, usePinnedAppsStore } from "./pinnedAppsStore";

// "app-store" is always present — it's part of the static baseline above,
// and this workstream owns keeping the two in sync.
const appStoreApp = builtInApps.find((app) => app.id === "app-store")!;

/**
 * Top-centered floating pill dock — the app launcher/taskbar. A plain
 * launcher only: the command bar, AI cursor, and presence avatars are a
 * separate, later workstream (the AI Agent Layer) and don't belong here.
 *
 * Frosted/translucent chrome at the `z-chrome` layer, mounted as a sibling
 * of `<WindowManager />` from Desktop.tsx. Renders one `DockTile` per
 * `builtInApps` entry (the fixed 5-app baseline all workstreams share —
 * see pinnedApps.ts), then one more per additionally-pinned App Store
 * catalog app (`pinnedAppsStore.ts`), in the order each was pinned. After
 * those, a divider and two trailing icon buttons: the App Menu (every
 * installed app — see AppMenu.tsx) and the "+" that's always been a
 * straight shortcut to the App Store itself.
 *
 * Also a drop target for the App Menu -> Dock "pin this app" drag gesture:
 * dragging any `AppMenuEntry` that supports pinning and releasing it
 * anywhere on this pill pins that app, with a ring highlight while a
 * recognized drag is over it. See pinnedAppsStore.ts's
 * `APP_DRAG_MIME_TYPE` for how the drag is identified.
 */
export function Dock() {
  const openWindow = useWindowStore((s) => s.openWindow);
  const pinnedIds = usePinnedAppsStore((s) => s.pinnedIds);
  const pinApp = usePinnedAppsStore((s) => s.pinApp);
  const [isDropTarget, setIsDropTarget] = useState(false);

  function openBuiltIn(app: PinnedApp) {
    const IconGlyph = pinnedAppIcons[app.icon];
    openWindow(app.id, { title: app.title, icon: <IconGlyph /> });
  }

  // Resolve pinned ids against the live catalog, dropping any id that no
  // longer matches an entry there — defensive only; nothing in this pass
  // removes catalog entries at runtime, but a plain `find` can still come
  // back `undefined` for e.g. a stale id from a future catalog edit.
  const pinnedCatalogApps = pinnedIds
    .map((id) => appCatalog.find((app) => app.id === id))
    .filter((app): app is AppListing => Boolean(app));

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    // `dataTransfer.getData` is only readable on drop, but `.types` is
    // readable throughout the drag — exactly what's needed to decide
    // whether THIS drag is one we accept before the user releases it.
    if (!event.dataTransfer.types.includes(APP_DRAG_MIME_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDropTarget(true);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    const id = event.dataTransfer.getData(APP_DRAG_MIME_TYPE);
    setIsDropTarget(false);
    if (!id) return;
    event.preventDefault();
    pinApp(id);
  }

  return (
    <nav
      aria-label="App dock"
      className="absolute top-4 left-1/2 z-[var(--z-chrome)] -translate-x-1/2"
    >
      <div
        onDragOver={handleDragOver}
        onDragLeave={() => setIsDropTarget(false)}
        onDrop={handleDrop}
        className={cn(
          "h-dock rounded-pill border-border/60 bg-surface-elevated/70 shadow-float flex items-center gap-1.5 border px-2.5 backdrop-blur-xl",
          "ease-standard transition-[box-shadow] duration-150",
          isDropTarget && "ring-accent ring-offset-surface ring-2 ring-offset-2",
        )}
      >
        {builtInApps.map((app) => (
          <DockTile
            key={app.id}
            label={app.title}
            icon={pinnedAppIcons[app.icon]}
            onClick={() => openBuiltIn(app)}
          />
        ))}

        {pinnedCatalogApps.map((app) => (
          <DockTile
            key={app.id}
            label={app.name}
            icon={appIcons[app.icon]}
            onClick={() => runAppPrimaryAction(app)}
          />
        ))}

        <div aria-hidden className="bg-border mx-1 h-6 w-px" />

        <AppMenu />

        <Tooltip label="App Store">
          <IconButton
            aria-label="Open App Store"
            onClick={() => openBuiltIn(appStoreApp)}
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
