// The weekly status report: what happened in a period, built from the app's own
// to-dos. Pure (no clock, no files, no node imports; the caller passes `now`), so
// the server, the UI and `pnpm test` share the rules and every test runs on a fake
// clock. THIS APP NEVER SENDS THE REPORT: it is text to review, edit, copy and
// save locally (see ARCHITECTURE.md, "Phase 5").
//
// The report is built by code, not by the model: counts, lists, dates and owners
// are exact. The local model may add a short narrative on top
// (reportNarrative.ts), which is optional and checked against this data.
//
// What the sections mean:
//  - Period sections (Completed, New) are about the chosen days, judged in the
//    reminder time zone (IST by default) as the half-open range [start of the
//    first day, start of the day after the last day).
//  - Open-state sections (Overdue, Waiting, In progress, Due next 7 days, Needs a
//    decision) are a snapshot of the to-dos AT THE TIME THE REPORT IS BUILT, whatever
//    the period, because the app does not keep a history of every past state.
//  - Overdue lists every open to-do due before today and Waiting every open to-do
//    with "waiting on" set, so an item that is both is in both. In progress is the
//    rest of the open to-dos. Snoozed to-dos are still open work: they stay in the
//    report (snoozing only silences reminders) and are marked.
//  - Cancelled to-dos appear nowhere but one count.
import { z } from "zod";
import { addDays, isSnoozed, localParts, waitingState, zonedInstant } from "./due.ts";
import { signoffNeedsAttention, signoffSummary } from "./signoffView.ts";
import type { SignoffState } from "./signoff.ts";
import { checkpointProgress, deriveStage } from "./todoLogic.ts";
import { safeTimeZone } from "./time.ts";
import type { PmoConfig, Priority, Todo } from "./types.ts";

export const REPORT_SCHEMA_ID = "pmo-report/1";
/** Items shown per section in the text; the rest become "+N more". The full
 *  list is kept in the saved report's data (and its `.full.md`). */
export const DEFAULT_MAX_PER_SECTION = 10;
/** A custom range may cover at most this many days. */
export const MAX_PERIOD_DAYS = 92;
/** How far back a period may start. */
export const MAX_LOOKBACK_DAYS = 366;

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

const isoDayString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-24.");

/** What the person picks. "This week" is the week so far (Monday to today);
 *  "last week" is the previous Monday to Sunday; "last 7 days" is today and the
 *  six days before. */
export const PeriodRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("last-7-days") }),
  z.object({ kind: z.literal("this-week") }),
  z.object({ kind: z.literal("last-week") }),
  z.object({ kind: z.literal("custom"), start: isoDayString, end: isoDayString }),
]);
export type PeriodRequest = z.infer<typeof PeriodRequestSchema>;
export type PeriodKind = PeriodRequest["kind"];

export interface ReportPeriod {
  kind: PeriodKind;
  /** First and last day, YYYY-MM-DD in the time zone, both included. */
  startDay: string;
  endDay: string;
  /** "Mon 19 Oct to Sun 25 Oct 2026" */
  label: string;
  days: number;
  /** [startMs, endMs): the start of the first day and of the day after the last. */
  startMs: number;
  endMs: number;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
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

/** A real calendar day (2026-02-30 is not). */
export function isRealDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const [year, month, date] = day.split("-").map(Number);
  const check = new Date(Date.UTC(year, month - 1, date));
  return check.toISOString().slice(0, 10) === day;
}

const weekdayOfDay = (day: string): number => {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date)).getUTCDay();
};

/** The Monday on or before `day`. */
export const mondayOnOrBefore = (day: string): string =>
  addDays(day, -((weekdayOfDay(day) + 6) % 7));

const daysBetween = (from: string, to: string): number =>
  Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );

/** "Mon 19 Oct", or "Mon 19 Oct 2026" with the year. */
export function dayLabel(day: string, withYear = false): string {
  if (!isRealDay(day)) return day;
  const [year, month, date] = day.split("-").map(Number);
  const base = `${WEEKDAYS[weekdayOfDay(day)]} ${date} ${MONTHS[month - 1]}`;
  return withYear ? `${base} ${year}` : base;
}

