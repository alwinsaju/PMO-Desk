"use client";

import type { ReactNode } from "react";
import { AppWindowIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { useWindowDrag } from "./useWindowDrag";
import { WindowControls } from "./WindowControls";

interface WindowTitleBarProps {
  id: string;
  /** The app name. */
  title: string;
  /** Optional context after the name: where the user is in the window, and the app's
   *  live status ("Shift roster · 3 need attention"). Shown smaller and muted. */
  suffix?: string | null;
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
 * 54px title bar: accent-tinted app icon chip, app name and an optional context
 * suffix on the left; pin / minimize / maximize / close (36px hit targets) on
 * the right. Doubles as the window's drag handle (disabled while maximized, or
 * mid-maximize/restore); text selection is off on the bar and, while a drag is
 * live, across the page (see `data-gesture` in globals.css). The surface behind
 * it is Window.tsx's frosted body, so the bar itself is transparent.
 */
export function WindowTitleBar({
  id,
  title,
  suffix,
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
        isMaximized ? "pr-3.5 sm:pr-[4.5rem]" : "pr-2.5",
        dragBlocked ? "cursor-default" : "cursor-grab active:cursor-grabbing",
      )}
    >
      <span
        aria-hidden
        className="bg-accent-soft text-accent-ink rounded-control flex h-8 w-8 shrink-0 items-center justify-center [&_svg]:h-[18px] [&_svg]:w-[18px]"
      >
        {icon ?? <AppWindowIcon />}
      </span>
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span
          className={cn(
            "max-w-full min-w-0 shrink-0 truncate text-[14.5px] font-semibold tracking-[-0.005em] transition-colors duration-300",
            isFocused ? "text-ink" : "text-ink-muted",
          )}
        >
          {title}
        </span>
        {suffix ? (
          <span className="text-ink-muted min-w-0 truncate text-[12.5px] font-medium">
            <span aria-hidden>· </span>
            {suffix}
          </span>
        ) : null}
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
