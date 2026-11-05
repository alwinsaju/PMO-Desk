/**
 * The presentation *rules* for a task: the state -> label vocabulary, the
 * one-line status sentence per state, and how the step tracker derives its
 * per-step status. Plain, typed functions, no React.
 */
import type {
  ActionResult,
  OutputFile,
  Task,
  TaskNotification,
  TaskState,
  TaskStep,
} from "./types";

/** Human-readable label for each state. */
export const STATE_LABEL: Record<TaskState, string> = {
  resting: "Idle",
  working: "Running",
  awaiting_review: "Needs review",
  awaiting_send: "Needs confirm",
  finishing: "Finishing",
  error: "Error",
};

/** Converts a snake_case step/task id into a readable label, e.g.
 *  "build_report" -> "Build report". */
export function humanize(id: string | null | undefined): string {
  if (!id) return "";
  return id.replace(/_/g, " ").replace(/^./, (char) => char.toUpperCase());
}

/** Short names for the steps the shipped tasks use when their manifest gives no `label`. */
const KNOWN_STEP_LABELS: Record<string, string> = {
  recalc: "Recalculate the workbook",
  create_pivot: "Create the pivot table",
  build_email_data: "Prepare the email",
  create_draft: "Create the Outlook draft",
  review_gate: "Your review",
  send_gate: "Your OK to send",
  send_draft: "Send the email",
  prepare_data: "Prepare the data",
  review_incidents: "Classify incidents",
  refresh_workbook: "Refresh the workbook",
  review_workbook: "Check the workbook",
};

/** A step's display name: the manifest `label` when it has one (tasks on
 *  the platform), else a plain name for the shipped tasks' steps, else the
 *  humanized id. An unknown step id (e.g. a log line from a step since
 *  removed) humanizes the id too. */
export function stepLabel(task: Task, stepId: string | null | undefined): string {
  const step = task.steps.find((s) => s.id === stepId);
  return (
    step?.label || (stepId ? KNOWN_STEP_LABELS[stepId] : undefined) || humanize(stepId)
  );
}

/**
 * One-line status sentence for a task card, plain words per state ("Running
 * Build report…"). "error" resolves to an empty string: that state renders its
 * own dedicated error box instead (see TaskCard).
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
 * tracker, derived purely from `currentStep` + `state`. Steps are fully dynamic
 * per task (a manifest can have as few as 3 steps and no review/send gate
 * at all), so this never assumes a fixed pipeline shape, and a
 * `currentStep` that no longer matches any step id (e.g. mid-rescan on the
 * real engine) degrades to "no active step" rather than throwing.
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

// ---------------------------------------------------------------------------
// Human gates of the task platform (tasks/TASK-PLATFORM-CONTRACT.md).
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

/** The newest `task.review_ready` notification, whose body the engine
 *  fills from the step's `reviewMessage`. */
export function latestReviewNotification(task: Task): TaskNotification | null {
  for (let i = task.notifications.length - 1; i >= 0; i--) {
    if (task.notifications[i].kind === "task.review_ready") return task.notifications[i];
  }
  return null;
}

/** The newest notification that carries an output artifact (for the draft
 *  workbook "Open" button — the engine sets it from report-data.json's
 *  workbook_path). */
export function latestArtifactNotification(task: Task): TaskNotification | null {
  for (let i = task.notifications.length - 1; i >= 0; i--) {
    if (task.notifications[i].outputPath) return task.notifications[i];
  }
  return null;
}

/** Every file a notification offers an Open button for: its `outputPaths`
 *  (duplicates dropped), else the single `outputPath` of an older engine. */