/** "Mon 19 Oct to Sun 25 Oct 2026" (the year once when it is the same). */
export function rangeLabel(startDay: string, endDay: string): string {
  if (startDay === endDay) return dayLabel(startDay, true);
  const sameYear = startDay.slice(0, 4) === endDay.slice(0, 4);
  return `${dayLabel(startDay, !sameYear)} to ${dayLabel(endDay, true)}`;
}

export type PeriodResult =
  { ok: true; period: ReportPeriod } | { ok: false; reason: string };

export { safeTimeZone };

/** Turn the person's choice into days and instants. A custom range that is not a
 *  real range (backwards, in the future, too long, too old) says why. */
export function resolvePeriod(
  request: PeriodRequest,
  now: Date,
  timeZone: string,
): PeriodResult {
  const tz = safeTimeZone(timeZone);
  const today = localParts(now, tz).day;
  let startDay: string;
  let endDay: string;
  switch (request.kind) {
    case "last-7-days":
      startDay = addDays(today, -6);
      endDay = today;
      break;
    case "this-week":
      startDay = mondayOnOrBefore(today);
      endDay = today;
      break;
    case "last-week": {
      const thisMonday = mondayOnOrBefore(today);
      startDay = addDays(thisMonday, -7);
      endDay = addDays(thisMonday, -1);
      break;
    }
    case "custom": {
      startDay = request.start;
      endDay = request.end;
      if (!isRealDay(startDay) || !isRealDay(endDay)) {
        return { ok: false, reason: "That is not a real date." };
      }
      if (startDay > endDay) {
        return { ok: false, reason: "The start date is after the end date." };
      }
      if (endDay > today) {
        return { ok: false, reason: "The end date is in the future." };
      }
      if (daysBetween(startDay, endDay) + 1 > MAX_PERIOD_DAYS) {
        return { ok: false, reason: `Choose at most ${MAX_PERIOD_DAYS} days.` };
      }
      if (daysBetween(startDay, today) > MAX_LOOKBACK_DAYS) {
        return { ok: false, reason: "That is more than a year ago." };
      }
      break;
    }
  }
  return {
    ok: true,
    period: {
      kind: request.kind,
      startDay,
      endDay,
      label: rangeLabel(startDay, endDay),
      days: daysBetween(startDay, endDay) + 1,
      startMs: zonedInstant(startDay, "00:00", tz).getTime(),
      endMs: zonedInstant(addDays(endDay, 1), "00:00", tz).getTime(),
    },
  };
}

/** One job / one saved-report key per period. */
export const periodKey = (period: Pick<ReportPeriod, "startDay" | "endDay">): string =>
  `${period.startDay}_${period.endDay}`;

export const PERIOD_KEY = /^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// The report's data
// ---------------------------------------------------------------------------

export interface ReportItem {
  id: string;
  title: string;
  /** Owner's name (else email, else "Unassigned"). */
  owner: string;
  priority: Priority;
  dueAt: string | null;
}

export interface Progress {
  done: number;
  total: number;
  /** The first checkpoint not done or skipped; null when none is left. */
  stage: string | null;
}

export interface CompletedItem extends ReportItem {
  /** ISO instant and IST day the to-do was closed. */
  closedAt: string;
  closedDay: string;
}

export interface OpenItem extends ReportItem {
  progress: Progress;
  /** ISO instant while the to-do is snoozed, else null. */
  snoozedUntil: string | null;
  waitingOn: string | null;
}

export interface OverdueItem extends OpenItem {
  daysOverdue: number;
}

export interface WaitingItem extends OpenItem {
  waitingOn: string;
  sinceDay: string;
  /** Calendar days since the waiting began, and working days among them. */
  days: number;
  workingDays: number;
}

