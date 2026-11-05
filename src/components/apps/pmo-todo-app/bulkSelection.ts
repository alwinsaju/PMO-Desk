// What the to-do bulk bar acts on. Pure (no React); relative imports with the .ts extension
// so `pnpm test` can load it (see bulkSelection.test.mjs).
//
// A bulk action only ever touches ticked to-dos that are ON SCREEN now. A ticked to-do that a
// filter, tag or search hides is not changed, and the bar says how many were left out (the
// same rule and wording as the registers, from lib/ui/multiSelect).
import type { BulkPatch } from "../../../lib/pmo/pmoViews.ts";
import type { Todo } from "../../../lib/pmo/types.ts";
import { selectedText, selectionView, type IdSet } from "../../../lib/ui/multiSelect.ts";

export interface TodoBulkSelection {
  /** Ticked to-dos that are shown, in the order shown: the ONLY ones a bulk action may touch. */
  todos: Todo[];
  /** Ticked to-dos that exist but are hidden by the filter, tag or search. */
  hidden: number;
  /** "2 ticked" or "1 ticked (1 more hidden by the filter, not included)". */
  text: string;
}

/** `shown`: the list on screen (filter, tag and search applied). `all`: every to-do, so a
 *  ticked id that no longer exists (deleted, or removed by a refresh) is not counted as hidden. */
export function todoBulkSelection(
  shown: readonly Todo[],
  all: readonly Pick<Todo, "id">[],
  selected: IdSet,
): TodoBulkSelection {
  const { visible, hidden } = selectionView(
    shown,
    all.map((t) => t.id),
    selected,
  );
  return { todos: visible, hidden, text: selectedText(visible.length, hidden, "ticked") };
}

/** The undo for a bulk action, limited to the to-dos that were really changed: a patch the
 *  server refused (`ok` false, same order as `patches`) has nothing to put back. */
export function appliedUndo(
  patches: readonly BulkPatch[],
  undo: readonly BulkPatch[],
  ok: readonly boolean[],
): BulkPatch[] {
  const changed = new Set(patches.filter((_, i) => ok[i]).map((p) => p.id));
  return undo.filter((p) => changed.has(p.id));
}
