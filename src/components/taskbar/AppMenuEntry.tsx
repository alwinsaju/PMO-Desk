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
 * One tile in the App Menu's grid (AppMenu.tsx): a 52px icon tile that
 * morphs from a rounded square to an accent-glow circle while the whole entry
 * is hovered (`morph` on the tile, `morph-host` on the button), a label below
 * it, and — for a pinnable entry — the drag source + right-click menu that
 * lets it be pinned to (or unpinned from) the taskbar. Pinned entries rest
 * in the accent tint. Mirrors AppCard.tsx's icon+label pairing, just stacked
 * vertically for a launcher grid instead of a list row.
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
        "morph-host group rounded-card text-ink-soft hover:bg-chip flex w-full flex-col items-center gap-2 px-1 pt-3.5 pb-2.5 text-[12.5px] font-semibold",
        "ease-spring transition-[background-color,transform] duration-300 active:scale-[0.97]",
        "focus-visible:ring-focus focus-visible:ring-2 focus-visible:outline-none",
        pinning && "cursor-grab active:cursor-grabbing",
      )}
    >
      {/* Pinned apps carry the accent tint at rest so the grid doubles as
          a "what's on my dock" read; hover morphs every tile to a circle. */}
      <span
        data-active={pinning?.isPinned ? "true" : undefined}
        className="morph bg-chip text-ink grid h-[52px] w-[52px] shrink-0 place-items-center"
      >
        <IconGlyph size={26} />
      </span>
      <span className="w-full truncate text-center">{title}</span>
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
