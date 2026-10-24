// Structural sharing for the polled state. Every 3 s the server sends a whole
// new document; most of it is identical to the last one. Handing React the SAME
// object for every part that did not change keeps `useMemo`/identity checks
// stable (an open dialog's proposal or to-do is the same object until it really
// changes) and lets unchanged branches be skipped. Pure, no React.

const isPlain = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

/** `next`, except that every part deeply equal to the same place in `prev` is
 *  `prev`'s own object. Returns `prev` itself when nothing changed at all.
 *  Arrays are compared position by position, so a reordered list is a new
 *  array whose unmoved elements are still shared. */
export function shareUnchanged<T>(prev: unknown, next: T): T {
  if (Object.is(prev, next)) return next;
  if (Array.isArray(prev) && Array.isArray(next)) {
    let same = prev.length === next.length;
    const merged = next.map((item, index) => {
      const shared = index < prev.length ? shareUnchanged(prev[index], item) : item;
      if (shared !== prev[index]) same = false;
      return shared;
    });
    return (same ? prev : merged) as T;
  }
  if (isPlain(prev) && isPlain(next)) {
    const keys = Object.keys(next);
    let same = Object.keys(prev).length === keys.length;
    const merged: Record<string, unknown> = {};
    for (const key of keys) {
      const shared = key in prev ? shareUnchanged(prev[key], next[key]) : next[key];
      merged[key] = shared;
      if (shared !== prev[key]) same = false;
    }
    return (same ? prev : merged) as T;
  }
  return next;
}
