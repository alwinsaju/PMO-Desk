// What the Dashboard widgets show, worked out from the PMO to-dos, the Tasks
// engine's tasks and the saved weekly reports. Pure: the Dashboard and the
// command bar's "what is overdue?" both use these, so they always agree.
import {
  daysBetween,
  formatDayMonth,
  mondayOf,
  addDays as addIsoDays,
} from "../staff/dates.ts";
import { describeInstant, localParts, waitingState } from "../pmo/due.ts";
import type { ReminderPrefs, Todo } from "../pmo/types.ts";

type Prefs = Pick<ReminderPrefs, "timeZone" | "workDays" | "chaserDays">;

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------
// Open to-dos
// ---------------------------------------------------------------------------

export interface TodoRow {
  id: string;
  title: string;
  owner: string;
  dueAt: string | null;
  /** > 0 when overdue. */
  daysLate: number;
  priority: Todo["priority"];
  waitingOn: string | null;
}

export interface OpenTodos {
  open: number;
  overdue: number;
  dueToday: number;
  dueTomorrow: number;
  /** Waiting on someone. */
  waiting: number;
  /** Waiting long enough that a chaser is due. */
  chaseDue: number;
  noDueDate: number;
  /** The ones to look at first: overdue (latest first), then due today, then tomorrow. */
  urgent: TodoRow[];
}

const ownerName = (todo: Pick<Todo, "owner">): string =>
  todo.owner.name?.trim() || todo.owner.email?.trim() || "Unassigned";

const PRIORITY_RANK: Record<Todo["priority"], number> = { high: 0, normal: 1, low: 2 };

export function openTodos(
  todos: readonly Todo[],
  now: Date,
  prefs: Prefs,
  limit = 5,
): OpenTodos {
  const today = localParts(now, prefs.timeZone).day;
  const tomorrow = addIsoDays(today, 1);
  const out: OpenTodos = {
    open: 0,
    overdue: 0,
    dueToday: 0,
    dueTomorrow: 0,
    waiting: 0,
    chaseDue: 0,
    noDueDate: 0,
    urgent: [],
  };
  const urgent: (TodoRow & { rank: number })[] = [];
  for (const todo of todos) {
    if (todo.status !== "open") continue;
    out.open++;
    const waiting = waitingState(todo, now, prefs);
    if (todo.waitingOn?.trim()) out.waiting++;
    if (waiting?.chaseDue) out.chaseDue++;
    let rank: number | null = null;
    if (!todo.dueAt) out.noDueDate++;
    else if (todo.dueAt < today) {
      out.overdue++;
      rank = 0;
    } else if (todo.dueAt === today) {
      out.dueToday++;
      rank = 1;
    } else if (todo.dueAt === tomorrow) {
      out.dueTomorrow++;
      rank = 2;
    }
    if (rank !== null) {
      urgent.push({
        id: todo.id,
        title: todo.title,
        owner: ownerName(todo),
        dueAt: todo.dueAt,
        daysLate: todo.dueAt && todo.dueAt < today ? daysBetween(todo.dueAt, today) : 0,
        priority: todo.priority,
        waitingOn: todo.waitingOn?.trim() || null,
        rank,
      });
    }
  }
  out.urgent = urgent
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        b.daysLate - a.daysLate ||
        PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
        a.title.localeCompare(b.title),
    )
    .slice(0, limit)
    .map(({ rank: _rank, ...row }) => row);
  return out;
}

/** "Overdue by 2 days", "Due today", "Due tomorrow", "Due 5 Mar". */
export function dueText(row: Pick<TodoRow, "dueAt" | "daysLate">, today: string): string {
  if (!row.dueAt) return "No due date";
  if (row.daysLate > 0) return `Overdue by ${plural(row.daysLate, "day")}`;
  if (row.dueAt === today) return "Due today";
  if (row.dueAt === addIsoDays(today, 1)) return "Due tomorrow";
  return `Due ${formatDayMonth(row.dueAt)}`;
}

// ---------------------------------------------------------------------------
// Chasers
// ---------------------------------------------------------------------------

export interface ChaserRow {
  id: string;
  title: string;
  waitingOn: string;
  /** Working days with no reply. */
  quietDays: number;
  /** The cadence in force. */
  everyDays: number;
  /** Working days past the cadence (0 = just became due). */
  overBy: number;
}

/** To-dos waiting on someone for at least their chaser cadence, longest quiet first. */
export function overdueChasers(
  todos: readonly Todo[],
  now: Date,
  prefs: Prefs,
): ChaserRow[] {
  const rows: ChaserRow[] = [];
  for (const todo of todos) {
    const waiting = waitingState(todo, now, prefs);
    if (!waiting?.chaseDue) continue;
    rows.push({
      id: todo.id,
      title: todo.title,
      waitingOn: todo.waitingOn?.trim() ?? "",
      quietDays: waiting.quietDays,
      everyDays: waiting.everyDays,
      overBy: waiting.quietDays - waiting.everyDays,
    });
  }
  return rows.sort((a, b) => b.quietDays - a.quietDays || a.title.localeCompare(b.title));
}

// ---------------------------------------------------------------------------
// Who is out
// ---------------------------------------------------------------------------

export type AwayPeriod = "this-week" | "next-week";

/** The days the "who is out" widget covers: from today to the end of this week,
 *  or all of next week (Monday to Sunday). */
