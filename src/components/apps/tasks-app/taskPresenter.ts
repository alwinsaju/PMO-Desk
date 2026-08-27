/**
 * The presentation *rules* for a task, ported from the reference agent-office
 * frontend's `agentPresenter.js`
 * (`C:\Projects\Agents-workspace\agent-office\frontend\src\agentPresenter.js`,
 * read-only reference) and reimplemented here as plain, typed, idiomatic
 * TS/React functions — not a line of that file's own vanilla-DOM code is
 * reused, but the rules themselves (state -> label vocabulary, the one-line
 * status sentence per state, how the step tracker derives its per-step
 * status) are intentionally kept identical so this app matches "how it
 * worked before."
 */
import type { Agent, Task, TaskState } from "./types";

/** Human-readable label for each state — mirrors agentPresenter.js's
 *  STATE_LABEL exactly. */
export const STATE_LABEL: Record<TaskState, string> = {
  resting: "Idle",
  working: "Running",
  awaiting_review: "Needs review",
  awaiting_send: "Needs confirm",
  finishing: "Finishing",
  error: "Error",
};

/** Converts a snake_case step/task id into a readable label, e.g.
 *  "build_report" -> "Build report". Mirrors agentPresenter.js's
 *  `humanize`. */
export function humanize(id: string | null | undefined): string {
  if (!id) return "";
  return id.replace(/_/g, " ").replace(/^./, (char) => char.toUpperCase());
}

/**
 * One-line status sentence for a task card — adapted from agentPresenter.js's
 * `statusLabel`, which names the assigned worker (e.g. "Adam is running
 * ..."); this app deliberately drops that framing (the person it's built
 * for doesn't want agent names surfaced while a task is running) and just
 * describes the state/step, but otherwise keeps the same one-line-per-state
 * shape, including its one asymmetry: "error" resolves to an empty string
 * here too, because that state renders its own dedicated error box instead
 * (see TaskCard) rather than a status sentence.
 */
export function statusSentence(task: Task): string {
  switch (task.state) {
    case "resting":
      return "Ready to run.";
    case "working":
      return `Running ${humanize(task.currentStep)}…`;
    case "finishing":
      return `Finishing up — ${humanize(task.currentStep)}…`;
    case "awaiting_review":
      return "Waiting on your review.";
    case "awaiting_send":
      return "Waiting on your confirmation to send.";
    default:
      return "";
  }
}

export type StepStatus = "done" | "active" | "gate" | "failed" | "pending";

/**
 * Per-step done/active/gate/failed/pending status for the horizontal step
 * tracker, derived purely from `currentStep` + `state` — mirrors
 * agentPresenter.js's `buildStepTracker` exactly. Steps are fully dynamic
 * per task (a manifest can have as few as 3 steps and no review/send gate
 * at all), so this never assumes a fixed pipeline shape, and a
 * `currentStep` that no longer matches any step id (e.g. mid-rescan on the
 * real backend) degrades to "no active step" rather than throwing.
 */
export function computeStepStatuses(task: Task): StepStatus[] {
  const activeIndex = task.currentStep
    ? task.steps.findIndex((step) => step.id === task.currentStep)
    : -1;

  return task.steps.map((step, index) => {
    if (activeIndex === -1 || index > activeIndex) return "pending";
    if (index < activeIndex) return "done";
    if (task.state === "error") return "failed";
    return step.type === "review" || step.type === "confirm" ? "gate" : "active";
  });
}

/** Whether the "Run"/"Retry" action should be enabled — true when at least
 *  one pool worker is currently idle. Mirrors main.js's `lastCanStart`
 *  (`workers.some((w) => !w.currentTaskId)`). */
export function canStartFromAgents(agents: Pick<Agent, "currentTaskId">[]): boolean {
  return agents.some((agent) => !agent.currentTaskId);
}
