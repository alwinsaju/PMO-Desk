"use client";

import { CheckIcon, XIcon } from "@phosphor-icons/react";
import { Tooltip } from "@/components/ui";
import { cn } from "@/lib/cn";
import { computeStepStatuses, humanize, type StepStatus } from "./taskPresenter";
import type { Task } from "./types";

// Dots communicate status via fill/border value contrast (+ a checkmark or
// "!" glyph for the two terminal states), never a second accent hue —
// "active" is the one legitimate accent use, for the same reason given in
// TaskStateBadge.tsx.
const DOT_CLASS: Record<StepStatus, string> = {
  done: "border-ink bg-ink",
  active: "border-accent bg-accent animate-pulse",
  gate: "border-ink bg-surface-elevated border-2",
  failed: "border-ink bg-ink",
  pending: "border-neutral-300 bg-surface-elevated",
};

interface StepTrackerProps {
  task: Task;
}

/** Horizontal dot-and-line pipeline tracker: one dot per manifest step,
 *  colored by done/active/gate/failed/pending (see
 *  taskPresenter.computeStepStatuses). Steps are fully dynamic per task —
 *  some have as few as 3 steps and no review/send gate at all — so this
 *  never assumes a fixed shape. Mirrors agentPresenter.js's
 *  `buildStepTracker` rule exactly, restyled in this project's tokens. */
export function StepTracker({ task }: StepTrackerProps) {
  if (task.steps.length === 0) return null;
  const statuses = computeStepStatuses(task);

  return (
    <div className="flex items-center" aria-label="Pipeline steps">
      {task.steps.map((step, index) => {
        const status = statuses[index];
        const isLast = index === task.steps.length - 1;
        return (
          <div key={step.id} className={cn("flex items-center", !isLast && "flex-1")}>
            <Tooltip label={humanize(step.id)}>
              <span
                tabIndex={0}
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border outline-none",
                  DOT_CLASS[status],
                )}
              >
                {status === "done" && (
                  <CheckIcon size={9} weight="bold" className="text-accent-contrast" />
                )}
                {status === "failed" && (
                  <XIcon size={9} weight="bold" className="text-accent-contrast" />
                )}
              </span>
            </Tooltip>
            {!isLast && (
              <span
                className={cn(
                  "mx-1 h-px flex-1",
                  status === "done" ? "bg-ink" : "bg-neutral-200",
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
