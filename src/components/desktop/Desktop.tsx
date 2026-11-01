import { WindowManager } from "@/components/window-manager";
import { Dock } from "@/components/taskbar";
import {
  AICursor,
  AIAnnotationBubble,
  CommandBar,
  PresenceAvatars,
} from "@/components/ai-layer";
import { FirstRunSetup } from "@/components/setup/FirstRunSetup";
import { FirstTimeSetup } from "@/components/setup/FirstTimeSetup";
import { GlobalSearch } from "@/components/search/GlobalSearch";
import { DesktopContextMenu } from "./DesktopContextMenu";
import { PmoReminders } from "./PmoReminders";
import { TasksBackground } from "@/components/apps/tasks-app/TasksBackground";
import { NeedsYouBadge } from "./NeedsYouBadge";
import { BriefingBackground } from "./BriefingBackground";
import { RegistersBackground } from "./RegistersBackground";
import { GuidedTour } from "./GuidedTour";
import { PlatformBackground } from "./PlatformBackground";
import { HiddenInFocus } from "./HiddenInFocus";
import { DesktopWidget } from "./DesktopWidget";
import { ShellEffects } from "./ShellEffects";
import { SettingsMenu } from "./SettingsMenu";
import { CommandBarHue } from "./CommandBarHue";
import { Wallpaper } from "./Wallpaper";

/**
 * The whole screen. A Server Component on purpose — it has no interactivity
 * of its own, it just composes the wallpaper (wrapped in a right-click
 * context menu), the window layer, the dock, the AI Agent Layer, and the invisible
 * settings-restore step (the settings themselves live in the App Menu). Each of
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
      <DesktopWidget />
      <WindowManager />
      <HiddenInFocus>
        <Dock />
      </HiddenInFocus>
      <SettingsMenu />
      <CommandBarHue />
      <PmoReminders />
      <TasksBackground />
      <NeedsYouBadge />
      <BriefingBackground />
      <RegistersBackground />
      <PlatformBackground />
      <GuidedTour />
      <FirstRunSetup />
      <FirstTimeSetup />
      <GlobalSearch />
      <ShellEffects />
      <CommandBar />
      <AICursor />
      <AIAnnotationBubble />
      <PresenceAvatars />
    </main>
  );
}
