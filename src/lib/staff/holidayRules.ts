/** Public holidays that follow a rule (a fixed date, "last Monday of May", Easter), so a bundled list cannot be
 *  wrong about them. Lunar festivals (Diwali, Eid, ...) change every year and are not guessed: add those by hand. */
import { addDays, isIsoDate, weekdayIndex } from "./dates.ts";
import { INDIA_LOCATIONS } from "./holidays.ts";
import type { RosterEvent } from "./types.ts";

export interface HolidayEntry {
  date: string;
  label: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** The nth (1-based) weekday (0 = Monday) of a month. */
function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  const first = iso(year, month, 1);
  const offset = (weekday - weekdayIndex(first) + 7) % 7;
  return addDays(first, offset + (n - 1) * 7);
}

function lastWeekday(year: number, month: number, weekday: number): string {
  const last = iso(year, month, new Date(year, month, 0).getDate());
  const back = (weekdayIndex(last) - weekday + 7) % 7;
  return addDays(last, -back);
}

/** Easter Sunday (Gregorian), the anonymous algorithm. */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(year, month, day);
}

/** A weekday holiday that falls on a weekend moves (US: Saturday -> Friday, Sunday -> Monday). */
function observed(date: string): string {
  const w = weekdayIndex(date);
  return w === 5 ? addDays(date, -1) : w === 6 ? addDays(date, 1) : date;
}

/** `locations` are the places a person's office is matched against (see `observes` in
 *  holidays.ts), so India lists its cities: a country name alone matches nobody. */
export const COUNTRIES = [
  { id: "in", label: "India", locations: INDIA_LOCATIONS },
  { id: "us", label: "United States", locations: ["US"] },
  { id: "uk", label: "United Kingdom", locations: ["United Kingdom"] },
] as const;
export type CountryId = (typeof COUNTRIES)[number]["id"];

export function holidaysFor(country: CountryId, year: number): HolidayEntry[] {
  const list: HolidayEntry[] = [];
  const add = (date: string, label: string) => list.push({ date, label });
  if (country === "in") {
    add(iso(year, 1, 26), "Republic Day");
    add(iso(year, 8, 15), "Independence Day");
    add(iso(year, 10, 2), "Gandhi Jayanti");
    add(iso(year, 12, 25), "Christmas Day");
  } else if (country === "us") {
    add(observed(iso(year, 1, 1)), "New Year's Day");
    add(nthWeekday(year, 1, 0, 3), "Martin Luther King Jr. Day");
    add(nthWeekday(year, 2, 0, 3), "Presidents' Day");
    add(lastWeekday(year, 5, 0), "Memorial Day");
    add(observed(iso(year, 6, 19)), "Juneteenth");
    add(observed(iso(year, 7, 4)), "Independence Day");
    add(nthWeekday(year, 9, 0, 1), "Labor Day");
    add(nthWeekday(year, 11, 3, 4), "Thanksgiving");
    add(observed(iso(year, 12, 25)), "Christmas Day");
  } else {
    const easter = easterSunday(year);
    const sub = (date: string) => {
      const w = weekdayIndex(date);
      return w === 5 ? addDays(date, 2) : w === 6 ? addDays(date, 1) : date;
    };
    add(sub(iso(year, 1, 1)), "New Year's Day");
    add(addDays(easter, -2), "Good Friday");
    add(addDays(easter, 1), "Easter Monday");
    add(nthWeekday(year, 5, 0, 1), "Early May bank holiday");
    add(lastWeekday(year, 5, 0), "Spring bank holiday");
    add(lastWeekday(year, 8, 0), "Summer bank holiday");
    add(
      addDays(
        iso(year, 12, 25),
        [5, 6].includes(weekdayIndex(iso(year, 12, 25))) ? 2 : 0,
      ),
      "Christmas Day",
    );
    const boxing = iso(year, 12, 26);
    add(addDays(boxing, [5, 6].includes(weekdayIndex(boxing)) ? 2 : 0), "Boxing Day");
  }
  return list
    .filter((h) => isIsoDate(h.date))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** The roster events to add: holidays for a country and year that the calendar does not already hold
 *  (same date and name). */
export function holidayEvents(
  country: CountryId,
  year: number,
  existing: readonly RosterEvent[],
  newId: () => string,
): RosterEvent[] {
  const meta = COUNTRIES.find((c) => c.id === country)!;
  return holidaysFor(country, year)
    .filter(
      (h) =>
        !existing.some(
          (e) =>
            e.kind === "holiday" &&
            e.date === h.date &&
            e.label.toLowerCase() === h.label.toLowerCase(),
        ),
    )
    .map((h) => ({
      id: newId(),
      date: h.date,
      endDate: h.date,
      label: h.label,
      kind: "holiday" as const,
      locations: [...meta.locations],
    }));
}
