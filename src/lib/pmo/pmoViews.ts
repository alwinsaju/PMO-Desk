// The pure logic behind the PMO To-Do views and helpers added in v5.3: bulk actions, tag
// rollups, the board and the calendar, dependencies, look-alike detection, the weekly plan,
// escalation, hand-off notes and reading action items out of meeting notes. No I/O, no React.
import { parseQuickAdd } from "./quickAdd.ts";
import { isSnoozed, isWaiting, waitingState } from "./due.ts";
import { addDays, dayName, formatDate, mondayOf } from "../staff/dates.ts";
import type { Priority, ReminderPrefs, Todo } from "./types.ts";
import type { TodoPatch } from "./todoLogic.ts";

const MAX_TAGS = 10;

// --- bulk actions -------------------------------------------------------------------------

export type BulkAction =
  | { type: "done" }
  | { type: "cancel" }
  | { type: "snooze"; until: string }
  | { type: "priority"; priority: Priority }
  | { type: "tag"; tag: string };

export interface BulkPatch {
  id: string;
  patch: TodoPatch;
}

/** The change to each selected to-do; one that would change nothing is left out. */
export function bulkPatches(action: BulkAction, todos: readonly Todo[]): BulkPatch[] {
  const out: BulkPatch[] = [];
  for (const t of todos) {
    switch (action.type) {
      case "done":
        if (t.status === "open") out.push({ id: t.id, patch: { status: "done" } });
        break;
      case "cancel":
        if (t.status === "open") out.push({ id: t.id, patch: { status: "cancelled" } });
        break;
      case "snooze":
        if (t.status === "open")
          out.push({ id: t.id, patch: { snoozedUntil: action.until } });
        break;
      case "priority":
        if (t.priority !== action.priority)
          out.push({ id: t.id, patch: { priority: action.priority } });
        break;
      case "tag": {
        const tag = action.tag.trim();
        const has = t.tags.some((x) => x.toLowerCase() === tag.toLowerCase());
        if (tag && !has && t.tags.length < MAX_TAGS) {
          out.push({ id: t.id, patch: { tags: [...t.tags, tag] } });
        }
        break;
      }
    }
  }
  return out;
}

/** The patches that put each changed to-do back as it was. */
export function bulkUndo(action: BulkAction, todos: readonly Todo[]): BulkPatch[] {
  const byId = new Map(todos.map((t) => [t.id, t]));
  return bulkPatches(action, todos).flatMap(({ id }): BulkPatch[] => {
    const t = byId.get(id)!;
    switch (action.type) {
      case "done":
      case "cancel":
        return [{ id, patch: { status: "open" } }];
      case "snooze":
        return [{ id, patch: { snoozedUntil: t.reminders.snoozedUntil } }];
      case "priority":
        return [{ id, patch: { priority: t.priority } }];
      case "tag":
        return [{ id, patch: { tags: t.tags } }];
    }
  });
}

export function bulkSummary(action: BulkAction, count: number): string {
  const n = `${count} to-do${count === 1 ? "" : "s"}`;
  switch (action.type) {
    case "done":
      return `Marked ${n} done.`;
    case "cancel":
      return `Cancelled ${n}.`;
    case "snooze":
      return `Snoozed ${n}.`;
    case "priority":
      return `Set ${n} to ${action.priority} priority.`;
    case "tag":
      return `Tagged ${n} “${action.tag.trim()}”.`;
  }
}

// --- tags and text filters ------------------------------------------------------------------

export interface TagRollup {
  tag: string;
  open: number;
  overdue: number;
  done: number;
  /** Share of the tag's (open + done) to-dos that are done, 0 to 100. */
  percent: number;
}

export function tagRollup(todos: readonly Todo[], today: string): TagRollup[] {
  const map = new Map<string, TagRollup>();
  for (const t of todos) {
    if (t.status === "cancelled") continue;
    for (const raw of t.tags) {
      const key = raw.toLowerCase();
      const row = map.get(key) ?? { tag: raw, open: 0, overdue: 0, done: 0, percent: 0 };
      if (t.status === "open") {
        row.open += 1;
        if (t.dueAt !== null && t.dueAt < today) row.overdue += 1;
      } else {
        row.done += 1;
      }
      map.set(key, row);
    }
  }
  return [...map.values()]
    .map((r) => ({
      ...r,
      percent: Math.round((r.done / Math.max(1, r.open + r.done)) * 100),
    }))
    .sort((a, b) => b.open - a.open || a.tag.localeCompare(b.tag));
}

export interface ViewExtras {
  tag: string | null;
  text: string;
}

