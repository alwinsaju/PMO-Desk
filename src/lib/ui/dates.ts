// The one date display format ("30 Oct 2026") and relative due wording.
// Pure, relative-import friendly (see dates.test.mjs); every function takes
// `now` so tests never depend on the clock.

export type DateInput = Date | string | number | null | undefined;
export type DueUrgency = "overdue" | "today" | "later" | "none";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** A `YYYY-MM-DD` string is a calendar day in local time, not UTC midnight. */
export function parseDate(input: DateInput): Date | null {
  if (input === null || input === undefined || input === "") return null;
  if (typeof input === "string") {
    const match = DATE_ONLY.exec(input.trim());
    if (match) {
      const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
      const date = new Date(year, month - 1, day);
      const real =
        date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day;
      return real ? date : null;
    }
  }
  const date = input instanceof Date ? new Date(input.getTime()) : new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "30 Oct 2026". */
export function formatDate(input: DateInput, fallback = ""): string {
  const date = parseDate(input);
  if (!date) return fallback;
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** "30 Oct 2026, 09:05" (24-hour). */
export function formatDateTime(input: DateInput, fallback = ""): string {
  const date = parseDate(input);
  if (!date) return fallback;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${formatDate(date)}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Whole calendar days from `now` to `due` (negative = past); null if no date. */
export function daysUntil(due: DateInput, now: Date): number | null {
  const date = parseDate(due);
  if (!date) return null;
  const dueDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((dueDay - today) / MS_PER_DAY);
}

export function dueUrgency(due: DateInput, now: Date): DueUrgency {
  const days = daysUntil(due, now);
  if (days === null) return "none";
  if (days < 0) return "overdue";
  return days === 0 ? "today" : "later";
}

/** "3d late", "Due today", "Due tomorrow", "Due in 4d", then "Due 20 Nov 2026". */
export function formatDue(due: DateInput, now: Date): string {
  const days = daysUntil(due, now);
  if (days === null) return "No due date";
  if (days < 0) return `${-days}d late`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days <= 7) return `Due in ${days}d`;
  return `Due ${formatDate(due)}`;
}
