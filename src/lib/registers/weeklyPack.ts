// The weekly pack: one text to copy (or open as an unsent mail) that joins the status report, the change
// summary, a summary of late and top open RAID items, and the governance events coming up. Pure; nothing
// here reads a file or sends anything.
//
// RAID and change records are grouped by their optional Project text when any record has one, each project
// in the status report's order, then projects the status register does not list as active, then records
// with no project. When no record has a Project the pack is flat. Governance events have no project and
// are always one list.
import { daysBetween, dayName, formatDate, formatDayMonth } from "../staff/dates.ts";
import { overallRag, prepStart } from "./alerts.ts";
import { projectKey, openRisks } from "./projectDigest.ts";
import { isOpen, recordTitle, textOf } from "./records.ts";
import { changeSummary, statusReport } from "./reports.ts";
import type { RegisterDef, RegisterRecord } from "./types.ts";

/** Risks one RAID summary lists. */
export const PACK_TOP_RISKS = 5;
/** Items past their review date one RAID summary lists (the rest are counted). */
export const PACK_LATE_MAX = 8;
/** How many days ahead the governance section looks. */
export const PACK_GOVERNANCE_DAYS = 14;

/** The heading for records that have no Project (grouped pack only). */
export const PACK_NO_PROJECT = "No project";
/** Added to the name of a project the status register does not list as active. */
export const PACK_NOT_ACTIVE = "not active in the status register";

const KINDS = [
  ["Risk", "risk", "risks"],
  ["Assumption", "assumption", "assumptions"],
  ["Issue", "issue", "issues"],
  ["Dependency", "dependency", "dependencies"],
] as const;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const lower = (s: string) => s.toLowerCase();

// ---------------------------------------------------------------------------
// RAID
// ---------------------------------------------------------------------------

export interface RaidSummary {
  /** Open items of every kind. */
  open: number;
  /** "4 risks, 1 issue"; empty when nothing is open. */
  mix: string;
  /** Open items whose review date has passed, the longest overdue first (all of them). */
  lateTotal: number;
  /** The lines to show for those (at most `PACK_LATE_MAX`). */
  late: string[];
  riskTotal: number;
  /** The top open risks, worst first (at most `PACK_TOP_RISKS`). */
  topRisks: string[];
}

function raidLine(r: RegisterRecord, def: RegisterDef, today: string, withKind: boolean) {
  const kind = textOf(r, "kind") || "Risk";
  const impact = textOf(r, "impact");
  const likelihood = textOf(r, "likelihood");
  const owner = textOf(r, "owner");
  const due = textOf(r, "dueDate");
  const parts: string[] = [];
  if (kind === "Risk") {
    parts.push(
      `${impact || "Medium"} impact, ${lower(likelihood || "Medium")} likelihood`,
    );
  } else if (impact) {
    parts.push(`${impact} impact`);
  }
  if (owner) parts.push(owner);
  if (due) {
    const late = -daysBetween(today, due);
    parts.push(
      late > 0
        ? `review overdue since ${formatDayMonth(due)}, ${plural(late, "day", "days")} late`
        : `review ${formatDayMonth(due)}`,
    );
  }
  return `${withKind ? `${kind}: ` : ""}${recordTitle(def, r)}${parts.length ? ` (${parts.join(", ")})` : ""}`;
}

/** The open items past their review date, and the worst open risks, for the records given. */
export function raidSummary(
  raid: readonly RegisterRecord[],
  def: RegisterDef,
  today: string,
  topRisks: number = PACK_TOP_RISKS,
  lateMax: number = PACK_LATE_MAX,
): RaidSummary {
  const open = raid.filter((r) => isOpen(def, r));
  const counts = KINDS.map(([kind, one, many]) => {
    const n = open.filter((r) => (textOf(r, "kind") || "Risk") === kind).length;
    return n > 0 ? plural(n, one, many) : "";
  }).filter(Boolean);
  const late = open
    .filter((r) => {
      const due = textOf(r, "dueDate");
      return due !== "" && daysBetween(today, due) < 0;
    })
    .sort(
      (a, b) =>
        textOf(a, "dueDate").localeCompare(textOf(b, "dueDate")) ||
        recordTitle(def, a).localeCompare(recordTitle(def, b)),
    );
  const risks = openRisks(raid, def);
  return {
    open: open.length,
    mix: counts.join(", "),
    lateTotal: late.length,
    late: late.slice(0, lateMax).map((r) => raidLine(r, def, today, true)),
    riskTotal: risks.length,
    topRisks: risks.slice(0, topRisks).map((r) => raidLine(r, def, today, false)),
  };
}

