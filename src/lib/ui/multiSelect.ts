// Ticking rows in a list (register tools, the Staff directory). Pure and generic: a selection is
// a set of ids, and everything here returns a new set. A bulk action only ever acts on the rows
// that are still on screen, so a filter or search can never make it reach a row you cannot see.

export type IdSet = ReadonlySet<string>;

/** Ticks the id, or unticks it when it was ticked. */
export function toggleId(selected: IdSet, id: string): Set<string> {
  const next = new Set(selected);
  if (!next.delete(id)) next.add(id);
  return next;
}

/** True when there is at least one id and every one of them is ticked. */
export function allSelected(selected: IdSet, ids: readonly string[]): boolean {
  return ids.length > 0 && ids.every((id) => selected.has(id));
}

/** The header box: unticks all of `ids` when every one is ticked, else ticks all of them.
 *  Ids outside `ids` keep their state. */
export function toggleAll(selected: IdSet, ids: readonly string[]): Set<string> {
  const next = new Set(selected);
  const every = allSelected(selected, ids);
  for (const id of ids) {
    if (every) next.delete(id);
    else next.add(id);
  }
  return next;
}

/** Takes the ids out of the selection (after they were deleted, say). */
export function withoutIds(selected: IdSet, ids: Iterable<string>): Set<string> {
  const next = new Set(selected);
  for (const id of ids) next.delete(id);
  return next;
}

/** What a selection means for the list on screen: the ticked rows that are shown (in the
 *  order shown), and how many ticked rows exist but are hidden by a filter. Ticked ids that
 *  no longer exist anywhere (deleted, or removed by a refresh) are not counted. */
export function selectionView<T extends { id: string }>(
  shown: readonly T[],
  allIds: Iterable<string>,
  selected: IdSet,
): { visible: T[]; hidden: number } {
  const visible = shown.filter((row) => selected.has(row.id));
  const shownIds = new Set(visible.map((row) => row.id));
  let hidden = 0;
  for (const id of allIds) if (selected.has(id) && !shownIds.has(id)) hidden += 1;
  return { visible, hidden };
}

/** "3 selected" or "3 selected (2 more hidden by the filter)". */
export function selectedText(visible: number, hidden: number): string {
  return hidden > 0
    ? `${visible} selected (${hidden} more hidden by the filter, not included)`
    : `${visible} selected`;
}
