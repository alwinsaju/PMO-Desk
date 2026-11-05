// More Dashboard numbers, all worked out by code from the PMO to-dos, the report history and the roster:
// a merged "Today" list, workload, how long to-dos have sat open, the sign-off pipeline, report health,
// a week-over-week card, the morning briefing and the combined "needs you" count. Pure.
import { addDays, daysBetween, mondayOf } from "../staff/dates.ts";
import { localParts } from "../pmo/due.ts";
import { signoffSummary } from "../pmo/signoffView.ts";
import type { ReminderPrefs, Todo } from "../pmo/types.ts";
import { overallRag, recordAlert } from "../registers/alerts.ts";
import type { RegisterSummary } from "../registers/alerts.ts";
import { REGISTERS, registerById } from "../registers/defs.ts";
import { isOpen, textOf } from "../registers/records.ts";
import type { FieldValue, RegisterDef, RegisterRecord } from "../registers/types.ts";
import type { ReportStatusRow, RunLike } from "./summary.ts";

type Prefs = Pick<ReminderPrefs, "timeZone" | "workDays" | "chaserDays">;

const owner = (t: Pick<Todo, "owner">) =>
  t.owner.name?.trim() || t.owner.email?.trim() || "Unassigned";

// --- Today ----------------------------------------------------------------------------------

export type TodayKind =
  | "overdue"
  | "task"
  | "leave"
  | "signoff"
  | "due-today"
  | "review"
  | "away"
  | "contract-late"
  | "contract-soon";

export interface TodayItem {
  kind: TodayKind;
  text: string;
  /** Which app to open for it. */
  appId: "pmo-todo" | "tasks" | "staff" | "vendors";
}

/** A contract that is late or due soon: a milestone, a payment, or the renewal and notice date. */
export interface TodayContract {
  /** The vendor's name. */
  vendor: string;
  level: "late" | "soon";
  /** What the register's alert says ("Go-live: late by 3 days"). */
  text: string;
}

/** The late and soon alerts of the vendor register's open contracts, for the Today list. Uses the
 *  register's own alert rule, so the list and the register always agree. */
export function contractTodayAlerts(
  records: readonly RegisterRecord[],
  today: string,
  config: Record<string, FieldValue> = {},
): TodayContract[] {
  const def = registerById("vendors");
  if (!def) return [];
  const out: TodayContract[] = [];
  for (const record of records) {
    const alert = recordAlert(def, record, { today, config });
    if (alert && (alert.level === "late" || alert.level === "soon")) {
      out.push({
        vendor: textOf(record, def.titleKey) || "(untitled)",
        level: alert.level,
        text: alert.text,
      });
    }
  }
  return out;
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
  /** Late or soon contracts from the vendor register (`contractTodayAlerts`). Optional: a caller that
   *  has not read the register simply shows none. */
  contracts?: readonly TodayContract[];
}

const RANK: Record<TodayKind, number> = {
  overdue: 0,
  task: 1,
  signoff: 2,
  "contract-late": 2.5,
  leave: 3,
  "due-today": 4,
  "contract-soon": 4.5,
  review: 5,
  away: 6,
};

export interface TodaySummary {
  /** The first `limit` rows, most urgent first. */
  items: TodayItem[];
  /** Every row there is, shown or not. */
  total: number;
  /** Rows beyond the limit ("+N more"). */
  more: number;
}

const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/** Every Today row, most urgent first: by kind, and among late to-dos the longest overdue first. */
export function todaySummary(input: TodayInput, limit = 10): TodaySummary {
  const out: { item: TodayItem; late: number }[] = [];
  const add = (item: TodayItem, late = 0) => out.push({ item, late });
  const open = input.todos.filter((t) => t.status === "open");
  for (const t of open) {
    if (t.dueAt && t.dueAt < input.today) {
      const late = daysBetween(t.dueAt, input.today);
      add(
        {
          kind: "overdue",
          text: `Overdue by ${days(late)}: ${t.title}`,
          appId: "pmo-todo",
        },
        late,
      );
    } else if (t.dueAt === input.today)
      add({ kind: "due-today", text: `Due today: ${t.title}`, appId: "pmo-todo" });
    const so = signoffSummary(t, input.now, input.prefs);
    if (so && so.overdue)
      add({
        kind: "signoff",
        text: `Chase the sign-off${so.approver ? ` from ${so.approver}` : ""}: ${t.title}`,
        appId: "pmo-todo",
      });
  }
  for (const name of input.tasksNeedingYou)
    add({ kind: "task", text: `${name} needs you`, appId: "tasks" });
  for (const c of input.contracts ?? [])
    add({
      kind: c.level === "late" ? "contract-late" : "contract-soon",
      text: `${c.vendor} contract: ${c.text}`,
      appId: "vendors",
    });
  if (input.pendingLeave > 0)
    add({
      kind: "leave",
      text: `${input.pendingLeave} leave request${input.pendingLeave === 1 ? "" : "s"} to decide`,
      appId: "staff",
    });
  if (input.reviewCount > 0)
    add({
      kind: "review",
      text: `${input.reviewCount} message${input.reviewCount === 1 ? "" : "s"} in the review queue`,
      appId: "pmo-todo",
    });
  if (input.awayToday.length > 0)
    add({
      kind: "away",
      text: `Out today: ${input.awayToday.slice(0, 4).join(", ")}${input.awayToday.length > 4 ? ` and ${input.awayToday.length - 4} more` : ""}`,
      appId: "staff",
    });
  const sorted = out.sort(
    (a, b) => RANK[a.item.kind] - RANK[b.item.kind] || b.late - a.late,
  );
  return {
    items: sorted.slice(0, limit).map((e) => e.item),
    total: sorted.length,
    more: Math.max(0, sorted.length - limit),
  };
}

