"use client";

import {
  useEffect,
  useRef,
  type ComponentType,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import {
  AppWindowIcon,
  ArrowCounterClockwiseIcon,
  ArrowsClockwiseIcon,
  CircleNotchIcon,
  GearSixIcon,
  KeyboardIcon,
  LightningIcon,
  ListChecksIcon,
  LockKeyOpenIcon,
  BellRingingIcon,
  MoonIcon,
  RobotIcon,
  SlidersHorizontalIcon,
  SunIcon,
  TagIcon,
  TargetIcon,
} from "@phosphor-icons/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSwitchItem,
  DropdownMenuTrigger,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { useSetupUi } from "@/components/setup/setupStore";
import { usePreferences } from "@/lib/preferences/preferencesStore";
import { openSettings } from "@/components/apps/settings-app/settingsNav";
import { useFocusActive, useFocusMode } from "@/lib/focusModeStore";
import { remainingText } from "@/lib/focusMode";
import { useBrand } from "@/lib/useBrand";
import { restoreAppearanceFromServer } from "@/lib/theme";
import { useTheme } from "@/lib/useTheme";
import { WorkspaceLayoutsDialog } from "@/components/taskbar/WorkspaceLayoutsDialog";
import { useWorkspaceLayoutsUi } from "@/components/taskbar/workspaceLayoutsUi";
import { useEngineRestart, type EngineRestartStatus } from "./useEngineRestart";
import { useHardwareAcceleration } from "./useHardwareAcceleration";
import { useQuickCaptureSetting } from "./useQuickCaptureSetting";
import { useFastModel } from "./useFastModel";

/**
 * Quick settings: the menu rows below, opened from the App Menu (taskbar/AppMenu.tsx).
 *
 * To add a setting, write a row component (a `DropdownMenuSwitchItem`, or
 * another menu item built with `<RowBody>`) and append it to `settingsRows`
 * below. Rows own their own state source; this file only lays them out.
 */

/** Concentric rings — the glyph of "Deloitte mode" (matches the prototype's
 *  `i-rings`; Phosphor has no outlined double ring). */
function RingsGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

/** A settings row's body: an icon tile (rounded square that morphs to a
 *  circle with the accent tint while the row is highlighted), a bold title and
 *  a one-line hint. The row element must carry the `group` class. */
function RowBody({
  icon,
  title,
  hint,
  hintProps,
}: {
  icon: ReactNode;
  title: ReactNode;
  hint: ReactNode;
  hintProps?: HTMLAttributes<HTMLSpanElement>;
}) {
  return (
    <>
      <span
        className={cn(
          "bg-chip text-ink-soft rounded-control grid h-[34px] w-[34px] shrink-0 place-items-center",
          "ease-spring transition-[border-radius,background-color,color] duration-500",
          "group-data-[highlighted]:text-accent-ink group-data-[highlighted]:bg-accent-soft group-data-[highlighted]:rounded-full",
        )}
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-ink text-sm leading-tight font-semibold">{title}</span>
        <span
          {...hintProps}
          className={cn(
            "text-ink-muted mt-0.5 text-[12.5px] leading-snug break-words",
            hintProps?.className,
          )}
        >
          {hint}
        </span>
      </span>
    </>
  );
}

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
      className="group py-2.5"
    >
      <RowBody
        icon={<Glyph size={18} weight="regular" aria-hidden />}
        title="Dark mode"
        hint="Easy on the eyes"
      />
    </DropdownMenuSwitchItem>
  );
}

/** "Deloitte mode" — the brand palette + Open Sans, orthogonal to dark mode
 *  (`data-brand` on <html> + localStorage, via src/lib/theme.ts). */
function DeloitteModeRow() {
  const { brand, setBrand } = useBrand();
  return (
    <DropdownMenuSwitchItem
      checked={brand === "deloitte"}
      onCheckedChange={(checked) => setBrand(checked ? "deloitte" : "default")}
      className="group py-2.5"
    >
      <RowBody
        icon={<RingsGlyph size={18} />}
        title="Deloitte mode"
        hint="Brand palette and Open Sans"
      />
    </DropdownMenuSwitchItem>
  );
}

/** "Hardware acceleration" - rich visual effects (live blur wallpaper + drift,
 *  heavy glass blurs) and, in the desktop app, letting Chromium use the GPU.
 *  The effects switch instantly (`data-fx` on <html>, src/lib/displayFx.ts);
 *  the GPU choice is saved by the desktop shell and applies after a restart,
 *  so a "Restart now" row appears when the two differ. In a plain browser only
 *  the effects exist. */
