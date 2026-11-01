// The Activity viewer over the PMO audit log (audit.jsonl and its rotated copies).
// Pure parsing, wording and filtering; the file reading is in auditServer.ts.

import { actorLabel, readableDetails } from "./auditReadable.ts";

export interface AuditEntry {
  at: string;
  action: string;
  user: string;
  /** What the line recorded besides who and when, as short "key: value" pairs
   *  (raw, ids included: for tooltips and the CSV). */
  details: string[];
  /** The same facts in plain words, without internal ids. */
  readable: string[];
}

export const ACTION_LABELS: Readonly<Record<string, string>> = {
  approve: "Approved a suggested to-do",
  reject: "Rejected a suggestion",
  restore: "Brought back a rejected suggestion",
  edit: "Edited a to-do",
  complete: "Marked a to-do done",
  cancel: "Cancelled a to-do",
  "clear-cancelled": "Deleted cancelled to-dos",
  reopen: "Reopened a to-do",
  "create-manual": "Added a to-do by hand",
  retry: "Retried reading a message",
  paste: "Pasted a message",
  snooze: "Snoozed a to-do",
  waiting: "Set who a to-do is waiting on",
  "update-apply": "Applied an update to a to-do",
  "update-separate": "Kept an update as a separate to-do",
  split: "Split a message into several to-dos",
  "chaser-draft": "Prepared a chaser",
  "signoff-request": "Recorded a sign-off request",
  "signoff-record": "Recorded a sign-off answer",
  "signoff-conditions-met": "Confirmed sign-off conditions",
  "signoff-revoke": "Revoked a sign-off",
  "signoff-draft": "Prepared a sign-off request",
  "signoff-refused": "Refused a sign-off change",
  "report-generate": "Generated the weekly report",
  "report-narrative": "Drafted the report wording",
  "report-save": "Saved the weekly report",
  config: "Changed PMO settings",
};

export const actionLabel = (action: string): string =>
  ACTION_LABELS[action] ?? action.replace(/-/g, " ");

const SKIP_KEYS = new Set(["ts", "action", "user"]);

const short = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string")
    return value.length > 60 ? `${value.slice(0, 57)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.length > 3
      ? `${value.slice(0, 3).map(short).join(", ")} +${value.length - 3}`
      : value.map(short).join(", ");
  }
  const text = JSON.stringify(value);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
};

/** One JSON line to an entry; null for a line that is not an audit record. */
export function parseAuditLine(line: string): AuditEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.action !== "string" || typeof record.ts !== "string") return null;
  const details = Object.entries(record)
    .filter(
      ([key, v]) => !SKIP_KEYS.has(key) && v !== null && v !== undefined && v !== "",
    )
    .map(([key, v]) => `${key}: ${short(v)}`);
  const extras = Object.fromEntries(
    Object.entries(record).filter(([key]) => !SKIP_KEYS.has(key)),
  );
  return {
    at: record.ts,
    action: record.action,
    user: typeof record.user === "string" ? record.user : "",
    details,
    readable: readableDetails(extras),
  };
}

/** Newest first. Lines that cannot be read are skipped. */
export function parseAuditText(text: string): AuditEntry[] {
  return text
    .split(/\r?\n/)
    .map(parseAuditLine)
    .filter((e): e is AuditEntry => e !== null)
    .sort((a, b) => b.at.localeCompare(a.at));
}

export interface AuditFilter {
  action?: string;
  query?: string;
  /** yyyy-mm-dd, inclusive (UTC day of the entry). */
  from?: string;
  to?: string;
}

export function filterAudit(
  entries: readonly AuditEntry[],
  filter: AuditFilter,
): AuditEntry[] {
  const query = (filter.query ?? "").trim().toLowerCase();
  return entries.filter((entry) => {
    if (filter.action && entry.action !== filter.action) return false;
    const day = entry.at.slice(0, 10);
    if (filter.from && day < filter.from) return false;
    if (filter.to && day > filter.to) return false;
    if (!query) return true;
    return (
      actionLabel(entry.action).toLowerCase().includes(query) ||
      entry.action.includes(query) ||
      entry.user.toLowerCase().includes(query) ||
      actorLabel(entry.user).toLowerCase().includes(query) ||
      entry.details.some((d) => d.toLowerCase().includes(query))
    );
  });
}

/** How many times each action happened, most frequent first. */
export function actionCounts(
  entries: readonly AuditEntry[],
): { action: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const entry of entries)
    counts.set(entry.action, (counts.get(entry.action) ?? 0) + 1);
  return [...counts]
    .map(([action, count]) => ({ action, count }))
    .sort((a, b) => b.count - a.count || a.action.localeCompare(b.action));
}

/** Audit entries as CSV rows, for "copy" and "save". */
export function auditRows(entries: readonly AuditEntry[]): string[][] {
  return [
    ["When", "Who", "What", "Details"],
    ...entries.map((e) => [e.at, e.user, actionLabel(e.action), e.details.join("; ")]),
  ];
}
