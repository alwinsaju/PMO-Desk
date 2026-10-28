// The PMO lead works in India Standard Time unless `reminders.timeZone` says
// otherwise; relative dates in messages ("by Friday") are resolved against that
// zone. Every "today" goes through `safeTimeZone`, so a bad name never throws.
export const DEFAULT_TIME_ZONE = "Asia/Kolkata";
export const PMO_TIME_ZONE = DEFAULT_TIME_ZONE;

/** Is `timeZone` a name Intl knows (an IANA zone such as "Asia/Kolkata")? */
export function isValidTimeZone(timeZone: string): boolean {
  if (typeof timeZone !== "string" || !timeZone.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The one source of the zone to judge time in: the configured name when Intl
 *  knows it, else the default. */
export function safeTimeZone(timeZone: string | undefined | null): string {
  return typeof timeZone === "string" && isValidTimeZone(timeZone)
    ? timeZone
    : DEFAULT_TIME_ZONE;
}

/** A real calendar day: YYYY-MM-DD that survives a Date.UTC round trip, so
 *  2026-02-30 (which Date.parse silently rolls into March) is refused. */
export function isRealIsoDay(day: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return false;
  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, date));
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === date
  );
}

/** A date-time Date.parse reads whose day (when written YYYY-MM-DD...) also
 *  exists: "2026-02-30T09:00:00Z" parses fine but is not a real moment. */
export function isRealIsoInstant(value: string): boolean {
  if (Number.isNaN(Date.parse(value))) return false;
  const day = /^(\d{4}-\d{2}-\d{2})(?:$|[T\s])/.exec(value.trim());
  return day ? isRealIsoDay(day[1]) : true;
}

/** YYYY-MM-DD of an instant in `timeZone` (default and fallback: IST). */
export function istDate(instant: Date | string | number, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTimeZone(timeZone),
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
 * seen in `timeZone`, so the model copies a weekday's date instead of counting.
 * null when the instant is not a valid date.
 */
export function istDayLabels(
  instant: Date | string | number,
  days = 14,
  timeZone?: string,
): { received: string; upcoming: string[] } | null {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return null;
  const today = istDate(date, timeZone);
  return {
    received: labelledDay(today, 0),
    upcoming: Array.from({ length: days }, (_, i) => labelledDay(today, i + 1)),
  };
}

/** "2026-10-22T09:14 IST (Thursday 22 October 2026)" for the model's context;
 *  another zone is named in full ("... America/New_York ..."). */
export function istStamp(instant: Date | string | number, timeZone?: string): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return String(instant);
  const zone = safeTimeZone(timeZone);
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  const label = zone === DEFAULT_TIME_ZONE ? "IST" : zone;
  return `${istDate(date, zone)}T${time} ${label} (${day})`;
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
