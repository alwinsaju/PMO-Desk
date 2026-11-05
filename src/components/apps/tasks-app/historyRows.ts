// Rows of the History table: a status pill, how long the run took and which output to open. Pure.
import { durationMs, formatDuration } from "../../../lib/tasks/runHistory.ts";
import { notificationFiles } from "./taskPresenter.ts";
import type { HistoryRun, OutputFile, Task, TaskNotification } from "./types.ts";

export interface RunOutput {
  notification: TaskNotification;
  /** The primary file the engine will open. */
  file: OutputFile;
}

export interface HistoryRow {
  key: string;
  run: HistoryRun;
  taskName: string;
  pill: { label: string; tone: "success" | "danger" | "neutral" };
  /** One plain sentence for a run that was rejected or reset; null for completed and failed runs. */
  note: string | null;
  duration: string;
  output: RunOutput | null;
}

/** Notifications are written while a run goes (the review draft) and as it ends, so one made
 *  from shortly before the start to a minute after the end belongs to that run. */
const SLACK_MS = 60_000;

/** The newest output file written during this run, or null when the engine kept none. */
export function outputForRun(
  run: Pick<HistoryRun, "started_at" | "ended_at">,
  notifications: readonly TaskNotification[],
): RunOutput | null {
  const from = Date.parse(run.started_at) - SLACK_MS;
  const to = Date.parse(run.ended_at) + SLACK_MS;
  let best: { at: number; output: RunOutput } | null = null;
  for (const n of notifications) {
    const at = Date.parse(n.createdAt);
    if (!Number.isFinite(at) || at < from || at > to) continue;
    const file = notificationFiles(n)[0];
    if (file && (!best || at >= best.at)) {
      best = { at, output: { notification: n, file } };
    }
  }
  return best?.output ?? null;
}

/** The status pill and the plain sentence for how a run ended. Rejected and reset runs are not failures. */
export function outcomeInfo(outcome: string): {
  label: string;
  tone: "success" | "danger" | "neutral";
  note: string | null;
} {
  switch (outcome) {
    case "failed":
      return { label: "Failed", tone: "danger", note: null };
    case "rejected":
      return {
        label: "Rejected",
        tone: "neutral",
        note: "You rejected this run at the review step. Nothing was sent.",
      };
    case "cancelled":
      return {
        label: "Reset",
        tone: "neutral",
        note: "This run was reset before it finished. Nothing was sent.",
      };
    default:
      return { label: "Completed", tone: "success", note: null };
  }
}

export function historyRows(
  runs: readonly HistoryRun[],
  tasks: readonly Pick<Task, "id" | "notifications">[],
): HistoryRow[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return runs.map((run) => {
    const info = outcomeInfo(run.outcome);
    return {
      key: `${run.task_id}:${run.run_id}`,
      run,
      taskName: run.task_name ?? run.task_id,
      pill: { label: info.label, tone: info.tone },
      note: info.note,
      duration: formatDuration(durationMs(run)),
      output: outputForRun(run, byId.get(run.task_id)?.notifications ?? []),
    };
  });
}
