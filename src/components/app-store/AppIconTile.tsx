"use client";

import type { CSSProperties } from "react";
import type { Icon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";

interface AppIconTileProps {
  icon: Icon;
  /** Stable key (the app id) that picks this tile's gradient from the
   *  palette below, so an app keeps its color across renders and windows. */
  seed: string;
  /** Deloitte-mode colour for a tile that is not inside a list (the hero, the detail sheet):
   *  the list rule below paints by position, which does not exist there. */
  brandSlot?: 0 | 1 | 2;
  className?: string;
}

const BRAND_SLOT_CLASSES = [
  "brand-dl:bg-[linear-gradient(145deg,#86bc25,#63c631)]",
  "brand-dl:bg-[linear-gradient(145deg,#282728,#555)] brand-dl:text-[#86eb22]!",
  "brand-dl:bg-[linear-gradient(145deg,#00a3e0,#3fc3ec)]",
] as const;

/** Default-mode tile gradients (top-left -> bottom-right). */
const TILE_GRADIENTS = [
  "linear-gradient(145deg,#4fa68f,#2b7b6a)",
  "linear-gradient(145deg,#8a6fe0,#5b46c0)",
  "linear-gradient(145deg,#4a5a78,#2a3550)",
  "linear-gradient(145deg,#e0645a,#b8392f)",
  "linear-gradient(145deg,#6a7686,#454f5e)",
  "linear-gradient(145deg,#5a93e0,#3b62c4)",
  "linear-gradient(145deg,#e68a4f,#c25f24)",
  "linear-gradient(145deg,#4ba7c9,#2878a0)",
  "linear-gradient(145deg,#d9779f,#b0488a)",
  "linear-gradient(145deg,#d8a14a,#b27a1c)",
  "linear-gradient(145deg,#5f6672,#3a404b)",
  "linear-gradient(145deg,#3fb59a,#1f8a73)",
] as const;

function gradientFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return TILE_GRADIENTS[hash % TILE_GRADIENTS.length];
}

/**
 * Colored rounded icon tile used by AppCard. Default mode paints one of the
 * palette gradients above (picked from the app id). Deloitte mode repaints
 * every tile from the brand palette by position in its list — green, dark
 * gray + neon glyph, blue — the one structural brand difference the tokens
 * can't express, so it is a handful of `brand-dl:` + `li:nth-child` rules
 * (the tile's parent is the `<li>` card).
 *
 * Used to come in "sm"/"lg" sizes, back when the App Store had a per-app
 * detail screen. The card uses the one fixed size; the hero and the detail
 * sheet pass a larger `className` and a `brandSlot`.
 */
export function AppIconTile({
  icon: IconGlyph,
  seed,
  brandSlot,
  className,
}: AppIconTileProps) {
  return (
    <span
      style={{ "--tile-bg": gradientFor(seed) } as CSSProperties}
      className={cn(
        "rounded-tile inline-flex h-[54px] w-[54px] shrink-0 items-center justify-center bg-(image:--tile-bg) text-white",
        "brand-dl:text-black",
        "brand-dl:[li:nth-child(3n+1)_&]:bg-[linear-gradient(145deg,#86bc25,#63c631)]",
        "brand-dl:[li:nth-child(3n+2)_&]:bg-[linear-gradient(145deg,#282728,#555)] brand-dl:[li:nth-child(3n+2)_&]:text-[#86eb22]",
        "brand-dl:[li:nth-child(3n)_&]:bg-[linear-gradient(145deg,#00a3e0,#3fc3ec)]",
        brandSlot !== undefined && BRAND_SLOT_CLASSES[brandSlot],
        className,
      )}
    >
      <IconGlyph size={24} />
    </span>
  );
}
