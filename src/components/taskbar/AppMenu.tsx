"use client";

import { useMemo, useState } from "react";
import type { DragEvent } from "react";
import { DotsNineIcon } from "@phosphor-icons/react";
import { appCatalog, appIcons } from "@/components/app-store/appCatalog";
import { runAppPrimaryAction } from "@/components/app-store/appActions";
import { useInstalledAppsStore } from "@/components/app-store/installedAppsStore";
import type { AppListing } from "@/components/app-store/types";
import { useWindowStore } from "@/components/window-manager";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
} from "@/components/ui";
import { dockTileClassName } from "./DockTile";
import { AppMenuEntry } from "./AppMenuEntry";
import { builtInAppIds, builtInApps, type PinnedApp } from "./pinnedApps";
import { APP_DRAG_MIME_TYPE, usePinnedAppsStore } from "./pinnedAppsStore";
import { isDefaultPinnedIds } from "./taskbarLayout";

/**
 * The "every app" launcher — a flyout off its own dock button (a grid-dots
 * icon), distinct from the dock's "+" (which only ever opens the App
 * Store). Lists every built-in app (pinned to the taskbar or not — this
 * menu is how an unpinned one is found again) plus every App Store catalog
 * entry currently installed (`installedAppsStore`) — i.e. exactly the set
 * of apps that would show "Open" rather than "Install" if you opened the
 * App Store itself right now. Every entry can be pinned/unpinned (right-
 * click, or drag it onto the dock); a footer button resets the taskbar to
 * its default so it's reachable even when every tile has been removed.
 *
 * Opening a built-in just calls `openWindow` directly, same as a dock
 * tile. Opening a catalog entry goes through `runAppPrimaryAction` — the
 * exact same helper AppCard's Install/Open button uses (see
 * app-store/appActions.tsx) — so a real web app opens its real window here
 * exactly as it does from the App Store, and a fictional entry does
 * whatever it already does there; this component never special-cases
 * either kind of entry itself.
 *
 * The grid scrolls inside the popover (a plain `overflow-y-auto` box with a
 * max height — the old ScrollArea put its max-height on the Radix Root while
 * the Viewport kept growing, so a long list was clipped instead of scrolling).
 *
 * A Radix `Popover` anchored to the trigger button, matching this design
 * system's other flyout-style overlays (Popover/DropdownMenu/ContextMenu
 * all share the same open/close treatment — see src/lib/motion.ts).
 */
export function AppMenu() {
  const [open, setOpen] = useState(false);
  const openWindow = useWindowStore((s) => s.openWindow);
  const installedIds = useInstalledAppsStore((s) => s.installedIds);
  const pinnedIds = usePinnedAppsStore((s) => s.pinnedIds);
  const pinApp = usePinnedAppsStore((s) => s.pinApp);
  const unpinApp = usePinnedAppsStore((s) => s.unpinApp);
  const resetPinnedApps = usePinnedAppsStore((s) => s.resetPinnedApps);

  const installedCatalogApps = useMemo(
    () => appCatalog.filter((app) => installedIds[app.id]),
    [installedIds],
  );

  function openBuiltIn(app: PinnedApp) {
    const IconGlyph = app.icon;
    openWindow(app.id, { title: app.title, icon: <IconGlyph /> });
    setOpen(false);
  }

  function openCatalogApp(app: AppListing) {
    runAppPrimaryAction(app);
    setOpen(false);
  }

  // Stamps the dragged app's id onto the native DataTransfer under our own
  // MIME type — see pinnedAppsStore.ts's APP_DRAG_MIME_TYPE doc comment for
  // why a custom type (not e.g. "text/plain"). Dock.tsx reads this back in
  // its own onDrop to pin the app, and recognizes it in onDragOver (via
  // `dataTransfer.types`, readable mid-drag) to show its drop-target ring.
  function handleDragStart(event: DragEvent<HTMLButtonElement>, appId: string) {
    event.dataTransfer.setData(APP_DRAG_MIME_TYPE, appId);
    event.dataTransfer.effectAllowed = "copyMove";
  }

  function pinningFor(appId: string) {
    const isPinned = pinnedIds.includes(appId);
    return {
      isPinned,
      onTogglePinned: () => (isPinned ? unpinApp(appId) : pinApp(appId)),
      onDragStart: (event: DragEvent<HTMLButtonElement>) => handleDragStart(event, appId),
    };
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip label="All apps" side="bottom" sideOffset={16}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Open App Menu"
            data-active={open ? "true" : undefined}
            className={dockTileClassName}
          >
            <DotsNineIcon size={23} />
          </button>
        </PopoverTrigger>
      </Tooltip>

      <PopoverContent
        align="center"
        sideOffset={14}
        aria-label="All apps"
        className="w-[min(27rem,calc(100vw-1.5rem))] p-4"
      >
        <p className="text-ink-muted px-3 pt-1 pb-1.5 text-[11.5px] font-bold tracking-[0.08em] uppercase">
          All apps
        </p>
        <div className="scroll-thin max-h-[21.25rem] overflow-y-auto overscroll-contain">
          <div className="grid grid-cols-[repeat(4,minmax(0,1fr))] gap-1.5">
            {builtInApps.map((app) => (
              <AppMenuEntry
                key={app.id}
                title={app.title}
                icon={app.icon}
                onOpen={() => openBuiltIn(app)}
                pinning={pinningFor(app.id)}
              />
            ))}
            {installedCatalogApps.map((app) => (
              <AppMenuEntry
                key={app.id}
                title={app.name}
                icon={appIcons[app.icon]}
                onOpen={() => openCatalogApp(app)}
                pinning={pinningFor(app.id)}
              />
            ))}
          </div>

          {installedCatalogApps.length === 0 && (
            <p className="text-ink-faint px-2 py-4 text-center text-[13px]">
              Install apps from the App Store to see them here too.
            </p>
          )}
        </div>

        <div className="border-line mt-2 flex justify-end border-t pt-2.5">
          <Button
            variant="ghost"
            size="sm"
            disabled={isDefaultPinnedIds(pinnedIds, builtInAppIds)}
            onClick={resetPinnedApps}
          >
            Reset taskbar to default
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
