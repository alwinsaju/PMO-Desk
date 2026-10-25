/**
 * Pure logic for the draft-review flags panel: severity ordering, counts,
 * filtering and a copy-friendly TSV export. Type-only imports so
 * taskPlatform.test.mjs runs it under plain Node.
 */
import type { Flag, FlagSeverity, FlagsFile } from "./types";

export const SEVERITIES: readonly FlagSeverity[] = ["error", "warning", "info"];

/** Null-safe text: engine fields may be null (e.g. a flag with no person). */
export function textOf(value: string | null | undefined): string {
  return value ?? "";
}

/** localeCompare where null/empty values sort LAST (never first), so rows
 *  without a person/date sink to the bottom of a group. */
export function compareNullsLast(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const aEmpty = a === null || a === undefined || a === "";
  const bEmpty = b === null || b === undefined || b === "";
  if (aEmpty || bEmpty) return Number(aEmpty) - Number(bEmpty);
  return a.localeCompare(b);
}

export function severityRank(severity: string): number {
  const index = SEVERITIES.indexOf(severity as FlagSeverity);
  return index === -1 ? SEVERITIES.length : index;
}

/** Counts per severity: the file's own `counts` when present, otherwise
 *  tallied from the flag list (so a missing `counts` never reads as zero). */
export function severityCounts(file: FlagsFile): Record<FlagSeverity, number> {
  const tally: Record<FlagSeverity, number> = { error: 0, warning: 0, info: 0 };
  for (const flag of file.flags ?? []) {
    if (flag.severity in tally) tally[flag.severity as FlagSeverity] += 1;
  }
  return {
    error: file.counts?.error ?? tally.error,
    warning: file.counts?.warning ?? tally.warning,
    info: file.counts?.info ?? tally.info,
  };
}

export function flagKinds(flags: Flag[]): string[] {
  const kinds = flags
    .map((flag) => flag.kind)
    .filter((kind): kind is string => Boolean(kind));
  return [...new Set(kinds)].sort((a, b) => a.localeCompare(b));
}

export interface FlagFilter {
  severity: FlagSeverity | "all";
  /** A flag kind, or "all". */
  kind: string;
  query: string;
}

/** Filters by severity/kind and a free-text query (all terms must match
 *  somewhere in kind/person/date/message), most severe first, then by
 *  person and date. */
export function filterFlags(flags: Flag[], filter: FlagFilter): Flag[] {
  const terms = filter.query.toLowerCase().split(/\s+/).filter(Boolean);
  return flags
    .filter((flag) => {
      if (filter.severity !== "all" && flag.severity !== filter.severity) return false;
      if (filter.kind !== "all" && flag.kind !== filter.kind) return false;
      if (terms.length === 0) return true;
      const haystack = [
        flag.kind,
        flag.person,
        flag.date,
        flag.team,
        flag.shift,
        flag.message,
      ]
        .map(textOf)
        .join(" ")
        .toLowerCase();
      return terms.every((term) => haystack.includes(term));
    })
    .sort(
      (a, b) =>
        severityRank(a.severity) - severityRank(b.severity) ||
        compareNullsLast(a.person, b.person) ||
        compareNullsLast(a.date, b.date),
    );
}

/** Tab-separated rows (with a header) that paste cleanly into Excel. */
export function flagsToTsv(flags: Flag[]): string {
  const clean = (value: string | null | undefined) =>
    textOf(value).replace(/[\t\r\n]+/g, " ");
  const rows = flags.map((flag) =>
    [flag.severity, flag.kind, flag.person, flag.date, flag.message]
      .map(clean)
      .join("\t"),
  );
  return ["Severity\tKind\tPerson\tDate\tMessage", ...rows].join("\n");
}

/** Card-level one-liner, e.g. "2 errors · 14 warnings · 65 info". */
export function flagsSummary(file: FlagsFile): string {
  const counts = severityCounts(file);
  const parts: string[] = [];
  if (counts.error) parts.push(`${counts.error} error${counts.error === 1 ? "" : "s"}`);
  if (counts.warning)
    parts.push(`${counts.warning} warning${counts.warning === 1 ? "" : "s"}`);
  if (counts.info) parts.push(`${counts.info} info`);
  return parts.length > 0 ? parts.join(" · ") : "No flags";
}
