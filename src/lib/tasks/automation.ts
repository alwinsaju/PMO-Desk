/** What the background watcher should tell the person when tasks change state, and which schedules need attention. Pure. */
import { pendingOccurrence, type ScheduleDue, type TaskSchedule } from "./taskSchedule.ts";

export interface TaskLite {
  id: string;
  displayName: string;
  state: string;
}

export type NoticeKind = "review" | "send" | "failed" | "done";

export interface Notice {
  taskId: string;
  kind: NoticeKind;
  text: string;
}

/** Changes between two polls worth a notice. The first poll (no `prev`) never notifies. */
export function stateNotices(
  prev: ReadonlyMap<string, string> | null,
  tasks: readonly TaskLite[],
): Notice[] {
  if (!prev) return [];
  const out: Notice[] = [];
  for (const t of tasks) {
    const before = prev.get(t.id);
    if (before === undefined || before === t.state) continue;
    if (t.state === "awaiting_review")
      out.push({ taskId: t.id, kind: "review", text: `${t.displayName} is ready for your review.` });
    else if (t.state === "awaiting_send")
      out.push({ taskId: t.id, kind: "send", text: `${t.displayName} is waiting for your confirmation.` });
    else if (t.state === "error")
      out.push({ taskId: t.id, kind: "failed", text: `${t.displayName} hit an error.` });
    else if (t.state === "resting" && before !== "error")
      out.push({ taskId: t.id, kind: "done", text: `${t.displayName} finished.` });
  }
  return out;
}

export const snapshotStates = (tasks: readonly TaskLite[]): Map<string, string> =>
  new Map(tasks.map((t) => [t.id, t.state]));

export interface DueSchedule {
  schedule: TaskSchedule;
  due: Exclude<ScheduleDue, { kind: "none" }>;
}

/** Schedules with an unhandled occurrence, for tasks that still exist. */
export function dueSchedules(
  schedules: readonly TaskSchedule[],
  handled: Readonly<Record<string, string>>,
  taskIds: ReadonlySet<string>,
  now: Date,
): DueSchedule[] {
  const out: DueSchedule[] = [];
  for (const schedule of schedules) {
    if (!taskIds.has(schedule.taskId)) continue;
    const due = pendingOccurrence(schedule, handled[schedule.taskId], now);
    if (due.kind !== "none") out.push({ schedule, due });
  }
  return out;
}