export function awayWindow(
  today: string,
  period: AwayPeriod,
): { from: string; to: string } {
  const monday = mondayOf(today);
  return period === "this-week"
    ? { from: today, to: addIsoDays(monday, 6) }
    : { from: addIsoDays(monday, 7), to: addIsoDays(monday, 13) };
}

// ---------------------------------------------------------------------------
// Report status
// ---------------------------------------------------------------------------

/** The task folders that produce a report or a mailing (the ones worth watching). */
export const REPORT_TASKS: readonly { id: string; fallbackName: string }[] = [
  { id: "weekly-aging-report", fallbackName: "Aging Report" },
  { id: "weekly-backlog-report", fallbackName: "Backlog Report" },
  { id: "monthly-report-deck", fallbackName: "Monthly Report Deck" },
  {
    id: "deployment-dep-weekend-mailer",
    fallbackName: "Deployment & DEP Weekend Mailer",
  },
];

export interface TaskLike {
  id: string;
  displayName: string;
  state:
    | "resting"
    | "working"
    | "awaiting_review"
    | "awaiting_send"
    | "finishing"
    | "error"
    | string;
  error: string | null;
}

export interface RunLike {
  outcome: string;
  started_at: string;
  ended_at: string;
  error: string | null;
}

export interface SavedReportLike {
  title: string;
  period: { label: string; startDay: string; endDay: string };
  savedAt: string;
  edited: boolean;
}

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

export interface ReportStatusRow {
  id: string;
  name: string;
  tone: StatusTone;
  /** "Needs your review", "Completed", "Failed", ... */
  status: string;
  /** When, or why. */
  detail: string;
  /** A person has to act: review, send or look at a failure. */
  needsYou: boolean;
}

/** A failure message boiled down to what went wrong: the last line (a traceback ends
 *  with the error itself), shortened. */
export function lastLine(text: string, max = 120): string {
  const line =
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .at(-1) ?? "";
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

function taskStatus(
  task: TaskLike,
  lastRun: RunLike | undefined,
  timeZone: string,
): Omit<ReportStatusRow, "id" | "name"> {
  switch (task.state) {
    case "working":
    case "finishing":
      return {
        tone: "info",
        status: "Running",
        detail: "Preparing the report now.",
        needsYou: false,
      };
    case "awaiting_review":
      return {
        tone: "warning",
        status: "Needs your review",
        detail: "Waiting at the review step.",
        needsYou: true,
      };
    case "awaiting_send":
      return {
        tone: "warning",
        status: "Ready to send",
        detail: "Waiting for your confirmation.",
        needsYou: true,
      };
    case "error":
      return {
        tone: "danger",
        status: "Failed",
        detail: lastLine(task.error ?? "") || "The last run stopped with an error.",
        needsYou: true,
      };
  }
  if (!lastRun)
    return {
      tone: "neutral",
      status: "Not run yet",
      detail: "No runs on record.",
      needsYou: false,
    };
  const when = describeInstant(lastRun.ended_at || lastRun.started_at, timeZone);
  return lastRun.outcome === "completed"
    ? { tone: "success", status: "Completed", detail: when, needsYou: false }
    : {
        tone: "danger",
        status: "Last run failed",
        detail: `${when}${lastRun.error ? `: ${lastLine(lastRun.error, 100)}` : ""}`,
        needsYou: true,
      };
}

export interface ReportStatusInput {
  /** All tasks the engine reports (null = the engine could not be reached). */
  tasks: readonly TaskLike[] | null;
  /** Each task's runs, newest first, by task id. */
  histories: Readonly<Record<string, readonly RunLike[] | undefined>>;
  /** The saved weekly reports, newest first (null = unknown). */
  saved: readonly SavedReportLike[] | null;
  now: Date;
  timeZone: string;
}

/** One row per report task the engine knows, then the PMO weekly report. */
export function reportStatuses(input: ReportStatusInput): ReportStatusRow[] {
  const rows: ReportStatusRow[] = [];
  for (const known of REPORT_TASKS) {
    const task = input.tasks?.find((t) => t.id === known.id);
    if (!task) continue;
    rows.push({
      id: known.id,
      name: task.displayName || known.fallbackName,
      ...taskStatus(task, input.histories[known.id]?.[0], input.timeZone),
    });
  }
  if (input.saved) rows.push(weeklyReportRow(input.saved, input.now, input.timeZone));
  return rows;
}

/** The PMO weekly report: does the latest saved one reach back to last week's end? */
function weeklyReportRow(
  saved: readonly SavedReportLike[],
  now: Date,
  timeZone: string,
): ReportStatusRow {
  const today = localParts(now, timeZone).day;
  const lastSunday = addIsoDays(mondayOf(today), -1);
  const latest = saved[0];
  const base = { id: "pmo-weekly-report", name: "PMO weekly report" };
  if (!latest) {
    return {
      ...base,
      tone: "neutral",
      status: "None saved",
      detail: "Write one in PMO To-Do > Reports.",
      needsYou: false,
    };
  }
  const current = latest.period.endDay >= lastSunday;
  return {
    ...base,
    tone: current ? "success" : "warning",
    status: current ? "Up to date" : "Behind",
    detail: `${latest.period.label}, saved ${describeInstant(latest.savedAt, timeZone)}`,
    needsYou: !current,
  };
}
