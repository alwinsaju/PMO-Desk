/**
 * Pure logic for the diff gate ("Confirm the changes"): searching and
 * sorting the changed-cell table, the headline numbers, and the blocking
 * rule that disables the confirm button. Type-only imports so
 * taskPlatform.test.mjs runs it under plain Node.
 */
import type { CellChange, DiffBlocker, RosterDiff } from "./types";

/** localeCompare with null/empty values last (a changed cell without a
 *  person/date must not throw or sort first). Defined here, not imported,
 *  because plain-Node tests can't resolve extensionless sibling imports. */
function compareNullsLast(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const aEmpty = !a;
  const bEmpty = !b;
  if (aEmpty || bEmpty) return Number(aEmpty) - Number(bEmpty);
  return a.localeCompare(b, undefined, { numeric: true });
}

export type ChangeSortKey = "person" | "date" | "before" | "after";
export type SortDirection = "asc" | "desc";

/** All terms must match somewhere in person/date/before/after. */
export function filterChanges(changes: CellChange[], query: string): CellChange[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return changes;
  return changes.filter((change) => {
    const haystack = [change.person, change.date, change.before, change.after]
      .map((value) => value ?? "")
      .join(" ")
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/** Sorted copy. Ties fall back to person then date so the order is stable
 *  and predictable whichever column is chosen (dates are ISO, so plain
 *  string comparison is chronological). */
export function sortChanges(
  changes: CellChange[],
  key: ChangeSortKey,
  direction: SortDirection,
): CellChange[] {
  const sign = direction === "asc" ? 1 : -1;
  // Empty cells sort last in BOTH directions (the sign only applies when
  // both sides have a value).
  const byColumn = (a: CellChange, b: CellChange) =>
    !a[key] || !b[key]
      ? compareNullsLast(a[key], b[key])
      : sign * compareNullsLast(a[key], b[key]);
  return [...changes].sort(
    (a, b) =>
      byColumn(a, b) ||
      compareNullsLast(a.person, b.person) ||
      compareNullsLast(a.date, b.date),
  );
}

export interface ChangeStats {
  cells: number;
  people: number;
}

export function changeStats(changes: CellChange[]): ChangeStats {
  return {
    cells: changes.length,
    people: new Set(changes.map((c) => c.person).filter(Boolean)).size,
  };
}

/** Blockers that stop the confirm (the engine refuses it too). */
export function blockers(diff: RosterDiff | null | undefined): DiffBlocker[] {
  return diff?.blocking ?? [];
}

export function isConfirmBlocked(diff: RosterDiff | null | undefined): boolean {
  return blockers(diff).length > 0;
}

/** One-line summary of the blockers, for the disabled button's caption. */
export function blockingSummary(list: DiffBlocker[]): string {
  if (list.length === 0) return "";
  const first = list[0].message || list[0].kind;
  return list.length === 1 ? first : `${first} (+${list.length - 1} more)`;
}

export interface FlagDelta {
  added: number;
  resolved: number;
  remaining: number;
}

export function flagDelta(diff: RosterDiff): FlagDelta {
  return {
    added: diff.flags?.new?.length ?? 0,
    resolved: diff.flags?.resolved?.length ?? 0,
    remaining: diff.flags?.remaining ?? 0,
  };
}

/** Card-level one-liner for the confirm step. */
export function diffSummary(diff: RosterDiff): string {
  const { cells, people } = changeStats(diff.changes ?? []);
  const outside = diff.outside_changes?.length ?? 0;
  const main =
    cells === 0
      ? "No cells changed"
      : `${cells} cell${cells === 1 ? "" : "s"} changed across ${people} ${people === 1 ? "person" : "people"}`;
  return outside > 0 ? `${main} · ${outside} outside the plan` : main;
}
