"use client";

import type { Icon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";

export type AppIconTileSize = "sm" | "lg";

const tileClassName: Record<AppIconTileSize, string> = {
  sm: "h-11 w-11 rounded-xl",
  lg: "h-16 w-16 rounded-2xl",
};

const glyphSize: Record<AppIconTileSize, number> = {
  sm: 20,
  lg: 28,
};

interface AppIconTileProps {
  icon: Icon;
  size?: AppIconTileSize;
  className?: string;
}

/**
 * Neutral rounded icon tile shared by AppCard (row-sized) and
 * AppDetailView (header-sized). Deliberately neutral, not accent — the
 * design spec's one accent color is reserved for interactive moments (the
 * Install button here), not decorative app-icon backgrounds. See
 * ARCHITECTURE.md's "ONE accent color" section.
 */
export function AppIconTile({
  icon: IconGlyph,
  size = "sm",
  className,
}: AppIconTileProps) {
  return (
    <span
      className={cn(
        "text-ink-muted inline-flex shrink-0 items-center justify-center bg-neutral-100",
        tileClassName[size],
        className,
      )}
    >
      <IconGlyph size={glyphSize[size]} />
    </span>
  );
}
