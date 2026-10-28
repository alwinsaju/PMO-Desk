// Calendar-day helpers on yyyy-mm-dd strings. Everything is done in UTC so a
// daylight-saving change can never move a date.
const DAY_MS = 86_400_000;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Calendar check, so "2026-02-31" is refused. */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
  );
}

/** Today in the machine's own calendar. */
export function todayIso(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const toUtc = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);
const toIso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export function addDays(iso: string, days: number): string {
  return toIso(toUtc(iso) + days * DAY_MS);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(iso: string): number {
  return (new Date(toUtc(iso)).getUTCDay() + 6) % 7;
}

export const isWeekend = (iso: string): boolean => weekdayIndex(iso) >= 5;

export function mondayOf(iso: string): string {
  return addDays(iso, -weekdayIndex(iso));
}

export function weekDates(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** Inclusive count of calendar days. */
export function inclusiveDays(start: string, end: string): number {
  return daysBetween(start, end) + 1;
}

/** Inclusive count of Monday–Friday days. */
export function workingDays(start: string, end: string): number {
  let count = 0;
  for (let day = start; day <= end; day = addDays(day, 1)) {
    if (!isWeekend(day)) count++;
  }
  return count;
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_NAMES = [
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
];

export const dayName = (iso: string): string => DAY_NAMES[weekdayIndex(iso)];

/** "5 Mar 2026"; "" for an empty value. */
export function formatDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

/** "5 Mar" (day and month only). */
export function formatDayMonth(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTH_NAMES[m - 1]}`;
}

/** "5 – 11 Mar 2026", "29 Mar – 4 Apr 2026" or across years. */
export function formatRange(start: string, end: string): string {
  if (start === end) return formatDate(start);
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  if (sy !== ey) return `${formatDate(start)} – ${formatDate(end)}`;
  if (sm === em) return `${Number(start.slice(8))} – ${formatDate(end)}`;
  return `${formatDayMonth(start)} – ${formatDate(end)}`;
}

/** "in 12 days", "today", "3 days ago". */
export function relativeDays(days: number): string {
  if (days === 0) return "today";
  const n = Math.abs(days);
  const unit = n === 1 ? "day" : "days";
  return days > 0 ? `in ${n} ${unit}` : `${n} ${unit} ago`;
}

/** The first day of the month `iso` is in. */
export const monthStart = (iso: string): string => `${iso.slice(0, 7)}-01`;

/** The first day of the month `months` away from the one `iso` is in. */
export function addMonths(iso: string, months: number): string {
  const [y, m] = iso.split("-").map(Number);
  const index = y * 12 + (m - 1) + months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`;
}

/** Every day of the month `iso` is in. */
export function monthDates(iso: string): string[] {
  const first = monthStart(iso);
  const days: string[] = [];
  for (let day = first; day.slice(0, 7) === first.slice(0, 7); day = addDays(day, 1)) {
    days.push(day);
  }
  return days;
}

/** "March 2026". */
export function formatMonth(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return `${MONTH_FULL[m - 1]} ${y}`;
}

const MONTH_FULL = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
