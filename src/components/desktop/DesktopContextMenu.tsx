"use client";

import type { ReactNode } from "react";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui";

/**
 * Wraps the desktop background (the wallpaper) in a right-click menu. This
 * is a mocked shell, not a real OS, so "Refresh" exists to make the desktop
 * feel like a real surface — it's plausible, not functional (per the
 * Desktop Shell & Chrome spec). It uses the frosted ContextMenu primitive
 * (`glass-pop`, spring open) like every other menu. The dark-mode toggle used to live here; it
 * now lives in the top-right settings menu (SettingsMenu.tsx), the single
 * entry point for theme switching.
 *
 * `className="contents"` on the trigger gives it no box of its own, so the
 * desktop's actual absolutely-positioned layers (currently just Wallpaper)
 * paint exactly as if this wrapper weren't there — position/z-index are
 * unaffected. The trigger element still sits in the DOM tree, so it still
 * receives the bubbled `contextmenu` event from whichever child the click
 * landed on, which is all Radix needs to open the menu at the cursor.
 */
export function DesktopContextMenu({ children }: { children: ReactNode }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger className="contents">{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem>
          <ArrowsClockwiseIcon size={16} aria-hidden className="text-ink-muted" />
          Refresh
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
