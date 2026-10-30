// More Dashboard numbers, all worked out by code from the PMO to-dos, the report history and the roster:
// a merged "Today" list, workload, how long to-dos have sat open, the sign-off pipeline, report health,
// a week-over-week card, the morning briefing and the combined "needs you" count. Pure.
import { addDays, daysBetween, mondayOf } from "../staff/dates.ts";
import { localParts } from "../pmo/due.ts";
import { signoffSummary } from "../pmo/signoffView.ts";
import type { ReminderPrefs, Todo } from "../pmo/types.ts";
import type { ReportStatusRow, RunLike } from "./summary.ts";

type Prefs = Pick<ReminderPrefs, "timeZone" | "workDays" | "chaserDays">;

const owner = (t: Pick<Todo, "owner">) =>
  t.owner.name?.trim() || t.owner.email?.trim() || "Unassigned";

// --- Today ----------------------------------------------------------------------------------

export type TodayKind =
  "overdue" | "task" | "leave" | "signoff" | "due-today" | "review" | "away";

export interface TodayItem {
  kind: TodayKind;
  text: string;
  /** Which app to open for it. */
  appId: "pmo-todo" | "tasks" | "staff";
}

export interface TodayInput {
  todos: readonly Todo[];
  today: string;
  now: Date;
  prefs: Prefs;
  pendingLeave: number;
  /** Items in the PMO review queue. */
  reviewCount: number;
  /** Tasks waiting at a gate or failed: their display names. */
  tasksNeedingYou: readonly string[];
  /** People out today, by name. */
  awayToday: readonly string[];
}

const RANK: Record<TodayKind, number> = {
  overdue: 0,
  task: 1,
  signoff: 2,
  leave: 3,
  "due-today": 4,
  review: 5,
  away: 6,
};

export function todayList(input: TodayInput, limit = 10): TodayItem[] {
  const out: TodayItem[] = [];
  const open = input.todos.filter((t) => t.status === "open");
  for (const t of open) {
    if (t.dueAt && t.dueAt < input.today)
      out.push({
        kind: "overdue",
        text: `Overdue ${daysBetween(t.dueAt, input.today)} day(s): ${t.title}`,
        appId: "pmo-todo",
      });
    else if (t.dueAt === input.today)
      out.push({ kind: "due-today", text: `Due today: ${t.title}`, appId: "pmo-todo" });
    const so = signoffSummary(t, input.now, input.prefs);
    if (so && so.overdue)
      out.push({
        kind: "signoff",
        text: `Chase the sign-off${so.approver ? ` from ${so.approver}` : ""}: ${t.title}`,
        appId: "pmo-todo",
      });
  }
  for (const name of input.tasksNeedingYou)
    out.push({ kind: "task", text: `${name} needs you`, appId: "tasks" });
  if (input.pendingLeave > 0)
    out.push({
      kind: "leave",
      text: `${input.pendingLeave} leave request${input.pendingLeave === 1 ? "" : "s"} to decide`,
      appId: "staff",
    });
  if (input.reviewCount > 0)
    out.push({
      kind: "review",
      text: `${input.reviewCount} message${input.reviewCount === 1 ? "" : "s"} in the review queue`,
      appId: "pmo-todo",
    });
  if (input.awayToday.length > 0)
    out.push({
      kind: "away",
      text: `Out today: ${input.awayToday.slice(0, 4).join(", ")}${input.awayToday.length > 4 ? ` and ${input.awayToday.length - 4} more` : ""}`,
      appId: "staff",
    });
  return out.sort((a, b) => RANK[a.kind] - RANK[b.kind]).slice(0, limit);
}

// --- workload and aging ---------------------------------------------------------------------

export interface Workload {
  owner: string;
  open: number;
  dueSoon: number;
  overdue: number;
}

