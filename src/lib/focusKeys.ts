/** Pure keyboard/focus rules for windows and the lock screen (no DOM). */

export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

export type WindowShortcut = "close" | "minimize";

/** Ctrl+W closes and Ctrl+M minimises the focused window, even while typing. */
export function windowShortcut(event: KeyLike): WindowShortcut | null {
  if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
  const key = event.key.toLowerCase();
  if (key === "w") return "close";
  if (key === "m") return "minimize";
  return null;
}

/** First candidate that is still usable (e.g. still in the document). */
export function firstUsable<T>(
  candidates: ReadonlyArray<T | null | undefined>,
  isUsable: (candidate: T) => boolean,
): T | null {
  for (const candidate of candidates) {
    if (candidate != null && isUsable(candidate)) return candidate;
  }
  return null;
}

/** Index of the item Tab should move to inside a focus trap; null = nothing to
 *  focus. An `activeIndex` of -1 (focus is outside the trap) enters it at the
 *  start (Tab) or the end (Shift+Tab). */
export function trapTarget(
  activeIndex: number,
  count: number,
  backwards: boolean,
): number | null {
  if (count <= 0) return null;
  if (activeIndex < 0 || activeIndex >= count) return backwards ? count - 1 : 0;
  return backwards ? (activeIndex - 1 + count) % count : (activeIndex + 1) % count;
}
