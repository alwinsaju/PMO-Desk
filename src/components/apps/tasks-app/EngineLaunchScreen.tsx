"use client";

import { useEffect, useState } from "react";
import { CircleNotchIcon, WarningIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui";
import { CopyDetailsButton } from "@/components/platform/CopyDetailsButton";
import { cn } from "@/lib/cn";
import { redact } from "@/lib/platform/redact";

interface EngineLaunchScreenProps {
  state: "launching" | "failed";
  /** Only meaningful for state === "failed". */
  reason?: string | null;
  /** Only meaningful for state === "failed": what to try, in order, when the failure was recognised. */
  steps?: string[];
  /** Only meaningful for state === "failed": the raw technical text, kept behind "Copy details". */
  detail?: string;
  /** Only meaningful for state === "launching": when this launch began. */
  startedAt?: number | null;
  /** Only meaningful for state === "launching": why the last attempt was retried. */
  retrying?: string | null;
  onRetry: () => void;
}

/** Whole seconds since `startedAt`, re-rendered once a second. */
function useElapsedSeconds(
  startedAt: number | null | undefined,
  active: boolean,
): number {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!active || startedAt == null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active, startedAt]);
  return startedAt == null || now == null
    ? 0
    : Math.max(0, Math.floor((now - startedAt) / 1000));
}

function launchingHint(elapsed: number, retrying: string | null | undefined): string {
  if (retrying) {
    return `Still waiting for it (${retrying}), trying again… ${elapsed} s`;
  }
  return elapsed >= 2
    ? `This usually only takes a few seconds… ${elapsed} s`
    : "This usually only takes a few seconds.";
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
  steps,
  detail,
  startedAt,
  retrying,
  onRetry,
}: EngineLaunchScreenProps) {
  const elapsed = useElapsedSeconds(startedAt, state === "launching");
  return (
    <div
      className={cn(
        "glass-pop rounded-surface shadow-pop flex w-full flex-col items-center gap-4 p-8 text-center",
        state === "failed" && steps?.length ? "max-w-md" : "max-w-sm",
      )}
    >
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
        <p
          className="text-ink-muted text-[13px] whitespace-pre-line"
          role={state === "failed" ? "alert" : "status"}
        >
          {state === "launching"
            ? launchingHint(elapsed, retrying)
            : reason || "Something went wrong while launching it."}
        </p>
      </div>

      {state === "failed" && steps && steps.length > 0 && (
        <ol className="text-ink-muted flex list-decimal flex-col gap-1.5 pl-5 text-left text-[13px]">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}

      {state === "failed" && (
        <div className="flex items-center">
          <Button onClick={onRetry}>Retry</Button>
          <CopyDetailsButton
            message={reason || "Couldn’t start the Tasks engine"}
            detail={redact(detail ?? reason ?? "")}
            where="Tasks engine launch"
          />
        </div>
      )}
    </div>
  );
}
