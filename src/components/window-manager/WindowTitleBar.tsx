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
  /** Ref of the OUTER window element — see useWindowDrag for why. */
  rootRef: React.RefObject<HTMLElement | null>;
  onMinimize: () => void;
  onMaximizeToggle: () => void;
  onClose: () => void;
}

/**
 * Thin near-white title bar: small app icon + name on the left, understated
 * minimize/maximize + always-visible close on the right. Doubles as the
 * window's drag handle (disabled while maximized).
 */
export function WindowTitleBar({
  id,
  title,
  icon,
  isFocused,
  isMaximized,
  rootRef,
  onMinimize,
  onMaximizeToggle,
  onClose,
}: WindowTitleBarProps) {
  const bindDrag = useWindowDrag(id, rootRef, { disabled: isMaximized });

  return (
    <div
      {...(isMaximized ? {} : bindDrag())}
      onDoubleClick={onMaximizeToggle}
      className={cn(
        "group h-titlebar flex shrink-0 touch-none items-center gap-2 pr-2 pl-3 select-none",
        isMaximized ? "cursor-default" : "cursor-grab active:cursor-grabbing",
      )}
    >
      {icon ? (
        <span className="text-ink-muted flex h-4 w-4 shrink-0 items-center justify-center [&_svg]:h-full [&_svg]:w-full">
          {icon}
        </span>
      ) : null}
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[13px] font-medium tracking-tight",
          isFocused ? "text-ink" : "text-ink-faint",
        )}
      >
        {title}
      </span>
      <WindowControls
        isMaximized={isMaximized}
        onMinimize={onMinimize}
        onMaximizeToggle={onMaximizeToggle}
        onClose={onClose}
      />
    </div>
  );
}
