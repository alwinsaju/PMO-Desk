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
import type {
  ActionResult,
  Agent,
  Task,
  TaskNotification,
  TaskState,
  TaskStep,
} from "./types";

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

/** A step's display name: the manifest `label` when it has one (tasks on
 *  the platform), else the humanized id exactly as before. An unknown step
 *  id (e.g. a log line from a step since removed) humanizes the id too. */
export function stepLabel(task: Task, stepId: string | null | undefined): string {
  const step = task.steps.find((s) => s.id === stepId);
  return step?.label || humanize(stepId);
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
      return `Running ${stepLabel(task, task.currentStep)}…`;
    case "finishing":
      return `Finishing up — ${stepLabel(task, task.currentStep)}…`;
    case "awaiting_review":
      return reviewReadyText(task) ?? "Waiting on your review.";
    case "awaiting_send":
      return reviewReadyText(task) ?? "Waiting on your confirmation to send.";
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

// ---------------------------------------------------------------------------
// Human gates of the task platform (agent-apps/TASK-PLATFORM-CONTRACT.md).
// The four older tasks declare no `label`/`gate` on their steps, so every
// function below falls through to "no platform gate" for them and the legacy
// UI (bare Approve/Reject, the review_incidents queue) is untouched. Kept in
// this file (not a sibling module) so it stays importable by the plain-Node
// unit tests, which can't resolve extensionless relative imports.
// ---------------------------------------------------------------------------

/** The gate kinds that get a dedicated panel; "none"/absent = legacy gate. */
export type PanelGate = "form" | "flags" | "diff";

const PANEL_GATES: readonly string[] = ["form", "flags", "diff"];

function asPanelGate(type: string | undefined): PanelGate | null {
  return type && PANEL_GATES.includes(type) ? (type as PanelGate) : null;
}

/** The step the task is paused on, only while it is waiting on a human. */
export function pausedStep(task: Task): TaskStep | null {
  if (task.state !== "awaiting_review" && task.state !== "awaiting_send") return null;
  return task.steps.find((step) => step.id === task.currentStep) ?? null;
}

/** The dedicated-panel gate the task is waiting at right now, if any. */
export function activeGate(task: Task): PanelGate | null {
  return asPanelGate(pausedStep(task)?.gate?.type);
}

/** True if any step of this task declares a form/flags/diff gate — decides
 *  whether the Review tab shows the new panel (or its idle notice) instead
 *  of the legacy incident queue. */
export function hasPanelGates(task: Task): boolean {
  return task.steps.some((step) => asPanelGate(step.gate?.type) !== null);
}

/** True if this task declares start-form inputs (so Run opens the form). */
export function hasStartForm(task: Task): boolean {
  return (task.inputs?.length ?? 0) > 0;
}

/** The newest `task.review_ready` notification, whose body the backend
 *  fills from the step's `reviewMessage`. */
export function latestReviewNotification(task: Task): TaskNotification | null {
  for (let i = task.notifications.length - 1; i >= 0; i--) {
    if (task.notifications[i].kind === "task.review_ready") return task.notifications[i];
  }
  return null;
}

/** The newest notification that carries an output artifact (for the draft
 *  workbook "Open" button — the backend sets it from report-data.json's
 *  workbook_path). */
export function latestArtifactNotification(task: Task): TaskNotification | null {
  for (let i = task.notifications.length - 1; i >= 0; i--) {
    if (task.notifications[i].outputPath) return task.notifications[i];
  }
  return null;
}

/** Review-ready text for the status line: the notification body exactly as
 *  the backend wrote it, but only for steps that opted into the platform
 *  (a `label` or `gate`). The older tasks keep their fixed sentences. */
export function reviewReadyText(task: Task): string | null {
  const step = pausedStep(task);
  if (!step || (!step.label && !step.gate)) return null;
  const body = latestReviewNotification(task)?.body?.trim();
  return body ? body : null;
}

/** Tab title for the gate panel. */
export function gateTabLabel(gate: PanelGate, count?: number): string {
  const base =
    gate === "form" ? "Questions" : gate === "flags" ? "Draft flags" : "Changes";
  return count && count > 0 ? `${base} (${count})` : base;
}

/** Short call-to-action for the card's gate button. */
export function gateActionLabel(gate: PanelGate): string {
  return gate === "form"
    ? "Answer questions"
    : gate === "flags"
      ? "View flags"
      : "Review changes";
}

/** Human line for an approval row in the History tab. */
export function describeApproval(
  approval: { kind: string; user: string },
  stepName: string,
): string {
  const verb = approval.kind === "send" ? "Confirmed" : "Approved";
  return `${verb}: ${stepName} — ${approval.user}`;
}

/** How many ids/messages a refusal line names before "+N more". */
const REFUSAL_PREVIEW = 3;

/** One-line text for an `ok:false` action reply. The backend's `reason` is
 *  used as given; a form-gate refusal also names the first few unanswered
 *  field ids, and a diff-gate refusal the first few blockers. */
export function refusalText(result: ActionResult): string {
  const base = result.reason?.trim() || "request was rejected";
  const names: string[] = Array.isArray(result.pending)
    ? result.pending
    : (result.blocking ?? []).map((b) => b.message || b.kind);
  if (names.length === 0) return base;
  const shown = names.slice(0, REFUSAL_PREVIEW).join(", ");
  const extra = names.length - REFUSAL_PREVIEW;
  return `${base} (${shown}${extra > 0 ? ` +${extra} more` : ""})`;
}

/** Parses a backend timestamp. The backend stamps UTC, but a naive ISO
 *  string (no `Z`/offset) would be read by `Date` as LOCAL time, so it is
 *  pinned to UTC first. */
export function parseUtc(value: string): Date {
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(value);
  return new Date(hasZone ? value : `${value}Z`);
}
