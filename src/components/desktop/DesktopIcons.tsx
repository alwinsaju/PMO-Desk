"use client";

import { pinnedApps, pinnedAppIcons, type PinnedApp } from "@/components/taskbar";
import { useWindowStore } from "@/components/window-manager";
import { cn } from "@/lib/cn";

/**
 * Desktop icon grid. V1 mirrors the dock's pinned apps exactly — same 4
 * ids, same titles/icons (see `src/components/taskbar/pinnedApps.ts`) —
 * laid out as a single top-left column, like a conventional desktop.
 * Double-click (or Enter, once an icon has keyboard focus) opens the
 * matching app window, same destination as clicking its dock tile.
 */
export function DesktopIcons() {
  const openWindow = useWindowStore((s) => s.openWindow);

  function open(app: PinnedApp) {
    const IconGlyph = pinnedAppIcons[app.icon];
    openWindow(app.id, { title: app.title, icon: <IconGlyph /> });
  }

  return (
    <div className="absolute top-6 left-6 flex flex-col gap-1">
      {pinnedApps.map((app) => {
        const IconGlyph = pinnedAppIcons[app.icon];
        return (
          <button
            key={app.id}
            type="button"
            onDoubleClick={() => open(app)}
            onKeyDown={(event) => {
              if (event.key === "Enter") open(app);
            }}
            className={cn(
              "rounded-control flex w-20 flex-col items-center gap-1.5 p-2 outline-none select-none",
              "hover:bg-neutral-0/25 focus-visible:bg-neutral-0/25",
              "focus-visible:ring-accent focus-visible:ring-2",
            )}
          >
            <span className="rounded-control bg-neutral-0/60 text-ink-muted shadow-float-sm flex h-11 w-11 items-center justify-center backdrop-blur-sm">
              <IconGlyph size={22} />
            </span>
            <span className="text-ink line-clamp-2 text-center text-[12px] font-medium">
              {app.title}
            </span>
          </button>
        );
      })}
    </div>
  );
}
