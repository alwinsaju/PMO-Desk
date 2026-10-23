// Pure list/formatting helpers for the PMO To-Do window. No React, and
// relative imports with the .ts extension, so `pnpm test` can load this file
// under plain Node (see queueView.test.mjs).
import type {
  Priority,
  Proposal,
  StructuringInfo,
  Todo,
} from "../../../lib/pmo/types.ts";

export interface QueueGroups {
  /** Structured, looks like a task: waiting for a human decision. */
  review: Proposal[];
  /** Waiting for, or in the middle of, the model. */
  processing: Proposal[];
  failed: Proposal[];
  /** Structured, but the model thinks it is not a task (collapsed in the UI). */
  notTask: Proposal[];
}

const byReceivedDesc = (a: Proposal, b: Proposal) =>
  b.summary.receivedAt.localeCompare(a.summary.receivedAt);

export function groupQueue(queue: Proposal[]): QueueGroups {
  const sorted = [...queue].sort(byReceivedDesc);
  return {
    review: sorted.filter((p) => p.status === "ready" && p.isActionable !== false),
    processing: [...sorted]
      .reverse() // the queue works oldest first, so show it that way
      .filter((p) => p.status === "pending" || p.status === "structuring"),
    failed: sorted.filter((p) => p.status === "failed"),
    notTask: sorted.filter((p) => p.status === "ready" && p.isActionable === false),
  };
}

/** What the badge on a queue row says. */
export function statusLabel(proposal: Proposal, structuring: StructuringInfo): string {
  // While the model is down, an item flips between pending and structuring on
  // every retry; one steady label reads better than that flicker.
  if (
    structuring.paused &&
    (proposal.status === "pending" || proposal.status === "structuring")
  ) {
    return "waiting for model";
  }
  switch (proposal.status) {
    case "structuring":
      return structuring.total > 1
        ? `structuring ${structuring.position} of ${structuring.total}`
        : "structuring";
    case "pending":
      return structuring.paused ? "waiting for model" : "pending";
    case "ready":
      return proposal.isActionable === false ? "probably not a task" : "ready";
    case "failed":
      return "failed";
    default:
      return proposal.status;
  }
}

const PRIORITY_RANK: Record<Priority, number> = { high: 0, normal: 1, low: 2 };

/** Open first; within them overdue, then soonest due, then priority, then newest. */
export function sortTodos(todos: Todo[], today: string): Todo[] {
  const rank = (todo: Todo) => (todo.status === "open" ? 0 : 1);
  return [...todos].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (a.status === "open") {
      const overdueA = a.dueAt !== null && a.dueAt < today;
      const overdueB = b.dueAt !== null && b.dueAt < today;
      if (overdueA !== overdueB) return overdueA ? -1 : 1;
      if (a.dueAt !== b.dueAt) {
        if (a.dueAt === null) return 1;
        if (b.dueAt === null) return -1;
        return a.dueAt.localeCompare(b.dueAt);
      }
      if (a.priority !== b.priority)
        return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    }
    return b.createdAt.localeCompare(a.createdAt);
  });
}

const DAY_MS = 86_400_000;
const utcDay = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** "Today", "Tomorrow", "Yesterday", else "Fri 27 Oct" (with the year when it
 *  isn't the current one). `today` is the IST date the server reports. */
export function formatDay(day: string, today: string): string {
  const diff = Math.round((utcDay(day) - utcDay(today)) / DAY_MS);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(new Date(utcDay(day)));
}

/** "just now", "5 min ago", "3 h ago", "2 d ago", else a short date. */
export function relativeTime(iso: string, nowMs: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const minutes = Math.round((nowMs - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} d ago`;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(then));
}

/** Who to show for a to-do: the owner's name, "Me" for the PMO lead. */
export function ownerLabel(owner: Todo["owner"]): string {
  if (owner.isMe) return "Me";
  return owner.name || owner.email || "Unassigned";
}

export const SOURCE_LABEL = {
  outlook: "Outlook",
  teams: "Teams",
  manual: "Manual",
} as const;