export function workloadByOwner(todos: readonly Todo[], today: string): Workload[] {
  const map = new Map<string, Workload>();
  const soon = addDays(today, 2);
  for (const t of todos) {
    if (t.status !== "open") continue;
    const name = owner(t);
    const w = map.get(name) ?? { owner: name, open: 0, dueSoon: 0, overdue: 0 };
    w.open += 1;
    if (t.dueAt && t.dueAt < today) w.overdue += 1;
    else if (t.dueAt && t.dueAt <= soon) w.dueSoon += 1;
    map.set(name, w);
  }
  return [...map.values()].sort(
    (a, b) => b.open - a.open || b.overdue - a.overdue || a.owner.localeCompare(b.owner),
  );
}

export const AGE_BUCKETS = [
  { label: "0–1 days", max: 1 },
  { label: "2–3 days", max: 3 },
  { label: "4–7 days", max: 7 },
  { label: "8–14 days", max: 14 },
  { label: "15–30 days", max: 30 },
  { label: "Over 30 days", max: Infinity },
] as const;

export interface AgeBucket {
  label: string;
  count: number;
}

/** How long the open to-dos have sat since they were approved. */
export function agingBuckets(todos: readonly Todo[], now: Date): AgeBucket[] {
  const counts = AGE_BUCKETS.map(() => 0);
  for (const t of todos) {
    if (t.status !== "open") continue;
    const since = Date.parse(t.approvedAt || t.createdAt);
    if (Number.isNaN(since)) continue;
    const age = Math.max(0, Math.floor((now.getTime() - since) / 86_400_000));
    counts[AGE_BUCKETS.findIndex((b) => age <= b.max)] += 1;
  }
  return AGE_BUCKETS.map((b, i) => ({ label: b.label, count: counts[i] }));
}

// --- sign-off pipeline ----------------------------------------------------------------------

export interface Pipeline {
  awaiting: number;
  conditions: number;
  changes: number;
  overdue: number;
  rows: {
    id: string;
    title: string;
    approver: string | null;
    state: string;
    overdue: boolean;
  }[];
}

export function signoffPipeline(
  todos: readonly Todo[],
  now: Date,
  prefs: Prefs,
): Pipeline {
  const out: Pipeline = { awaiting: 0, conditions: 0, changes: 0, overdue: 0, rows: [] };
  for (const t of todos) {
    if (t.status !== "open") continue;
    const s = signoffSummary(t, now, prefs);
    if (!s) continue;
    if (s.state === "awaiting") out.awaiting += 1;
    else if (s.state === "conditions") out.conditions += 1;
    else if (s.state === "changes_requested" || s.state === "rejected") out.changes += 1;
    else continue;
    if (s.overdue) out.overdue += 1;
    out.rows.push({
      id: t.id,
      title: t.title,
      approver: s.approver,
      state: s.stateLabel,
      overdue: s.overdue,
    });
  }
  out.rows.sort(
    (a, b) => Number(b.overdue) - Number(a.overdue) || a.title.localeCompare(b.title),
  );
  return out;
}

// --- report health --------------------------------------------------------------------------

export interface Health {
  /** 0–100; null when no report has run yet. */
  score: number | null;
  tasks: { id: string; name: string; percent: number | null; failing: boolean }[];
}

/** Each report's recent reliability (completed share of its last five runs, minus a penalty while it is in
 *  error) and the average over reports that have run. */
export function reportHealth(
  rows: readonly ReportStatusRow[],
  histories: Readonly<Record<string, readonly RunLike[] | undefined>>,
): Health {
  const tasks = rows.map((row) => {
    const runs = [...(histories[row.id] ?? [])]
      .sort((a, b) => Date.parse(b.ended_at) - Date.parse(a.ended_at))
      .slice(0, 5);
    const failing = row.tone === "danger";
    if (runs.length === 0) return { id: row.id, name: row.name, percent: null, failing };
    const ok = runs.filter((r) => r.outcome === "completed").length;
    const raw = Math.round((ok / runs.length) * 100);
    return {
      id: row.id,
      name: row.name,
      percent: failing ? Math.max(0, raw - 20) : raw,
      failing,
    };
  });
  const scored = tasks.filter((t) => t.percent !== null) as { percent: number }[];
  return {
    score: scored.length
      ? Math.round(scored.reduce((s, t) => s + t.percent, 0) / scored.length)
      : null,
    tasks,
  };
}

