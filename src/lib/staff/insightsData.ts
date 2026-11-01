// The numbers behind the Insights charts: the capacity heatmap, the distributions,
// leave-balance bars, the holiday month and the skill cloud. Pure, so the shapes the
// charts draw are tested without a browser.
import { addDays, monthWeeks } from "./dates.ts";
import { capacityOn, type CapacityInput, type CoverageRules } from "./capacity.ts";
import type { LeaveBalance } from "./leave.ts";
import type { Employee, RosterEvent } from "./types.ts";

// --- capacity heatmap -------------------------------------------------------------------------

/** 0 = nobody in the team is scheduled; 1-4 = how full the team is against its busiest day in view. */
export type HeatLevel = 0 | 1 | 2 | 3 | 4;

export interface HeatCell {
  day: string;
  working: number;
  onLeave: number;
  level: HeatLevel;
  /** The team has a minimum and fewer people than that are working. */
  short: boolean;
}

export interface HeatRow {
  groupId: string;
  name: string;
  /** The team's minimum per day; 0 = no rule. */
  need: number;
  cells: HeatCell[];
}

export interface Heatmap {
  days: string[];
  rows: HeatRow[];
}

/** Team x day: how many are working, so thin days stand out at a glance. */
export function capacityHeatmap(
  from: string,
  count: number,
  input: CapacityInput,
  rules: CoverageRules,
): Heatmap {
  const days = Array.from({ length: Math.max(0, count) }, (_, i) => addDays(from, i));
  const rows = new Map<string, HeatRow>();
  for (const group of input.groups) {
    if (group.hidden) continue;
    rows.set(group.id, {
      groupId: group.id,
      name: group.name,
      need: rules[group.id] ?? 0,
      cells: [],
    });
  }
  for (const day of days) {
    for (const cap of capacityOn(day, input)) {
      const row = rows.get(cap.groupId);
      if (!row) continue;
      const scheduled = cap.working + cap.onLeave;
      row.cells.push({
        day,
        working: cap.working,
        onLeave: cap.onLeave,
        level: scheduled === 0 ? 0 : 1,
        short: row.need > 0 && scheduled > 0 && cap.working < row.need,
      });
    }
  }
  for (const row of rows.values()) {
    const busiest = Math.max(0, ...row.cells.map((c) => c.working));
    for (const cell of row.cells) {
      if (cell.level === 0) continue;
      cell.level =
        busiest === 0
          ? 1
          : (Math.min(
              4,
              Math.max(1, Math.ceil((cell.working / busiest) * 4)),
            ) as HeatLevel);
    }
  }
  return { days, rows: [...rows.values()] };
}

// --- distributions ----------------------------------------------------------------------------

export type DistributionKey = "level" | "location" | "team" | "op" | "offering";

export interface Slice {
  label: string;
  count: number;
  /** 0-1 of everyone counted. */
  share: number;
}

export const NOT_SET = "Not set";

/**
 * How many people fall in each value of a field, biggest first, "Not set" last. With
 * `limit`, the smallest groups beyond it are merged into one "Other" slice.
 */
export function distribution(
  employees: readonly Pick<Employee, DistributionKey>[],
  key: DistributionKey,
  limit = Infinity,
): Slice[] {
  const counts = new Map<string, number>();
  for (const e of employees) {
    const label = e[key].trim() || NOT_SET;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const total = employees.length;
  const ordered = [...counts]
    .map(([label, count]) => ({ label, count }))
    .sort(
      (a, b) =>
        Number(a.label === NOT_SET) - Number(b.label === NOT_SET) ||
        b.count - a.count ||
        a.label.localeCompare(b.label, undefined, { numeric: true }),
    );
  let kept = ordered;
  if (ordered.length > limit && limit > 0) {
    const rest = ordered.slice(limit - 1);
    kept = [
      ...ordered.slice(0, limit - 1),
      { label: `Other (${rest.length})`, count: rest.reduce((n, s) => n + s.count, 0) },
    ];
  }
  return kept.map((s) => ({ ...s, share: total === 0 ? 0 : s.count / total }));
}

export interface DonutArc {
  /** Stroke-dasharray / offset for a circle drawn with `pathLength="100"`. */
  length: number;
  offset: number;
}

/** The arcs of a donut: each slice's length and where it starts, in percent of the ring. */
export function donutArcs(slices: readonly Pick<Slice, "share">[]): DonutArc[] {
  let used = 0;
  return slices.map((slice) => {
    const length = Math.round(slice.share * 1000) / 10;
    const arc = { length, offset: Math.round(used * 10) / 10 };
    used += slice.share * 100;
    return arc;
  });
}

// --- leave balances ---------------------------------------------------------------------------

export interface BalanceBar {
  /** Width of the "used" and "waiting" parts, in percent of the allowance (together at most 100). */
  usedPct: number;
  pendingPct: number;
  /** More leave is used than the allowance. */
  over: boolean;
}

export function balanceBar(balance: LeaveBalance): BalanceBar {
  if (balance.allowance <= 0) {
    return { usedPct: 0, pendingPct: 0, over: balance.used > 0 };
  }
  const pct = (days: number) => (days / balance.allowance) * 100;
  const usedPct = Math.min(100, pct(balance.used));
  const pendingPct = Math.min(100 - usedPct, pct(balance.pending));
  return {
    usedPct: Math.round(usedPct * 10) / 10,
    pendingPct: Math.round(pendingPct * 10) / 10,
    over: balance.remaining < 0,
  };
}

// --- holidays month ---------------------------------------------------------------------------

export interface CalendarDay {
  date: string;
  /** Holidays already in the roster calendar on this day. */
  saved: string[];
  /** Holidays that "Add" would put in the calendar. */
  planned: string[];
}

/** The month `month` is in as Monday-first weeks; `null` pads the first and last week. */
export function holidayMonth(
  month: string,
  saved: readonly RosterEvent[],
  planned: readonly RosterEvent[],
): (CalendarDay | null)[][] {
  const labelsOn = (events: readonly RosterEvent[], date: string) =>
    events
      .filter((e) => e.kind === "holiday" && e.date <= date && date <= e.endDate)
      .map((e) => e.label);
  return monthWeeks(month).map((week) =>
    week.map((date) =>
      date
        ? { date, saved: labelsOn(saved, date), planned: labelsOn(planned, date) }
        : null,
    ),
  );
}

// --- skill cloud ------------------------------------------------------------------------------

/** 1 (rare) to 4 (everywhere): how large a skill tag is drawn, from its count among the counts shown. */
export function tagWeight(count: number, min: number, max: number): 1 | 2 | 3 | 4 {
  if (max <= min) return 2;
  const ratio = (count - min) / (max - min);
  return (1 + Math.min(3, Math.floor(ratio * 4))) as 1 | 2 | 3 | 4;
}
