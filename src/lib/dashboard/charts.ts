// The Dashboard's small charts, shaped by code: stacked workload bars, report-health chips and
// week-over-week sparklines. Pure: widgets only draw what these return.
import { addDays, daysBetween, mondayOf } from "../staff/dates.ts";
import { localParts } from "../pmo/due.ts";
import type { Todo } from "../pmo/types.ts";
import type { Health, TodayItem, TodayKind, Workload } from "./insights.ts";
import type { RunLike } from "./summary.ts";

// --- Today rows -----------------------------------------------------------------------------

export type RowTone = "danger" | "warning" | "info" | "neutral";

/** The colour of the dot before a Today row: red when late, amber when it is on you, blue to decide. */
export const TODAY_TONE: Readonly<Record<TodayKind, RowTone>> = {
  overdue: "danger",
  task: "danger",
  signoff: "warning",
  "due-today": "warning",
  leave: "info",
  review: "info",
  away: "neutral",
};

/** The app a Today row's Open button goes to, in words. */
export const TODAY_APP_LABEL: Readonly<Record<TodayItem["appId"], string>> = {
  "pmo-todo": "PMO To-Do",
  tasks: "Tasks",
  staff: "Staff",
};

// --- workload bars --------------------------------------------------------------------------

export interface WorkloadBar {
  owner: string;
  open: number;
  /** Segment widths as a percentage of the longest bar; they add up to `percent`. */
  overduePct: number;
  soonPct: number;
  otherPct: number;
  /** The whole bar's width, 0-100. */
  percent: number;
  /** Plain words for the bar ("5 open, 2 late"). */
  label: string;
}

/** Longest bar = the busiest person (shown in full), the rest in proportion. */
export function workloadBars(rows: readonly Workload[], limit = 8): WorkloadBar[] {
  const shown = rows.slice(0, limit);
  const max = Math.max(1, ...shown.map((r) => r.open));
  return shown.map((r) => {
    const pct = (n: number) => (n / max) * 100;
    const other = Math.max(0, r.open - r.overdue - r.dueSoon);
    return {
      owner: r.owner,
      open: r.open,
      overduePct: pct(r.overdue),
      soonPct: pct(r.dueSoon),
      otherPct: pct(other),
      percent: pct(r.open),
      label: `${r.open} open${r.overdue ? `, ${r.overdue} late` : r.dueSoon ? `, ${r.dueSoon} soon` : ""}`,
    };
  });
}

// --- report health chips --------------------------------------------------------------------

export type HealthTone = "success" | "warning" | "danger" | "neutral";

export interface HealthChip {
  id: string;
  name: string;
  /** "100%", "60%" or "No runs". */
  text: string;
  tone: HealthTone;
  failing: boolean;
}

export const toneForPercent = (percent: number | null): HealthTone =>
  percent === null
    ? "neutral"
    : percent >= 80
      ? "success"
      : percent >= 50
        ? "warning"
        : "danger";

export function healthChips(health: Health): HealthChip[] {
  return health.tasks.map((t) => ({
    id: t.id,
    name: t.name,
    text: t.percent === null ? "No runs" : `${t.percent}%`,
    // A report that is failing right now is red whatever its history says.
    tone: t.failing ? "danger" : toneForPercent(t.percent),
    failing: t.failing,
  }));
}

// --- sparklines -----------------------------------------------------------------------------

export interface SparkPoint {
  x: number;
  y: number;
}

/** Points for a line of `values` (left to right) inside a width x height box, `pad` px from the
 *  edges. `max` fixes the top so two lines can share one scale; a flat line sits mid-height. */
export function sparkPoints(
  values: readonly number[],
  box: { width: number; height: number; pad?: number; max?: number; slots?: number },
): SparkPoint[] {
  const pad = box.pad ?? 2;
  const slots = Math.max(box.slots ?? values.length, 2);
  const top = box.max ?? Math.max(...values, 0);
  const usableW = box.width - pad * 2;
  const usableH = box.height - pad * 2;
  return values.map((v, i) => ({
    x: round(pad + (usableW * i) / (slots - 1)),
    y: round(top <= 0 ? pad + usableH / 2 : pad + usableH - (usableH * v) / top),
  }));
}

const round = (n: number): number => Math.round(n * 100) / 100;

/** The `points` attribute of an SVG polyline. */
export const polylinePoints = (points: readonly SparkPoint[]): string =>
  points.map((p) => `${p.x},${p.y}`).join(" ");

// --- week over week series ------------------------------------------------------------------

export type WeekMetricKey = "approved" | "closed" | "reports" | "leave";

export interface WeekMetric {
  key: WeekMetricKey;
  label: string;
  thisWeek: number;
  lastWeek: number;
  /** Running total per day, Monday up to today (this week) and all seven days (last week). */
  thisSeries: number[];
  lastSeries: number[];
  delta: number;
}

const LABEL: Record<WeekMetricKey, string> = {
  approved: "To-dos approved",
  closed: "To-dos closed",
  reports: "Reports completed",
  leave: "Time off starting",
};

/** How many of each day (Monday = index 0) fall in the week that starts on `from`. */
export function dailyCounts(days: readonly (string | null)[], from: string): number[] {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const day of days) {
    if (day === null) continue;
    const at = daysBetween(from, day);
    if (at >= 0 && at < 7) counts[at] += 1;
  }
  return counts;
}

export const runningTotal = (counts: readonly number[]): number[] => {
  let sum = 0;
  return counts.map((n) => (sum += n));
};

const dayOf = (iso: string | undefined | null, timeZone: string): string | null => {
  if (!iso || Number.isNaN(Date.parse(iso))) return null;
  return localParts(iso, timeZone).day;
};

export function weekMetrics(input: {
  todos: readonly Todo[];
  runs: readonly RunLike[];
  leave: readonly { startDate: string; status: string }[];
  today: string;
  timeZone: string;
}): WeekMetric[] {
  const start = mondayOf(input.today);
  const previous = addDays(start, -7);
  const elapsed = Math.min(7, Math.max(1, daysBetween(start, input.today) + 1));
  const days: Record<WeekMetricKey, (string | null)[]> = {
    approved: input.todos.map((t) => dayOf(t.approvedAt || t.createdAt, input.timeZone)),
    closed: input.todos.map((t) =>
      t.status === "done" ? dayOf(t.completedAt, input.timeZone) : null,
    ),
    reports: input.runs.map((r) =>
      r.outcome === "completed" ? dayOf(r.ended_at, input.timeZone) : null,
    ),
    leave: input.leave.map((l) => (l.status === "approved" ? l.startDate : null)),
  };
  return (Object.keys(LABEL) as WeekMetricKey[]).map((key) => {
    const thisSeries = runningTotal(dailyCounts(days[key], start)).slice(0, elapsed);
    const lastSeries = runningTotal(dailyCounts(days[key], previous));
    const thisWeek = thisSeries.at(-1) ?? 0;
    const lastWeek = lastSeries.at(-1) ?? 0;
    return {
      key,
      label: LABEL[key],
      thisWeek,
      lastWeek,
      thisSeries,
      lastSeries,
      delta: thisWeek - lastWeek,
    };
  });
}

/** "+2 vs last week", "same as last week". */
export const deltaText = (delta: number): string =>
  delta === 0
    ? "same as last week"
    : `${delta > 0 ? "+" : "\u2212"}${Math.abs(delta)} vs last week`;
