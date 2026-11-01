// Pure mapping from data to chip tone + wording (see chipLogic.test.mjs), so
// every app shows an overdue date, a status or a source the same way.
import { dueUrgency, formatDate, formatDue, type DateInput } from "../../lib/ui/dates.ts";
import { TERMS } from "../../lib/ui/terms.ts";
import type { BadgeVariant } from "./Badge.tsx";

export interface ChipSpec {
  variant: BadgeVariant;
  label: string;
  dot?: boolean;
}

export function dueChip(
  due: DateInput,
  now: Date,
  { done = false }: { done?: boolean } = {},
): ChipSpec {
  if (done) {
    return { variant: "neutral", label: formatDate(due, "No due date") };
  }
  const urgency = dueUrgency(due, now);
  const variant: BadgeVariant =
    urgency === "overdue"
      ? "danger"
      : urgency === "today"
        ? "warning"
        : urgency === "none"
          ? "outline"
          : "neutral";
  return { variant, label: formatDue(due, now) };
}

const STATUSES: Record<string, ChipSpec> = {
  done: { variant: "success", label: "Done" },
  running: { variant: "accent", label: "Running", dot: true },
  waiting: { variant: "warning", label: "Waiting" },
  "needs you": { variant: "warning", label: "Needs you" },
  failed: { variant: "danger", label: "Failed" },
  snoozed: { variant: "neutral", label: "Snoozed" },
  pending: { variant: "warning", label: TERMS.pending },
  approved: { variant: "success", label: TERMS.approved },
  declined: { variant: "danger", label: TERMS.declined },
};
const STATUS_ALIASES: Record<string, string> = {
  complete: "done",
  completed: "done",
  "in progress": "running",
  error: "failed",
  rejected: "declined",
};

function words(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");
}

export function statusChip(status: string | null | undefined): ChipSpec {
  const key = words(status ?? "");
  if (!key) return { variant: "neutral", label: "Unknown" };
  const spec = STATUSES[STATUS_ALIASES[key] ?? key];
  if (spec) return { ...spec };
  return { variant: "neutral", label: key.charAt(0).toUpperCase() + key.slice(1) };
}

export type PriorityToneName = "red" | "amber" | "muted";

const PRIORITIES: Record<string, { tone: PriorityToneName; label: string }> = {
  urgent: { tone: "red", label: "Urgent priority" },
  high: { tone: "red", label: "High priority" },
  medium: { tone: "amber", label: "Medium priority" },
  normal: { tone: "amber", label: "Medium priority" },
  low: { tone: "muted", label: "Low priority" },
};

export function priorityTone(
  priority: string | null | undefined,
): { tone: PriorityToneName; label: string } | null {
  const found = PRIORITIES[words(priority ?? "")];
  return found ? { ...found } : null;
}

export function sourceChip(source: string | null | undefined): ChipSpec {
  switch (words(source ?? "")) {
    case "outlook":
    case "email":
      return { variant: "info", label: TERMS.outlook };
    case "teams":
      return { variant: "accent", label: TERMS.teams };
    default:
      return { variant: "neutral", label: TERMS.manual };
  }
}
