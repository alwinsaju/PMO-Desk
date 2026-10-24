"use client";

import { useEffect, useRef, type ComponentType } from "react";
import {
  ArrowsClockwiseIcon,
  CircleNotchIcon,
  GearSixIcon,
  MoonIcon,
  SunIcon,
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
import { useTheme } from "@/lib/useTheme";
import { useBackendRestart, type BackendRestartStatus } from "./useBackendRestart";

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

const RESTART_HINT = "Loads backend and task changes";

function restartHint(status: BackendRestartStatus): string {
  switch (status.kind) {
    case "checking":
      return "Checking for running tasks...";
    case "working":
      return status.phase === "stopping" ? "Stopping backend..." : "Starting backend...";
    case "done":
    case "error":
      return status.message;
    default:
      return RESTART_HINT;
  }
}

/** "Restart backend" - restarts the Agent Office backend this app launched,
 *  so backend code and task manifest changes load without quitting AI OS.
 *  Warns first if a task is mid-run. Only uses the app's own launcher routes
 *  (see src/lib/backendRestart.ts); never a backend action endpoint. */
function RestartBackendRow() {
  const { status, requestRestart, confirmRestart, cancelRestart } = useBackendRestart();
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
        <div role="alert" className="px-2.5 py-1.5 text-[12px] leading-snug">
          <p className="text-ink font-medium">A task is still in progress</p>
          <ul className="text-ink-muted mt-1 max-w-[17rem] list-disc pl-4">
            {status.busy.map((task, index) => (
              <li key={`${task.label}-${index}`} className="break-words">
                {task.label} ({task.state})
              </li>
            ))}
          </ul>
          <p className="text-ink-muted mt-1 max-w-[17rem]">
            Restarting the backend stops these runs. Files already written stay on disk.
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
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        aria-disabled={inProgress}
        onSelect={(event) => {
          event.preventDefault(); // keep the menu open so progress stays visible
          if (!inProgress) requestRestart();
        }}
        className="items-start gap-3 py-2"
      >
        <Glyph
          size={16}
          weight="regular"
          aria-hidden
          className={cn("mt-0.5 shrink-0", inProgress && "animate-spin")}
        />
        <span className="flex min-w-0 flex-col">
          <span>Restart backend</span>
          <span
            role="status"
            aria-live="polite"
            className={cn(
              "mt-0.5 max-w-[15rem] text-[11px] leading-snug break-words",
              status.kind === "error" ? "text-ink" : "text-ink-faint",
            )}
          >
            {restartHint(status)}
          </span>
        </span>
      </DropdownMenuItem>
    </>
  );
}

const settingsRows: { id: string; Row: ComponentType }[] = [
  { id: "dark-mode", Row: DarkModeRow },
  { id: "restart-backend", Row: RestartBackendRow },
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