/** Where a to-do's sign-off stands, for "Needs a decision". */
export interface DecisionSignoff {
  state: SignoffState;
  approver: string | null;
  /** Awaiting only: the day it was requested and how long ago. */
  sinceDay: string | null;
  days: number | null;
  workingDays: number | null;
  /** Awaiting and past the chase cadence. */
  overdue: boolean;
  /** The conditions, or the changes asked for. */
  conditions: string;
}

export interface DecisionItem extends OpenItem {
  /** The approval checkpoint that is the current stage (or, when the answer sent
   *  the work back, the sign-off step it is waiting to pass). */
  checkpoint: string;
  /** Sign-off status; null when no request or answer is on record yet. */
  signoff: DecisionSignoff | null;
}

export interface NewItem extends ReportItem {
  createdDay: string;
  status: "open" | "done";
}

export interface ReportSummary {
  open: number;
  closed: number;
  created: number;
  cancelled: number;
  overdue: number;
  dueNext: number;
  waiting: number;
  needsDecision: number;
  snoozed: number;
}

export interface ReportData {
  schema: typeof REPORT_SCHEMA_ID;
  /** "Project Atlas: Weekly status" */
  title: string;
  period: ReportPeriod;
  /** The day the open-state sections describe. */
  asOfDay: string;
  generatedAt: string;
  timeZone: string;
  /** The "next 7 days" window: today and the six days after it. */
  upcoming: { startDay: string; endDay: string };
  summary: ReportSummary;
  completed: CompletedItem[];
  inProgress: OpenItem[];
  overdue: OverdueItem[];
  waiting: WaitingItem[];
  dueNext: OpenItem[];
  created: NewItem[];
  decisions: DecisionItem[];
}

const PRIORITY_RANK: Record<Priority, number> = { high: 0, normal: 1, low: 2 };

/** Owner's name, else email, else "Unassigned". */
export function ownerOf(todo: Pick<Todo, "owner">): string {
  return todo.owner.name?.trim() || todo.owner.email?.trim() || "Unassigned";
}

const validMs = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
};

/** When a to-do was closed: `completedAt` (done), else the last matching line of
 *  its timeline, else its last update. null if no readable date exists. */
export function closedAtOf(todo: Todo): string | null {
  if (todo.status === "open") return null;
  if (todo.status === "done" && validMs(todo.completedAt) !== null)
    return todo.completedAt!;
  const text = todo.status === "done" ? "Marked done." : "Cancelled.";
  const entry = [...(todo.history ?? [])]
    .reverse()
    .find((h) => h.kind === "status" && h.text === text && validMs(h.at) !== null);
  if (entry) return entry.at;
  return validMs(todo.updatedAt) !== null ? todo.updatedAt : null;
}

const byTitle = (a: ReportItem, b: ReportItem) => a.title.localeCompare(b.title);
const byPriority = (a: ReportItem, b: ReportItem) =>
  PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
/** Soonest due first, undated last. */
const byDue = (a: ReportItem, b: ReportItem) => {
  if (a.dueAt === b.dueAt) return 0;
  if (a.dueAt === null) return 1;
  if (b.dueAt === null) return -1;
  return a.dueAt.localeCompare(b.dueAt);
};

export function headerOf(prefs: PmoConfig["report"] | undefined): string {
  const title = prefs?.title?.trim() || "Weekly status";
  const project = prefs?.projectName?.trim();
  return project ? `${project}: ${title}` : title;
}

export type BuildResult = { ok: true; data: ReportData } | { ok: false; reason: string };

