import { WindowManager } from "@/components/window-manager";
import { Dock } from "@/components/taskbar";
import {
  AICursor,
  AIAnnotationBubble,
  CommandBar,
  PresenceAvatars,
} from "@/components/ai-layer";
import { DesktopContextMenu } from "./DesktopContextMenu";
import { PmoReminders } from "./PmoReminders";
import { SettingsMenu } from "./SettingsMenu";
import { Wallpaper } from "./Wallpaper";

/**
 * The whole screen. A Server Component on purpose — it has no interactivity
 * of its own, it just composes the wallpaper (wrapped in a right-click
 * context menu), the window layer, the dock, the top-right settings menu,
 * and the AI Agent Layer. Each of
 * those is its own Client Component where it needs interactivity; a Server
 * Component can render Client Components as children just fine, so there's
 * no need for "use client" on this file.
 *
 * CommandBar/AICursor/AIAnnotationBubble/PresenceAvatars are all mounted
 * as plain siblings here — AICursor and AIAnnotationBubble portal to
 * `document.body` internally (see their own files), so their position in
 * this tree only matters for import wiring, not for where they visually
 * render.
 */
export function Desktop() {
  return (
    <main className="relative h-screen w-screen overflow-hidden">
      <DesktopContextMenu>
        <Wallpaper />
      </DesktopContextMenu>
      <WindowManager />
      <Dock />
      <SettingsMenu />
      <PmoReminders />

      <CommandBar />
      <AICursor />
      <AIAnnotationBubble />
      <PresenceAvatars />
    </main>
  );
}