// --- week over week -------------------------------------------------------------------------

export interface WeekStats {
  created: number;
  closed: number;
  runsCompleted: number;
  runsFailed: number;
  leaveRequests: number;
}

export interface WeekCompare {
  thisWeek: WeekStats;
  lastWeek: WeekStats;
  lines: string[];
}

const dayOf = (iso: string | undefined | null, timeZone: string): string | null => {
  if (!iso || Number.isNaN(Date.parse(iso))) return null;
  return localParts(iso, timeZone).day;
};

export function weekOverWeek(input: {
  todos: readonly Todo[];
  runs: readonly RunLike[];
  leave: readonly { startDate: string; status: string }[];
  today: string;
  timeZone: string;
}): WeekCompare {
  const start = mondayOf(input.today);
  const prevStart = addDays(start, -7);
  const within = (day: string | null, from: string) =>
    day !== null && day >= from && day < addDays(from, 7);
  const stats = (from: string): WeekStats => ({
    created: input.todos.filter((t) =>
      within(dayOf(t.approvedAt || t.createdAt, input.timeZone), from),
    ).length,
    closed: input.todos.filter(
      (t) => t.status === "done" && within(dayOf(t.completedAt, input.timeZone), from),
    ).length,
    runsCompleted: input.runs.filter(
      (r) => r.outcome === "completed" && within(dayOf(r.ended_at, input.timeZone), from),
    ).length,
    runsFailed: input.runs.filter(
      (r) => r.outcome === "failed" && within(dayOf(r.ended_at, input.timeZone), from),
    ).length,
    leaveRequests: input.leave.filter(
      (l) =>
        l.status === "approved" && l.startDate >= from && l.startDate < addDays(from, 7),
    ).length,
  });
  const thisWeek = stats(start);
  const lastWeek = stats(prevStart);
  const delta = (a: number, b: number) =>
    a === b ? "same as last week" : `${a > b ? "+" : ""}${a - b} vs last week`;
  return {
    thisWeek,
    lastWeek,
    lines: [
      `To-dos approved: ${thisWeek.created} (${delta(thisWeek.created, lastWeek.created)})`,
      `To-dos closed: ${thisWeek.closed} (${delta(thisWeek.closed, lastWeek.closed)})`,
      `Report runs: ${thisWeek.runsCompleted} completed, ${thisWeek.runsFailed} failed (${delta(thisWeek.runsCompleted, lastWeek.runsCompleted)} completed)`,
      `Leave starting: ${thisWeek.leaveRequests} (${delta(thisWeek.leaveRequests, lastWeek.leaveRequests)})`,
    ],
  };
}

// --- briefing and badges --------------------------------------------------------------------

export function briefingText(
  items: readonly TodayItem[],
  greeting = "Good morning",
): string {
  if (items.length === 0) return `${greeting}. Nothing needs you right now.`;
  const lines = items.slice(0, 5).map((i) => `• ${i.text}`);
  return `${greeting}. ${items.length} thing${items.length === 1 ? "" : "s"} for today:\n${lines.join("\n")}`;
}

export interface BriefingSettings {
  enabled: boolean;
  /** "HH:MM" local. */
  time: string;
  /** The day a briefing was last shown. */
  lastDay: string;
}

/** Show it once a day, once the chosen time has passed (even if the app opened later in the day). */
export function briefingDue(s: BriefingSettings, now: Date, today: string): boolean {
  if (!s.enabled || s.lastDay === today) return false;
  const clock = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return clock >= s.time;
}

export interface NeedsYou {
  pmo: number;
  leave: number;
  tasks: number;
  /** Late items across the PMO toolkit's tools. */
  registers?: number;
}

export const needsYouTotal = (n: NeedsYou): number =>
  n.pmo + n.leave + n.tasks + (n.registers ?? 0);
