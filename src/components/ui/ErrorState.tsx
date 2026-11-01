"use client";

import * as React from "react";
import {
  ArrowClockwiseIcon,
  CheckIcon,
  CopyIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { appVersionKnown } from "@/lib/platform/reportError";
import { TERMS } from "@/lib/ui/terms";
import { Button } from "./Button";
import { errorStateDetails, type ErrorStateInfo } from "./errorStateLogic";

export interface ErrorStateProps
  extends ErrorStateInfo, Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  /** What to do about it, e.g. "Check that Outlook is open, then retry." */
  nextStep?: string;
  /** Shows the Retry button. */
  onRetry?: () => void;
  retrying?: boolean;
  retryLabel?: string;
  icon?: React.ReactNode;
  compact?: boolean;
}

type CopyState = "idle" | "copied" | "failed";

/**
 * A failure that is not a dead end: what failed, the likely cause, the next
 * step, Retry and "Copy details" (version, time, place and technical text).
 */
export function ErrorState({
  title,
  cause,
  detail,
  where,
  nextStep,
  onRetry,
  retrying = false,
  retryLabel = TERMS.retry,
  icon,
  compact = false,
  className,
  ...props
}: ErrorStateProps) {
  const [copy, setCopy] = React.useState<CopyState>("idle");
  const timer = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(timer.current), []);

  const copyDetails = async () => {
    let next: CopyState = "copied";
    try {
      await navigator.clipboard.writeText(
        errorStateDetails(
          { title, cause, detail, where },
          { appVersion: appVersionKnown() },
        ),
      );
    } catch {
      next = "failed";
    }
    setCopy(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopy("idle"), 2500);
  };

  return (
    <div
      role="alert"
      className={cn(
        "mx-auto flex w-full max-w-md flex-col items-center justify-center text-center",
        compact ? "gap-2 px-4 py-6" : "min-h-64 gap-3 px-6 py-10",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className="bg-red-soft text-red grid h-12 w-12 place-items-center rounded-full"
      >
        {icon ?? <WarningCircleIcon size={22} />}
      </span>
      <h3 className="text-ink text-[15px] leading-snug font-semibold">{title}</h3>
      {cause && (
        <p className="text-ink-muted text-[13px] leading-relaxed">
          <span className="text-ink-soft font-semibold">Likely cause: </span>
          {cause}
        </p>
      )}
      {nextStep && (
        <p className="text-ink-soft text-[13px] leading-relaxed">
          <span className="font-semibold">Next: </span>
          {nextStep}
        </p>
      )}
      <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
        {onRetry && (
          <Button size="sm" onClick={onRetry} disabled={retrying}>
            <ArrowClockwiseIcon size={14} weight="bold" />
            {retrying ? "Retrying..." : retryLabel}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => void copyDetails()}>
          {copy === "copied" ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
          {copy === "copied" ? TERMS.copied : TERMS.copyDetails}
        </Button>
      </div>
      <span role="status" className="sr-only">
        {copy === "copied" ? "Details copied to the clipboard" : ""}
        {copy === "failed" ? "Could not copy to the clipboard" : ""}
      </span>
    </div>
  );
}