function HardwareAccelerationRow() {
  const { view, relaunching, toggle, relaunch } = useHardwareAcceleration();
  return (
    <>
      <DropdownMenuSwitchItem
        checked={view.checked}
        onCheckedChange={toggle}
        disabled={view.disabled}
        className="group py-2.5"
      >
        <RowBody
          icon={<LightningIcon size={18} weight="regular" aria-hidden />}
          title="Hardware acceleration"
          hint={
            <>
              {view.hint}
              {view.warning ? (
                <span role="status" className="text-ink mt-0.5 block font-medium">
                  {view.warning}
                </span>
              ) : null}
            </>
          }
        />
      </DropdownMenuSwitchItem>
      {view.restartNeeded ? (
        <DropdownMenuItem
          aria-disabled={relaunching}
          onSelect={(event) => {
            event.preventDefault();
            if (!relaunching) relaunch();
          }}
          className="group gap-3 py-2.5"
        >
          <RowBody
            icon={
              relaunching ? (
                <CircleNotchIcon size={18} aria-hidden className="animate-spin" />
              ) : (
                <ArrowsClockwiseIcon size={18} weight="regular" aria-hidden />
              )
            }
            title={relaunching ? "Restarting..." : "Restart to apply"}
            hint="PMO Desk closes and reopens"
          />
        </DropdownMenuItem>
      ) : null}
    </>
  );
}

/** "Quick capture" - a global hotkey (Ctrl+Shift+Space) that brings PMO Desk forward from any
 *  other program with the command bar ready for "/todo ...". Desktop app only, off by default
 *  (a system-wide shortcut can clash with another program), and only while PMO Desk is
 *  running. If another program already owns the keys the row stays on and says why. */
function QuickCaptureRow() {
  const { available, view, toggle } = useQuickCaptureSetting();
  if (!available) return null;
  return (
    <DropdownMenuSwitchItem
      checked={view.checked}
      onCheckedChange={toggle}
      className="group py-2.5"
    >
      <RowBody
        icon={<KeyboardIcon size={18} weight="regular" aria-hidden />}
        title="Quick capture hotkey"
        hint={
          <>
            {view.hint}
            {view.warning ? (
              <span role="status" className="text-ink mt-0.5 block font-medium">
                {view.warning}
              </span>
            ) : null}
          </>
        }
      />
    </DropdownMenuSwitchItem>
  );
}

/** "Fast AI model" - switches the local AI between the careful default and a lighter model
 *  that answers in about half the time on a CPU-only computer. Downloads the light model
 *  the first time it is turned on. PTO emails are always read with the light model. */
function FastModelRow() {
  const { view, busy, toggle } = useFastModel();
  if (!view) return null;
  return (
    <DropdownMenuSwitchItem
      checked={view.checked}
      onCheckedChange={toggle}
      disabled={busy}
      className="group py-2.5"
    >
      <RowBody
        icon={<RobotIcon size={18} weight="regular" aria-hidden />}
        title="Fast AI model"
        hint={
          <span role="status" aria-live="polite">
            {view.hint}
          </span>
        }
      />
    </DropdownMenuSwitchItem>
  );
}

const RESTART_HINT = "Loads engine and task changes";

function restartHint(status: EngineRestartStatus): string {
  switch (status.kind) {
    case "checking":
      return "Checking for running tasks...";
    case "working":
      return status.phase === "stopping" ? "Stopping engine..." : "Starting engine...";
    case "done":
    case "error":
      return status.message;
    default:
      return RESTART_HINT;
  }
}

/** "Restart Tasks engine" - restarts the Tasks engine this app launched,
 *  so engine code and task manifest changes load without quitting PMO Desk.
 *  Warns first if a task is mid-run. Only uses the app's own launcher routes
 *  (see src/lib/engineRestart.ts); never an engine action endpoint. */
