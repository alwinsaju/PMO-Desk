// Keeping track of which version of a saved record a form has seen, so the server can refuse a write that would
// overwrite a change made elsewhere (see `baseUpdatedAt` in server.ts). Pure.

export interface Seen {
  /** The `updatedAt` the form last saw; undefined for a record that has not been saved yet. */
  base: string | undefined;
  /** The to-do link of the record, which a save made by a panel can add. */
  todoId: string | undefined;
}

/** What the form has seen after a save: the saved record's own `updatedAt` and to-do link from the server's
 *  reply. A reply that does not hold the record leaves what was seen as it was. */
export function afterSave(
  seen: Seen,
  id: string,
  items: readonly { id: string; updatedAt: string; todoId?: string }[],
): Seen {
  const mine = items.find((i) => i.id === id);
  return mine ? { base: mine.updatedAt, todoId: mine.todoId } : seen;
}

/** The part of a save request that carries the version: sent for a record that was opened (a stamp that is
 *  empty is as good as none, e.g. a record read from a damaged file). */
export function versionFields(
  seen: Seen,
  isExisting: boolean,
  todoId?: string,
): { todoId: string | undefined; baseUpdatedAt: string | undefined } {
  return {
    todoId: todoId ?? seen.todoId,
    baseUpdatedAt: isExisting && seen.base ? seen.base : undefined,
  };
}
