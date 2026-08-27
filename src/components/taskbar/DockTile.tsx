"use client";

import type { Icon } from "@phosphor-icons/react";
import { IconButton, Tooltip } from "@/components/ui";

interface DockTileProps {
  label: string;
  icon: Icon;
  onClick: () => void;
}

/**
 * One pinned-app tile in the dock: a clean rounded-square icon chip with a
 * hover tooltip showing its name. `IconButton` supplies the interaction
 * mechanics (focus ring, hover/active states); the className override
 * swaps its default `rounded-full` ghost look for the square-ish, filled
 * "chip" the dock spec calls for — `cn()`'s tailwind-merge setup (see
 * `src/lib/cn.ts`) resolves that override correctly.
 */
export function DockTile({ label, icon: IconGlyph, onClick }: DockTileProps) {
  return (
    <Tooltip label={label}>
      <IconButton
        aria-label={label}
        onClick={onClick}
        variant="ghost"
        size="lg"
        className="rounded-control text-ink-muted hover:text-ink h-11 w-11 bg-neutral-100 hover:bg-neutral-200"
      >
        <IconGlyph size={20} />
      </IconButton>
    </Tooltip>
  );
}