/** The lines for one summary (empty when nothing is open). */
export function raidSummaryLines(summary: RaidSummary, indent = ""): string[] {
  if (summary.open === 0) return [];
  const lines = [
    `${indent}Open: ${summary.open} (${summary.mix}); ${summary.lateTotal} past their review date`,
  ];
  if (summary.late.length > 0) {
    lines.push(
      `${indent}Past their review date${summary.lateTotal > summary.late.length ? ` (${summary.late.length} of ${summary.lateTotal})` : ""}:`,
      ...summary.late.map((l) => `${indent}- ${l}`),
    );
  }
  if (summary.topRisks.length > 0) {
    lines.push(
      `${indent}Top open risks${summary.riskTotal > summary.topRisks.length ? ` (${summary.topRisks.length} of ${summary.riskTotal})` : ""}:`,
      ...summary.topRisks.map((l) => `${indent}- ${l}`),
    );
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Governance
// ---------------------------------------------------------------------------

export interface GovernanceSummary {
  /** Open events from today to `days` ahead, soonest first. */
  upcoming: string[];
  /** Open events whose date has passed: someone should mark them held or cancelled. */
  passed: string[];
}

function eventLine(r: RegisterRecord, def: RegisterDef, today: string): string {
  const date = textOf(r, "date");
  const time = textOf(r, "time").trim();
  const kind = textOf(r, "kind");
  const when = `${dayName(date)} ${formatDayMonth(date)}${time ? `, ${time}` : ""}`;
  const notes: string[] = [];
  if (kind) notes.push(kind);
  if (daysBetween(today, date) >= 0 && !r.todoId && prepStart(r) <= today) {
    notes.push("prep not started");
  }
  return `${when}: ${recordTitle(def, r)}${notes.length ? ` (${notes.join(", ")})` : ""}`;
}

/** The governance events that are still planned, split into the coming days and the ones whose date has passed. */
export function governanceSummary(
  events: readonly RegisterRecord[],
  def: RegisterDef,
  today: string,
  days: number = PACK_GOVERNANCE_DAYS,
): GovernanceSummary {
  const open = events
    .filter((e) => isOpen(def, e) && textOf(e, "date") !== "")
    .sort(
      (a, b) =>
        textOf(a, "date").localeCompare(textOf(b, "date")) ||
        recordTitle(def, a).localeCompare(recordTitle(def, b)),
    );
  const line = (e: RegisterRecord) => eventLine(e, def, today);
  return {
    upcoming: open
      .filter((e) => {
        const left = daysBetween(today, textOf(e, "date"));
        return left >= 0 && left <= days;
      })
      .map(line),
    passed: open.filter((e) => daysBetween(today, textOf(e, "date")) < 0).map(line),
  };
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export interface ProjectGroup {
  label: string;
  records: RegisterRecord[];
}

/** True when any record has a Project typed. */
export const hasProjectData = (...lists: (readonly RegisterRecord[])[]): boolean =>
  lists.some((list) => list.some((r) => textOf(r, "project").trim() !== ""));

/**
 * The records split by Project: each name in `activeNames` (in that order), then the projects the
 * status register does not list (by name, in the spelling first seen), then records with no project.
 * Groups with no records are left out.
 */
export function groupByProject(
  records: readonly RegisterRecord[],
  activeNames: readonly string[],
): ProjectGroup[] {
  const active = new Map<string, ProjectGroup>();
  for (const name of activeNames) {
    const key = projectKey(name);
    if (key && !active.has(key)) active.set(key, { label: name, records: [] });
  }
  const other = new Map<string, ProjectGroup>();
  const none: RegisterRecord[] = [];
  for (const r of records) {
    const typed = textOf(r, "project").trim().replace(/\s+/g, " ");
    const key = projectKey(typed);
    if (key === "") none.push(r);
    else if (active.has(key)) active.get(key)!.records.push(r);
    else {
      let group = other.get(key);
      if (!group) {
        group = { label: `${typed} (${PACK_NOT_ACTIVE})`, records: [] };
        other.set(key, group);
      }
      group.records.push(r);
    }
  }
  const orphans = [...other.values()].sort((a, b) => a.label.localeCompare(b.label));
  return [
    ...active.values(),
    ...orphans,
    ...(none.length ? [{ label: PACK_NO_PROJECT, records: none }] : []),
  ].filter((g) => g.records.length > 0);
}

// ---------------------------------------------------------------------------
// The pack
// ---------------------------------------------------------------------------

export interface PackInput {
  projects: readonly RegisterRecord[];
  projectsDef: RegisterDef;
  raid: readonly RegisterRecord[];
  raidDef: RegisterDef;
  changes: readonly RegisterRecord[];
  changesDef: RegisterDef;
  governance: readonly RegisterRecord[];
  governanceDef: RegisterDef;
  today: string;
  /** Days ahead for the governance section. */
  governanceDays?: number;
}

export interface WeeklyPack {
  subject: string;
  text: string;
  /** True when RAID and change records are grouped by project. */
  grouped: boolean;
  overall: "Green" | "Amber" | "Red";
}

const indented = (lines: readonly string[], indent: string): string[] =>
  lines.map((l) => (l === "" ? l : `${indent}${l}`));

/** The lines of a change summary without its own heading line and the blank line after it. */
function changeLines(
  items: readonly RegisterRecord[],
  def: RegisterDef,
  today: string,
): string[] {
  const text = changeSummary(items, def, today).text;
  return text === "" ? [] : text.split("\n").slice(2);
}

const section = (title: string, body: readonly string[], empty: string): string[] => [
  title,
  ...(body.length ? body : [empty]),
  "",
];

/** The whole pack as text. */
export function weeklyPack(input: PackInput): WeeklyPack {
  const { today } = input;
  const report = statusReport(input.projects, input.projectsDef, today);
  // The report's own heading is replaced by the pack's.
  const statusBody = report.text.split("\n").slice(2);
  const grouped = hasProjectData(input.raid, input.changes);

  // Active projects in the status report's order: worst first, then by name.
  const RAG = ["Green", "Amber", "Red"];
  const activeNames = input.projects
    .filter((p) => isOpen(input.projectsDef, p))
    .sort(
      (a, b) =>
        RAG.indexOf(overallRag(b)) - RAG.indexOf(overallRag(a)) ||
        recordTitle(input.projectsDef, a).localeCompare(
          recordTitle(input.projectsDef, b),
        ),
    )
    .map((p) => recordTitle(input.projectsDef, p));

  const changesBody: string[] = [];
  const raidBody: string[] = [];
  if (grouped) {
    for (const g of groupByProject(input.changes, activeNames)) {
      const lines = changeLines(g.records, input.changesDef, today);
      if (lines.length > 0) changesBody.push(`${g.label}:`, ...indented(lines, "  "), "");
    }
    for (const g of groupByProject(input.raid, activeNames)) {
      const lines = raidSummaryLines(raidSummary(g.records, input.raidDef, today), "  ");
      if (lines.length > 0) raidBody.push(`${g.label}:`, ...lines, "");
    }
  } else {
    if (input.changes.length > 0)
      changesBody.push(...changeLines(input.changes, input.changesDef, today));
    raidBody.push(...raidSummaryLines(raidSummary(input.raid, input.raidDef, today)));
  }
  while (changesBody[changesBody.length - 1] === "") changesBody.pop();
  while (raidBody[raidBody.length - 1] === "") raidBody.pop();

  const days = input.governanceDays ?? PACK_GOVERNANCE_DAYS;
  const gov = governanceSummary(input.governance, input.governanceDef, today, days);
  const govBody = [
    ...gov.upcoming.map((l) => `- ${l}`),
    ...(gov.passed.length
      ? [
          ...(gov.upcoming.length ? [""] : []),
          "Date has passed, still planned (mark each held or cancelled):",
          ...gov.passed.map((l) => `- ${l}`),
        ]
      : []),
  ];

  const text = [
    `Weekly PMO pack: ${formatDate(today)}`,
    "",
    ...section("STATUS", statusBody, "No active projects."),
    ...section("CHANGE REQUESTS", changesBody, "No change requests."),
    ...section(
      grouped
        ? "RAID LOG: PAST REVIEW DATE AND TOP OPEN RISKS, BY PROJECT"
        : "RAID LOG: PAST REVIEW DATE AND TOP OPEN RISKS",
      raidBody,
      "No open RAID items.",
    ),
    ...section(
      `GOVERNANCE: NEXT ${days} DAYS`,
      govBody,
      `Nothing planned in the next ${days} days.`,
    ),
  ]
    .join("\n")
    .trimEnd();

  return {
    subject: `Weekly PMO pack: ${formatDayMonth(today)} (${report.overall})`,
    text,
    grouped,
    overall: report.overall,
  };
}
