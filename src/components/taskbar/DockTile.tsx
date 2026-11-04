"use client";

import type { ButtonHTMLAttributes } from "react";
import type { Icon } from "@phosphor-icons/react";
import { badgeText, badgedLabel, tileHover } from "./dockBadge";
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
  /** "Show desktop" (minimise every window) and "Tidy windows" (re-cascade the visible ones),
   *  offered in every tile's menu. `hasVisibleWindows` greys both out when there is nothing
   *  on screen to act on. */
  onShowDesktop?: () => void;
  onTidyWindows?: () => void;
  hasVisibleWindows?: boolean;
  /** Settings > "Show dock labels": the app's name under the icon. The tile then takes
   *  `DOCK_LABELLED_TILE_WIDTH` px (a fixed column, so the overflow maths in dockOverflow.ts
   *  can count on it) and the name is cut with an ellipsis rather than widening it. */
  showLabel?: boolean;
  /** Drives the little dot under the icon: open = accent dot, minimized =
   *  grey dot, none = no dot. */
  running?: TileRunState;
  /** A count to draw on the tile's corner (e.g. items needing attention);
   *  0 or undefined draws nothing. Purely visual: the tile behaves the same. */
  badge?: number;
  /** What the badge number is made of, shown on hover ("2 PMO items, 1 time-off request"). */
  badgeMeaning?: string;
  /** Titles of this app's open windows; the tooltip lists them when there are several. */
  windowTitles?: string[];
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
  onShowDesktop,
  onTidyWindows,
  hasVisibleWindows = false,
  showLabel = false,
  running = "none",
  badge = 0,
  badgeMeaning,
  windowTitles = [],
  dragProps,
}: DockTileProps) {
  const badgeLabel = badgeText(badge);
  const hover = tileHover({ label, running, badge, meaning: badgeMeaning, windowTitles });
  return (
    <ContextMenu>
      <ContextMenuTrigger className="contents">
        <span
          className={cn(
            "inline-flex",
            // Must match DOCK_LABELLED_TILE_WIDTH in dockOverflow.ts (Tailwind needs the literal).
            showLabel && "w-[60px] flex-col items-center gap-[3px]",
          )}
        >
          <span className="relative inline-flex">
            <Tooltip
              label={
                <span className="flex max-w-64 flex-col gap-0.5">
                  <span>{hover.title}</span>
                  {hover.lines.map((line) => (
                    <span
                      key={line}
                      className="text-ink-inverse/75 text-[12px] font-normal"
                    >
                      {line}
                    </span>
                  ))}
                </span>
              }
              side="bottom"
              sideOffset={16}
            >
              <button
                type="button"
                aria-label={badgedLabel(label, badge)}
                data-running={running}
                data-dock-app={appId}
                onClick={onClick}
                className={cn(dockTileClassName, "data-[running=open]:text-accent-ink")}
                {...dragProps}
              >
                <IconGlyph size={23} weight={running === "open" ? "fill" : "regular"} />
              </button>
            </Tooltip>
            <i
              aria-hidden
              data-dock-dot={running}
              className={cn(
                "pointer-events-none absolute bottom-[3px] left-1/2 -ml-[3px] h-1.5 w-1.5 rounded-full not-italic",
                "ease-spring transition-[opacity,transform,background-color] duration-300",
                running === "none" ? "scale-0 opacity-0" : "scale-100 opacity-100",
                running === "minimized"
                  ? "border-ink-faint border bg-transparent"
                  : "bg-accent-ink ring-surface-elevated ring-1",
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
          {showLabel && (
            // The button already carries the name (aria-label), so this is for the eye only.
            <span
              aria-hidden
              data-dock-label
              className="text-ink-muted w-full truncate text-center text-[10.5px] leading-none font-medium"
            >
              {label}
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
        {onShowDesktop && (
          <ContextMenuItem disabled={!hasVisibleWindows} onSelect={onShowDesktop}>
            Show desktop
          </ContextMenuItem>
        )}
        {onTidyWindows && (
          <ContextMenuItem disabled={!hasVisibleWindows} onSelect={onTidyWindows}>
            Tidy windows
          </ContextMenuItem>
        )}
        {(onShowDesktop || onTidyWindows) && <ContextMenuSeparator />}
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
