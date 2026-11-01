"use client";

import { useWindowStore } from "@/components/window-manager";
import { cn } from "@/lib/cn";

/**
 * A soft tint along the bottom edge, under the command bar, while an app window is open.
 * Windows can fill the whole screen now, so the bar floats over them; the tint (the accent at
 * a low strength, fading to nothing upward) keeps the bar and its starter chips legible on any
 * window content without a hard edge. It never takes pointer events and sits just below the
 * bar's own layer.
 */
export function CommandBarHue() {
  const open = useWindowStore((s) =>
    Object.values(s.windows).some((w) => !w.isMinimized),
  );
  return (
    <div
      aria-hidden
      data-testid="command-bar-hue"
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-0 z-[calc(var(--z-chrome)-1)] h-40",
        "ease-standard transition-opacity duration-500",
        "bg-[linear-gradient(to_top,color-mix(in_srgb,var(--color-accent)_20%,transparent)_0%,color-mix(in_srgb,var(--color-accent)_8%,transparent)_45%,transparent_100%)]",
        open ? "opacity-100" : "opacity-0",
      )}
    />
  );
}
