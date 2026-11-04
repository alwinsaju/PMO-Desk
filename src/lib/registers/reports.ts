// Text the PMO tools write for you: the weekly status report, the change-request summary, the
// month-end invoice check, and the to-do a record can become. Pure; nothing here sends anything.
import { daysBetween, formatDate, formatDayMonth } from "../staff/dates.ts";
import { invoiceBlockers, overallRag } from "./alerts.ts";
import {
  NO_PROJECT_LABEL,
  OTHER_PROJECT_LABEL,
  buildProjectDigest,
  digestLines,
  hasDigest,
  projectKey,
} from "./projectDigest.ts";
import { isOpen, recordTitle, textOf } from "./records.ts";
import type { RegisterDef, RegisterRecord } from "./types.ts";

const RAG_ORDER = ["Green", "Amber", "Red"] as const;
type Rag = (typeof RAG_ORDER)[number];

export interface StatusReport {
  overall: Rag;
  subject: string;
  text: string;
  counts: Record<Rag, number>;
}

/** The RAID and change records (with their definitions) a report can add under each project. */
export interface ReportRegisters {
  raid: readonly RegisterRecord[];
  raidDef: RegisterDef;
  changes: readonly RegisterRecord[];
  changesDef: RegisterDef;
}

/** The weekly report: the overall status (the worst project's), then each active project.
 *  With `registers`, each project also lists its top open risks and late changes, followed by
 *  a "No project" group and an "Other projects" group for records that match no active project. */
export function statusReport(
  projects: readonly RegisterRecord[],
  def: RegisterDef,
  today: string,
  registers?: ReportRegisters,
): StatusReport {
  const active = projects.filter((p) => isOpen(def, p));
  const counts: Record<Rag, number> = { Green: 0, Amber: 0, Red: 0 };
  for (const p of active) counts[overallRag(p)] += 1;
  const overall: Rag = counts.Red > 0 ? "Red" : counts.Amber > 0 ? "Amber" : "Green";
  const ordered = [...active].sort(
    (a, b) =>
      RAG_ORDER.indexOf(overallRag(b)) - RAG_ORDER.indexOf(overallRag(a)) ||
      recordTitle(def, a).localeCompare(recordTitle(def, b)),
  );
  const digest = registers
    ? buildProjectDigest(
        active.map((p) => recordTitle(def, p)),
        registers.raid,
        registers.raidDef,
        registers.changes,
        registers.changesDef,
        today,
      )
    : null;
  const lines = [
    `Weekly status report: ${formatDate(today)}`,
    "",
    `Overall: ${overall.toUpperCase()} (${counts.Red} red, ${counts.Amber} amber, ${counts.Green} green)`,
    "",
  ];
  for (const p of ordered) {
    const owner = textOf(p, "owner");
    lines.push(
      `${recordTitle(def, p)}${owner ? ` (${owner})` : ""}: ${overallRag(p).toUpperCase()}`,
      `  Schedule ${textOf(p, "schedule")}, budget ${textOf(p, "budget")}, scope ${textOf(p, "scope")}`,
    );
    const note = textOf(p, "commentary");
    const next = textOf(p, "nextSteps");
    if (note) lines.push(`  This week: ${note.replace(/\s*\n\s*/g, " ")}`);
    if (next) lines.push(`  Next: ${next.replace(/\s*\n\s*/g, " ")}`);
    if (digest) {
      lines.push(...digestLines(digest.byProject.get(projectKey(recordTitle(def, p)))));
    }
    lines.push("");
  }
  if (active.length === 0) lines.push("No active projects.", "");
  if (digest) {
    for (const [label, group] of [
      [NO_PROJECT_LABEL, digest.noProject],
      [OTHER_PROJECT_LABEL, digest.other],
    ] as const) {
      if (hasDigest(group)) lines.push(label, ...digestLines(group), "");
    }
  }
  return {
    overall,
    subject: `Weekly status report: ${formatDayMonth(today)} (${overall})`,
    text: lines.join("\n").trimEnd(),
    counts,
  };
}

