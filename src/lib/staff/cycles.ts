// Roster cycles, as the Tasks app's shift-roster task defines them: two months
// starting in Feb, Apr, Jun, Aug, Oct or Dec, always whole Sunday-Saturday weeks.
// The cycles tile the calendar: each runs to the day before the next one starts.
import { addDays, formatDayMonth, weekdayIndex } from "./dates.ts";

export interface Cycle {
  /** "2026-02". */
  id: string;
  /** "Feb – Mar 2026" or "Dec 2025 – Jan 2026". */
  label: string;
  /** The Sunday the cycle starts on. */
  start: string;
  /** The Saturday it ends on. */
  end: string;
}

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
];

const pad = (n: number) => String(n).padStart(2, "0");

/** The day the cycle whose first month is `year-month` starts: the last Sunday of
 *  the month before when that month ends on a Sunday, Monday or Tuesday, otherwise
 *  the first Sunday of the first month. */
export function rotationSunday(year: number, month: number): string {
  const first = `${year}-${pad(month)}-01`;
  const lastOfPrevious = addDays(first, -1);
  const weekday = weekdayIndex(lastOfPrevious); // 0 = Monday ... 6 = Sunday
  if (weekday === 6) return lastOfPrevious;
  if (weekday === 0) return addDays(lastOfPrevious, -1);
  if (weekday === 1) return addDays(lastOfPrevious, -2);
  return addDays(first, (6 - weekdayIndex(first) + 7) % 7);
}

/** The cycle that starts in `year-month` (`month` must be 2, 4, 6, 8, 10 or 12). */
export function cycleStartingIn(year: number, month: number): Cycle {
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 2 : month + 2;
  const second = month === 12 ? 1 : month + 1;
  const secondYear = month === 12 ? year + 1 : year;
  const label =
    second === 1
      ? `${MONTHS[month - 1]} ${year} – ${MONTHS[second - 1]} ${secondYear}`
      : `${MONTHS[month - 1]} – ${MONTHS[second - 1]} ${year}`;
  return {
    id: `${year}-${pad(month)}`,
    label,
    start: rotationSunday(year, month),
    end: addDays(rotationSunday(nextYear, nextMonth), -1),
  };
}

/** The cycle a day falls in. */
export function cycleContaining(iso: string): Cycle {
  const year = Number(iso.slice(0, 4));
  for (let y = year - 1; y <= year + 1; y++) {
    for (const month of [2, 4, 6, 8, 10, 12]) {
      const cycle = cycleStartingIn(y, month);
      if (cycle.start <= iso && iso <= cycle.end) return cycle;
    }
  }
  // Unreachable: the cycles tile every year.
  return cycleStartingIn(year, 2);
}

export const nextCycle = (cycle: Cycle): Cycle => cycleContaining(addDays(cycle.end, 1));
export const previousCycle = (cycle: Cycle): Cycle =>
  cycleContaining(addDays(cycle.start, -1));

/** Every day of the cycle. */
export function cycleDates(cycle: Cycle): string[] {
  const days: string[] = [];
  for (let day = cycle.start; day <= cycle.end; day = addDays(day, 1)) days.push(day);
  return days;
}

/** "Sun 1 Feb – Sat 4 Apr 2026" style span for the header. */
export const cycleSpan = (cycle: Cycle): string =>
  `${formatDayMonth(cycle.start)} – ${formatDayMonth(cycle.end)}`;
