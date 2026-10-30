// The words of the command bar's PMO answers. Pure: the route gathers the data, these
// turn it into the short, plain-text reply the AI bubble shows (a line per item, so
// nothing is hidden behind a click). Facts only: every name and date comes from the
// data passed in, never from the model.
import { dueText, type ChaserRow, type OpenTodos } from "../dashboard/summary.ts";
import { formatRange } from "../staff/dates.ts";
import { peopleAway, type AwayEntry, type WhosOff } from "../staff/whosOff.ts";
import { taskById, type KnownTask } from "../tasks-engine/catalog.ts";
import type { DateRange } from "./whenPhrase.ts";
import type { PmoTopic } from "./pmoIntent.ts";

/** Lines listed before "+N more", so a reply stays readable in the bubble. */
const MAX_LINES = 6;

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

function capped(lines: string[], more: string): string[] {
  return lines.length <= MAX_LINES
    ? lines
    : [...lines.slice(0, MAX_LINES), `+${lines.length - MAX_LINES} ${more}`];
}

export const unknownWhenReply = (phrase: string, suggestion?: string | null): string =>
  suggestion
    ? `I couldn't tell which day "${phrase}" means. Did you mean "${suggestion}"? Ask again with that.`
    : `I couldn't tell which day "${phrase}" means. Try "today", "tomorrow", "next Monday", "this week" or a date like "5 Nov".`;

/** The model named a task the catalog does not have; offer the nearest one if there is one. */
export const unknownTaskReply = (
  phrase: string,
  suggestion?: KnownTask | null,
): string =>
  suggestion
    ? `I don't know a task called "${phrase}". Did you mean ${suggestion.label}?`
    : `I don't know a task called "${phrase}".`;

function awayLine(entry: AwayEntry, singleDay: boolean): string {
  const when = singleDay ? "" : `, ${formatRange(entry.start, entry.end)}`;
  return `• ${entry.name} (${entry.label}${when}${entry.pending ? ", waiting for approval" : ""})`;
}

/** "Off on Mon 2 Nov 2026 (2): ..." / "Nobody is off ...". */
export function whosOffReply(range: DateRange, result: WhosOff): string {
  const singleDay = range.from === range.to;
  const where = singleDay ? `on ${range.label}` : range.label;
  const holidays = result.holidays.map(
    (h) => `${h.label}${h.locations?.length ? ` (${h.locations.join(", ")})` : ""}`,
  );
  const holidayLine = holidays.length > 0 ? [`Holiday: ${holidays.join("; ")}.`] : [];
  if (result.entries.length === 0) {
    return [`Nobody is off ${where}.`, ...holidayLine].join("\n");
  }
  const people = peopleAway(result).length;
  const lines = capped(
    result.entries.map((entry) => awayLine(entry, singleDay)),
    "more",
  );
  return [
    `Off ${where} (${plural(people, "person", "people")}):`,
    ...lines,
    ...holidayLine,
  ].join("\n");
}

const todoLine = (row: OpenTodos["urgent"][number], today: string) =>
  `• ${row.title} (${dueText(row, today)}, ${row.owner})`;

const chaserLine = (row: ChaserRow) =>
  `• ${row.title}: waiting on ${row.waitingOn || "someone"}, ${plural(row.quietDays, "working day")} quiet`;

/** The data behind a status reply. `todos` must come from `openTodos` with a limit of
 *  at least the number of overdue items, so the overdue list is complete. */
export interface StatusData {
  todos: OpenTodos;
  chasers: ChaserRow[];
  today: string;
}

export function statusReply(topic: PmoTopic, data: StatusData): string {
  const { todos, chasers, today } = data;
  if (topic === "overdue") {
    if (todos.overdue === 0) return "Nothing is overdue.";
    const overdue = todos.urgent.filter((row) => row.daysLate > 0);
    return [
      `${plural(todos.overdue, "to-do")} overdue:`,
      ...capped(
        overdue.map((row) => todoLine(row, today)),
        "more",
      ),
    ].join("\n");
  }
  if (topic === "chasers") {
    if (chasers.length === 0) return "No chasers are due.";
    return [
      `${plural(chasers.length, "chaser")} due:`,
      ...capped(chasers.map(chaserLine), "more"),
    ].join("\n");
  }
  const counts = [
    todos.overdue > 0 && `${todos.overdue} overdue`,
    todos.dueToday > 0 && `${todos.dueToday} due today`,
    todos.dueTomorrow > 0 && `${todos.dueTomorrow} due tomorrow`,
    todos.waiting > 0 && `${todos.waiting} waiting on others`,
  ].filter(Boolean);
  const head =
    todos.open === 0
      ? "No open to-dos."
      : `${plural(todos.open, "open to-do")}${counts.length > 0 ? `: ${counts.join(", ")}` : ""}.`;
  if (topic === "open") return head;
  // summary
  const lines = [head];
  if (chasers.length > 0) lines.push(`${plural(chasers.length, "chaser")} due.`);
  lines.push(...todos.urgent.slice(0, 3).map((row) => todoLine(row, today)));
  return lines.join("\n");
}

/** What the bubble says when the Tasks window opens for a task. */
export function prepareTaskSummary(taskId: string): string {
  const label = taskById(taskId)?.label ?? "the task";
  return `Opening ${label}: add this run's files and press Run. Nothing is sent without your approval.`;
}
