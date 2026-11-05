// What a workflow card and the Details stepper show: icon, last run, step statuses. Pure.
import { durationMs, formatDuration } from "../../../lib/tasks/runHistory.ts";
import { outcomeInfo } from "./historyRows.ts";
import { computeStepStatuses, stepLabel, type StepStatus } from "./taskPresenter.ts";
import type { HistoryRun, Task } from "./types.ts";

export type WorkflowIconKey = "mail" | "roster" | "incident" | "report" | "workflow";

const ICON_RULES: ReadonlyArray<readonly [RegExp, WorkflowIconKey]> = [
  [/mail|send|notice/i, "mail"],
  [/roster|shift|staff|holiday/i, "roster"],
  [/incident|aging|disconnect|ticket/i, "incident"],
  [/report|deck|backlog|analytic|pivot/i, "report"],
];

/** The icon family for a workflow, guessed from its id and name. */
export function workflowIcon(task: Pick<Task, "id" | "displayName">): WorkflowIconKey {
  const text = `${task.id} ${task.displayName}`;
  return ICON_RULES.find(([pattern]) => pattern.test(text))?.[1] ?? "workflow";
}

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 d ago", else a short date. */
export function relativeTime(iso: string, now: Date): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const minutes = Math.floor((now.getTime() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} d ago`;
  return new Date(then).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** The most recently finished run, or null. */
export function latestRun(runs: readonly HistoryRun[]): HistoryRun | null {
  let best: HistoryRun | null = null;
  for (const run of runs) {
    if (!best || Date.parse(run.ended_at) > Date.parse(best.ended_at)) best = run;
  }
  return best;
}

export interface LastRunInfo {
  tone: "success" | "danger" | "neutral";
  /** "Completed 2 h ago · 4 min", "Failed yesterday", or "Not run yet". */
  text: string;
}

export function lastRunInfo(
  runs: readonly HistoryRun[],
  now: Date,
  state?: string,
): LastRunInfo {
  const run = latestRun(runs);
  if (!run) {
    // "Not run yet" must not sit beside a run that is under way or waiting for you.
    return {
      tone: "neutral",
      text: state && state !== "resting" ? "First run in progress" : "Not run yet",
    };
  }
  const info = outcomeInfo(run.outcome);
  const when = relativeTime(run.ended_at, now);
  const took = info.label === "Completed" ? ` · ${formatDuration(durationMs(run))}` : "";
  return { tone: info.tone, text: `${info.label} ${when}${took}` };
}

export interface StepperItem {
  id: string;
  label: string;
  status: StepStatus;
}

/** Per-step statuses for the card timeline and the Details stepper. Progress only reflects the
 *  current run: a live or paused task uses its own position, and an idle task is reset to
 *  all-pending so a finished run's progress doesn't linger (past runs live in the run history). */
export function stepperItems(task: Task): StepperItem[] {
  const live = computeStepStatuses(task);
  return task.steps.map((step, index) => ({
    id: step.id,
    label: stepLabel(task, step.id),
    status: task.state === "resting" ? "pending" : live[index],
  }));
}

/** Totals for the stepper header: "3 of 8 steps done". */
export function stepperSummary(items: readonly StepperItem[]): string {
  const done = items.filter((i) => i.status === "done").length;
  return `${done} of ${items.length} step${items.length === 1 ? "" : "s"} done`;
}
