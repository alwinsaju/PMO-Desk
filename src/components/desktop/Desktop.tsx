import { WindowManager } from "@/components/window-manager";
import { Dock } from "@/components/taskbar";
import { DesktopContextMenu } from "./DesktopContextMenu";
import { DesktopIcons } from "./DesktopIcons";
import { Wallpaper } from "./Wallpaper";

/**
 * The whole screen. A Server Component on purpose — it has no interactivity
 * of its own, it just composes the wallpaper + icon grid (wrapped in a
 * right-click context menu), the window layer, and the dock. Each of those
 * is its own Client Component where it needs interactivity; a Server
 * Component can render Client Components as children just fine, so there's
 * no need for "use client" on this file.
 *
 * Two more mount points are ready and commented below for the AI Agent
 * Layer phase — each is a single sibling of WindowManager, so neither
 * requires touching this file's structure, only uncommenting a line.
 */
export function Desktop() {
  return (
    <main className="relative h-screen w-screen overflow-hidden">
      <DesktopContextMenu>
        <Wallpaper />
        <DesktopIcons />
      </DesktopContextMenu>
      <WindowManager />
      <Dock />

      {/* AI Agent Layer phase — centered floating pill command bar, fixed
          to the bottom of the screen; the AI cursor overlay and inline
          annotation bubbles (also `z-[var(--z-chrome)]`/`z-[var(--z-overlay)]`
          as appropriate); and the collapsible task/agent detail panel.
      <CommandBar />
      <AiCursorOverlay /> */}

      {/* AI Agent Layer phase — small circular presence avatars in the
          bottom corners (use <Avatar presence="active|idle"> from the UI
          kit — see src/components/ui/Avatar.tsx).
      <PresenceAvatar side="left" />
      <PresenceAvatar side="right" /> */}
    </main>
  );
}
