/** Reading the engine's run history: durations, filters, outcomes and a rough "time left". Pure. */
import type { HistoryRun, Task } from "@/components/apps/tasks-app/types";

export const durationMs = (run: Pick<HistoryRun, "started_at" | "ended_at">): number => {
  const ms = Date.parse(run.ended_at) - Date.parse(run.started_at);
  return Number.isFinite(ms) && ms >= 0 ? ms : 0;
};

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

export interface HistoryFilter {
  outcome: "all" | "completed" | "failed" | "rejected" | "cancelled";
  text: string;
  taskId: string | null;
  /** Only runs that ended within this many days. */
  sinceDays: number | null;
}

export const NO_FILTER: HistoryFilter = {
  outcome: "all",
  text: "",
  taskId: null,
  sinceDays: null,
};

export function filterRuns(
  runs: readonly HistoryRun[],
  filter: HistoryFilter,
  now: Date,
): HistoryRun[] {
  const words = filter.text.toLowerCase().split(/\s+/).filter(Boolean);
  const since = filter.sinceDays === null ? 0 : now.getTime() - filter.sinceDays * 86_400_000;
  return runs
    .filter((r) => filter.outcome === "all" || r.outcome === filter.outcome)
    .filter((r) => !filter.taskId || r.task_id === filter.taskId)
    .filter((r) => !since || Date.parse(r.ended_at) >= since)
    .filter((r) => {
      if (words.length === 0) return true;
      const hay = [
        r.task_name,
        r.task_id,
        r.error,
        r.outcome,
        ...(r.approvals ?? []).map((a) => `${a.user} ${a.kind}`),
      ]
        .join(" ")
        .toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => Date.parse(b.ended_at) - Date.parse(a.ended_at));
}

export interface HistorySummary {
  total: number;
  completed: number;
  failed: number;
  /** Completed share of the runs that finished or failed (rejected and reset runs are not counted), 0–100; null with none. */
  successPercent: number | null;
  medianMs: number | null;
}

export function summarizeRuns(runs: readonly HistoryRun[]): HistorySummary {
  const completed = runs.filter((r) => r.outcome === "completed");
  const failed = runs.filter((r) => r.outcome === "failed").length;
  const finished = completed.length + failed;
  const times = completed.map(durationMs).sort((a, b) => a - b);
  return {
    total: runs.length,
    completed: completed.length,
    failed,
    successPercent: finished ? Math.round((completed.length / finished) * 100) : null,
    medianMs: times.length ? times[Math.floor(times.length / 2)] : null,
  };
}

/** "Step 3 of 8" for a running or paused task, or null when it is idle. */
export function stepPosition(task: Pick<Task, "steps" | "currentStep" | "state">): string | null {
  if (task.state === "resting" || !task.currentStep) return null;
  const i = task.steps.findIndex((s) => s.id === task.currentStep);
  return i < 0 ? null : `Step ${i + 1} of ${task.steps.length}`;
}

/** Plain-English names for the steps the shipped tasks use; anything else falls back to the manifest. */
const PLAIN: Record<string, string> = {
  build_report: "Building the report",
  recalc: "Recalculating the workbook",
  create_pivot: "Creating the pivot table",
  build_email_data: "Preparing the email details",
  create_draft: "Creating the Outlook draft",
  review_gate: "Waiting for your review",
  send_gate: "Waiting for your OK to send",
  send_draft: "Sending the email",
  prepare_data: "Reading and preparing the data",
  review_incidents: "Waiting for you to classify incidents",
  refresh_workbook: "Refreshing the workbook",
  review_workbook: "Waiting for you to check the workbook",
  analyze: "Reading the roster",
  answers: "Waiting for your answers",
  build_draft: "Building the draft",
  review_draft: "Waiting for you to review the draft",
  diff_draft: "Comparing with the current roster",
  confirm_diff: "Waiting for you to confirm the changes",
  finalize: "Saving the final files",
};

export function plainStepName(
  task: Pick<Task, "steps">,
  stepId: string | null | undefined,
): string {
  if (!stepId) return "";
  const step = task.steps.find((s) => s.id === stepId);
  if (PLAIN[stepId]) return PLAIN[stepId];
  if (step?.label) return step.label;
  const text = stepId.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A rough "about N min left" while a task is working on its own steps. Needs at least three finished
 *  runs; human waiting time makes longer runs useless, so only runs under half an hour count. */
export function timeLeftText(
  task: Pick<Task, "steps" | "currentStep" | "state">,
  runs: readonly HistoryRun[],
): string | null {
  if (task.state !== "working" || !task.currentStep) return null;
  const i = task.steps.findIndex((s) => s.id === task.currentStep);
  if (i < 0 || task.steps.length === 0) return null;
  const times = runs
    .filter((r) => r.outcome === "completed")
    .map(durationMs)
    .filter((ms) => ms > 0 && ms < 30 * 60_000)
    .sort((a, b) => a - b);
  if (times.length < 3) return null;
  const median = times[Math.floor(times.length / 2)];
  const left = median * (1 - i / task.steps.length);
  if (left < 30_000) return "less than a minute left";
  return `about ${Math.max(1, Math.round(left / 60_000))} min left`;
}
