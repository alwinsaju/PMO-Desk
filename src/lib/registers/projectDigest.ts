// The top open risks and late change requests for each project, for the weekly status report.
// Pure. RAID and change records are matched to a project by their optional Project text,
// without regard to case or extra spaces. Records with no project, or with a project the status
// register does not list as active, are kept in their own labelled groups so nothing is hidden.
import { daysBetween, formatDayMonth } from "../staff/dates.ts";
import { isOpen, recordTitle, textOf } from "./records.ts";
import type { RegisterDef, RegisterRecord } from "./types.ts";

/** How many risks one project shows. */
export const TOP_RISKS = 3;

/** The heading for records that have no Project. */
export const NO_PROJECT_LABEL = "No project";
/** The heading for records whose Project is not an active project in the status register. */
export const OTHER_PROJECT_LABEL = "Other projects (not active in the status register)";

export interface DigestGroup {
  /** The lines to show, already worded. Empty when the group has nothing to say. */
  risks: string[];
  /** How many open risks the group has in all (the lines show only the top few). */
  riskTotal: number;
  lateChanges: string[];
}

export interface ProjectDigest {
  /** By project name in lower case with single spaces (see `projectKey`). */
  byProject: Map<string, DigestGroup>;
  noProject: DigestGroup;
  other: DigestGroup;
}

/** The key two spellings of one project share: lower case, trimmed, runs of spaces collapsed. */
export const projectKey = (name: string): string =>
  name.toLowerCase().replace(/\s+/g, " ").trim();

const LEVEL: Record<string, number> = { High: 3, Medium: 2, Low: 1 };
const level = (value: string): number => LEVEL[value] ?? 2;

/** Impact times likelihood, 1 to 9. A blank counts as Medium, like the form's default. */
export const riskScore = (record: RegisterRecord): number =>
  level(textOf(record, "impact")) * level(textOf(record, "likelihood"));

/** The open Risk records (not assumptions, issues or dependencies), worst first, then the
 *  earliest review date, then by title. */
export function openRisks(
  raid: readonly RegisterRecord[],
  def: RegisterDef,
): RegisterRecord[] {
  return raid
    .filter((r) => textOf(r, "kind") === "Risk" && isOpen(def, r))
    .sort((a, b) => {
      const byScore = riskScore(b) - riskScore(a);
      if (byScore !== 0) return byScore;
      const da = textOf(a, "dueDate");
      const db = textOf(b, "dueDate");
      if (da !== db) return da === "" ? 1 : db === "" ? -1 : da.localeCompare(db);
      return recordTitle(def, a).localeCompare(recordTitle(def, b));
    });
}

/** The open change requests past their target date, the longest overdue first. */
export function lateChanges(
  changes: readonly RegisterRecord[],
  def: RegisterDef,
  today: string,
): RegisterRecord[] {
  return changes
    .filter((c) => {
      const t = textOf(c, "targetDate");
      return isOpen(def, c) && t !== "" && daysBetween(today, t) < 0;
    })
    .sort(
      (a, b) =>
        textOf(a, "targetDate").localeCompare(textOf(b, "targetDate")) ||
        recordTitle(def, a).localeCompare(recordTitle(def, b)),
    );
}

const emptyGroup = (): DigestGroup => ({ risks: [], riskTotal: 0, lateChanges: [] });

/** Sorted lines, one per record, for a group. `tag` adds the typed project name to each line. */
function riskLine(r: RegisterRecord, def: RegisterDef, today: string, tag: boolean) {
  const owner = textOf(r, "owner");
  const due = textOf(r, "dueDate");
  const project = textOf(r, "project").trim();
  const parts = [
    `${textOf(r, "impact") || "Medium"} impact, ${(textOf(r, "likelihood") || "Medium").toLowerCase()} likelihood`,
  ];
  if (owner) parts.push(owner);
  if (due) {
    parts.push(
      daysBetween(today, due) < 0
        ? `review overdue since ${formatDayMonth(due)}`
        : `review ${formatDayMonth(due)}`,
    );
  }
  return `${tag && project ? `[${project}] ` : ""}${recordTitle(def, r)} (${parts.join(", ")})`;
}

function changeLine(c: RegisterRecord, def: RegisterDef, today: string, tag: boolean) {
  const ref = textOf(c, "ref");
  const who = textOf(c, "requester");
  const target = textOf(c, "targetDate");
  const days = -daysBetween(today, target);
  const project = textOf(c, "project").trim();
  return `${tag && project ? `[${project}] ` : ""}${ref ? `${ref} ` : ""}${recordTitle(def, c)}${who ? ` (${who})` : ""}, target ${formatDayMonth(target)}, ${days} day${days === 1 ? "" : "s"} late`;
}

/**
 * Group the open risks and late changes by project.
 * `projectNames` are the active projects of the status register; a record whose Project matches
 * one (ignoring case) goes to it, a record with a blank Project goes to the "No project" group,
 * and any other goes to "Other projects" with its typed project name shown on the line.
 */
export function buildProjectDigest(
  projectNames: readonly string[],
  raid: readonly RegisterRecord[],
  raidDef: RegisterDef,
  changes: readonly RegisterRecord[],
  changesDef: RegisterDef,
  today: string,
  topRisks: number = TOP_RISKS,
): ProjectDigest {
  const known = new Set(projectNames.map(projectKey).filter(Boolean));
  const digest: ProjectDigest = {
    byProject: new Map(),
    noProject: emptyGroup(),
    other: emptyGroup(),
  };
  const bucket = (record: RegisterRecord): [DigestGroup, boolean] => {
    const key = projectKey(textOf(record, "project"));
    if (key === "") return [digest.noProject, false];
    if (!known.has(key)) return [digest.other, true];
    let group = digest.byProject.get(key);
    if (!group) {
      group = emptyGroup();
      digest.byProject.set(key, group);
    }
    return [group, false];
  };
  for (const r of openRisks(raid, raidDef)) {
    const [group, tag] = bucket(r);
    group.riskTotal += 1;
    if (group.risks.length < topRisks) group.risks.push(riskLine(r, raidDef, today, tag));
  }
  for (const c of lateChanges(changes, changesDef, today)) {
    const [group, tag] = bucket(c);
    group.lateChanges.push(changeLine(c, changesDef, today, tag));
  }
  return digest;
}

/** The indented lines for one group (empty when it has nothing). */
export function digestLines(group: DigestGroup | undefined, indent = "  "): string[] {
  if (!group) return [];
  const lines: string[] = [];
  if (group.risks.length > 0) {
    const more = group.riskTotal - group.risks.length;
    lines.push(
      `${indent}Top open risks${more > 0 ? ` (${group.risks.length} of ${group.riskTotal})` : ""}:`,
      ...group.risks.map((l) => `${indent}- ${l}`),
    );
  }
  if (group.lateChanges.length > 0) {
    lines.push(
      `${indent}Late changes:`,
      ...group.lateChanges.map((l) => `${indent}- ${l}`),
    );
  }
  return lines;
}

/** True when the group has any line to show. */
export const hasDigest = (group: DigestGroup | undefined): boolean =>
  !!group && (group.risks.length > 0 || group.lateChanges.length > 0);
