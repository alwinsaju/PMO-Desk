// The PMO lead works in India Standard Time; relative dates in messages
// ("by Friday") are resolved against it. IST has no daylight saving.
export const PMO_TIME_ZONE = "Asia/Kolkata";

/** Is `timeZone` a name Intl knows (an IANA zone such as "Asia/Kolkata")? */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** YYYY-MM-DD of an instant, as seen in IST. */
export function istDate(instant: Date | string | number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PMO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Mon 2026-10-26" for a YYYY-MM-DD moved by `offsetDays`. Plain calendar
 *  arithmetic in UTC, so month, year and leap-day rollover are exact. */
function labelledDay(isoDay: string, offsetDays: number): string {
  const [year, month, day] = isoDay.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + offsetDays));
  return `${WEEKDAY_SHORT[date.getUTCDay()]} ${date.toISOString().slice(0, 10)}`;
}

/**
 * The received day and the following `days` days as `Mon 2026-10-26` labels,
 * seen in IST, so the model copies a weekday's date instead of counting.
 * null when the instant is not a valid date.
 */
export function istDayLabels(
  instant: Date | string | number,
  days = 14,
): { received: string; upcoming: string[] } | null {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return null;
  const today = istDate(date);
  return {
    received: labelledDay(today, 0),
    upcoming: Array.from({ length: days }, (_, i) => labelledDay(today, i + 1)),
  };
}

/** "2026-10-22T09:14 IST (Thursday 22 October 2026)" for the model's context. */
export function istStamp(instant: Date | string | number): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return String(instant);
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone: PMO_TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: PMO_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return `${istDate(date)}T${time} IST (${day})`;
}

/** YYYY-MM-DD moved by `offset` calendar days (month/year rollover exact). */
export function addIsoDays(day: string, offset: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + offset)).toISOString().slice(0, 10);
}

/** Whole calendar days from `from` to `to` (both YYYY-MM-DD); negative if `to` is earlier. */
export function isoDaysBetween(from: string, to: string): number {
  const at = (day: string) => {
    const [year, month, date] = day.split("-").map(Number);
    return Date.UTC(year, month - 1, date);
  };
  return Math.round((at(to) - at(from)) / 86_400_000);
}

/** "Mon 2026-10-26" for a YYYY-MM-DD day. */
export function isoDayLabel(day: string): string {
  return labelledDay(day, 0);
}
