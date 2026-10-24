"use client";

import { Tooltip } from "@/components/ui";
import { cn } from "@/lib/cn";
import { computeStepStatuses, stepLabel, type StepStatus } from "./taskPresenter";
import type { Task, TaskState } from "./types";

// Trailing half of each segment's tooltip / accessible name — the step id
// alone ("Build report") doesn't say what's actually happening there now.
const STATUS_WORD: Record<StepStatus, string> = {
  pending: "Not started",
  gate: "Waiting on you",
  done: "Done",
  failed: "Failed",
  active: "In progress",
};

/** `.progress[data-state]` (globals.css) per task state: the fill's color and
 *  whether it shimmers. There is no "ok" here: the engine has no "done"
 *  state (a finished run just returns the task to "resting"), so a
 *  completed task reads as idle again rather than as a green full bar. */
const PROGRESS_STATE: Record<TaskState, "idle" | "run" | "gate" | "err"> = {
  resting: "idle",
  working: "run",
  finishing: "run",
  awaiting_review: "gate",
  awaiting_send: "gate",
  error: "err",
};

/** How far into the active segment the fill (and its leading marker) sits.
 *  The task data only says WHICH step is current, never how far through it
 *  the script is, so this is a fixed, honest "somewhere in it": a bit past
 *  the middle while running, nearly through it while finishing, and less
 *  when parked on a gate or a failure (the step has barely begun / died). */
const ACTIVE_FRACTION: Record<TaskState, number> = {
  resting: 0,
  working: 0.55,
  finishing: 0.85,
  awaiting_review: 0.4,
  awaiting_send: 0.4,
  error: 0.4,
};

/** Cuts the shared `.progress-bar` track into one segment per step (the CSS
 *  default is a fixed eight). The bar is 3px wider than the track so every
 *  segment, the last one included, is followed by a 3px gap that is clipped
 *  off the end. */
function segmentMask(count: number): string {
  const step = 100 / count;
  return `repeating-linear-gradient(90deg, #000 0, #000 calc(${step}% - 3px), transparent calc(${step}% - 3px), transparent ${step}%)`;
}

/** The caption above the bar. `step` is the current step's display name, or
 *  null when the task has no current step (idle, or a step id the manifest
 *  no longer has). */
function captionFor(task: Task, activeIndex: number, step: string | null): string {
  const count = task.steps.length;
  if (step === null) {
    switch (task.state) {
      case "resting":
        return `Not started · ${count} step${count === 1 ? "" : "s"}`;
      case "error":
        return "Failed";
      case "awaiting_review":
      case "awaiting_send":
        return "Waiting on you";
      default:
        return "Running";
    }
  }
  switch (task.state) {
    case "finishing":
      return `Finishing · ${step}`;
    case "awaiting_review":
    case "awaiting_send":
      return `Waiting on you · ${step}`;
    case "error":
      return `Failed at ${step}`;
    default:
      return `Step ${activeIndex + 1} of ${count} · ${step}`;
  }
}

interface StepTrackerProps {
  task: Task;
}

/** Segmented pipeline progress bar: one segment per manifest step, a label
 *  row above ("Step 3 of 7 · <step>", "Waiting on you · <step>", "Failed at
 *  <step>", "Finishing · <step>") with a percentage at the right. Built on the
 *  UI kit's `.progress*` styles (the same markup `<Progress/>` renders, see
 *  ui/Progress.tsx) with two additions that component can't express: a mask
 *  with one segment per step instead of a fixed eight, and a per-segment
 *  tooltip / focus target that keeps the old tracker's step-status semantics
 *  (done / in progress / waiting on you / failed / not started). Steps are
 *  fully dynamic per task — some have as few as 3 steps and no review/send
 *  gate at all — so this never assumes a fixed shape. Status derivation
 *  mirrors agentPresenter.js's `buildStepTracker` via
 *  taskPresenter.computeStepStatuses. */
export function StepTracker({ task }: StepTrackerProps) {
  const count = task.steps.length;
  if (count === 0) return null;
  const statuses = computeStepStatuses(task);

  const activeIndex = statuses.findIndex((s) => s !== "done" && s !== "pending");
  const state = PROGRESS_STATE[task.state];
  // With no current step the bar is empty whatever the state says.
  const pct =
    activeIndex === -1 ? 0 : ((activeIndex + ACTIVE_FRACTION[task.state]) / count) * 100;
  const step = activeIndex === -1 ? null : stepLabel(task, task.steps[activeIndex].id);
  const label = captionFor(task, activeIndex, step);

  const mask = segmentMask(count);
  const labelColor =
    state === "gate" ? "text-amber" : state === "err" ? "text-red" : "text-ink-soft";

  return (
    <div className="progress" data-state={state}>
      <div className="text-ink-muted mb-2.5 flex items-baseline justify-between gap-2.5 text-xs font-semibold">
        <span className={cn("truncate", labelColor)}>{label}</span>
        <span className="text-ink-soft shrink-0 tabular-nums">{Math.round(pct)}%</span>
      </div>
      <div className="relative">
        <div
          role="progressbar"
          aria-label="Pipeline progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
          aria-valuetext={label}
          className="progress-track"
        >
          <div
            className="progress-bar"
            style={{ maskImage: mask, WebkitMaskImage: mask }}
          >
            <i className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <i className="progress-dot" style={{ left: `${pct}%` }} />
        </div>
        {/* One hover/focus target per segment, laid over the track (same 3px
            overhang as the bar, so the zones line up with the segments). */}
        <div
          role="group"
          aria-label="Pipeline steps"
          className="absolute -top-2 -right-[3px] -bottom-2 left-0 flex"
        >
          {task.steps.map((s, index) => {
            const text = `${stepLabel(task, s.id)} — ${STATUS_WORD[statuses[index]]}`;
            return (
              <Tooltip key={s.id} label={text}>
                <span
                  tabIndex={0}
                  aria-label={text}
                  className="focus-visible:ring-focus min-w-0 flex-1 rounded-sm outline-none focus-visible:ring-2"
                />
              </Tooltip>
            );
          })}
        </div>
      </div>
    </div>
  );
}