export function applyExtras(todos: readonly Todo[], extras: ViewExtras): Todo[] {
  const words = extras.text.toLowerCase().split(/\s+/).filter(Boolean);
  return todos.filter((t) => {
    if (
      extras.tag &&
      !t.tags.some((x) => x.toLowerCase() === extras.tag!.toLowerCase())
    ) {
      return false;
    }
    if (words.length === 0) return true;
    const hay =
      `${t.title} ${t.description} ${t.owner.name ?? ""} ${t.waitingOn ?? ""} ${t.tags.join(" ")}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

// --- board ----------------------------------------------------------------------------------

export const BOARD_COLUMNS = [
  { id: "todo", label: "To do" },
  { id: "waiting", label: "Waiting" },
  { id: "snoozed", label: "Snoozed" },
  { id: "done", label: "Done" },
] as const;
export type BoardColumn = (typeof BOARD_COLUMNS)[number]["id"];

const MAX_DONE_ON_BOARD = 15;

export function boardColumns(
  todos: readonly Todo[],
  now: Date,
): Record<BoardColumn, Todo[]> {
  const cols: Record<BoardColumn, Todo[]> = {
    todo: [],
    waiting: [],
    snoozed: [],
    done: [],
  };
  for (const t of todos) {
    if (t.status === "cancelled") continue;
    if (t.status === "done") cols.done.push(t);
    else if (isWaiting(t)) cols.waiting.push(t);
    else if (isSnoozed(t, now)) cols.snoozed.push(t);
    else cols.todo.push(t);
  }
  const byDue = (a: Todo, b: Todo) =>
    (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999") ||
    a.title.localeCompare(b.title);
  cols.todo.sort(byDue);
  cols.waiting.sort(byDue);
  cols.snoozed.sort(byDue);
  cols.done = cols.done
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))
    .slice(0, MAX_DONE_ON_BOARD);
  return cols;
}

export type DropResult = { patch: TodoPatch } | { reason: string } | null;

/** What dropping a card on a column does. Waiting and Snoozed need more information, so they ask for it. */
export function dropPatch(todo: Todo, column: BoardColumn, now: Date): DropResult {
  switch (column) {
    case "done":
      return todo.status === "done" ? null : { patch: { status: "done" } };
    case "todo": {
      const patch: TodoPatch = {};
      if (todo.status !== "open") patch.status = "open";
      if (todo.waitingOn) patch.waitingOn = null;
      if (isSnoozed(todo, now)) patch.snoozedUntil = null;
      return Object.keys(patch).length === 0 ? null : { patch };
    }
    case "waiting":
      return isWaiting(todo)
        ? null
        : { reason: "Open the to-do and say who you are waiting on." };
    case "snoozed":
      return isSnoozed(todo, now)
        ? null
        : { reason: "Use Snooze on the to-do to choose when it comes back." };
  }
}

// --- calendar -------------------------------------------------------------------------------

export interface CalendarDay {
  day: string;
  inMonth: boolean;
  todos: Todo[];
}

/** Weeks (Monday first) covering a month, each day with the open to-dos due on it. */
export function monthGrid(
  year: number,
  month: number,
  todos: readonly Todo[],
): CalendarDay[][] {
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const start = mondayOf(first);
  const byDay = new Map<string, Todo[]>();
  for (const t of todos) {
    if (t.status !== "open" || !t.dueAt) continue;
    byDay.set(t.dueAt, [...(byDay.get(t.dueAt) ?? []), t]);
  }
  const weeks: CalendarDay[][] = [];
  for (let w = 0; w < 6; w++) {
    const week: CalendarDay[] = [];
    for (let d = 0; d < 7; d++) {
      const day = addDays(start, w * 7 + d);
      week.push({
        day,
        inMonth: day.slice(0, 7) === first.slice(0, 7),
        todos: (byDay.get(day) ?? []).sort((a, b) => a.title.localeCompare(b.title)),
      });
    }
    // A last row that is entirely the next month is not shown.
    if (w >= 4 && week.every((c) => !c.inMonth)) break;
    weeks.push(week);
  }
  return weeks;
}

export function shiftMonth(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export const monthLabel = (year: number, month: number): string =>
  new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

// --- dependencies ---------------------------------------------------------------------------

export interface BlockedState {
  /** Open to-dos this one still waits for. */
  blockers: Todo[];
  /** A blocker is overdue or due after this to-do is, so the date cannot hold. */
  atRisk: boolean;
}

export function blockedState(
  todo: Todo,
  all: readonly Todo[],
  today: string,
): BlockedState {
  const blockers = todo.blockedBy
    .map((id) => all.find((t) => t.id === id))
    .filter((t): t is Todo => !!t && t.status === "open");
  const atRisk = blockers.some(
    (b) =>
      b.dueAt !== null &&
      (b.dueAt < today || (todo.dueAt !== null && b.dueAt > todo.dueAt)),
  );
  return { blockers, atRisk };
}

/** Open to-dos that wait for this one. */
export const dependentsOf = (todo: Todo, all: readonly Todo[]): Todo[] =>
  all.filter((t) => t.status === "open" && t.blockedBy.includes(todo.id));

/** Would making `blockerId` block `todoId` create a loop (it already depends on it, directly or not)? */
export function wouldCycle(
  todoId: string,
  blockerId: string,
  all: readonly Todo[],
): boolean {
  if (todoId === blockerId) return true;
  const seen = new Set<string>();
  const stack = [blockerId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === todoId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const t = all.find((x) => x.id === id);
    if (t) stack.push(...t.blockedBy);
  }
  return false;
}

// --- look-alikes ----------------------------------------------------------------------------

const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "about",
  "please",
  "send",
  "to",
  "of",
  "a",
  "an",
  "on",
  "in",
]);

const words = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(" ")
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );

/** Open to-dos whose title shares most of its words with `title`. */
export function similarTodos(title: string, todos: readonly Todo[], limit = 3): Todo[] {
  const a = words(title);
  if (a.size === 0) return [];
  return todos
    .filter((t) => t.status === "open")
    .map((t) => {
      const b = words(t.title);
      const shared = [...a].filter((w) => b.has(w)).length;
      return { t, score: shared / (a.size + b.size - shared || 1) };
    })
    .filter((r) => r.score >= 0.5)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map((r) => r.t);
}

// --- why a to-do is flagged -----------------------------------------------------------------

const daysBetween = (from: string, to: string): number =>
  Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** One short line saying why a to-do needs a look ("Overdue by 3 days"), or null. */
export function flagReason(
  todo: Todo,
  all: readonly Todo[],
  today: string,
  now: Date,
  prefs: Pick<ReminderPrefs, "timeZone" | "workDays" | "chaserDays">,
): string | null {
  if (todo.status !== "open") return null;
  if (isSnoozed(todo, now)) return null;
  if (todo.dueAt !== null && todo.dueAt < today) {
    return `Overdue by ${plural(daysBetween(todo.dueAt, today), "day")}`;
  }
  const blocked = blockedState(todo, all, today);
  if (blocked.blockers.length > 0) {
    return `Blocked by ${blocked.blockers[0].title}${blocked.blockers.length > 1 ? ` and ${blocked.blockers.length - 1} more` : ""}${blocked.atRisk ? " (at risk)" : ""}`;
  }
  const waiting = waitingState(todo, now, prefs);
  if (waiting?.chaseDue)
    return `Chaser due: ${plural(waiting.quietDays, "quiet working day")}`;
  if (todo.dueAt === today) return "Due today";
  return null;
}

// --- weekly plan ----------------------------------------------------------------------------

export interface PlanEntry {
  todo: Todo;
  score: number;
  reasons: string[];
}

/** The few things worth doing this week, with why. Snoozed, blocked and far-off to-dos rank low or out. */
export function weeklyPlan(
  todos: readonly Todo[],
  today: string,
  now: Date,
  prefs: Pick<ReminderPrefs, "timeZone" | "workDays" | "chaserDays">,
  limit = 5,
): PlanEntry[] {
  const weekEnd = addDays(mondayOf(today), 6);
  const entries: PlanEntry[] = [];
  for (const t of todos) {
    if (t.status !== "open" || isSnoozed(t, now)) continue;
    let score = 0;
    const reasons: string[] = [];
    if (t.dueAt !== null && t.dueAt < today) {
      score += 120 + 2 * daysBetween(t.dueAt, today);
      reasons.push(`overdue by ${plural(daysBetween(t.dueAt, today), "day")}`);
    } else if (t.dueAt === today) {
      score += 80;
      reasons.push("due today");
    } else if (t.dueAt !== null && t.dueAt <= weekEnd) {
      score += 40 - daysBetween(today, t.dueAt);
      reasons.push(`due ${dayName(t.dueAt)} ${formatDate(t.dueAt)}`);
    }
    if (t.priority === "high") {
      score += 30;
      reasons.push("high priority");
    } else if (t.priority === "low") score -= 10;
    if (waitingState(t, now, prefs)?.chaseDue) {
      score += 35;
      reasons.push("time to chase");
    }
    if (blockedState(t, todos, today).blockers.length > 0) {
      score -= 50;
      reasons.push("blocked");
    }
    if (score > 0) entries.push({ todo: t, score, reasons });
  }
  return entries
    .sort((a, b) => b.score - a.score || a.todo.title.localeCompare(b.todo.title))
    .slice(0, limit);
}

// --- escalation and hand-off ----------------------------------------------------------------

/** After the third chaser round with no reply, suggest going to someone with more reach. */
export function escalationSuggestion(
  todo: Todo,
  now: Date,
  prefs: Pick<ReminderPrefs, "timeZone" | "workDays" | "chaserDays">,
): string | null {
  const waiting = waitingState(todo, now, prefs);
  if (!waiting || waiting.round < 3) return null;
  return `${todo.waitingOn} has been quiet for ${plural(waiting.quietDays, "working day")} (${waiting.round} chasers' worth). Consider escalating.`;
}

export function escalationText(
  todo: Pick<Todo, "title" | "waitingOn" | "dueAt">,
  myName: string,
): { subject: string; body: string } {
  return {
    subject: `Escalation: ${todo.title}`,
    body: [
      "Hi,",
      "",
      `I am following up on "${todo.title}", which is waiting on ${todo.waitingOn ?? "a reply"}.${todo.dueAt ? ` It is due ${todo.dueAt}.` : ""}`,
      "I have chased a few times without a reply. Could you help get this moving?",
      "",
      "Thanks,",
      myName,
    ].join("\n"),
  };
}

export function handoffNote(
  todo: Pick<
    Todo,
    | "title"
    | "description"
    | "dueAt"
    | "priority"
    | "waitingOn"
    | "actionItems"
    | "checkpoints"
  >,
  to: string,
  from: string,
): string {
  const open = todo.actionItems.filter((a) => !a.done);
  const stage = todo.checkpoints.find((c) => c.state === "pending");
  return [
    `Hi ${to},`,
    "",
    `I'm handing over "${todo.title}" to you.`,
    todo.dueAt ? `Due: ${todo.dueAt}` : "No due date.",
    `Priority: ${todo.priority}`,
    stage ? `Where it is: ${stage.label}` : "",
    todo.waitingOn ? `Waiting on: ${todo.waitingOn}` : "",
    todo.description.trim() ? `\nBackground:\n${todo.description.trim()}` : "",
    open.length > 0 ? `\nStill to do:\n${open.map((a) => `- ${a.text}`).join("\n")}` : "",
    "",
    "Ask me if anything is unclear.",
    from,
  ]
    .filter((line, i, all) => line !== "" || all[i - 1] !== "")
    .join("\n");
}

// --- action items from meeting notes --------------------------------------------------------

export interface ExtractedItem {
  title: string;
  owner: string | null;
  dueAt: string | null;
}

const LABELLED =
  /^\s*(?:[-*•]\s*)?(?:action(?:\s+items?)?|todo|to-do|next\s+steps?|ai)\s*[:\-]\s*(.+)$/i;
const CHECKBOX = /^\s*[-*•]\s*\[\s?\]\s*(.+)$/;
const NAMED =
  /^\s*(?:[-*•]\s*)?@?([A-Z][\p{L}'-]+(?:\s[A-Z][\p{L}'-]+)?)\s+(?:to|will|should|needs?\s+to|is\s+going\s+to|please)\s+(.+)$/u;
const MENTION = /^@([\p{L}][\p{L}'-]*(?:\s[A-Z][\p{L}'-]*)?)[:,]?\s+(.+)$/u;
const MAX_ITEMS = 20;

/** Action items written in notes or a transcript: "Action: ...", "- [ ] ...", "Priya to send the deck Friday". */
export function extractActionItems(text: string, today: string): ExtractedItem[] {
  const out: ExtractedItem[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    let owner: string | null = null;
    let body: string | null = null;
    let m: RegExpExecArray | null;
    if ((m = LABELLED.exec(line))) body = m[1];
    else if ((m = CHECKBOX.exec(line))) body = m[1];
    else if ((m = MENTION.exec(line.trim()))) {
      owner = m[1];
      body = m[2];
    } else if ((m = NAMED.exec(line))) {
      owner = m[1];
      body = m[2];
    }
    if (!body) continue;
    // "Sam: send the deck" or "Priya to send the deck" inside a labelled line.
    if (!owner) {
      const inner = /^([A-Z][\p{L}'-]+(?:\s[A-Z][\p{L}'-]+)?)\s*[:\-]\s+(.+)$/u.exec(
        body,
      );
      const named = inner ? null : NAMED.exec(body);
      const hit = inner ?? named;
      if (hit) {
        owner = hit[1];
        body = hit[2];
      }
    }
    const parsed = parseQuickAdd(body.trim(), today);
    if (!parsed || parsed.title.length < 3) continue;
    const key = parsed.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title: parsed.title, owner, dueAt: parsed.dueAt });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

// --- why a message was linked to a to-do ----------------------------------------------------

/** Plain words for why an incoming message was matched to an open to-do (it shares the to-do's conversation). */
export function matchReason(threadKey: string | null | undefined): string {
  if (!threadKey) return "It looks like the same conversation as this to-do.";
  if (threadKey.startsWith("outlook|"))
    return "Same Outlook conversation as the mail this to-do came from.";
  if (threadKey.startsWith("teams|"))
    return "Same Teams chat or thread as the message this to-do came from.";
  return "It is in the same conversation as this to-do.";
}
