// The Notes editor's own undo history. The text box is controlled (every change
// goes through the store), so the browser's built-in undo cannot be relied on:
// it forgets everything once a toolbar button or Ctrl+B rewrites the text. Pure.

export interface Snapshot {
  text: string;
  start: number;
  end: number;
}

export type ChangeKind = "type" | "format";

export interface NoteHistory {
  past: Snapshot[];
  future: Snapshot[];
  lastKind: ChangeKind | null;
  lastAt: number;
}

export const MAX_HISTORY = 200;
/** Typing within this gap of the last keystroke is one undo step. */
export const TYPING_GROUP_MS = 1000;

export const emptyHistory = (): NoteHistory => ({
  past: [],
  future: [],
  lastKind: null,
  lastAt: 0,
});

/** Remembers `before` (the state a change started from). Typing in a quick run
 *  shares one step; a toolbar action is always a step of its own. */
export function recordChange(
  history: NoteHistory,
  before: Snapshot,
  kind: ChangeKind,
  now: number,
): NoteHistory {
  const continuesRun =
    kind === "type" &&
    history.lastKind === "type" &&
    now - history.lastAt >= 0 &&
    now - history.lastAt < TYPING_GROUP_MS &&
    history.past.length > 0;
  const past = continuesRun
    ? history.past
    : [...history.past, before].slice(-MAX_HISTORY);
  return { past, future: [], lastKind: kind, lastAt: now };
}

/** Steps back; `current` is kept so Redo can return to it. Null when there is nothing to undo. */
export function undo(
  history: NoteHistory,
  current: Snapshot,
): { history: NoteHistory; snapshot: Snapshot } | null {
  const snapshot = history.past[history.past.length - 1];
  if (!snapshot) return null;
  return {
    snapshot,
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, current],
      lastKind: null,
      lastAt: 0,
    },
  };
}

export function redo(
  history: NoteHistory,
  current: Snapshot,
): { history: NoteHistory; snapshot: Snapshot } | null {
  const snapshot = history.future[history.future.length - 1];
  if (!snapshot) return null;
  return {
    snapshot,
    history: {
      past: [...history.past, current].slice(-MAX_HISTORY),
      future: history.future.slice(0, -1),
      lastKind: null,
      lastAt: 0,
    },
  };
}

/** Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y as the action they mean, or null for any other key. */
export function historyKey(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): "undo" | "redo" | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y" && !event.shiftKey) return "redo";
  return null;
}