function RestartEngineRow() {
  const { status, requestRestart, confirmRestart, cancelRestart } = useEngineRestart();
  const cancelRef = useRef<HTMLDivElement>(null);
  const confirming = status.kind === "confirm";

  // Cancel is the default choice while the warning is showing.
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  if (status.kind === "confirm") {
    return (
      <>
        <DropdownMenuSeparator />
        <div role="alert" className="px-3 py-1.5 text-[12px] leading-snug">
          <p className="text-ink font-medium">A task is still in progress</p>
          <ul className="text-ink-muted mt-1 max-w-[17rem] list-disc pl-4">
            {status.busy.map((task, index) => (
              <li key={`${task.label}-${index}`} className="break-words">
                {task.label} ({task.state})
              </li>
            ))}
          </ul>
          <p className="text-ink-muted mt-1 max-w-[17rem]">
            Restarting the engine stops these runs. Files already written stay on disk.
          </p>
        </div>
        <DropdownMenuItem
          ref={cancelRef}
          onSelect={(event) => {
            event.preventDefault();
            cancelRestart();
          }}
        >
          Cancel
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            confirmRestart();
          }}
        >
          Stop runs and restart
        </DropdownMenuItem>
      </>
    );
  }

  const inProgress = status.kind === "checking" || status.kind === "working";
  const Glyph = inProgress ? CircleNotchIcon : ArrowsClockwiseIcon;
  return (
    <DropdownMenuItem
      aria-disabled={inProgress}
      onSelect={(event) => {
        event.preventDefault(); // keep the menu open so progress stays visible
        if (!inProgress) requestRestart();
      }}
      className="group gap-3 py-2.5"
    >
      <RowBody
        icon={
          <Glyph
            size={18}
            weight="regular"
            aria-hidden
            className={cn(inProgress && "animate-spin")}
          />
        }
        title="Restart Tasks engine"
        hint={restartHint(status)}
        hintProps={{
          role: "status",
          "aria-live": "polite",
          className: cn("max-w-[15rem]", status.kind === "error" && "text-ink"),
        }}
      />
    </DropdownMenuItem>
  );
}

/** "Setup and health check" - reopens the first-run setup screen (the local AI,
 *  its model, the OneDrive folders, classic Outlook, the Tasks engine). */
function SetupRow() {
  const openSetup = useSetupUi((state) => state.openSetup);
  return (
    <DropdownMenuItem onSelect={() => openSetup()} className="group gap-3 py-2.5">
      <RowBody
        icon={<ListChecksIcon size={18} weight="regular" aria-hidden />}
        title="Setup and health check"
        hint="Local AI, PMO inbox, Outlook, Tasks"
      />
    </DropdownMenuItem>
  );
}

/** "Skip the lock screen" - opens straight to the desktop. The lock screen is only a
 *  welcome screen, so this is a convenience, not a security setting. */
function InstantUnlockRow() {
  const instantUnlock = usePreferences((s) => s.instantUnlock);
  const setInstantUnlock = usePreferences((s) => s.setInstantUnlock);
  return (
    <DropdownMenuSwitchItem
      checked={instantUnlock}
      onCheckedChange={setInstantUnlock}
      className="group py-2.5"
    >
      <RowBody
        icon={<LockKeyOpenIcon size={18} weight="regular" aria-hidden />}
        title="Skip the lock screen"
        hint="Open straight to the desktop"
      />
    </DropdownMenuSwitchItem>
  );
}

/** "Needs you on the lock screen" - a one-line summary under the lock screen's clock. */
function LockSummaryRow() {
  const lockSummary = usePreferences((s) => s.lockSummary);
  const setLockSummary = usePreferences((s) => s.setLockSummary);
  return (
    <DropdownMenuSwitchItem
      checked={lockSummary}
      onCheckedChange={setLockSummary}
      className="group py-2.5"
    >
      <RowBody
        icon={<BellRingingIcon size={18} weight="regular" aria-hidden />}
        title="Show what needs you"
        hint="A line under the lock screen clock"
      />
    </DropdownMenuSwitchItem>
  );
}

/** "Show dock labels" - the app's name under each dock tile. Off by default: the dock is a
 *  narrow pill that already moves its tail into the App Menu on a small screen, and labels
 *  make each tile wider (so fewer fit before that happens). */
function DockLabelsRow() {
  const showDockLabels = usePreferences((s) => s.showDockLabels);
  const setShowDockLabels = usePreferences((s) => s.setShowDockLabels);
  return (
    <DropdownMenuSwitchItem
      checked={showDockLabels}
      onCheckedChange={setShowDockLabels}
      className="group py-2.5"
    >
      <RowBody
        icon={<TagIcon size={18} weight="regular" aria-hidden />}
        title="Show dock labels"
        hint="A name under each dock icon"
      />
    </DropdownMenuSwitchItem>
  );
}

/** "Reopen my apps at launch" - opens the apps that were open last time when PMO Desk
 *  starts (one window per app; each in the place it was last left). */
function ReopenAppsRow() {
  const reopenLastApps = usePreferences((s) => s.reopenLastApps);
  const setReopenLastApps = usePreferences((s) => s.setReopenLastApps);
  return (
    <DropdownMenuSwitchItem
      checked={reopenLastApps}
      onCheckedChange={setReopenLastApps}
      className="group py-2.5"
    >
      <RowBody
        icon={<ArrowCounterClockwiseIcon size={18} weight="regular" aria-hidden />}
        title="Reopen my apps at launch"
        hint="Start with the apps you had open"
      />
    </DropdownMenuSwitchItem>
  );
}

