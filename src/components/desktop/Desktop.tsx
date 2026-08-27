import { WindowManager } from "@/components/window-manager";
import { Wallpaper } from "./Wallpaper";

/**
 * The whole screen. A Server Component on purpose — it has no interactivity
 * of its own, it just composes the wallpaper (server-safe) with the window
 * layer (a client component, since it reads from the Zustand store). A
 * Server Component can render Client Components as children just fine, so
 * there's no need for "use client" on this file.
 *
 * This is intentionally tiny right now: its only job in this pass is to
 * prove the wallpaper + an empty window layer render correctly. Three more
 * mount points are ready and commented below for the phases that add them —
 * each is a single sibling of WindowManager, so none of them require
 * touching this file's structure, only uncommenting a line.
 */
export function Desktop() {
  return (
    <main className="relative h-screen w-screen overflow-hidden">
      <Wallpaper />
      <WindowManager />

      {/* Desktop Shell & Chrome phase — centered floating pill dock, fixed
          to the top of the screen. Should render above WindowManager using
          the `z-[var(--z-chrome)]` layer.
      <Dock /> */}

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
