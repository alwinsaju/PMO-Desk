"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useWindowDrag } from "./useWindowDrag";
import { WindowControls } from "./WindowControls";

interface WindowTitleBarProps {
  id: string;
  title: string;
  icon?: ReactNode;
  isFocused: boolean;
  isMaximized: boolean;
  /** Pinned: stays above the other windows. */
  isPinned?: boolean;
  onPinToggle?: () => void;
  /** True only while Window.tsx's own imperative maximize/restore spring is
   *  mid-flight (see its `transitionRect` state). Separate from
   *  `isMaximized` on purpose: `isMaximized` flips the instant the toggle is
   *  clicked (so the control icon gives immediate feedback either
   *  direction), but dragging/re-toggling has to stay blocked until OUTER's
   *  rect animation actually finishes, or a drag gesture's ref-mutation
   *  would start fighting that still-running animation over the same
   *  `transform`/width/height — see Window.tsx's `handleMaximizeToggle`. */
  dragDisabled?: boolean;
  /** Ref of the OUTER window element — see useWindowDrag for why. */
  rootRef: React.RefObject<HTMLElement | null>;
  onMinimize: () => void;
  onMaximizeToggle: () => void;
  onClose: () => void;
}

/**
 * 54px title bar: accent-tinted icon chip + app name on the left,
 * understated minimize/maximize + always-visible close on the right.
 * Doubles as the window's drag handle (disabled while maximized, or
 * mid-maximize/restore). The surface behind it is Window.tsx's frosted body,
 * so the bar itself is transparent.
 */
export function WindowTitleBar({
  id,
  title,
  icon,
  isFocused,
  isMaximized,
  isPinned = false,
  onPinToggle,
  dragDisabled = false,
  rootRef,
  onMinimize,
  onMaximizeToggle,
  onClose,
}: WindowTitleBarProps) {
  const dragBlocked = isMaximized || dragDisabled;
  const bindDrag = useWindowDrag(id, rootRef, { disabled: dragBlocked });

  return (
    <div
      {...(dragBlocked ? {} : bindDrag())}
      onDoubleClick={dragDisabled ? undefined : onMaximizeToggle}
      className={cn(
        "h-titlebar flex shrink-0 touch-none items-center gap-[11px] pl-[18px] select-none",
        // A maximized window's top-right corner sits under the settings gear
        // (SettingsMenu.tsx, z-chrome, 56px wide at right-4; from `sm` up — below
        // that it drops under the dock). Reserve that
        // width so minimize/maximize/close stay clickable. Keep in sync with
        // the gear's size/offset; a restored window never reaches the corner
        // unless the user drags it there on purpose.
        isMaximized ? "pr-3.5 sm:pr-[4.5rem]" : "pr-3.5",
        dragBlocked ? "cursor-default" : "cursor-grab active:cursor-grabbing",
      )}
    >
      {icon ? (
        <span
          aria-hidden
          className="bg-accent-soft text-accent-ink rounded-control flex h-[30px] w-[30px] shrink-0 items-center justify-center [&_svg]:h-[18px] [&_svg]:w-[18px]"
        >
          {icon}
        </span>
      ) : null}
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[14.5px] font-semibold tracking-[-0.005em] transition-colors duration-300",
          isFocused ? "text-ink" : "text-ink-muted",
        )}
      >
        {title}
      </span>
      <WindowControls
        isMaximized={isMaximized}
        isPinned={isPinned}
        onPinToggle={onPinToggle}
        onMinimize={onMinimize}
        onMaximizeToggle={onMaximizeToggle}
        onClose={onClose}
      />
    </div>
  );
}
