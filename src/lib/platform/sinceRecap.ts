// "Since you last opened": a recap of the PMO audit log entries newer than the last time the app was
// opened. The log covers PMO To-Do, messages, chasers, reports and settings only. Toolkit and Staff
// changes are not recorded, so the wording always says so. Pure.
import {
  CATEGORY_LABEL,
  categoryCounts,
  type ActivityCategory,
} from "./activityTimeline.ts";
import type { AuditEntry } from "./auditView.ts";

/** What the Activity viewer reads at most (AUDIT_VIEW_LIMIT in auditServer.ts, which is server only). */
export const RECAP_READ_LIMIT = 2000;

/** Shown wherever the recap appears: the audit log has no Toolkit or Staff lines. */
export const RECAP_SCOPE_NOTE =
  "The activity log records PMO To-Do, messages, chasers, reports and settings only. Toolkit and Staff changes are not recorded.";

export interface Recap {
  /** Entries newer than `since`. At the read limit this is a floor, not an exact count. */
  count: number;
  /** True when every entry the viewer can read is newer than `since`, so older ones may be missing. */
  atLeast: boolean;
  since: string;
  categories: { category: ActivityCategory; count: number }[];
}

const time = (iso: string): number => Date.parse(iso);

/** A valid ISO time, or "" (a missing, blank or unreadable value means "no previous time"). */
export const validSince = (value: unknown): string =>
  typeof value === "string" && !Number.isNaN(time(value)) ? value.trim() : "";

/** The entries strictly newer than `since`. An unreadable `since` keeps nothing. */
export function entriesSince<T extends Pick<AuditEntry, "at">>(
  entries: readonly T[],
  since: string,
): T[] {
  const cutoff = time(validSince(since));
  if (Number.isNaN(cutoff)) return [];
  return entries.filter((e) => time(e.at) > cutoff);
}

/**
 * The recap for a launch, or null when there is nothing to show: no previous time (first run) or no new
 * entries. `entries` is what the viewer reads (newest first, at most RECAP_READ_LIMIT).
 */
export function buildRecap(
  entries: readonly Pick<AuditEntry, "at" | "action">[],
  lastOpenedAt: string,
  readLimit = RECAP_READ_LIMIT,
): Recap | null {
  const since = validSince(lastOpenedAt);
  if (!since) return null;
  const fresh = entriesSince(entries, since);
  if (fresh.length === 0) return null;
  return {
    count: fresh.length,
    atLeast: entries.length >= readLimit && fresh.length === entries.length,
    since,
    categories: categoryCounts(fresh),
  };
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** "12 new lines" or "at least 2000 new lines". */
export function recapCountText(recap: Pick<Recap, "count" | "atLeast">): string {
  const lines = plural(recap.count, "line", "lines");
  return recap.atLeast
    ? `at least ${recap.count} new ${lines}`
    : `${recap.count} new ${lines}`;
}

/** "To-dos 5, Messages 3" for the toast and the banner. */
export function recapBreakdown(recap: Pick<Recap, "categories">): string {
  return recap.categories
    .map((c) => `${CATEGORY_LABEL[c.category]} ${c.count}`)
    .join(", ");
}

/** The launch toast text: the count, the split and the scope warning. */
export function recapMessage(recap: Recap): string {
  return `Since you last opened: ${recapCountText(recap)} in the PMO activity log (${recapBreakdown(recap)}). Toolkit and Staff changes are not recorded.`;
}
