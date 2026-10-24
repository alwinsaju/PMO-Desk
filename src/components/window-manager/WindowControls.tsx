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
  "rounded-orb text-ink-muted flex h-8 w-8 items-center justify-center",
  "ease-spring transition-[opacity,background-color,color,transform] duration-300",
  "hover:bg-chip-strong hover:text-ink hover:scale-110 active:scale-95",
  "focus-visible:ring-focus focus-visible:ring-2 focus-visible:outline-none",
);

/** Minimize / maximize rest invisible and appear while the window is
 *  focused, hovered, or one of them has keyboard focus. */
const revealedOnDemand =
  "opacity-0 group-hover/win:opacity-100 group-data-[focused=true]/win:opacity-100 focus-visible:opacity-100";

/**
 * Minimize / maximize / close, in that order (left to right), matching
 * WindowTitleBar's layout. Minimize and maximize stay understated — hidden
 * until the window is hovered, focused, or one of them gains keyboard focus
 * (the `group/win` / `data-focused` hooks live on Window.tsx's body). Close is
 * always visible per the design spec, and turns red on hover.
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
        className={cn(controlButtonClassName, revealedOnDemand)}
      >
        <MinusIcon size={15} weight="bold" />
      </button>
      <button
        type="button"
        aria-label={isMaximized ? "Restore" : "Maximize"}
        onClick={(e) => {
          e.stopPropagation();
          onMaximizeToggle();
        }}
        className={cn(controlButtonClassName, revealedOnDemand)}
      >
        {isMaximized ? (
          <ArrowsInSimpleIcon size={15} weight="bold" />
        ) : (
          <ArrowsOutSimpleIcon size={15} weight="bold" />
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
          controlButtonClassName,
          // Brand-agnostic destructive red, identical on every theme.
          "opacity-80 hover:bg-[#e5584c] hover:text-white hover:opacity-100 focus-visible:opacity-100",
        )}
      >
        <XIcon size={15} weight="bold" />
      </button>
    </div>
  );
}
