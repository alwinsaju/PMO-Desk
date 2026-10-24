"use client";

import { CircleNotchIcon, WarningIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui";

interface EngineLaunchScreenProps {
  state: "launching" | "failed";
  /** Only meaningful for state === "failed". */
  reason?: string | null;
  onRetry: () => void;
}

/**
 * Full-panel card shown by TasksAppGate while the Tasks engine is
 * being launched (see useEngineLauncher) or if that launch failed. A glass
 * surface (`glass-pop`, `rounded-surface`) rather than a bare spinner floating
 * on nothing; the accent is used exactly the way ARCHITECTURE.md scopes it —
 * this IS an "AI/agent is doing something" moment — and the failed state takes
 * the status red (`red-soft` disc, `text-red` icon).
 */
export function EngineLaunchScreen({
  state,
  reason,
  onRetry,
}: EngineLaunchScreenProps) {
  return (
    <div className="glass-pop rounded-surface shadow-pop flex w-full max-w-sm flex-col items-center gap-4 p-8 text-center">
      {state === "launching" ? (
        <span className="relative flex h-12 w-12 shrink-0 items-center justify-center">
          <span className="bg-accent-soft absolute inset-0 rounded-full motion-safe:animate-ping" />
          <span className="bg-accent-soft relative flex h-12 w-12 items-center justify-center rounded-full">
            <CircleNotchIcon
              size={22}
              weight="bold"
              className="text-accent-ink motion-safe:animate-spin"
            />
          </span>
        </span>
      ) : (
        <span className="bg-red-soft relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full">
          <WarningIcon size={22} weight="bold" className="text-red" />
        </span>
      )}

      <div className="flex flex-col gap-1.5">
        <p className="text-ink font-headline text-lg leading-tight">
          {state === "launching"
            ? "Starting the Tasks engine…"
            : "Couldn't start the Tasks engine"}
        </p>
        <p className="text-ink-muted text-[13px] whitespace-pre-line">
          {state === "launching"
            ? "This usually only takes a few seconds."
            : reason || "Something went wrong while launching it."}
        </p>
      </div>

      {state === "failed" && <Button onClick={onRetry}>Retry</Button>}
    </div>
  );
}
