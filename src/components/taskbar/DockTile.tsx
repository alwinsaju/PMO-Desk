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
  Tooltip,
} from "@/components/ui";

/** Whether an app has a window: `open` = at least one visible window,
 *  `minimized` = windows exist but all are minimized, `none` = no window. */
export type TileRunState = "none" | "open" | "minimized";

/** The shared 46px dock-button look (also used by Dock.tsx's trailing
 *  App-Menu / App-Store buttons): resting `chip` fill, the `morph` hover
 *  (rounded square -> circle with accent glow), a press-in. */
export const dockTileClassName = cn(
  "morph bg-chip text-ink-soft relative grid h-[46px] w-[46px] shrink-0 place-items-center",
  "active:scale-95 disabled:pointer-events-none disabled:opacity-40",
  "focus-visible:ring-focus focus-visible:ring-2 focus-visible:outline-none",
);

interface DockTileProps {
  /** The app this tile stands for; lets a closing window return focus here. */
  appId?: string;
  label: string;
  icon: Icon;
  onClick: () => void;
  /** Offered in the context menu while the app is running, since a plain
   *  click minimises/restores instead of opening another window. */
  onNewWindow?: () => void;
  /** False for a temporary tile that's only here because a window of an
   *  unpinned app is open — its context menu offers "Pin to taskbar"
   *  instead of "Unpin from taskbar". */
  pinned: boolean;
  onTogglePinned: () => void;
  onResetTaskbar: () => void;
  /** Disables "Reset taskbar to default" when the taskbar already IS the
   *  default (nothing to reset). */
  canReset: boolean;
  /** Drives the little dot under the icon: open = accent dot, minimized =
   *  grey dot, none = no dot. */
  running?: TileRunState;
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
 * One app tile in the dock: a 46px rounded-square icon chip that morphs into
 * a circle with an accent glow on hover (the `morph` utility), a running-app
 * dot, a tooltip BELOW it (the dock sits at the top of the screen) showing
 * its name, and a right-click menu to unpin/pin it or reset the taskbar.
 *
 * The `className="contents"` trick on `ContextMenuTrigger` mirrors
 * `AppMenuEntry.tsx`: the trigger gets no box of its own, so the dock's
 * flex row sees the button itself as the item.
 */
export function DockTile({
  appId,
  label,
  icon: IconGlyph,
  onClick,
  onNewWindow,
  pinned,
  onTogglePinned,
  onResetTaskbar,
  canReset,
  running = "none",
  badge = 0,
  dragProps,
}: DockTileProps) {
  const badgeLabel = badgeText(badge);
  return (
    <ContextMenu>
      <ContextMenuTrigger className="contents">
        <span className="relative inline-flex">
          <Tooltip label={badgedLabel(label, badge)} side="bottom" sideOffset={16}>
            <button
              type="button"
              aria-label={badgedLabel(label, badge)}
              aria-description={
                running === "open"
                  ? "Open"
                  : running === "minimized"
                    ? "Minimized"
                    : undefined
              }
              data-running={running}
              data-dock-app={appId}
              onClick={onClick}
              className={dockTileClassName}
              {...dragProps}
            >
              <IconGlyph size={23} />
            </button>
          </Tooltip>
          <i
            aria-hidden
            className={cn(
              "pointer-events-none absolute bottom-[3px] left-1/2 -ml-0.5 h-1 w-1 rounded-full not-italic",
              "ease-spring transition-[opacity,transform,background-color] duration-300",
              running === "none" ? "scale-0 opacity-0" : "scale-100 opacity-100",
              running === "minimized" ? "bg-ink-faint" : "bg-accent-ink",
            )}
          />
          {badgeLabel && (
            <span
              aria-hidden
              data-dock-badge
              className={cn(
                "bg-accent text-accent-contrast pointer-events-none absolute -top-1 -right-1 z-[1] flex h-[18px] min-w-[18px] items-center justify-center",
                "rounded-pill border-surface-elevated border-2 px-1 text-[10px] leading-none font-semibold",
              )}
            >
              {badgeLabel}
            </span>
          )}
        </span>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {onNewWindow && running !== "none" && (
          <>
            <ContextMenuItem onSelect={onNewWindow}>New window</ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
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
