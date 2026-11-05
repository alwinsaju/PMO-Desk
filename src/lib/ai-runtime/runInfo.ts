// "Did the backlog report run this week?" and "why did the last run fail?", answered from
// the Tasks engine's run history. Facts only: every state and date comes from the data.
// Pure: the command bar fetches the history (the engine is called from the browser).
import {
  isDeliberateStop,
  lastLine,
  REPORT_TASKS,
  type RunLike,
} from "../dashboard/summary.ts";
import { describeInstant, localParts } from "../pmo/due.ts";
import { addDays, dayName, formatDate, mondayOf } from "../staff/dates.ts";
import { taskById } from "../tasks-engine/catalog.ts";

export interface RunInfoData {
  /** null = the engine could not be reached. */
  tasks: readonly { id: string; displayName: string }[] | null;
  /** Each task's runs, newest first. */
  histories: Readonly<Record<string, readonly RunLike[] | undefined>>;
}

export interface RunInfoIntent {
  taskId: string | null;
  question: "ran" | "failed";
}

const nameOf = (id: string, data: RunInfoData): string =>
  data.tasks?.find((t) => t.id === id)?.displayName ?? taskById(id)?.label ?? id;

const when = (run: RunLike, tz: string) =>
  describeInstant(run.ended_at || run.started_at, tz);

export function runInfoReply(
  intent: RunInfoIntent,
  data: RunInfoData,
  now: Date,
  timeZone: string,
): string {
  if (!data.tasks) {
    return "The Tasks engine isn't running, so I can't see the run history. Open Tasks to start it.";
  }

  if (intent.question === "ran") {
    if (!intent.taskId)
      return "Which task? For example: did the backlog report run this week?";
    const name = nameOf(intent.taskId, data);
    const runs = data.histories[intent.taskId] ?? [];
    const today = localParts(now, timeZone).day;
    const monday = mondayOf(today);
    const sunday = addDays(monday, 6);
    const thisWeek = runs.filter((r) => {
      const day = localParts(new Date(r.started_at), timeZone).day;
      return day >= monday && day <= sunday;
    });
    const range = `${dayName(monday)} ${formatDate(monday)} to ${dayName(sunday)} ${formatDate(sunday)}`;
    if (thisWeek.length === 0) {
      const last = runs[0];
      return last
        ? `No, ${name} has not run this week (${range}). Its last run was ${when(last, timeZone)} (${last.outcome}).`
        : `No, ${name} has no runs on record.`;
    }
    const lines = thisWeek
      .slice(0, 4)
      .map(
        (r) =>
          `• ${when(r, timeZone)}: ${r.outcome}${r.error ? ` (${lastLine(r.error, 80)})` : ""}`,
      );
    return [
      `Yes, ${name} ran ${thisWeek.length === 1 ? "once" : `${thisWeek.length} times`} this week:`,
      ...lines,
    ].join("\n");
  }

  // Why did it fail: the named task, else the most recent failure among the report tasks.
  const candidates = intent.taskId
    ? [intent.taskId]
    : REPORT_TASKS.map((t) => t.id).filter((id) => data.tasks?.some((t) => t.id === id));
  let worst: { id: string; run: RunLike } | null = null;
  for (const id of candidates) {
    const last = data.histories[id]?.[0];
    if (!last || last.outcome === "completed" || isDeliberateStop(last.outcome)) continue;
    const at = Date.parse(last.ended_at || last.started_at);
    const best = worst
      ? Date.parse(worst.run.ended_at || worst.run.started_at)
      : -Infinity;
    if (at > best) worst = { id, run: last };
  }
  if (worst) {
    return `${nameOf(worst.id, data)}'s last run ${worst.run.outcome} (${when(worst.run, timeZone)}): ${
      lastLine(worst.run.error ?? "") || "no error was recorded"
    }. Open Tasks to see the log.`;
  }
  if (intent.taskId) {
    const last = data.histories[intent.taskId]?.[0];
    return last
      ? `${nameOf(intent.taskId, data)}'s last run completed fine (${when(last, timeZone)}).`
      : `${nameOf(intent.taskId, data)} has no runs on record.`;
  }
  return "None of the report tasks failed on their last run.";
}