/** Build the report for a period from the to-dos, as of `now`. */
export function buildReport(
  todos: readonly Todo[],
  now: Date,
  request: PeriodRequest,
  config: Pick<PmoConfig, "reminders" | "report">,
): BuildResult {
  const timeZone = safeTimeZone(config.reminders.timeZone);
  const resolved = resolvePeriod(request, now, timeZone);
  if (!resolved.ok) return resolved;
  const { period } = resolved;
  const prefs = { ...config.reminders, timeZone };
  const today = localParts(now, timeZone).day;
  const upcoming = { startDay: today, endDay: addDays(today, 6) };
  const inPeriod = (ms: number | null) =>
    ms !== null && ms >= period.startMs && ms < period.endMs;
  const dayOf = (iso: string) => localParts(iso, timeZone).day;

  const base = (todo: Todo): ReportItem => ({
    id: todo.id,
    title: todo.title.trim() || "(untitled)",
    owner: ownerOf(todo),
    priority: todo.priority,
    dueAt: todo.dueAt,
  });

  const completed: CompletedItem[] = [];
  const created: NewItem[] = [];
  let cancelled = 0;
  const open: Todo[] = [];

  for (const todo of todos) {
    if (todo.status === "open") open.push(todo);
    const closedAt = closedAtOf(todo);
    if (todo.status === "done" && closedAt && inPeriod(validMs(closedAt))) {
      completed.push({ ...base(todo), closedAt, closedDay: dayOf(closedAt) });
    }
    if (todo.status === "cancelled" && closedAt && inPeriod(validMs(closedAt)))
      cancelled++;
    if (todo.status !== "cancelled" && inPeriod(validMs(todo.createdAt))) {
      created.push({
        ...base(todo),
        createdDay: dayOf(todo.createdAt),
        status: todo.status === "done" ? "done" : "open",
      });
    }
  }

  const openItem = (todo: Todo): OpenItem => ({
    ...base(todo),
    progress: { ...checkpointProgress(todo), stage: deriveStage(todo) },
    snoozedUntil: isSnoozed(todo, now) ? todo.reminders.snoozedUntil : null,
    waitingOn: todo.waitingOn?.trim() || null,
  });

  const overdue: OverdueItem[] = [];
  const waiting: WaitingItem[] = [];
  const inProgress: OpenItem[] = [];
  const dueNext: OpenItem[] = [];
  const decisions: DecisionItem[] = [];
  let snoozed = 0;

  for (const todo of open) {
    const item = openItem(todo);
    if (item.snoozedUntil) snoozed++;
    const isOverdue = todo.dueAt !== null && todo.dueAt < today;
    const wait = waitingState(todo, now, prefs);
    if (isOverdue) {
      overdue.push({ ...item, daysOverdue: daysBetween(todo.dueAt!, today) });
    }
    if (wait && item.waitingOn) {
      waiting.push({
        ...item,
        waitingOn: item.waitingOn,
        sinceDay: wait.sinceDay,
        days: wait.calendarDays,
        workingDays: wait.quietDays,
      });
    }
    if (!isOverdue && !item.waitingOn) inProgress.push(item);
    if (
      todo.dueAt !== null &&
      todo.dueAt >= upcoming.startDay &&
      todo.dueAt <= upcoming.endDay
    ) {
      dueNext.push(item);
    }
    // A decision is pending when the current stage is an approval step, or when a
    // sign-off is open: requested and unanswered, approved with conditions, or sent
    // back (changes requested / rejected, which reopen the Draft step).
    const current = todo.checkpoints.find((c) => c.state === "pending");
    const sign = signoffSummary(todo, now, prefs);
    const openSignoff = signoffNeedsAttention(sign);
    if (current?.kind === "approval" || openSignoff) {
      const hasRecord = !!sign && sign.state !== "not_requested";
      decisions.push({
        ...item,
        checkpoint:
          current?.kind === "approval"
            ? current.label
            : (sign?.checkpointLabel ?? current!.label),
        signoff:
          sign && hasRecord
            ? {
                state: sign.state,
                approver: sign.approver,
                sinceDay: sign.sinceDay,
                days: sign.calendarDays,
                workingDays: sign.quietDays,
                overdue: sign.overdue,
                conditions: sign.conditions,
              }
            : null,
      });
    }
  }

  completed.sort((a, b) => b.closedAt.localeCompare(a.closedAt) || byTitle(a, b));
  created.sort((a, b) => b.createdDay.localeCompare(a.createdDay) || byTitle(a, b));
  overdue.sort(
    (a, b) => b.daysOverdue - a.daysOverdue || byPriority(a, b) || byTitle(a, b),
  );
  waiting.sort((a, b) => b.days - a.days || byPriority(a, b) || byTitle(a, b));
  inProgress.sort((a, b) => byDue(a, b) || byPriority(a, b) || byTitle(a, b));
  dueNext.sort((a, b) => byDue(a, b) || byPriority(a, b) || byTitle(a, b));
  decisions.sort((a, b) => byDue(a, b) || byPriority(a, b) || byTitle(a, b));

  return {
    ok: true,
    data: {
      schema: REPORT_SCHEMA_ID,
      title: headerOf(config.report),
      period,
      asOfDay: today,
      generatedAt: now.toISOString(),
      timeZone,
      upcoming,
      summary: {
        open: open.length,
        closed: completed.length,
        created: created.length,
        cancelled,
        overdue: overdue.length,
        dueNext: dueNext.length,
        waiting: waiting.length,
        needsDecision: decisions.length,
        snoozed,
      },
      completed,
      inProgress,
      overdue,
      waiting,
      dueNext,
      created,
      decisions,
    },
  };
}

