// The last few things opened from Ctrl+K, newest first. Pure list logic; the store keeps it.
import type { SearchItem, SearchKind } from "./searchIndex.ts";

export const MAX_RECENTS = 5;

const KINDS: readonly SearchKind[] = [
  "app",
  "todo",
  "record",
  "note",
  "template",
  "person",
  "timeoff",
];

/** Remembers `item` as the newest; opening it again moves it to the front. */
export function pushRecent(
  recents: readonly SearchItem[],
  item: SearchItem,
  max = MAX_RECENTS,
): SearchItem[] {
  // Long keywords are only for matching and would bloat the saved list.
  const slim: SearchItem = { ...item, keywords: "" };
  return [slim, ...recents.filter((r) => r.id !== item.id)].slice(0, max);
}

const isTarget = (value: unknown): value is SearchItem["target"] =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { app?: unknown }).app === "string";

/** Reads a saved list back, dropping anything that is not a well-formed item. */
export function sanitizeRecents(value: unknown, max = MAX_RECENTS): SearchItem[] {
  if (!Array.isArray(value)) return [];
  const out: SearchItem[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    if (
      typeof r.id !== "string" ||
      typeof r.title !== "string" ||
      !KINDS.includes(r.kind as SearchKind) ||
      !isTarget(r.target) ||
      seen.has(r.id)
    ) {
      continue;
    }
    seen.add(r.id);
    out.push({
      id: r.id,
      kind: r.kind as SearchKind,
      title: r.title,
      subtitle: typeof r.subtitle === "string" ? r.subtitle : "",
      keywords: "",
      target: r.target,
    });
  }
  return out.slice(0, max);
}

/** The recents as they are now: the live item when it still exists (its title may have
 *  changed), the saved one while its source is still loading. An item that is gone
 *  drops out once its kind is in `loaded`. */
export function resolveRecents(
  recents: readonly SearchItem[],
  live: readonly SearchItem[],
  loaded: ReadonlySet<SearchKind>,
): SearchItem[] {
  const byId = new Map(live.map((item) => [item.id, item]));
  return recents.flatMap((saved) => {
    const now = byId.get(saved.id);
    if (now) return [now];
    return loaded.has(saved.kind) ? [] : [saved];
  });
}
