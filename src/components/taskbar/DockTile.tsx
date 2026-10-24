"use client";

import type { ButtonHTMLAttributes } from "react";
import type { Icon } from "@phosphor-icons/react";
import { badgeText, badgedLabel } from "./dockBadge";
import { cn } from "@/lib/cn";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  IconButton,
  Tooltip,
} from "@/components/ui";

interface DockTileProps {
  label: string;
  icon: Icon;
  onClick: () => void;
  /** False for a temporary tile that's only here because a window of an
   *  unpinned app is open — its context menu offers "Pin to taskbar"
   *  instead of "Unpin from taskbar". */
  pinned: boolean;
  onTogglePinned: () => void;
  onResetTaskbar: () => void;
  /** Disables "Reset taskbar to default" when the taskbar already IS the
   *  default (nothing to reset). */
  canReset: boolean;
  /** A count to draw on the tile's corner (e.g. items needing attention);
   *  0 or undefined draws nothing. Purely visual: the tile behaves the same. */
  badge?: number;
  /** `draggable`/`onDragStart`/`onDragEnd` for a tile that can be dragged to
   *  reorder — Dock.tsx passes these only for pinned tiles. The drop side
   *  (where it lands) is Dock.tsx's wrapper around this tile. */
  dragProps?: Pick<
    ButtonHTMLAttributes<HTMLButtonElement>,
    "draggable" | "onDragStart" | "onDragEnd"
  >;
}

/**
 * One app tile in the dock: a clean rounded-square icon chip with a hover
 * tooltip showing its name and a right-click menu to unpin/pin it or reset
 * the taskbar. `IconButton` supplies the interaction mechanics (focus ring,
 * hover/active states); the className override swaps its default
 * `rounded-full` ghost look for the square-ish, filled "chip" the dock spec
 * calls for — `cn()`'s tailwind-merge setup (see `src/lib/cn.ts`) resolves
 * that override correctly.
 *
 * The `className="contents"` trick on `ContextMenuTrigger` mirrors
 * `AppMenuEntry.tsx`: the trigger gets no box of its own, so the dock's
 * flex row sees the button itself as the item.
 */
export function DockTile({
  label,
  icon: IconGlyph,
  onClick,
  pinned,
  onTogglePinned,
  onResetTaskbar,
  canReset,
  badge = 0,
  dragProps,
}: DockTileProps) {
  const badgeLabel = badgeText(badge);
  return (
    <ContextMenu>
      <ContextMenuTrigger className="contents">
        <span className="relative inline-flex">
          <Tooltip label={badgedLabel(label, badge)}>
            <IconButton
              aria-label={badgedLabel(label, badge)}
              onClick={onClick}
              variant="ghost"
              size="lg"
              className="rounded-control text-ink-muted hover:text-ink h-11 w-11 bg-neutral-100 hover:bg-neutral-200"
              {...dragProps}
            >
              <IconGlyph size={20} />
            </IconButton>
          </Tooltip>
          {badgeLabel && (
            <span
              aria-hidden
              data-dock-badge
              className={cn(
                "bg-accent text-accent-contrast pointer-events-none absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center",
                "rounded-pill border-surface border-2 px-1 text-[10px] leading-none font-semibold",
              )}
            >
              {badgeLabel}
            </span>
          )}
        </span>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onTogglePinned}>
          {pinned ? "Unpin from taskbar" : "Pin to taskbar"}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!canReset} onSelect={onResetTaskbar}>
          Reset taskbar to default
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