export function todayList(input: TodayInput, limit = 10): TodayItem[] {
  return todaySummary(input, limit).items;
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

// --- portfolio RAG --------------------------------------------------------------------------

export interface RagProject {
  id: string;
  project: string;
  owner: string;
  rag: "Red" | "Amber" | "Green";
  /** Which of schedule, budget and scope carry that colour (empty for Green). */
  which: string[];
}

export interface PortfolioRag {
  red: number;
  amber: number;
  green: number;
  /** Projects counted. */
  total: number;
  /** Extra rows dropped because the same project name appeared on another open row (the newest wins). */
  collapsed: number;
  /** Red first, then Amber, then Green; by name within a colour. */
  projects: RagProject[];
}

const RAG_RANK = { Red: 0, Amber: 1, Green: 2 } as const;

/** Red, Amber and Green counts over the open rows of the status-report register. A project is its
 *  worst of schedule, budget and scope (`overallRag`, the rule the register's own alerts use). The
 *  register is one row per project by convention only, so rows with the same project name (ignoring
 *  case) count once, the one with the latest "as of" date (then the latest edit). Closed rows are left
 *  out. A row with no project name is always counted on its own. */
export function portfolioRag(records: readonly RegisterRecord[]): PortfolioRag {
  const def = registerById("status-report");
  const open = def ? records.filter((r) => isOpen(def, r)) : [];
  const isNewer = (a: RegisterRecord, b: RegisterRecord): boolean => {
    const byDate = textOf(a, "asOf").localeCompare(textOf(b, "asOf"));
    return byDate !== 0 ? byDate > 0 : a.updatedAt.localeCompare(b.updatedAt) > 0;
  };
  const byName = new Map<string, RegisterRecord>();
  for (const r of open) {
    const name = textOf(r, "project").trim().toLowerCase();
    const key = name || `id:${r.id}`;
    const have = byName.get(key);
    if (!have || isNewer(r, have)) byName.set(key, r);
  }
  const projects: RagProject[] = [...byName.values()].map((r) => {
    const rag = overallRag(r);
    return {
      id: r.id,
      project: textOf(r, "project").trim() || "(untitled)",
      owner: textOf(r, "owner"),
      rag,
      which:
        rag === "Green"
          ? []
          : ["schedule", "budget", "scope"].filter((k) => textOf(r, k) === rag),
    };
  });
  projects.sort(
    (a, b) => RAG_RANK[a.rag] - RAG_RANK[b.rag] || a.project.localeCompare(b.project),
  );
  return {
    red: projects.filter((p) => p.rag === "Red").length,
    amber: projects.filter((p) => p.rag === "Amber").length,
    green: projects.filter((p) => p.rag === "Green").length,
    total: projects.length,
    collapsed: open.length - projects.length,
    projects,
  };
}

// --- PMO health scorecard -------------------------------------------------------------------

export interface ScorecardRow {
  id: string;
  title: string;
  open: number;
  late: number;
  soon: number;
  /** late beats soon beats clear. */
  state: "late" | "soon" | "clear";
}

export interface Scorecard {
  rows: ScorecardRow[];
  late: number;
  soon: number;
  /** Registers with nothing late or due soon. */
  clear: number;
}

/** Late and soon per register, for ONLY the registers that have an alert rule (`def.rule`): RAID, SLA,
 *  changes, governance, stakeholders, vendors, invoices and the status report. The other registers have
 *  no rule, so nothing can be late in them and they are not scored. A register the summaries do not
 *  mention counts as zero. Not a percentage on purpose: there is no agreed weighting. Unrelated to the
 *  "Report health" card, which scores Tasks-engine report runs. */
export function pmoScorecard(
  summaries: Readonly<Record<string, RegisterSummary | undefined>>,
  defs: readonly RegisterDef[] = REGISTERS,
): Scorecard {
  const rows = defs
    .filter((def) => def.rule !== undefined)
    .map((def): ScorecardRow => {
      const s = summaries[def.id];
      const late = s?.late ?? 0;
      const soon = s?.soon ?? 0;
      return {
        id: def.id,
        title: def.title,
        open: s?.open ?? 0,
        late,
        soon,
        state: late > 0 ? "late" : soon > 0 ? "soon" : "clear",
      };
    });
  return {
    rows,
    late: rows.reduce((n, r) => n + r.late, 0),
    soon: rows.reduce((n, r) => n + r.soon, 0),
    clear: rows.filter((r) => r.state === "clear").length,
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

/** `total` is the real number of Today rows when `items` is only the first few of them. */
export function briefingText(
  items: readonly TodayItem[],
  greeting = "Good morning",
  total = items.length,
): string {
  if (total === 0) return `${greeting}. Nothing needs you right now.`;
  const lines = items.slice(0, 5).map((i) => `• ${i.text}`);
  return `${greeting}. ${total} thing${total === 1 ? "" : "s"} for today:\n${lines.join("\n")}`;
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
