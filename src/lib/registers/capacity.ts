// The capacity planner's grid: each person's allocation per week against their leave. Pure.
import { addDays, weekDates, workingDays } from "../staff/dates.ts";
import { numberOf, textOf } from "./records.ts";
import type { RegisterRecord } from "./types.ts";

export interface CapacityCell {
  /** Monday of the week. */
  week: string;
  /** Sum of allocations that touch the week. */
  percent: number;
  /** 100 less the share of the week spent on approved leave. */
  available: number;
  over: boolean;
  projects: string[];
}

export interface CapacityRow {
  person: string;
  cells: CapacityCell[];
  /** Weeks where the person is over what they have available. */
  overWeeks: number;
}

/** Monday of `from` and the next `count - 1` Mondays. */
export function weekStarts(monday: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(monday, i * 7));
}

const overlaps = (from: string, to: string, monday: string): boolean =>
  from !== "" && to !== "" && from <= addDays(monday, 6) && to >= monday;

/** `leaveDays(person, monday)` is the number of working days that week the person is on approved leave. */
export function capacityGrid(
  allocations: readonly RegisterRecord[],
  weeks: readonly string[],
  leaveDays: (person: string, monday: string) => number = () => 0,
): CapacityRow[] {
  const people = [
    ...new Set(allocations.map((a) => textOf(a, "person")).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b));
  return people.map((person) => {
    const mine = allocations.filter((a) => textOf(a, "person") === person);
    const cells = weeks.map((week): CapacityCell => {
      const touching = mine.filter((a) =>
        overlaps(textOf(a, "from"), textOf(a, "to"), week),
      );
      const percent = touching.reduce((sum, a) => sum + (numberOf(a, "percent") ?? 0), 0);
      const days = workingDays(week, weekDates(week)[4]!);
      const off = Math.min(days, Math.max(0, leaveDays(person, week)));
      const available = Math.round(100 * (1 - off / Math.max(1, days)));
      return {
        week,
        percent,
        available,
        over: percent > available,
        projects: [...new Set(touching.map((a) => textOf(a, "project")))],
      };
    });
    return { person, cells, overWeeks: cells.filter((c) => c.over).length };
  });
}