export interface ChangeSummary {
  subject: string;
  text: string;
  counts: Record<string, number>;
}

/** What changed in the change log: counts by status and the ones that need a decision or a date. */
export function changeSummary(
  items: readonly RegisterRecord[],
  def: RegisterDef,
  today: string,
): ChangeSummary {
  const counts: Record<string, number> = {};
  for (const i of items) {
    const s = textOf(i, "status") || "Draft";
    counts[s] = (counts[s] ?? 0) + 1;
  }
  const line = (i: RegisterRecord) => {
    const ref = textOf(i, "ref");
    const who = textOf(i, "requester");
    const date = textOf(i, "targetDate");
    return `- ${ref ? `${ref} ` : ""}${recordTitle(def, i)}${who ? ` (${who})` : ""}${date ? `, target ${formatDayMonth(date)}` : ""}`;
  };
  const section = (title: string, rows: RegisterRecord[]) =>
    rows.length ? [title, ...rows.map(line), ""] : [];
  const awaiting = items.filter((i) => textOf(i, "status") === "Submitted");
  const approved = items.filter((i) => textOf(i, "status") === "Approved");
  const late = items.filter((i) => {
    const t = textOf(i, "targetDate");
    return isOpen(def, i) && t !== "" && daysBetween(today, t) < 0;
  });
  const text = [
    `Change requests: ${formatDate(today)}`,
    "",
    ...Object.entries(counts).map(([s, n]) => `${s}: ${n}`),
    "",
    ...section("Waiting for a decision", awaiting),
    ...section("Approved, not yet implemented", approved),
    ...section("Past their target date", late),
  ]
    .join("\n")
    .trimEnd();
  return { subject: `Change request summary: ${formatDayMonth(today)}`, text, counts };
}

export interface MonthEndCheck {
  month: string;
  ready: number;
  blocked: number;
  daysLeft: number;
  text: string;
}

const lastDayOfMonth = (month: string): string => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m!, 0));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};

/** For one month (yyyy-mm): which unsent invoices can go and what holds the others back. */
export function monthEndCheck(
  invoices: readonly RegisterRecord[],
  def: RegisterDef,
  month: string,
  today: string,
): MonthEndCheck {
  const mine = invoices.filter((i) => textOf(i, "month") === month && isOpen(def, i));
  const blocked = mine.filter((i) => invoiceBlockers(i).length > 0);
  const ready = mine.length - blocked.length;
  const daysLeft = daysBetween(today, lastDayOfMonth(month));
  const lines = [
    `Invoices for ${month}: ${ready} ready, ${blocked.length} blocked`,
    daysLeft >= 0
      ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} to month-end.`
      : "Month-end has passed.",
    "",
    ...blocked.map(
      (i) => `- ${recordTitle(def, i)}: missing ${invoiceBlockers(i).join(", ")}`,
    ),
  ];
  return {
    month,
    ready,
    blocked: blocked.length,
    daysLeft,
    text: lines.join("\n").trimEnd(),
  };
}

export interface TodoSeed {
  title: string;
  description: string;
  owner: string | null;
  dueAt: string | null;
  tags: string[];
}

/** The to-do a record can become. The date comes from the register's due field. */
export function todoSeed(def: RegisterDef, record: RegisterRecord): TodoSeed {
  const due = def.dueKey ? textOf(record, def.dueKey) : "";
  const owner = def.ownerKey ? textOf(record, def.ownerKey) : "";
  const status = def.statusKey ? textOf(record, def.statusKey) : "";
  return {
    title: `${def.title}: ${recordTitle(def, record)}`.slice(0, 200),
    description: [
      status ? `Status: ${status}` : "",
      `From the ${def.title} in the PMO toolkit.`,
    ]
      .filter(Boolean)
      .join("\n"),
    owner: owner || null,
    dueAt: due || null,
    tags: [def.id],
  };
}
