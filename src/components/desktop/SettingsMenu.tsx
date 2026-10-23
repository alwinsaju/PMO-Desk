"use client";

import type { ComponentType } from "react";
import { GearSixIcon, MoonIcon, SunIcon } from "@phosphor-icons/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSwitchItem,
  DropdownMenuTrigger,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { useTheme } from "@/lib/useTheme";

/**
 * Top-right settings control: a gear pill (same frosted chrome as the dock,
 * same height) that opens a small menu of settings rows. Mounted from
 * Desktop.tsx at the `z-chrome` layer, so it stays above every window
 * (maximized or not) exactly like the dock does.
 *
 * To add a setting, write a row component (a `DropdownMenuSwitchItem`, or
 * another menu item) and append it to `settingsRows` below. Rows own their
 * own state source; this file only lays them out.
 */

/** "Dark mode" — drives the same theme state as ever (`data-theme` on
 *  <html> + localStorage, via src/lib/theme.ts); this row only reads and
 *  writes it. */
function DarkModeRow() {
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";
  const Glyph = isDark ? MoonIcon : SunIcon;
  return (
    <DropdownMenuSwitchItem
      checked={isDark}
      onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
    >
      <Glyph size={16} weight="regular" aria-hidden />
      <span>Dark mode</span>
    </DropdownMenuSwitchItem>
  );
}

const settingsRows: { id: string; Row: ComponentType }[] = [
  { id: "dark-mode", Row: DarkModeRow },
];

export function SettingsMenu() {
  return (
    <div
      className={cn(
        "absolute z-[var(--z-chrome)]",
        // Safe-area aware, mirroring the dock's top-4 offset. Below `sm` the
        // dock spans the whole viewport width, so the gear drops to a row of
        // its own under it instead of covering the dock's last tile.
        "top-[calc(max(1rem,env(safe-area-inset-top))+4.5rem)] sm:top-[max(1rem,env(safe-area-inset-top))]",
        "right-[max(1rem,env(safe-area-inset-right))]",
      )}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Settings"
            className={cn(
              "sm:h-dock sm:w-dock rounded-pill border-border/60 bg-surface-elevated/70 shadow-float text-ink-muted flex h-11 w-11 items-center justify-center border backdrop-blur-xl",
              "ease-standard transition-colors duration-150",
              "hover:text-ink data-[state=open]:text-ink",
              "focus-visible:ring-accent focus-visible:ring-offset-surface focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
              "[&_svg]:ease-standard [&_svg]:transition-transform [&_svg]:duration-300 data-[state=open]:[&_svg]:rotate-45",
            )}
          >
            <GearSixIcon size={22} weight="regular" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={10}
          aria-label="Settings"
          className="border-border/60 bg-surface-elevated/70 shadow-float min-w-[14rem] backdrop-blur-xl"
        >
          <DropdownMenuLabel>Settings</DropdownMenuLabel>
          {settingsRows.map(({ id, Row }) => (
            <Row key={id} />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