/** "Workspace layouts" - opens the dialog that saves the open apps and window positions under
 *  a name and brings one back (the dialog is mounted by `SettingsMenu` below). */
function WorkspaceLayoutsRow() {
  const openLayouts = useWorkspaceLayoutsUi((s) => s.openLayouts);
  return (
    <DropdownMenuItem onSelect={() => openLayouts()} className="group gap-3 py-2.5">
      <RowBody
        icon={<AppWindowIcon size={18} weight="regular" aria-hidden />}
        title="Workspace layouts"
        hint="Save and restore open apps and windows"
      />
    </DropdownMenuItem>
  );
}

/** "Focus mode" - hides the dock and holds back notices for 25 minutes (or say "focus for 40
 *  minutes" in the command bar). Errors still show; everything held is in the notification list. */
function FocusModeRow() {
  const until = useFocusMode((s) => s.until);
  const active = useFocusActive();
  const start = useFocusMode((s) => s.start);
  const stop = useFocusMode((s) => s.stop);
  return (
    <DropdownMenuSwitchItem
      checked={active}
      onCheckedChange={(on) => (on ? start() : stop())}
      className="group py-2.5"
    >
      <RowBody
        icon={<TargetIcon size={18} weight="regular" aria-hidden />}
        title="Focus mode"
        hint={
          active
            ? remainingText(until, Date.now())
            : "Hide the dock, quiet notices (25 min)"
        }
      />
    </DropdownMenuSwitchItem>
  );
}

/** "All settings" - the Settings window: command-bar confirmations and history, notifications,
 *  shortcuts and accessibility in one place. */
function AllSettingsRow() {
  return (
    <DropdownMenuItem
      onSelect={() => openSettings("general")}
      className="group gap-3 py-2.5"
    >
      <RowBody
        icon={<SlidersHorizontalIcon size={18} weight="regular" aria-hidden />}
        title="All settings"
        hint="Notifications, shortcuts, accessibility (Ctrl+,)"
      />
    </DropdownMenuItem>
  );
}

const settingsRows: { id: string; Row: ComponentType }[] = [
  { id: "dark-mode", Row: DarkModeRow },
  { id: "deloitte-mode", Row: DeloitteModeRow },
  { id: "instant-unlock", Row: InstantUnlockRow },
  { id: "lock-summary", Row: LockSummaryRow },
  { id: "focus-mode", Row: FocusModeRow },
  { id: "dock-labels", Row: DockLabelsRow },
  { id: "reopen-apps", Row: ReopenAppsRow },
  { id: "workspace-layouts", Row: WorkspaceLayoutsRow },
  { id: "all-settings", Row: AllSettingsRow },
  { id: "hardware-acceleration", Row: HardwareAccelerationRow },
  { id: "quick-capture", Row: QuickCaptureRow },
  { id: "fast-model", Row: FastModelRow },
  { id: "restart-engine", Row: RestartEngineRow },
  { id: "setup", Row: SetupRow },
];

/** Picks the saved look up once on a new origin (e.g. another port: empty localStorage).
 *  Mounted from Desktop.tsx; it draws nothing, the settings live in the App Menu. */
export function SettingsMenu() {
  useEffect(() => {
    void restoreAppearanceFromServer();
  }, []);
  return <WorkspaceLayoutsDialog />;
}

/**
 * The "Quick settings" button and menu, shown in the App Menu's header (the old
 * top-right gear moved there so windows can use the whole screen). A dropdown
 * opened from inside the App Menu's popover is a child layer of it, so using a
 * row does not close the App Menu.
 */
export function QuickSettings() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Settings"
          className={cn(
            "text-ink-soft rounded-control flex h-9 items-center gap-2 px-3 text-[13px] font-semibold",
            "hover:bg-chip hover:text-ink data-[state=open]:bg-chip data-[state=open]:text-ink transition-colors",
            "focus-visible:ring-focus focus-visible:ring-2 focus-visible:outline-none",
            "[&_svg]:ease-spring [&_svg]:transition-transform [&_svg]:duration-500 data-[state=open]:[&_svg]:rotate-90",
          )}
        >
          <GearSixIcon size={18} weight="regular" aria-hidden />
          Settings
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={10}
        aria-label="Settings"
        collisionPadding={12}
        className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-[min(21rem,calc(100vw-2rem))] overflow-y-auto p-2.5"
      >
        <DropdownMenuLabel>Quick settings</DropdownMenuLabel>
        {settingsRows.map(({ id, Row }) => (
          <Row key={id} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
