// Window switcher order (Ctrl+Tab) and the focus-mode clock. Pure.

export interface SwitchWindow {
  id: string;
  zIndex: number;
  appId?: string;
}

/** Windows most recently used first (the focused one is first). */
export function mruOrder(windows: readonly SwitchWindow[]): SwitchWindow[] {
  return [...windows].sort((a, b) => b.zIndex - a.zIndex);
}

/** The next index when Tab is pressed again, wrapping both ways. */
export function stepIndex(current: number, count: number, backwards: boolean): number {
  if (count <= 0) return 0;
  return backwards ? (current - 1 + count) % count : (current + 1) % count;
}

/** Ctrl+Tab and Ctrl+Shift+Tab. */
export function switcherKey(event: {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}): "next" | "previous" | null {
  if (event.key !== "Tab" || !event.ctrlKey || event.altKey || event.metaKey) return null;
  return event.shiftKey ? "previous" : "next";
}
