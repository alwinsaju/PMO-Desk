"use client";

import { CheckIcon, PauseIcon, XIcon } from "@phosphor-icons/react";
import { Tooltip } from "@/components/ui";
import { cn } from "@/lib/cn";
import { computeStepStatuses, humanize, type StepStatus } from "./taskPresenter";
import type { Task } from "./types";

// Nodes communicate status via fill/border value contrast (+ a small glyph),
// never a second accent hue — "active" is the one legitimate accent use,
// for the same reason given in TaskStateBadge.tsx: it's the one state where
// an agent is genuinely working right now. "gate" stays hollow like
// "pending" rather than filled, because it's still an open question waiting
// on a human, not a settled outcome; "done" and "failed" are both filled
// for the opposite reason (something happened, for better or worse),
// differing only by glyph — the same restraint TaskStateBadge's "Error"
// state uses instead of reaching for a red accent. Shadowed states read as
// "raised" (the same soft, neutral shadow the UI kit's Slider/Switch
// thumbs use), reserving the flat/flush look for "pending" alone.
const DOT_CLASS: Record<StepStatus, string> = {
  pending: "border border-neutral-300 bg-surface-elevated",
  gate: "border-2 border-ink bg-surface-elevated shadow-float-sm",
  done: "bg-ink shadow-float-sm",
  failed: "bg-ink shadow-float-sm",
  active: "bg-accent shadow-float-sm",
};

// Trailing half of each node's tooltip label — the step id alone ("Build
// report") doesn't say what's actually happening there right now.
const STATUS_WORD: Record<StepStatus, string> = {
  pending: "Not started",
  gate: "Waiting on you",
  done: "Done",
  failed: "Failed",
  active: "In progress",
};

interface StepTrackerProps {
  task: Task;
}

/** Horizontal dot-and-track pipeline tracker: one node per manifest step,
 *  styled by done/active/gate/failed/pending (see
 *  taskPresenter.computeStepStatuses). Steps are fully dynamic per task —
 *  some have as few as 3 steps and no review/send gate at all — so this
 *  never assumes a fixed shape. Mirrors agentPresenter.js's
 *  `buildStepTracker` rule exactly — only the visual treatment below is
 *  this project's own: the pill-shaped track echoes the UI kit's Slider
 *  track/range, and the node sizing/shadow echoes its Slider/Switch
 *  thumbs, so the tracker reads as this design system's own control rather
 *  than a generic progress-bar-library widget. */
export function StepTracker({ task }: StepTrackerProps) {
  if (task.steps.length === 0) return null;
  const statuses = computeStepStatuses(task);

  return (
    <div className="flex items-center py-1" aria-label="Pipeline steps">
      {task.steps.map((step, index) => {
        const status = statuses[index];
        const isLast = index === task.steps.length - 1;
        return (
          <div key={step.id} className={cn("flex items-center", !isLast && "flex-1")}>
            <Tooltip label={`${humanize(step.id)} — ${STATUS_WORD[status]}`}>
              <span
                tabIndex={0}
                className={cn(
                  "relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full outline-none",
                  "ease-standard transition-transform duration-150 hover:scale-110",
                  "focus-visible:ring-accent focus-visible:ring-offset-surface focus-visible:ring-2 focus-visible:ring-offset-2",
                  DOT_CLASS[status],
                )}
              >
                {status === "active" && (
                  <span
                    aria-hidden
                    className="bg-accent pointer-events-none absolute inset-0 animate-ping rounded-full opacity-50"
                  />
                )}
                {status === "done" && (
                  <CheckIcon size={11} weight="bold" className="text-accent-contrast" />
                )}
                {status === "gate" && (
                  <PauseIcon size={11} weight="bold" className="text-ink" />
                )}
                {status === "failed" && (
                  <XIcon size={11} weight="bold" className="text-accent-contrast" />
                )}
              </span>
            </Tooltip>
            {!isLast && (
              <span
                className={cn(
                  "rounded-pill mx-1.5 h-1.5 flex-1",
                  status === "done" ? "bg-ink" : "bg-neutral-150",
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