// ---------------------------------------------------------------------------
// Saved reports (what the list and the editor get back; see server/reports.ts)
// ---------------------------------------------------------------------------

export interface SavedReportSummary {
  id: string;
  title: string;
  period: { kind: PeriodKind; startDay: string; endDay: string; label: string };
  generatedAt: string;
  /** When the latest revision was saved. */
  savedAt: string;
  revisions: number;
  /** Some revision differs from what was generated. */
  edited: boolean;
  /** The text carries highlights written by the local model. */
  usedModel: boolean;
}

export interface SavedReportRevision {
  rev: number;
  savedAt: string;
  savedBy: string;
  edited: boolean;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** The narrative lines (already checked, see reportNarrative.ts) as the report
 *  carries them. */
export interface NarrativeLines {
  highlights: string[];
  risks: string[];
  nextWeek: string[];
}

export const NARRATIVE_HEADINGS: { key: keyof NarrativeLines; heading: string }[] = [
  { key: "highlights", heading: "Highlights" },
  { key: "risks", heading: "Risks / blockers" },
  { key: "nextWeek", heading: "Next week focus" },
];

// Characters that mean something in Markdown. Backslash-escaping them keeps a
// title like "<script>" or "[x](javascript:...)" inert, and plain-text output
// removes the backslashes again.
const MD_SPECIAL = /[\\`*_[\]<>|~]/g;
const CONTROL =
  /[\u0000-\u001f\u007f\u0085\u2028\u2029\u202a-\u202e\u2066-\u2069\u200b-\u200f]/g;

/** One line of user text made safe for the report: control and bidi characters
 *  go, runs of whitespace become one space, Markdown characters are escaped. */
export function esc(text: string | null | undefined): string {
  return (text ?? "")
    .replace(CONTROL, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(MD_SPECIAL, (c) => `\\${c}`);
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

function progressText(p: Progress): string | null {
  if (p.total === 0) return null;
  if (p.stage === null) return `${p.done}/${p.total} steps, all complete`;
  return `${p.done}/${p.total} steps, now at ${esc(p.stage)}`;
}

const dueText = (day: string | null) => (day ? `due ${dayLabel(day)}` : null);

function snoozeText(item: OpenItem, timeZone: string): string | null {
  if (!item.snoozedUntil) return null;
  const ms = Date.parse(item.snoozedUntil);
  return Number.isNaN(ms)
    ? "snoozed"
    : `snoozed until ${dayLabel(localParts(ms, timeZone).day)}`;
}

const join = (parts: (string | null | undefined | false)[]): string =>
  parts.filter(Boolean).join(", ");

const row = (item: ReportItem, detail: string): string =>
  `- ${esc(item.title)} (${esc(item.owner)})${detail}`;

export interface RenderOptions {
  /** Items per section before "+N more"; Infinity writes everything. */
  maxPerSection?: number;
  narrative?: NarrativeLines | null;
}

function section<T>(
  heading: string,
  items: readonly T[],
  max: number,
  format: (item: T) => string,
  options: { omitWhenEmpty?: boolean } = {},
): string[] {
  if (items.length === 0 && options.omitWhenEmpty) return [];
  const lines = ["", `## ${heading} (${items.length})`];
  if (items.length === 0) return [...lines, "- None."];
  for (const item of items.slice(0, max)) lines.push(format(item));
  if (items.length > max) lines.push(`- +${items.length - max} more`);
  return lines;
}

/** The report as Markdown: headings and bullets only (no tables, no HTML), every
 *  piece of user text escaped. This is also what the editor holds and what is
 *  saved; `markdownToPlainText` makes the version for Outlook and Teams. */
export function renderMarkdown(data: ReportData, options: RenderOptions = {}): string {
  const max = Math.max(1, options.maxPerSection ?? DEFAULT_MAX_PER_SECTION);
  const { summary: s } = data;
  const zone = data.timeZone;

  const openExtra = join([
    s.overdue > 0 && `${s.overdue} overdue`,
    s.waiting > 0 && `${s.waiting} waiting on others`,
    s.snoozed > 0 && `${s.snoozed} snoozed`,
  ]);
  const lines: string[] = [
    `# ${esc(data.title)}`,
    "",
    `Period: ${data.period.label}`,
    `Status as of ${dayLabel(data.asOfDay, true)}`,
    "",
    "## Summary",
    `- Open: ${s.open}${openExtra ? ` (${openExtra})` : ""}`,
    `- Closed this period: ${s.closed}`,
    `- New this period: ${s.created}`,
    `- Due in the next 7 days: ${s.dueNext}`,
  ];
  if (s.needsDecision > 0) lines.push(`- Needs a decision: ${s.needsDecision}`);
  if (s.cancelled > 0) lines.push(`- Cancelled this period: ${s.cancelled}`);

  for (const { key, heading } of NARRATIVE_HEADINGS) {
    const narrative = options.narrative?.[key] ?? [];
    if (narrative.length === 0) continue;
    lines.push("", `## ${heading}`, ...narrative.map((line) => `- ${esc(line)}`));
  }

  lines.push(
    ...section(
      "Needs a decision",
      data.decisions,
      max,
      (i) =>
        row(
          i,
          `: decision pending at "${esc(i.checkpoint)}"${tail(dueText(i.dueAt))}${tail(signoffText(i.signoff))}`,
        ),
      { omitWhenEmpty: true },
    ),
    ...section("Completed this period", data.completed, max, (i) =>
      row(i, `, closed ${dayLabel(i.closedDay)}`),
    ),
    ...section("In progress", data.inProgress, max, (i) =>
      row(
        i,
        `: ${join([progressText(i.progress), dueText(i.dueAt), snoozeText(i, zone), i.priority === "high" && "high priority"]) || "no steps set"}`,
      ),
    ),
    ...section("Overdue", data.overdue, max, (i) =>
      row(
        i,
        `: ${plural(i.daysOverdue, "day")} overdue (was due ${dayLabel(i.dueAt ?? data.asOfDay)})${tail(
          join([
            progressText(i.progress),
            i.waitingOn && `waiting on ${esc(i.waitingOn)}`,
            snoozeText(i, zone),
            i.priority === "high" && "high priority",
          ]),
        )}`,
      ),
    ),
    ...section("Waiting on others", data.waiting, max, (i) =>
      row(
        i,
        `: waiting on ${esc(i.waitingOn)} since ${dayLabel(i.sinceDay)} (${plural(i.days, "day")})${tail(
          join([dueText(i.dueAt), snoozeText(i, zone)]),
        )}`,
      ),
    ),
    ...section(
      `Due in the next 7 days (${dayLabel(data.upcoming.startDay)} to ${dayLabel(data.upcoming.endDay)})`,
      data.dueNext,
      max,
      (i) =>
        row(
          i,
          `: due ${dayLabel(i.dueAt ?? data.asOfDay)}${tail(progressText(i.progress))}`,
        ),
    ),
    ...section("New this period", data.created, max, (i) =>
      row(
        i,
        `, added ${dayLabel(i.createdDay)}${tail(join([dueText(i.dueAt), i.status === "done" && "already closed"]))}`,
      ),
    ),
  );
  return `${lines.join("\n")}\n`;
}

const tail = (text: string | null | undefined): string => (text ? `, ${text}` : "");

const clip = (text: string, max = 160) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/** The sign-off part of a "Needs a decision" line: who, since when, or what was
 *  said. All user text goes through `esc`. */
function signoffText(sign: DecisionSignoff | null): string | null {
  if (!sign) return null;
  const by = sign.approver ? ` by ${esc(sign.approver)}` : "";
  const said = sign.conditions ? `: ${esc(clip(sign.conditions))}` : "";
  switch (sign.state) {
    case "awaiting":
      return `awaiting sign-off${sign.approver ? ` from ${esc(sign.approver)}` : ""}${
        sign.sinceDay
          ? ` since ${dayLabel(sign.sinceDay)} (${plural(sign.days ?? 0, "day")})`
          : ""
      }${sign.overdue ? ", time to chase" : ""}`;
    case "conditions":
      return `approved with conditions${by}${said}; conditions not yet confirmed as met`;
    case "changes_requested":
      return `changes requested${by}${said}`;
    case "rejected":
      return `rejected${by}${said}`;
    default:
      return null;
  }
}

/** The report as plain text for pasting into Outlook or Teams. */
export function renderPlainText(data: ReportData, options: RenderOptions = {}): string {
  return markdownToPlainText(renderMarkdown(data, options));
}

const ESC_OPEN = "\ue000";
const ESC_CLOSE = "\ue001";

/** Markdown (this report's dialect, and what a person may have typed into the
 *  editor) to plain text: headings become lines, bullets become "\u2022 ", emphasis
 *  and links lose their markup, backslash escapes are undone. */
export function markdownToPlainText(markdown: string): string {
  const out: string[] = [];
  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    let line = raw
      .replace(/\\([\\`*_{}[\]<>|~#])/g, `${ESC_OPEN}$1${ESC_CLOSE}`)
      .replace(/\s+$/, "");
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      if (out.length > 0 && out[out.length - 1] !== "") out.push("");
      out.push(stripInline(heading[2]));
      continue;
    }
    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    if (bullet) line = `${bullet[1]}\u2022 ${bullet[2]}`;
    out.push(stripInline(line));
  }
  return `${out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()}\n`.replace(new RegExp(`${ESC_OPEN}(.)${ESC_CLOSE}`, "gs"), "$1");
}

function stripInline(line: string): string {
  return line
    .replace(/!?\[([^\]]*)\]\(([^)\s]*)\)/g, (_m, text: string, url: string) =>
      text && url ? `${text} (${url})` : text || url,
    )
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1$2")
    .replace(/(^|[\s(])_([^_\s][^_]*)_/g, "$1$2")
    .replace(/`([^`]*)`/g, "$1");
}

/** "Weekly status: Mon 19 Oct to Sun 25 Oct 2026", for a mail subject. */
export function reportSubject(data: Pick<ReportData, "title" | "period">): string {
  return `${data.title}: ${data.period.label}`.replace(CONTROL, " ").slice(0, 150);
}

/** Does any section have more items than the text shows? */
export function isCapped(data: ReportData, max = DEFAULT_MAX_PER_SECTION): boolean {
  return [
    data.completed,
    data.inProgress,
    data.overdue,
    data.waiting,
    data.dueNext,
    data.created,
    data.decisions,
  ].some((items) => items.length > max);
}
