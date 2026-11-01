// Settings > Activity as a timeline: each action belongs to a category (for its icon and the filter
// chips), and entries are grouped under a day heading. Pure.
import type { AuditEntry } from "./auditView.ts";

export type ActivityCategory =
  "todos" | "messages" | "signoff" | "reports" | "settings" | "other";

export const CATEGORY_LABEL: Readonly<Record<ActivityCategory, string>> = {
  todos: "To-dos",
  messages: "Messages",
  signoff: "Chasers and sign-off",
  reports: "Reports",
  settings: "Settings",
  other: "Other",
};

export const CATEGORY_ORDER: readonly ActivityCategory[] = [
  "todos",
  "messages",
  "signoff",
  "reports",
  "settings",
  "other",
];

const MESSAGE_ACTIONS = new Set(["approve", "reject", "restore", "retry", "paste"]);
const TODO_ACTIONS = new Set([
  "edit",
  "complete",
  "cancel",
  "clear-cancelled",
  "reopen",
  "create-manual",
  "snooze",
  "waiting",
  "update-apply",
  "update-separate",
  "split",
]);

export function categoryOf(action: string): ActivityCategory {
  if (MESSAGE_ACTIONS.has(action)) return "messages";
  if (TODO_ACTIONS.has(action)) return "todos";
  if (action.startsWith("signoff") || action === "chaser-draft") return "signoff";
  if (action.startsWith("report")) return "reports";
  if (action === "config") return "settings";
  return "other";
}

/** How many entries each category has, in display order, skipping empty ones. */
export function categoryCounts(
  entries: readonly Pick<AuditEntry, "action">[],
): { category: ActivityCategory; count: number }[] {
  const counts = new Map<ActivityCategory, number>();
  for (const e of entries) {
    const c = categoryOf(e.action);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return CATEGORY_ORDER.filter((c) => counts.has(c)).map((c) => ({
    category: c,
    count: counts.get(c) ?? 0,
  }));
}

export const filterByCategory = <T extends Pick<AuditEntry, "action">>(
  entries: readonly T[],
  category: ActivityCategory | "",
): T[] =>
  category ? entries.filter((e) => categoryOf(e.action) === category) : [...entries];

export interface DayGroup<T> {
  /** yyyy-mm-dd in the viewer's time zone. */
  day: string;
  /** "Today", "Yesterday" or "Mon 26 Oct". */
  label: string;
  entries: T[];
}

const pad = (n: number): string => String(n).padStart(2, "0");
const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Groups newest-first entries under local-day headings, keeping their order. */
export function groupByDay<T extends Pick<AuditEntry, "at">>(
  entries: readonly T[],
  now: Date,
): DayGroup<T>[] {
  const today = dayKey(now);
  const yesterday = dayKey(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1),
  );
  const groups: DayGroup<T>[] = [];
  for (const entry of entries) {
    const at = new Date(entry.at);
    if (Number.isNaN(at.getTime())) continue;
    const day = dayKey(at);
    let group = groups.at(-1);
    if (!group || group.day !== day) {
      const label =
        day === today
          ? "Today"
          : day === yesterday
            ? "Yesterday"
            : at.toLocaleDateString("en-GB", {
                weekday: "short",
                day: "numeric",
                month: "short",
              });
      group = { day, label, entries: [] };
      groups.push(group);
    }
    group.entries.push(entry);
  }
  return groups;
}

/** "09:05" in the viewer's time zone. */
export const timeOfDay = (iso: string): string =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
