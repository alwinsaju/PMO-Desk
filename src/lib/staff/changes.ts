// Applying a batch of changes to a list of `{ id }` items: removals first, then
// upserts (an upsert of an existing id replaces it, keeping its position).
import type { StaffChanges } from "./types.ts";

export function mergeChanges<T extends { id: string }>(
  current: readonly T[],
  { upsert = [], remove = [] }: StaffChanges<T>,
): T[] {
  const drop = new Set(remove);
  const next = new Map(
    current.filter((item) => !drop.has(item.id)).map((i) => [i.id, i]),
  );
  for (const item of upsert) next.set(item.id, item);
  return [...next.values()];
}
