// Pure list/formatting helpers for the PMO To-Do window. No React, and
// relative imports with the .ts extension, so `pnpm test` can load this file
// under plain Node (see queueView.test.mjs).
import { isDueSoon, isSnoozed, isWaiting } from "../../../lib/pmo/due.ts";
import { domainMatches, domainOf } from "../../../lib/pmo/filter.ts";
import { checkpointProgress } from "../../../lib/pmo/todoLogic.ts";
import type {
  PmoConfig,
  Priority,
  Proposal,
  QuarantineRecord,
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

// --- filtering and sorting the to-do list -------------------------------------

export const TODO_FILTERS = [
  { id: "open", label: "Open" },
  { id: "overdue", label: "Overdue" },
  { id: "due-soon", label: "Due soon" },
  { id: "waiting", label: "Waiting" },
  { id: "snoozed", label: "Snoozed" },
  { id: "done", label: "Done" },
] as const;
export type TodoFilter = (typeof TODO_FILTERS)[number]["id"];

/** Overdue = due before today; due soon = due today or tomorrow (the same
 *  windows the dock badge uses); waiting = "waiting on" is set; snoozed =
 *  silenced until later; done = done or cancelled. Snoozed and waiting items
 *  also stay in "Open". `today` is the IST date the server reports. */
export function matchesFilter(todo: Todo, filter: TodoFilter, today: string, now: Date) {
  const open = todo.status === "open";
  switch (filter) {
    case "open":
      return open;
    case "overdue":
      return open && todo.dueAt !== null && todo.dueAt < today;
    case "due-soon":
      return isDueSoon(todo, today);
    case "waiting":
      return isWaiting(todo);
    case "snoozed":
      return open && isSnoozed(todo, now);
    case "done":
      return !open;
  }
}

export function filterTodos(
  todos: Todo[],
  filter: TodoFilter,
  today: string,
  now: Date,
): Todo[] {
  return todos.filter((todo) => matchesFilter(todo, filter, today, now));
}

export function countByFilter(
  todos: Todo[],
  today: string,
  now: Date,
): Record<TodoFilter, number> {
  return Object.fromEntries(
    TODO_FILTERS.map(({ id }) => [id, filterTodos(todos, id, today, now).length]),
  ) as Record<TodoFilter, number>;
}

export const TODO_SORTS = [
  { id: "due", label: "Due date" },
  { id: "priority", label: "Priority" },
  { id: "progress", label: "Least progress" },
  { id: "newest", label: "Newest" },
] as const;
export type TodoSort = (typeof TODO_SORTS)[number]["id"];

/** "due" is the default order of sortTodos; the others break ties by it. */
export function sortTodosBy(todos: Todo[], sort: TodoSort, today: string): Todo[] {
  const base = sortTodos(todos, today);
  const position = new Map(base.map((todo, index) => [todo.id, index]));
  const byBase = (a: Todo, b: Todo) => position.get(a.id)! - position.get(b.id)!;
  const share = (todo: Todo) => {
    const { done, total } = checkpointProgress(todo);
    return total === 0 ? 0 : done / total;
  };
  switch (sort) {
    case "due":
      return base;
    case "priority":
      return [...base].sort(
        (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || byBase(a, b),
      );
    case "progress":
      return [...base].sort((a, b) => share(a) - share(b) || byBase(a, b));
    case "newest":
      return [...base].sort(
        (a, b) => b.createdAt.localeCompare(a.createdAt) || byBase(a, b),
      );
  }
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

// --- the Filtered tab ---------------------------------------------------------

export const FILTER_REASON_LABEL: Record<string, string> = {
  "blocked-domain": "Blocked domain",
  "blocked-term": "Blocked term",
  "teams-not-allowlisted": "Teams, no tenant ID",
  "tenant-not-allowed": "Teams tenant not allowed",
  "sender-domain-not-allowed": "Sender domain not allowed",
};

export const reasonLabel = (code: string): string => FILTER_REASON_LABEL[code] ?? code;

/** One entry per reason that occurs, known reasons first in a fixed order,
 *  then any other code, each with how many items carry it. */
export function reasonCounts(
  records: Pick<QuarantineRecord, "code">[],
): { code: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const record of records)
    counts.set(record.code, (counts.get(record.code) ?? 0) + 1);
  const known = Object.keys(FILTER_REASON_LABEL).filter((code) => counts.has(code));
  const other = [...counts.keys()]
    .filter((code) => !(code in FILTER_REASON_LABEL))
    .sort();
  return [...known, ...other].map((code) => ({
    code,
    label: reasonLabel(code),
    count: counts.get(code) ?? 0,
  }));
}

export function filterByReason<T extends Pick<QuarantineRecord, "code">>(
  records: T[],
  code: string | null,
): T[] {
  return code === null ? records : records.filter((record) => record.code === code);
}

/** Why a filtered item cannot simply be moved into the review queue. */
export const WHY_NO_BODY =
  "The text of a filtered message is thrown away when it is filtered, on purpose, so it cannot be moved into the review queue afterwards. Fix the rule, then send the message again.";

export interface ResendGuidance {
  /** One click that makes the rule let the message through next time. */
  allowTenantId: string | null;
  allowDomain: string | null;
  /** What to do after that, in words. */
  steps: string;
}

/** What a person can do about one filtered item (never a way to get the body back). */
export function resendGuidance(
  record: QuarantineRecord,
  config: Pick<PmoConfig, "allowedTenantIds" | "allowedSenderDomains">,
): ResendGuidance {
  const { summary } = record;
  const tenant = record.tenantId?.trim().toLowerCase() ?? null;
  const domain = domainOf(summary.senderAddress);
  switch (record.code) {
    case "tenant-not-allowed": {
      const already = tenant !== null && config.allowedTenantIds.includes(tenant);
      return {
        allowTenantId: tenant && !already ? tenant : null,
        allowDomain: null,
        steps: already
          ? "This tenant is allowed now. Run the Teams flow on the message again."
          : "Allow this tenant, then run the Teams flow on the message again (select it, ... , More actions, your flow).",
      };
    }
    case "teams-not-allowlisted":
      return {
        allowTenantId: null,
        allowDomain: null,
        steps:
          "The message carried no tenant ID. Open Settings, add your tenant ID under Teams (the How-to there says where to find it), then run the Teams flow on the message again.",
      };
    case "sender-domain-not-allowed": {
      if (!domain) {
        return {
          allowTenantId: null,
          allowDomain: null,
          steps:
            "No sender address could be read from this email, so there is nothing to allow. Re-export it; for the Outlook script, check its warnings for the sender.",
        };
      }
      const already = config.allowedSenderDomains.some((listed) =>
        domainMatches(domain, listed),
      );
      return {
        allowTenantId: null,
        allowDomain: already ? null : domain,
        steps: already
          ? `${domain} is allowed now. Send the email again: flag it again, or run the Outlook export with -IgnoreSeen.`
          : `Allow ${domain}, then send the email again: flag it again, or run the Outlook export with -IgnoreSeen.`,
      };
    }
    case "blocked-domain":
    case "blocked-term":
      return {
        allowTenantId: null,
        allowDomain: null,
        steps:
          "This matched your block list. If that was a mistake, remove the entry in Settings, then send the message again.",
      };
    default:
      return {
        allowTenantId: null,
        allowDomain: null,
        steps: "Send the message again once the rule is fixed.",
      };
  }
}
