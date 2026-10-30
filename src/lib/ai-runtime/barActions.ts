// Turns a recognised command ("snooze the vendor invoice to Monday", "mark release plan
// done", "remind me to send the deck Friday") into a plan the command bar can show and then
// carry out. Pure: it reads the to-do list it is given and decides; the bar does the work.
import { localParts, snoozeUntil, zonedInstant } from "../pmo/due.ts";
import { parseQuickAdd } from "../pmo/quickAdd.ts";
import type { ReminderPrefs, Todo } from "../pmo/types.ts";
import { dayName, formatDate } from "../staff/dates.ts";
import type { ConfirmKey } from "../preferences/schema.ts";
import type { LocalIntent } from "./localIntent.ts";
import { resolveWhen } from "./whenPhrase.ts";

export type { ConfirmKey };

export type Effect =
  | { op: "create"; title: string; dueAt: string | null }
  | { op: "patch"; todoId: string; patch: { status: "done" } | { snoozedUntil: string } }
  | { op: "chaser"; todoId: string };

export type ActionPlan =
  | { type: "say"; text: string }
  | {
      type: "do";
      /** Which "ask me first" setting covers it; null = always just do it (it only opens a dialog). */
      confirmKey: ConfirmKey | null;
      title: string;
      detail: string;
      confirmLabel: string;
      /** What to tell the person once it is done. */
      doneText: string;
      effect: Effect;
    };

type TodoLite = Pick<Todo, "id" | "title" | "status" | "waitingOn">;

export type TodoMatch =
  | { kind: "one"; todo: TodoLite }
  | { kind: "many"; todos: TodoLite[] }
  | { kind: "none" };

const norm = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const STOP = new Set(["the", "a", "an", "to", "of", "for", "on", "my", "that", "this"]);

/** The open to-do a phrase names: an exact title, else the one title holding every word. */
export function matchTodo(todos: readonly TodoLite[], query: string): TodoMatch {
  const open = todos.filter((t) => t.status === "open");
  const q = norm(query);
  if (!q) return { kind: "none" };
  const exact = open.filter((t) => norm(t.title) === q);
  if (exact.length === 1) return { kind: "one", todo: exact[0] };
  const words = q.split(" ").filter((w) => !STOP.has(w));
  if (words.length === 0) return { kind: "none" };
  const hits = open.filter((t) => {
    const title = ` ${norm(t.title)} `;
    return words.every((w) => title.includes(` ${w}`) || title.includes(w));
  });
  if (hits.length === 1) return { kind: "one", todo: hits[0] };
  // Prefer titles that start with the words if that narrows it to one.
  const starts = hits.filter((t) => norm(t.title).startsWith(words[0]));
  if (starts.length === 1 && hits.length > 1 && words.length > 1) {
    return { kind: "one", todo: starts[0] };
  }
  return hits.length === 0 ? { kind: "none" } : { kind: "many", todos: hits };
}

const dayLabel = (day: string) => `${dayName(day)} ${formatDate(day)}`;

export interface PlanContext {
  todos: readonly TodoLite[];
  today: string;
  now: Date;
  prefs: Pick<ReminderPrefs, "timeZone" | "workStart">;
}

const quote = (title: string) =>
  `"${title.length > 70 ? `${title.slice(0, 69)}…` : title}"`;

const noMatch = (query: string): ActionPlan => ({
  type: "say",
  text: `I couldn't find an open to-do matching "${query}".`,
});

const severalMatches = (query: string, todos: readonly TodoLite[]): ActionPlan => ({
  type: "say",
  text: `More than one open to-do matches "${query}":\n${todos
    .slice(0, 5)
    .map((t) => `• ${t.title}`)
    .join("\n")}\nAsk again with more of the title.`,
});

export function planLocalIntent(
  intent: Exclude<LocalIntent, { kind: "run_info" | "explain" | "focus" }>,
  ctx: PlanContext,
): ActionPlan {
  if (intent.kind === "create_todo") {
    const parsed = parseQuickAdd(intent.text, ctx.today);
    if (!parsed) return { type: "say", text: "What should the to-do say?" };
    return {
      type: "do",
      confirmKey: "create_todo",
      title: "Create this to-do?",
      detail: parsed.dueAt
        ? `${parsed.title}\nDue ${dayLabel(parsed.dueAt)}`
        : `${parsed.title}\nNo due date`,
      confirmLabel: "Create to-do",
      doneText: `Added ${quote(parsed.title)}${parsed.dueAt ? `, due ${dayLabel(parsed.dueAt)}` : ""}.`,
      effect: { op: "create", title: parsed.title, dueAt: parsed.dueAt },
    };
  }

  const match = matchTodo(ctx.todos, intent.query);
  if (match.kind === "none") return noMatch(intent.query);
  if (match.kind === "many") return severalMatches(intent.query, match.todos);
  const { todo } = match;

  if (intent.action === "chase") {
    return {
      type: "do",
      confirmKey: null,
      title: "Draft a chaser",
      detail: quote(todo.title),
      confirmLabel: "Open the chaser",
      doneText: `Opening the chaser for ${quote(todo.title)}. You review it before anything is sent.`,
      effect: { op: "chaser", todoId: todo.id },
    };
  }

  if (intent.action === "done") {
    return {
      type: "do",
      confirmKey: "todo_done",
      title: "Mark this to-do done?",
      detail: quote(todo.title),
      confirmLabel: "Mark done",
      doneText: `Marked ${quote(todo.title)} done.`,
      effect: { op: "patch", todoId: todo.id, patch: { status: "done" } },
    };
  }

  // Snooze: a named day wakes it at the start of the working day; no day = tomorrow.
  let until: Date;
  let label: string;
  if (intent.until) {
    const range = resolveWhen(intent.until, ctx.today);
    if (!range || range.from !== range.to) {
      return {
        type: "say",
        text: `I couldn't tell which day "${intent.until}" means. Try "tomorrow", "Monday" or "5 Nov".`,
      };
    }
    if (range.from <= ctx.today) {
      return { type: "say", text: "A snooze has to end on a later day than today." };
    }
    until = zonedInstant(range.from, ctx.prefs.workStart, ctx.prefs.timeZone);
    label = dayLabel(range.from);
  } else {
    until = snoozeUntil("tomorrow", ctx.now, ctx.prefs);
    label = dayLabel(localParts(until, ctx.prefs.timeZone).day);
  }
  return {
    type: "do",
    confirmKey: "todo_snooze",
    title: "Snooze this to-do?",
    detail: `${quote(todo.title)}\nReminders return on ${label}`,
    confirmLabel: "Snooze",
    doneText: `Snoozed ${quote(todo.title)} until ${label}.`,
    effect: {
      op: "patch",
      todoId: todo.id,
      patch: { snoozedUntil: until.toISOString() },
    },
  };
}
