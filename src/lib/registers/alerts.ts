// What needs attention in a register record: late, soon or worth noting. Pure; each tool's rule
// is a small function over its own fields. The same code feeds the list, the toolkit and the Dashboard.
import { addDays, daysBetween } from "../staff/dates.ts";
import { dateLabel } from "./cells.ts";
import { flagOf, isOpen, numberOf, textOf } from "./records.ts";
import type { FieldValue, RecordAlert, RegisterDef, RegisterRecord } from "./types.ts";

export interface AlertContext {
  /** yyyy-mm-dd */
  today: string;
  /** The register's settings (e.g. SLA days by priority). */
  config: Record<string, FieldValue>;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function dueAlert(due: string, ctx: AlertContext, label = "Due"): RecordAlert | null {
  if (!due) return null;
  const left = daysBetween(ctx.today, due);
  if (left < 0) return { level: "late", text: `Late by ${plural(-left, "day")}` };
  if (left === 0) return { level: "soon", text: `${label} today` };
  if (left <= 7) return { level: "soon", text: `${label} in ${plural(left, "day")}` };
  return null;
}

/** The SLA target day for an item: received plus the days set for its priority. */
export function slaDue(
  record: RegisterRecord,
  config: Record<string, FieldValue>,
): string {
  const received = textOf(record, "received");
  const days = Number(config[textOf(record, "priority").toLowerCase()]);
  return received && Number.isFinite(days) ? addDays(received, days) : "";
}

function slaAlert(record: RegisterRecord, ctx: AlertContext): RecordAlert | null {
  const due = slaDue(record, ctx.config);
  if (!due) return null;
  const status = textOf(record, "status");
  const resolved = textOf(record, "resolvedOn");
  // A resolved day only counts on a Resolved item; a Resolved item with no day cannot be judged late.
  if (status === "Resolved") {
    return resolved && resolved > due
      ? {
          level: "info",
          text: `Resolved ${plural(daysBetween(due, resolved), "day")} late`,
        }
      : null;
  }
  const left = daysBetween(ctx.today, due);
  if (left < 0) return { level: "late", text: `Breached ${plural(-left, "day")} ago` };
  const total = Math.max(1, daysBetween(textOf(record, "received"), due));
  if (left <= 1 || (total - left) / total >= 0.8) {
    return {
      level: "soon",
      text: left === 0 ? "Due today" : `Due in ${plural(left, "day")}`,
    };
  }
  return null;
}

function raidAlert(record: RegisterRecord, ctx: AlertContext): RecordAlert | null {
  const due = dueAlert(textOf(record, "dueDate"), ctx, "Review");
  if (due) return due;
  const raised = textOf(record, "raisedOn");
  const age = raised ? daysBetween(raised, ctx.today) : 0;
  if (age > 30) return { level: "info", text: `Open ${plural(age, "day")}` };
  return null;
}

function renewalAlert(record: RegisterRecord, ctx: AlertContext): RecordAlert | null {
  const renewal = textOf(record, "renewalDate");
  if (!renewal) return null;
  if (renewal < ctx.today) return { level: "late", text: "Renewal date has passed" };
  const notice = numberOf(record, "noticeDays") ?? 60;
  const deadline = addDays(renewal, -notice);
  const toNotice = daysBetween(ctx.today, deadline);
  if (toNotice < 0) {
    return {
      level: "late",
      text: `Notice window passed ${plural(-toNotice, "day")} ago`,
    };
  }
  if (toNotice <= 30) {
    return { level: "soon", text: `Give notice by ${dateLabel(deadline, ctx.today)}` };
  }
  const toRenewal = daysBetween(ctx.today, renewal);
  return toRenewal <= 90
    ? { level: "info", text: `Renews in ${plural(toRenewal, "day")}` }
    : null;
}

/** The optional milestone and payment dates on a contract: the date key, the label key beside it and
 *  the name to use when that label is blank. */
const CONTRACT_DATES: readonly [dateKey: string, labelKey: string, fallback: string][] = [
  ["milestone1Date", "milestone1", "Milestone 1"],
  ["milestone2Date", "milestone2", "Milestone 2"],
  ["paymentDate", "paymentNote", "Payment"],
];

/** The most pressing of a contract's milestone and payment dates: late once the day has passed, soon
 *  from a week out. A blank date (the field is optional, and clearing it is how a milestone is marked
 *  met) never alerts. The earliest date wins within a level. */
export function contractDateAlert(
  record: RegisterRecord,
  ctx: AlertContext,
): RecordAlert | null {
  let best: { alert: RecordAlert; date: string } | null = null;
  for (const [dateKey, labelKey, fallback] of CONTRACT_DATES) {
    const date = textOf(record, dateKey);
    if (!date) continue;
    const name = textOf(record, labelKey) || fallback;
    const left = daysBetween(ctx.today, date);
    let alert: RecordAlert | null = null;
    if (left < 0) {
      alert = { level: "late", text: `${name}: late by ${plural(-left, "day")}` };
    } else if (left === 0) {
      alert = { level: "soon", text: `${name}: due today` };
    } else if (left <= 7) {
      alert = { level: "soon", text: `${name}: due in ${plural(left, "day")}` };
    }
    if (
      alert &&
      (!best ||
        LEVEL_RANK[alert.level] > LEVEL_RANK[best.alert.level] ||
        (alert.level === best.alert.level && date < best.date))
    ) {
      best = { alert, date };
    }
  }
  return best?.alert ?? null;
}

const LEVEL_RANK: Record<RecordAlert["level"], number> = { late: 3, soon: 2, info: 1 };

/** A contract's alert: the renewal and notice rule or a milestone or payment date, whichever is more
 *  pressing (the renewal one on a tie). */
function contractAlert(record: RegisterRecord, ctx: AlertContext): RecordAlert | null {
  const renewal = renewalAlert(record, ctx);
  const dates = contractDateAlert(record, ctx);
  if (!dates) return renewal;
  if (!renewal) return dates;
  return LEVEL_RANK[dates.level] > LEVEL_RANK[renewal.level] ? dates : renewal;
}

function contactAlert(record: RegisterRecord, ctx: AlertContext): RecordAlert | null {
  const last = textOf(record, "lastContact");
  if (!last) return { level: "soon", text: "No contact logged yet" };
  const next = addDays(last, numberOf(record, "cadenceDays") ?? 30);
  const left = daysBetween(ctx.today, next);
  if (left < 0)
    return { level: "late", text: `Contact overdue by ${plural(-left, "day")}` };
  return left <= 7
    ? {
        level: "soon",
        text:
          left === 0 ? "Due for contact today" : `Contact due in ${plural(left, "day")}`,
      }
    : null;
}

/** The day prep should start for an event: its date minus the prep days. */
export function prepStart(record: RegisterRecord): string {
  const date = textOf(record, "date");
  return date ? addDays(date, -(numberOf(record, "prepDays") ?? 5)) : "";
}

function eventAlert(record: RegisterRecord, ctx: AlertContext): RecordAlert | null {
  const date = textOf(record, "date");
  if (!date) return null;
  const left = daysBetween(ctx.today, date);
  if (left < 0)
    return { level: "late", text: "Date has passed: mark it held or cancelled" };
  if (left <= 7) {
    return { level: "soon", text: left === 0 ? "Today" : `In ${plural(left, "day")}` };
  }
  if (!record.todoId && prepStart(record) <= ctx.today) {
    return { level: "soon", text: "Time to start prep" };
  }
  return null;
}

const INVOICE_CHECKS: readonly [string, string, "text" | "flag"][] = [
  ["poNumber", "a PO number", "text"],
  ["timesheetsApproved", "approved timesheets", "flag"],
  ["detailsChecked", "checked details", "flag"],
  ["approvalObtained", "approval", "flag"],
];

/** What an invoice still lacks before it can go out. */
export function invoiceBlockers(record: RegisterRecord): string[] {
  return INVOICE_CHECKS.filter(([key, , kind]) =>
    kind === "text" ? textOf(record, key) === "" : !flagOf(record, key),
  ).map(([, label]) => label);
}

function invoiceAlert(record: RegisterRecord, ctx: AlertContext): RecordAlert | null {
  const blockers = invoiceBlockers(record);
  const sendBy = textOf(record, "sendBy");
  const left = sendBy ? daysBetween(ctx.today, sendBy) : null;
  if (blockers.length > 0) {
    const missing = `Missing ${blockers.join(", ")}`;
    if (textOf(record, "status") === "Ready") {
      return { level: "late", text: `Marked ready but missing ${blockers.join(", ")}` };
    }
    if (left !== null && left <= 2) {
      return {
        level: "late",
        text: `${missing}; ${left < 0 ? "send date has passed" : "due to send soon"}`,
      };
    }
    return { level: left !== null && left <= 7 ? "soon" : "info", text: missing };
  }
  return textOf(record, "status") === "Draft"
    ? { level: "info", text: "Everything is in place: mark it ready" }
    : null;
}

const RAG_ORDER = ["Green", "Amber", "Red"];

/** The worst of schedule, budget and scope. */
export function overallRag(record: RegisterRecord): "Green" | "Amber" | "Red" {
  const worst = Math.max(
    0,
    ...["schedule", "budget", "scope"].map((k) => RAG_ORDER.indexOf(textOf(record, k))),
  );
  return RAG_ORDER[worst] as "Green" | "Amber" | "Red";
}

function ragAlert(record: RegisterRecord, ctx: AlertContext): RecordAlert | null {
  const overall = overallRag(record);
  if (overall !== "Green") {
    const which = ["schedule", "budget", "scope"].filter(
      (k) => textOf(record, k) === overall,
    );
    return {
      level: overall === "Red" ? "late" : "soon",
      text: `${overall}: ${which.join(", ")}`,
    };
  }
  const asOf = textOf(record, "asOf");
  const age = asOf ? daysBetween(asOf, ctx.today) : 0;
  return age > 7
    ? { level: "info", text: `Not updated for ${plural(age, "day")}` }
    : null;
}

/** The alert for one record, or null when it needs nothing. Closed records never alert (an SLA that was met late still notes it). */
export function recordAlert(
  def: RegisterDef,
  record: RegisterRecord,
  ctx: AlertContext,
): RecordAlert | null {
  if (!isOpen(def, record) && def.rule !== "sla") return null;
  switch (def.rule) {
    case "due":
      return dueAlert(textOf(record, def.dueKey ?? ""), ctx);
    case "raid":
      return raidAlert(record, ctx);
    case "sla":
      return slaAlert(record, ctx);
    case "renewal":
      return contractAlert(record, ctx);
    case "contact":
      return contactAlert(record, ctx);
    case "event":
      return eventAlert(record, ctx);
    case "invoice":
      return invoiceAlert(record, ctx);
    case "rag":
      return ragAlert(record, ctx);
    default:
      return null;
  }
}

export interface RegisterSummary {
  id: string;
  total: number;
  open: number;
  late: number;
  soon: number;
  /** Records in the file that fail the checks and need repair (left out of the counts above). Only present when there are some. */
  invalid?: number;
  /** The file could not be read at all. Only present then. */
  unreadable?: boolean;
}

export function summarise(
  def: RegisterDef,
  items: readonly RegisterRecord[],
  ctx: AlertContext,
): RegisterSummary {
  let late = 0;
  let soon = 0;
  let open = 0;
  for (const item of items) {
    if (!isOpen(def, item)) continue;
    open += 1;
    const alert = recordAlert(def, item, ctx);
    if (alert?.level === "late") late += 1;
    else if (alert?.level === "soon") soon += 1;
  }
  return { id: def.id, total: items.length, open, late, soon };
}
