"use client";

import type { Icon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";

interface AppIconTileProps {
  icon: Icon;
  className?: string;
}

/**
 * Neutral rounded icon tile used by AppCard's row. Deliberately neutral,
 * not accent — the design spec's one accent color is reserved for
 * interactive moments (the Install button here), not decorative app-icon
 * backgrounds. See ARCHITECTURE.md's "ONE accent color" section.
 *
 * Used to come in "sm"/"lg" sizes (the "lg" one for AppDetailView's
 * header), back when the App Store had a per-app detail screen. Now that
 * AppCard is the only consumer, it's just the one fixed size.
 */
export function AppIconTile({ icon: IconGlyph, className }: AppIconTileProps) {
  return (
    <span
      className={cn(
        "text-ink-muted inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-neutral-100",
        className,
      )}
    >
      <IconGlyph size={20} />
    </span>
  );
}
