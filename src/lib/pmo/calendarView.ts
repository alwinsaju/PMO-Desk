// The Calendar tab's Week / Month switch: which days a view covers, how to step
// and label them, and the priority dots of a busy day (see calendarView.test.mjs).
import { priorityTone, type PriorityToneName } from "../../components/ui/chipLogic.ts";
import { addDays, mondayOf } from "../staff/dates.ts";
import {
  monthGrid,
  monthLabel,
  monthOf,
  weekIndexOf,
  type CalendarDay,
} from "./pmoViews.ts";
import type { Todo } from "./types.ts";

export type CalendarMode = "week" | "month";

export const CALENDAR_MODES: { id: CalendarMode; label: string }[] = [
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
];

/** The rows of the view: six weeks for a month, one for a week. `anchorDay` is
 *  any day inside the period shown. A week shows no dimmed "other month" days. */
export function calendarWeeks(
  mode: CalendarMode,
  anchorDay: string,
  todos: readonly Todo[],
): CalendarDay[][] {
  const { year, month } = monthOf(anchorDay);
  const weeks = monthGrid(year, month, todos);
  if (mode === "month") return weeks;
  const week = weeks[weekIndexOf(weeks, anchorDay)];
  return week ? [week.map((cell) => ({ ...cell, inMonth: true }))] : [];
}

/** The day to anchor on after stepping `delta` periods: the first of the month,
 *  or the Monday of the week. */
export function shiftAnchor(
  mode: CalendarMode,
  anchorDay: string,
  delta: number,
): string {
  if (mode === "week") return addDays(mondayOf(anchorDay), delta * 7);
  const { year, month } = monthOf(anchorDay);
  const index = year * 12 + (month - 1) + delta;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
}

const dayMonth = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const utc = (day: string) => new Date(`${day}T00:00:00Z`);

/** "October 2026", or "26 Oct – 1 Nov 2026" for a week. */
export function periodLabel(mode: CalendarMode, anchorDay: string): string {
  if (mode === "month") {
    const { year, month } = monthOf(anchorDay);
    return monthLabel(year, month);
  }
  const start = mondayOf(anchorDay);
  const end = addDays(start, 6);
  return `${dayMonth.format(utc(start))} – ${dayMonth.format(utc(end))} ${end.slice(0, 4)}`;
}

/** Previous / next in the button labels ("Previous week"). */
export const stepLabel = (mode: CalendarMode, delta: -1 | 1): string =>
  `${delta < 0 ? "Previous" : "Next"} ${mode}`;

/** How many to-dos a day lists before "+N more": a week has the room. */
export const SHOWN_PER_DAY: Record<CalendarMode, number> = { week: 5, month: 2 };

const TONE_ORDER: PriorityToneName[] = ["red", "amber", "muted"];

export const MAX_DOTS = 5;

/** One dot per to-do on a day, most urgent first, at most `max`. `more` is how
 *  many to-dos have no dot of their own. */
export function dayDots(
  todos: readonly Pick<Todo, "priority">[],
  max = MAX_DOTS,
): { tones: PriorityToneName[]; more: number } {
  const rank = (todo: Pick<Todo, "priority">) =>
    TONE_ORDER.indexOf(priorityTone(todo.priority)?.tone ?? "muted");
  const tones = [...todos]
    .sort((a, b) => rank(a) - rank(b))
    .map((todo) => priorityTone(todo.priority)?.tone ?? "muted");
  return { tones: tones.slice(0, max), more: Math.max(0, tones.length - max) };
}

/** The colour class of a priority dot (tokens, so it follows the theme). */
export const DOT_CLASS: Record<PriorityToneName, string> = {
  red: "bg-red",
  amber: "bg-amber",
  muted: "bg-ink-faint",
};
