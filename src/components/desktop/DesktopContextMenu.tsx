"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui";
import { getStoredTheme, setTheme } from "@/lib/theme";

/**
 * Wraps the desktop background (the wallpaper) in a right-click menu. This
 * is a mocked shell, not a real OS, so "Refresh" exists to make the desktop
 * feel like a real surface — it's plausible, not functional (per the
 * Desktop Shell & Chrome spec). The dark-mode toggle below it is the one
 * real, functional item: there's no Settings app yet, so this menu is its
 * sensible minimal-scope home until one exists to relocate it into.
 *
 * `className="contents"` on the trigger gives it no box of its own, so the
 * desktop's actual absolutely-positioned layers (currently just Wallpaper)
 * paint exactly as if this wrapper weren't there — position/z-index are
 * unaffected. The trigger element still sits in the DOM tree, so it still
 * receives the bubbled `contextmenu` event from whichever child the click
 * landed on, which is all Radix needs to open the menu at the cursor.
 */
export function DesktopContextMenu({ children }: { children: ReactNode }) {
  // Lazy-init from localStorage (see src/lib/theme.ts) rather than a
  // hydration-synced effect: ContextMenuContent is a Radix portal that
  // doesn't mount into the DOM until the menu is actually opened, so
  // there's no server-rendered markup for this checkbox to ever mismatch
  // against — by the time a user can see it, the client is all there is.
  const [isDark, setIsDark] = useState(() => getStoredTheme() === "dark");

  return (
    <ContextMenu>
      <ContextMenuTrigger className="contents">{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem>Refresh</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuCheckboxItem
          checked={isDark}
          onCheckedChange={(checked) => {
            setTheme(checked ? "dark" : "light");
            setIsDark(checked);
          }}
        >
          Dark Mode
        </ContextMenuCheckboxItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
