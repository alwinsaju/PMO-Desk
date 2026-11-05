// The holiday days of one location, as a flat set of dates, for the PMO due-date maths
// (src/lib/pmo/due.ts takes it as an optional `HolidayDates`). Pure: the roster's
// holiday events go in, a Set of yyyy-mm-dd days comes out. Which event applies where
// is decided by the Staff roster's own rule (`observes` in holidays.ts), so a to-do
// and the roster always agree about a day off.
import { addDays, isIsoDate } from "./dates.ts";
import { canonicalLocation, observes } from "./holidays.ts";
import type { RosterEvent } from "./types.ts";

/** How far ahead the set reaches. Long enough that "next year" phrases are covered. */
export const HOLIDAY_WINDOW_DAYS = 400;

/** A guard for a damaged event whose end date is years away. */
const MAX_EVENT_DAYS = 62;

/** The longest a saved location may be. */
export const MAX_HOLIDAY_LOCATION = 60;

/** Whatever was stored -> a location name: trimmed, whitespace collapsed, a known
 *  alias written the roster's way ("Bangalore" -> "Bengaluru"), at most 60 characters,
 *  no control characters. Anything that is not text is empty ("not set"). */
export function sanitizeHolidayLocation(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 200);
  return canonicalLocation(text).slice(0, MAX_HOLIDAY_LOCATION).trim();
}

/** One shared empty set, so "no holidays" is the same object every time (a stable
 *  value for React and a cheap check for callers). */
export const NO_HOLIDAYS: ReadonlySet<string> = new Set<string>();

/**
 * Every holiday day that applies at `location` from `fromDay` for `days` days (default
 * HOLIDAY_WINDOW_DAYS), inclusive of `fromDay`. A holiday that runs over several days
 * (date to endDate) contributes each day, weekends included. With no location it is
 * empty: a holiday that lists no places means "everywhere" in the roster, but a person
 * who has not said where they work gets today's behaviour, not a guess.
 */
export function holidayDatesFor(
  events: readonly RosterEvent[] | undefined,
  location: string,
  fromDay: string,
  days: number = HOLIDAY_WINDOW_DAYS,
): ReadonlySet<string> {
  const here = sanitizeHolidayLocation(location);
  if (!here || !isIsoDate(fromDay) || !events || events.length === 0 || days < 1) {
    return NO_HOLIDAYS;
  }
  const last = addDays(fromDay, days - 1);
  const found = new Set<string>();
  for (const event of events) {
    if (event.kind !== "holiday" || !observes(event, here)) continue;
    if (!isIsoDate(event.date)) continue;
    const end =
      isIsoDate(event.endDate) && event.endDate >= event.date
        ? event.endDate
        : event.date;
    if (end < fromDay || event.date > last) continue;
    let day = event.date < fromDay ? fromDay : event.date;
    for (let n = 0; n < MAX_EVENT_DAYS && day <= end && day <= last; n++) {
      found.add(day);
      day = addDays(day, 1);
    }
  }
  return found.size === 0 ? NO_HOLIDAYS : found;
}
