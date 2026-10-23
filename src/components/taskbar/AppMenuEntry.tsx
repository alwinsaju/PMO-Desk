"use client";

import type { DragEvent } from "react";
import type { Icon } from "@phosphor-icons/react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui";
import { cn } from "@/lib/cn";

export interface AppMenuEntryPinning {
  isPinned: boolean;
  onTogglePinned: () => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
}

interface AppMenuEntryProps {
  title: string;
  icon: Icon;
  onOpen: () => void;
  /**
   * Present for every entry the taskbar can hold — built-in apps and
   * installed App Store catalog apps alike (see `pinnedAppsStore.ts`).
   * When present, the tile is draggable (drop it on the dock to pin it) and
   * gets a right-click "Pin to taskbar"/"Unpin from taskbar" context menu;
   * when absent, it's a plain button with neither.
   */
  pinning?: AppMenuEntryPinning;
}

/**
 * One tile in the App Menu's grid (AppMenu.tsx): an icon, a label below it,
 * and — for a pinnable entry — the drag source + right-click menu that lets
 * it be pinned to (or unpinned from) the taskbar. Mirrors AppCard.tsx's
 * icon+label pairing, just stacked vertically for a launcher grid instead
 * of a list row.
 *
 * The `className="contents"` trick on `ContextMenuTrigger` mirrors
 * `DesktopContextMenu.tsx`: it gives the trigger no box of its own so the
 * grid's `grid-cols-*` layout sees the button itself as the grid item, not
 * an extra wrapper around it.
 */
export function AppMenuEntry({
  title,
  icon: IconGlyph,
  onOpen,
  pinning,
}: AppMenuEntryProps) {
  const tile = (
    <button
      type="button"
      title={title}
      onClick={onOpen}
      draggable={Boolean(pinning)}
      onDragStart={pinning?.onDragStart}
      className={cn(
        "group rounded-control ease-standard flex w-full flex-col items-center gap-1.5 p-2 transition-colors duration-150 outline-none",
        "focus-visible:ring-accent active:bg-neutral-150 hover:bg-neutral-100 focus-visible:ring-2",
        pinning && "cursor-grab active:cursor-grabbing",
      )}
    >
      <span className="text-ink-muted ease-standard group-hover:text-ink flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-neutral-100 transition-colors duration-150">
        <IconGlyph size={24} />
      </span>
      <span className="text-ink w-full truncate text-center text-[12px] font-medium">
        {title}
      </span>
    </button>
  );

  if (!pinning) return tile;

  return (
    <ContextMenu>
      <ContextMenuTrigger className="contents">{tile}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={pinning.onTogglePinned}>
          {pinning.isPinned ? "Unpin from taskbar" : "Pin to taskbar"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
