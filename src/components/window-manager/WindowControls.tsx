"use client";

import {
  ArrowsInSimpleIcon,
  ArrowsOutSimpleIcon,
  MinusIcon,
  XIcon,
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";

interface WindowControlsProps {
  isMaximized: boolean;
  onMinimize: () => void;
  onMaximizeToggle: () => void;
  onClose: () => void;
}

const controlButtonClassName = cn(
  "flex h-5 w-5 items-center justify-center rounded-full text-ink-faint",
  "opacity-0 transition-[opacity,background-color,color] duration-150 ease-standard",
  "group-hover:opacity-100 focus-visible:opacity-100",
  "hover:bg-neutral-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
);

/**
 * Minimize / maximize / close, in that order (left to right), matching
 * WindowTitleBar's layout. Minimize and maximize stay understated — invisible
 * until the title bar is hovered or one of them gains keyboard focus. Close
 * is always visible per the design spec.
 */
export function WindowControls({
  isMaximized,
  onMinimize,
  onMaximizeToggle,
  onClose,
}: WindowControlsProps) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label="Minimize"
        onClick={(e) => {
          e.stopPropagation();
          onMinimize();
        }}
        className={controlButtonClassName}
      >
        <MinusIcon size={11} weight="bold" />
      </button>
      <button
        type="button"
        aria-label={isMaximized ? "Restore" : "Maximize"}
        onClick={(e) => {
          e.stopPropagation();
          onMaximizeToggle();
        }}
        className={controlButtonClassName}
      >
        {isMaximized ? (
          <ArrowsInSimpleIcon size={11} weight="bold" />
        ) : (
          <ArrowsOutSimpleIcon size={11} weight="bold" />
        )}
      </button>
      <button
        type="button"
        aria-label="Close"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className={cn(
          "text-ink-faint flex h-5 w-5 items-center justify-center rounded-full",
          "ease-standard transition-colors duration-150",
          "focus-visible:ring-accent hover:bg-red-500 hover:text-white focus-visible:ring-2 focus-visible:outline-none",
        )}
      >
        <XIcon size={11} weight="bold" />
      </button>
    </div>
  );
}
