// Keyboard use of the to-do list: J/K (or the arrows) move between to-dos, E or Enter opens one,
// D marks it done (with an Undo), S opens its snooze menu. Pure.

export type ListKeyAction =
  | { type: "move"; index: number }
  | { type: "open" }
  | { type: "done" }
  | { type: "snooze" };

export interface ListKeyEvent {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/**
 * What a key does, given the focused to-do's position (`-1` when focus is on the list
 * itself, not yet on a to-do) and how many there are. `null` = not ours.
 */
export function listKeyAction(
  event: ListKeyEvent,
  index: number,
  count: number,
): ListKeyAction | null {
  if (count <= 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
    return null;
  }
  const last = count - 1;
  switch (event.key) {
    case "j":
    case "ArrowDown":
      return { type: "move", index: Math.min(last, index + 1) };
    case "k":
    case "ArrowUp":
      return { type: "move", index: Math.max(0, index < 0 ? 0 : index - 1) };
    case "Home":
      return { type: "move", index: 0 };
    case "End":
      return { type: "move", index: last };
  }
  if (index < 0) return null;
  switch (event.key) {
    case "e":
    case "Enter":
      return { type: "open" };
    case "d":
      return { type: "done" };
    case "s":
      return { type: "snooze" };
  }
  return null;
}

/** Keys typed into a field belong to the field. */
export function isTypingTarget(
  target: {
    tagName?: string;
    isContentEditable?: boolean;
  } | null,
): boolean {
  if (!target) return false;
  const tag = (target.tagName ?? "").toUpperCase();
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    !!target.isContentEditable
  );
}
