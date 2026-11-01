"use client";

import { CheckIcon, ClockIcon, XIcon } from "@phosphor-icons/react";
import { Tooltip } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { StepStatus } from "./taskPresenter";
import { stepperSummary, type StepperItem } from "./workflowView";

const STATUS_WORD: Record<StepStatus, string> = {
  pending: "Not started",
  gate: "Waiting on you",
  done: "Done",
  failed: "Failed",
  active: "In progress",
};

/** Fill colour per status: green done, accent running, amber waiting on you, red failed. */
const DOT: Record<StepStatus, string> = {
  done: "bg-success-dot",
  active: "bg-accent motion-safe:animate-blink",
  gate: "bg-amber motion-safe:animate-blink",
  failed: "bg-red",
  pending: "bg-chip-strong",
};

const TEXT: Record<StepStatus, string> = {
  done: "text-success",
  active: "text-accent-ink",
  gate: "text-amber",
  failed: "text-red",
  pending: "text-ink-muted",
};

/** The card's mini timeline: one dot per step joined by a line, coloured by status. */
export function StepDots({ items }: { items: readonly StepperItem[] }) {
  if (items.length === 0) return null;
  return (
    <ol
      aria-label={`Steps: ${stepperSummary(items)}`}
      className="flex items-center"
      data-testid="step-dots"
    >
      {items.map((item, index) => {
        const text = `${item.label} — ${STATUS_WORD[item.status]}`;
        return (
          <li key={item.id} className="flex min-w-0 flex-1 items-center last:flex-none">
            <Tooltip label={text}>
              <span
                tabIndex={0}
                role="img"
                aria-label={text}
                data-status={item.status}
                className={cn(
                  "focus-visible:ring-focus h-2.5 w-2.5 shrink-0 rounded-full outline-none focus-visible:ring-2",
                  DOT[item.status],
                )}
              />
            </Tooltip>
            {index < items.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  "mx-1 h-0.5 min-w-1 flex-1 rounded-full",
                  item.status === "done" ? "bg-success-dot/60" : "bg-chip-strong",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function StepMarker({ status, number }: { status: StepStatus; number: number }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
        status === "done" && "bg-success-soft text-success",
        status === "active" && "bg-accent-soft text-accent-ink",
        status === "gate" && "bg-amber-soft text-amber",
        status === "failed" && "bg-red-soft text-red",
        status === "pending" && "bg-chip text-ink-muted",
      )}
    >
      {status === "done" ? (
        <CheckIcon size={12} weight="bold" />
      ) : status === "failed" ? (
        <XIcon size={12} weight="bold" />
      ) : status === "gate" ? (
        <ClockIcon size={12} weight="bold" />
      ) : status === "active" ? (
        <i className="bg-accent motion-safe:animate-blink h-2 w-2 rounded-full" />
      ) : (
        number
      )}
    </span>
  );
}

/** Details' vertical stepper: a rail of numbered markers with each step's label and status. */
export function StepStepper({ items }: { items: readonly StepperItem[] }) {
  if (items.length === 0) return null;
  return (
    <ol aria-label="Steps" className="flex flex-col" data-testid="step-stepper">
      {items.map((item, index) => (
        <li key={item.id} className="relative flex gap-3 pb-3 last:pb-0">
          {index < items.length - 1 && (
            <span
              aria-hidden
              className={cn(
                "absolute top-6 bottom-0 left-3 w-0.5 -translate-x-1/2 rounded-full",
                item.status === "done" ? "bg-success-dot/60" : "bg-chip-strong",
              )}
            />
          )}
          <StepMarker status={item.status} number={index + 1} />
          <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
            <span
              className={cn(
                "min-w-0 truncate text-[13.5px]",
                item.status === "pending" ? "text-ink-soft" : "text-ink font-semibold",
              )}
            >
              {item.label}
            </span>
            <span className={cn("shrink-0 text-[12px] font-semibold", TEXT[item.status])}>
              {STATUS_WORD[item.status]}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}
