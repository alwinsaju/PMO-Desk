// One search over everything that is on this computer: apps, to-dos, notes, templates,
// people and time off. Pure: callers pass the data in and get ranked results back.
import type { Employee, TimeOffRequest } from "../staff/types.ts";
import { displayName } from "../staff/employees.ts";
import { TIME_OFF_META } from "../staff/timeoff.ts";

export type SearchKind =
  "app" | "todo" | "record" | "note" | "template" | "person" | "timeoff";

/** Where choosing a result goes. */
export type SearchTarget =
  | { app: string }
  | { app: "pmo-todo"; todoId: string }
  | { app: "notes"; noteId: string }
  | { app: "staff"; tab: "directory" | "timeoff" };

export interface SearchItem {
  id: string;
  kind: SearchKind;
  title: string;
  subtitle: string;
  /** More words to match (not shown). */
  keywords: string;
  target: SearchTarget;
}

export const KIND_LABEL: Record<SearchKind, string> = {
  app: "App",
  todo: "To-do",
  record: "PMO tool",
  note: "Note",
  template: "Template",
  person: "Person",
  timeoff: "Time off",
};

const KIND_ORDER: Record<SearchKind, number> = {
  app: 0,
  todo: 1,
  record: 2,
  person: 3,
  timeoff: 4,
  template: 5,
  note: 6,
};

const MAX_KEYWORDS = 600;
export const DEFAULT_LIMIT = 12;

const norm = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** How well an item matches every word typed; 0 = not a match. */
export function scoreItem(item: SearchItem, words: readonly string[]): number {
  const title = norm(item.title);
  const titleWords = title.split(" ");
  const rest = norm(`${item.subtitle} ${item.keywords}`);
  let total = 0;
  for (const word of words) {
    let points = 0;
    if (title === word) points = 10;
    else if (title.startsWith(word)) points = 6;
    else if (titleWords.some((w) => w.startsWith(word))) points = 4;
    else if (title.includes(word)) points = 2;
    else if (rest.includes(word)) points = 1;
    if (points === 0) return 0;
    total += points;
  }
  return total;
}

/** Ranked matches. An empty query lists the apps (so the box is useful before typing). */
export function searchItems(
  items: readonly SearchItem[],
  query: string,
  limit = DEFAULT_LIMIT,
): SearchItem[] {
  const words = norm(query).split(" ").filter(Boolean);
  if (words.length === 0) return items.filter((i) => i.kind === "app").slice(0, limit);
  const scored = items
    .map((item) => ({ item, score: scoreItem(item, words) }))
    .filter((r) => r.score > 0);
  // A word found only in the small print (1 point each) is a weak match. When some
  // other result matches by name or title, people who match only through their level or
  // office text ("Ana" finding an Analyst) are left out.
  const strong = scored.some((r) => r.score > words.length);
  return scored
    .filter((r) => !(strong && r.item.kind === "person" && r.score <= words.length))
    .sort(
      (a, b) =>
        b.score - a.score ||
        KIND_ORDER[a.item.kind] - KIND_ORDER[b.item.kind] ||
        a.item.title.localeCompare(b.item.title),
    )
    .slice(0, limit)
    .map((r) => r.item);
}

// --- builders ---------------------------------------------------------------------------

export const appItems = (apps: readonly { id: string; title: string }[]): SearchItem[] =>
  apps.map((a) => ({
    id: `app:${a.id}`,
    kind: "app",
    title: a.title,
    subtitle: "Open the app",
    keywords: a.id,
    target: { app: a.id },
  }));

/** Records of a PMO tool (a risk, a decision, a vendor...): choosing one opens that tool. */
export const recordItems = (
  tool: { id: string; title: string },
  records: readonly { id: string; title: string; subtitle: string; keywords: string }[],
): SearchItem[] =>
  records.map((r) => ({
    id: `record:${tool.id}:${r.id}`,
    kind: "record",
    title: r.title,
    subtitle: `${tool.title}${r.subtitle ? `, ${r.subtitle}` : ""}`,
    keywords: r.keywords.slice(0, MAX_KEYWORDS),
    target: { app: tool.id },
  }));

export interface TodoLike {
  id: string;
  title: string;
  description: string;
  status: string;
  dueAt: string | null;
  waitingOn: string | null;
  tags: readonly string[];
  owner: { name: string | null };
}

export const todoItems = (todos: readonly TodoLike[]): SearchItem[] =>
  todos.map((t) => ({
    id: `todo:${t.id}`,
    kind: "todo",
    title: t.title,
    subtitle: `${t.status}${t.dueAt ? `, due ${t.dueAt}` : ""}${t.waitingOn ? `, waiting on ${t.waitingOn}` : ""}`,
    keywords: `${t.description} ${t.owner.name ?? ""} ${t.tags.join(" ")}`.slice(
      0,
      MAX_KEYWORDS,
    ),
    target: { app: "pmo-todo", todoId: t.id },
  }));

export const noteItems = (
  notes: readonly { id: string; title: string; content: string }[],
): SearchItem[] =>
  notes.map((n) => ({
    id: `note:${n.id}`,
    kind: "note",
    title: n.title || "Untitled note",
    subtitle: "Note",
    keywords: n.content.slice(0, MAX_KEYWORDS),
    target: { app: "notes", noteId: n.id },
  }));

export const templateItems = (
  templates: readonly {
    id: string;
    name: string;
    kind: string;
    subject: string;
    body: string;
  }[],
): SearchItem[] =>
  templates.map((t) => ({
    id: `template:${t.id}`,
    kind: "template",
    title: t.name,
    subtitle: `${t.kind} template`,
    keywords: `${t.subject} ${t.body}`.slice(0, MAX_KEYWORDS),
    target: { app: "templates" },
  }));

export const personItems = (employees: readonly Employee[]): SearchItem[] =>
  employees.map((e) => ({
    id: `person:${e.id}`,
    kind: "person",
    title: displayName(e),
    subtitle: [e.offering, e.level, e.homeOffice || e.location]
      .filter(Boolean)
      .join(", "),
    keywords: `${e.deloitteEmail} ${e.milestone}`,
    target: { app: "staff", tab: "directory" },
  }));

export const timeOffItems = (
  requests: readonly Pick<
    TimeOffRequest,
    "id" | "employeeId" | "type" | "startDate" | "endDate" | "status" | "reason"
  >[],
  employees: readonly Employee[],
): SearchItem[] =>
  requests.flatMap((r): SearchItem[] => {
    const person = employees.find((e) => e.id === r.employeeId);
    if (!person) return [];
    const label = TIME_OFF_META[r.type]?.label ?? "Time off";
    const span =
      r.startDate === r.endDate ? r.startDate : `${r.startDate} to ${r.endDate}`;
    return [
      {
        id: `timeoff:${r.id}`,
        kind: "timeoff",
        title: `${displayName(person)}: ${label}, ${span}`,
        subtitle: r.status,
        keywords: r.reason,
        target: { app: "staff", tab: "timeoff" },
      },
    ];
  });
