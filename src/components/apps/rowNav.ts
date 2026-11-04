// Keyboard movement through a list of rows or tiles (Staff, Templates, Toolkit), the same keys as
// the to-do list (see pmo-todo-app/listKeys.ts): J/K (and the arrows where they do not clash with
// a grid) move, Home/End jump, E opens. Enter is left to the element: a button already clicks on
// Enter, and Staff rows handle it themselves. There is no Delete key and keys typed into a field
// are never taken. Pure: the elements are passed in, so tests use fakes.
import {
  isTypingTarget,
  listKeyAction,
  type ListKeyEvent,
} from "./pmo-todo-app/listKeys.ts";

export interface RowNavOptions {
  /** Up and Down also move. Off for a grid, where an arrow would mean a row or a column. Default on. */
  arrows?: boolean;
}

export type RowNavAction = { type: "move"; index: number } | { type: "open" };

/**
 * What a key does for a list with `count` rows when row `index` has focus (`-1`: none yet).
 * `null` means the key is not ours.
 */
export function rowKeyAction(
  event: ListKeyEvent,
  index: number,
  count: number,
  options: RowNavOptions = {},
): RowNavAction | null {
  if (event.key === "Enter") return null;
  if (options.arrows === false && event.key.startsWith("Arrow")) return null;
  const action = listKeyAction(event, index, count);
  if (!action) return null;
  return action.type === "move" || action.type === "open" ? action : null;
}

/** The part of a row or tile that navigation needs. */
export interface NavItem {
  focus: () => void;
  click: () => void;
}

export interface NavKeyEvent extends ListKeyEvent {
  target: unknown;
  preventDefault: () => void;
}

/**
 * Handles one key press for a list. `current` is the row the focus is in (or null when it is
 * on something else in the list). Returns true when the key was used (and its default action
 * cancelled). E opens only when the row itself has focus, so it never clicks from a control inside it.
 */
export function handleRowKey(
  event: NavKeyEvent,
  items: readonly NavItem[],
  current: NavItem | null,
  options: RowNavOptions = {},
): boolean {
  if (isTypingTarget(event.target as Parameters<typeof isTypingTarget>[0])) return false;
  const index = current ? items.indexOf(current) : -1;
  const action = rowKeyAction(event, index, items.length, options);
  if (!action) return false;
  if (action.type === "open") {
    if (!current || event.target !== current) return false;
    event.preventDefault();
    current.click();
    return true;
  }
  event.preventDefault();
  items[action.index]?.focus();
  return true;
}
