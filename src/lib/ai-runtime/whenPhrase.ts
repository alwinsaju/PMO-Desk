// Turns a phrase like "next Monday", "this week" or "5 Nov" into the days it means,
// for "who's off ...?" in the command bar. Deterministic on purpose: a small local
// model is unreliable at calendar arithmetic, so it only passes the phrase on.
// Pure (no node imports); dates are yyyy-mm-dd, weeks run Monday to Sunday.
import {
  addDays,
  addMonths,
  dayName,
  formatDate,
  formatDayMonth,
  isIsoDate,
  mondayOf,
  weekdayIndex,
} from "../staff/dates.ts";

export interface DateRange {
  from: string;
  to: string;
  /** For the reply: "Mon 2 Nov 2026", "Mon 2 Nov to Sun 8 Nov 2026". */
  label: string;
}

const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];
const WEEKDAY_SHORT: Record<string, number> = {
  mon: 0,
  tue: 1,
  tues: 1,
  wed: 2,
  weds: 2,
  thu: 3,
  thur: 3,
  thurs: 3,
  fri: 4,
  sat: 5,
  sun: 6,
};
const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const single = (day: string): DateRange => ({
  from: day,
  to: day,
  label: `${dayName(day)} ${formatDate(day)}`,
});

const span = (from: string, to: string): DateRange => ({
  from,
  to,
  label: `${dayName(from)} ${formatDayMonth(from)} to ${dayName(to)} ${formatDate(to)}`,
});

function weekdayOf(word: string): number | null {
  const full = WEEKDAYS.indexOf(word);
  if (full >= 0) return full;
  return WEEKDAY_SHORT[word] ?? null;
}

function monthOf(word: string): number | null {
  const full = MONTHS.indexOf(word);
  if (full >= 0) return full;
  const short = MONTHS.findIndex((m) => m.slice(0, 3) === word.slice(0, 3));
  return word.length >= 3 && short >= 0 && (word.length === 3 || word === "sept")
    ? short
    : null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "5 Nov", "5th November 2026", "Nov 5", "2026-11-05" -> a day. A date with no year is
 *  this year, or next year when it would be more than a month back. */
function parseDate(text: string, today: string): string | null {
  if (isIsoDate(text)) return text;
  const dayFirst =
    /^(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+([a-z]+)(?:,?\s+(\d{4}))?$/.exec(text);
  const monthFirst = /^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/.exec(text);
  const parts = dayFirst
    ? { day: dayFirst[1], month: dayFirst[2], year: dayFirst[3] }
    : monthFirst
      ? { day: monthFirst[2], month: monthFirst[1], year: monthFirst[3] }
      : null;
  const month = parts ? monthOf(parts.month) : null;
  if (!parts || month === null) return null;
  const build = (year: number) => `${year}-${pad(month + 1)}-${pad(Number(parts.day))}`;
  const thisYear = Number(today.slice(0, 4));
  let day = build(parts.year ? Number(parts.year) : thisYear);
  if (!isIsoDate(day)) return null;
  if (!parts.year && day < addDays(today, -31)) day = build(thisYear + 1);
  return isIsoDate(day) ? day : null;
}

/**
 * The days a phrase means, or null when it is not a day or period this
 * understands. `today` is the reference day.
 */
export function resolveWhen(phrase: string, today: string): DateRange | null {
  const text = phrase
    .toLowerCase()
    .replace(/[?!.,]+$/g, "")
    .replace(/^(?:on|for|during|from|in|at|the|by)\s+/g, "")
    .replace(/^(?:the\s+)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!isIsoDate(today)) return null;
  if (text === "" || text === "today" || text === "now" || text === "right now")
    return single(today);
  if (text === "tomorrow") return single(addDays(today, 1));
  if (text === "yesterday") return single(addDays(today, -1));
  if (text === "day after tomorrow") return single(addDays(today, 2));

  const monday = mondayOf(today);
  if (/^(?:this|the current) week$/.test(text) || text === "week")
    return span(monday, addDays(monday, 6));
  if (text === "next week") return span(addDays(monday, 7), addDays(monday, 13));
  if (text === "last week" || text === "previous week")
    return span(addDays(monday, -7), addDays(monday, -1));
  if (/^(?:this )?weekend$/.test(text))
    return span(addDays(monday, 5), addDays(monday, 6));
  if (text === "next weekend") return span(addDays(monday, 12), addDays(monday, 13));

  const days = /^(?:in )?(?:the )?next (\d{1,2}) days?$/.exec(text);
  if (days && Number(days[1]) >= 1)
    return span(today, addDays(today, Number(days[1]) - 1));

  const month = /^(this|next) month$/.exec(text);
  if (month) {
    const offset = month[1] === "this" ? 0 : 1;
    const start = addMonths(today, offset);
    const end = addDays(addMonths(today, offset + 1), -1);
    return span(offset === 0 ? today : start, end);
  }

  // A weekday: "friday", "this friday", "next monday".
  const named = /^(?:(this|next|coming)\s+)?([a-z]+)$/.exec(text);
  const weekday = named ? weekdayOf(named[2]) : null;
  if (named && weekday !== null) {
    if (named[1] === "next") return single(addDays(monday, 7 + weekday));
    if (named[1] === "this") return single(addDays(monday, weekday));
    // Bare or "coming": the next one on or after today.
    return single(addDays(today, (weekday - weekdayIndex(today) + 7) % 7));
  }

  const day = parseDate(text, today);
  return day ? single(day) : null;
}
