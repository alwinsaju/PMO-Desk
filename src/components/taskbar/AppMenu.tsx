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
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  Tooltip,
} from "@/components/ui";
import { AppMenuEntry } from "./AppMenuEntry";
import { builtInApps, pinnedAppIcons, type PinnedApp } from "./pinnedApps";
import { APP_DRAG_MIME_TYPE, usePinnedAppsStore } from "./pinnedAppsStore";

/**
 * The "every app" launcher — a flyout off its own dock button (a grid-dots
 * icon), distinct from the dock's "+" (which only ever opens the App
 * Store). Lists the 5 built-in apps plus every App Store catalog entry
 * currently installed (`installedAppsStore`) — i.e. exactly the set of
 * apps that would show "Open" rather than "Install" if you opened the App
 * Store itself right now.
 *
 * Opening a built-in just calls `openWindow` directly, same as a dock
 * tile. Opening a catalog entry goes through `runAppPrimaryAction` — the
 * exact same helper AppCard's Install/Open button uses (see
 * app-store/appActions.tsx) — so a real web app opens its real window here
 * exactly as it does from the App Store, and a fictional entry does
 * whatever it already does there; this component never special-cases
 * either kind of entry itself.
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

  const installedCatalogApps = useMemo(
    () => appCatalog.filter((app) => installedIds[app.id]),
    [installedIds],
  );

  function openBuiltIn(app: PinnedApp) {
    const IconGlyph = pinnedAppIcons[app.icon];
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
    event.dataTransfer.effectAllowed = "copy";
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip label="App Menu">
        <PopoverTrigger asChild>
          <IconButton
            aria-label="Open App Menu"
            variant="ghost"
            size="lg"
            className="rounded-control h-11 w-11"
          >
            <DotsNineIcon size={20} />
          </IconButton>
        </PopoverTrigger>
      </Tooltip>

      <PopoverContent align="center" sideOffset={14} className="w-[26rem] p-2">
        <ScrollArea className="max-h-[24rem]">
          <div className="grid grid-cols-4 gap-1 p-2">
            {builtInApps.map((app) => (
              <AppMenuEntry
                key={app.id}
                title={app.title}
                icon={pinnedAppIcons[app.icon]}
                onOpen={() => openBuiltIn(app)}
              />
            ))}
            {installedCatalogApps.map((app) => (
              <AppMenuEntry
                key={app.id}
                title={app.name}
                icon={appIcons[app.icon]}
                onOpen={() => openCatalogApp(app)}
                pinning={{
                  isPinned: pinnedIds.includes(app.id),
                  onTogglePinned: () =>
                    pinnedIds.includes(app.id) ? unpinApp(app.id) : pinApp(app.id),
                  onDragStart: (event) => handleDragStart(event, app.id),
                }}
              />
            ))}
          </div>

          {installedCatalogApps.length === 0 && (
            <p className="text-ink-faint px-2 py-4 text-center text-[13px]">
              Install apps from the App Store to see them here too.
            </p>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
