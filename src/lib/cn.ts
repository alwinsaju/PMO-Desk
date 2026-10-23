import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge ships a built-in guess at Tailwind's default theme scales
 * so it knows e.g. `rounded-lg` and `rounded-full` conflict. It has no way
 * to know about the CUSTOM scale values we added in tokens.css (`rounded-
 * window`, `shadow-float`, `bg-accent`, `ease-entrance`, ...), so without
 * this extension `cn("rounded-pill", "rounded-lg")` would keep BOTH classes
 * instead of letting the second win — exactly the className-override
 * footgun `cn()` exists to prevent. Keep this list in sync with the custom
 * keys added in `src/styles/tokens.css`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ["window", "control", "pill"],
      shadow: ["float-sm", "float", "float-lg"],
      ease: ["standard", "entrance", "exit"],
      color: [
        "ink",
        "ink-muted",
        "ink-faint",
        "ink-inverse",
        "surface",
        "surface-elevated",
        "border",
        "accent",
        "accent-hover",
        "accent-active",
        "accent-subtle",
        "accent-contrast",
      ],
    },
  },
});

/**
 * Merge className fragments, resolving conflicting Tailwind utilities
 * (e.g. `cn("p-2", condition && "p-4")` keeps `p-4` when `condition` is
 * true instead of emitting both classes). Every component in
 * `src/components/ui` accepts and merges an incoming `className` prop
 * through this so consumers can always override styling.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
