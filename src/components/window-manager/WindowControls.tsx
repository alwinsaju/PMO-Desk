"use client";

import {
  ArrowsInSimpleIcon,
  ArrowsOutSimpleIcon,
  MinusIcon,
  PushPinIcon,
  XIcon,
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { IconButton } from "@/components/ui/IconButton";

interface WindowControlsProps {
  isMaximized: boolean;
  isPinned?: boolean;
  onPinToggle?: () => void;
  onMinimize: () => void;
  onMaximizeToggle: () => void;
  onClose: () => void;
}

// 36px round hit targets (IconButton `md`), each with a tooltip from its label.
const controlClassName = cn(
  "text-ink-muted hover:text-ink",
  "ease-spring transition-[opacity,background-color,color,transform] duration-300",
  "active:scale-95",
);

/** Minimize / maximize rest invisible and appear while the window is
 *  focused, hovered, or one of them has keyboard focus. */
const revealedOnDemand =
  "opacity-0 group-hover/win:opacity-100 group-data-[focused=true]/win:opacity-100 focus-visible:opacity-100";

/**
 * Pin / minimize / maximize / close, left to right, matching WindowTitleBar's
 * layout. Pin, minimize and maximize stay understated — hidden until the window
 * is hovered, focused, or one of them gains keyboard focus (the `group/win` /
 * `data-focused` hooks live on Window.tsx's body). Close is always visible per
 * the design spec, and turns red on hover.
 */
export function WindowControls({
  isMaximized,
  isPinned = false,
  onPinToggle,
  onMinimize,
  onMaximizeToggle,
  onClose,
}: WindowControlsProps) {
  return (
    <div className="flex items-center gap-0.5">
      {onPinToggle && (
        <IconButton
          shape="round"
          aria-label={isPinned ? "Unpin from top" : "Keep on top"}
          aria-pressed={isPinned}
          onClick={(e) => {
            e.stopPropagation();
            onPinToggle();
          }}
          className={cn(
            controlClassName,
            isPinned ? "text-accent-ink opacity-100" : revealedOnDemand,
          )}
        >
          <PushPinIcon weight={isPinned ? "fill" : "bold"} />
        </IconButton>
      )}
      <IconButton
        shape="round"
        aria-label="Minimize"
        onClick={(e) => {
          e.stopPropagation();
          onMinimize();
        }}
        className={cn(controlClassName, revealedOnDemand)}
      >
        <MinusIcon weight="bold" />
      </IconButton>
      <IconButton
        shape="round"
        aria-label={isMaximized ? "Restore" : "Maximize"}
        onClick={(e) => {
          e.stopPropagation();
          onMaximizeToggle();
        }}
        className={cn(controlClassName, revealedOnDemand)}
      >
        {isMaximized ? (
          <ArrowsInSimpleIcon weight="bold" />
        ) : (
          <ArrowsOutSimpleIcon weight="bold" />
        )}
      </IconButton>
      <IconButton
        shape="round"
        aria-label="Close"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className={cn(
          controlClassName,
          // Brand-agnostic destructive red, identical on every theme.
          "opacity-80 hover:bg-[#e5584c] hover:text-white hover:opacity-100 focus-visible:opacity-100",
        )}
      >
        <XIcon weight="bold" />
      </IconButton>
    </div>
  );
}