export function notificationFiles(notification: TaskNotification): OutputFile[] {
  const listed = Array.isArray(notification.outputPaths) ? notification.outputPaths : [];
  const files: OutputFile[] = [];
  for (const entry of listed) {
    if (!entry || typeof entry.path !== "string" || !entry.path) continue;
    if (files.some((file) => file.path === entry.path)) continue;
    files.push({
      label:
        typeof entry.label === "string" && entry.label.trim() ? entry.label.trim() : null,
      path: entry.path,
    });
  }
  if (files.length === 0 && notification.outputPath) {
    files.push({ label: null, path: notification.outputPath });
  }
  return files;
}

/** Text of one Open button. A labelled file reads "Open <label>" (plus
 *  "draft" at the draft-review gate, unless the label already says so); an
 *  unlabelled one reads "Open draft workbook" there, "Open workbook" next to
 *  other files, else plain "Open". */
export function openButtonLabel(
  file: OutputFile,
  options: { count: number; draft?: boolean },
): string {
  if (file.label) {
    const draft = options.draft && !/draft/i.test(file.label) ? " draft" : "";
    return `Open ${file.label}${draft}`;
  }
  if (options.count > 1) return "Open workbook";
  return options.draft ? "Open draft workbook" : "Open";
}

/** Review-ready text for the status line: the notification body exactly as
 *  the engine wrote it, but only for steps that opted into the platform
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

/** Plain verb for an approval stamp: approve, send (confirm), reject and reset are all recorded. */
export function approvalVerb(kind: string): string {
  switch (kind) {
    case "send":
      return "Confirmed";
    case "reject":
      return "Rejected";
    case "reset":
      return "Reset";
    default:
      return "Approved";
  }
}

/** Human line for an approval row in the History tab. */
export function describeApproval(
  approval: { kind: string; user: string },
  stepName: string,
): string {
  return `${approvalVerb(approval.kind)}: ${stepName} — ${approval.user}`;
}

/** How many ids/messages a refusal line names before "+N more". */
const REFUSAL_PREVIEW = 3;

const TASK_STATE_TEXT: Record<string, string> = {
  working: "This task is running. Wait until it finishes.",
  finishing: "This task is finishing. Wait until it is done.",
  awaiting_review: "This task is waiting for your review. Approve or reject it first.",
  awaiting_send:
    "This task is waiting for your confirmation. Confirm or cancel it first.",
  error: "This task stopped with an error. Retry or reset it first.",
};

/** The engine's short refusal reasons in plain words; anything it does not know passes through. */
export function plainReason(reason: string): string {
  const text = reason.trim();
  if (text === "prepare is running")
    return "The files are still being checked. Wait for the check to finish, then try again.";
  const state = /^task is (\w+)$/.exec(text);
  if (state) return TASK_STATE_TEXT[state[1]] ?? text;
  const type = /^file type '(.*)' is not accepted \(allowed: (.*)\)$/.exec(text);
  if (type) return `That kind of file (${type[1]}) is not accepted here. Use ${type[2]}.`;
  if (text === "the uploaded file is empty")
    return "That file is empty. Choose another one.";
  return text;
}

/** One-line text for an `ok:false` action reply. The engine's `reason` is
 *  put in plain words (see plainReason); a form-gate refusal also names the first few unanswered
 *  field ids, and a diff-gate refusal the first few blockers. */
export function refusalText(result: ActionResult): string {
  const base = plainReason(result.reason ?? "") || "request was rejected";
  const names: string[] = Array.isArray(result.pending)
    ? result.pending
    : (result.blocking ?? []).map((b) => b.message || b.kind);
  if (names.length === 0) return base;
  const shown = names.slice(0, REFUSAL_PREVIEW).join(", ");
  const extra = names.length - REFUSAL_PREVIEW;
  return `${base} (${shown}${extra > 0 ? ` +${extra} more` : ""})`;
}

/** Parses a engine timestamp. The engine stamps UTC, but a naive ISO
 *  string (no `Z`/offset) would be read by `Date` as LOCAL time, so it is
 *  pinned to UTC first. */
export function parseUtc(value: string): Date {
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(value);
  return new Date(hasZone ? value : `${value}Z`);
}
