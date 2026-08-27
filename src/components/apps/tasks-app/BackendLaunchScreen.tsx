"use client";

import { CircleNotchIcon, WarningIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui";

interface BackendLaunchScreenProps {
  state: "launching" | "failed";
  /** Only meaningful for state === "failed". */
  reason?: string | null;
  onRetry: () => void;
}

/**
 * Full-panel card shown by TasksAppGate while the agent-office backend is
 * being launched (see useBackendLauncher) or if that launch failed. Same
 * frosted-chrome treatment as the dock/window overlays
 * (bg-surface-elevated/70 + backdrop-blur + shadow-float, see Dock.tsx and
 * the UI kit's Dialog) rather than a bare spinner floating on nothing, and
 * the one accent color used exactly the way ARCHITECTURE.md scopes it —
 * this IS an "AI/agent is doing something" moment. The failed state
 * deliberately reuses the same ink/neutral (never red) error language as
 * TaskStateBadge's `error` state, for the same "no second accent color"
 * reason.
 */
export function BackendLaunchScreen({
  state,
  reason,
  onRetry,
}: BackendLaunchScreenProps) {
  return (
    <div className="border-border/60 bg-surface-elevated/70 shadow-float-lg flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl border p-8 text-center backdrop-blur-xl">
      {state === "launching" ? (
        <span className="relative flex h-12 w-12 shrink-0 items-center justify-center">
          <span className="bg-accent/20 absolute inset-0 animate-ping rounded-full" />
          <span className="bg-accent-subtle relative flex h-12 w-12 items-center justify-center rounded-full">
            <CircleNotchIcon
              size={22}
              weight="bold"
              className="text-accent animate-spin"
            />
          </span>
        </span>
      ) : (
        <span className="bg-ink relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full">
          <WarningIcon size={22} weight="bold" className="text-white" />
        </span>
      )}

      <div className="flex flex-col gap-1">
        <p className="text-ink text-sm font-medium">
          {state === "launching"
            ? "Starting the agent-office backend…"
            : "Couldn't start the agent-office backend"}
        </p>
        <p className="text-ink-faint text-[12px] whitespace-pre-line">
          {state === "launching"
            ? "This usually only takes a few seconds."
            : reason || "Something went wrong while launching it."}
        </p>
      </div>

      {state === "failed" && (
        <Button size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
