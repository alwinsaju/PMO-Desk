/**
 * Cursor-following card spotlight — the logic half of the `spot` utility in
 * globals.css (which draws the glow from two CSS variables, `--mx`/`--my`).
 *
 * Nothing needs wiring for the common case: `<GlobalSpotlight />` (mounted
 * once in layout.tsx) listens on `document` and feeds every element that
 * carries the `spot` class, so a card/row just adds `className="spot"`.
 * `onSpotlightMove` is the same logic as a React handler, for the rare place
 * that renders outside the document listener's reach (an iframe-less
 * portal-less sandbox, a test) or wants to scope the work to one container:
 * put it on the container's `onPointerMove` and it delegates to whichever
 * `.spot` child is under the cursor.
 *
 * The update is two `style.setProperty` calls on the innermost `.spot` under
 * the pointer — no React state, no re-render, safe to fire on every move.
 */

export const SPOT_SELECTOR = ".spot";

/** Minimal shape so this can be unit-tested without a DOM. */
interface SpotTarget {
  closest?: (selector: string) => SpotElement | null;
}
interface SpotElement {
  getBoundingClientRect: () => { left: number; top: number };
  style: { setProperty: (name: string, value: string) => void };
}

/**
 * Point the spotlight of the innermost `.spot` ancestor-or-self of `target`
 * at viewport coordinates (`clientX`, `clientY`). Returns that element, or
 * null when the pointer isn't over one.
 */
export function applySpotlight(
  target: EventTarget | null,
  clientX: number,
  clientY: number,
): SpotElement | null {
  const el = (target as SpotTarget | null)?.closest?.(SPOT_SELECTOR) ?? null;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  el.style.setProperty("--mx", `${clientX - rect.left}px`);
  el.style.setProperty("--my", `${clientY - rect.top}px`);
  return el;
}

/** React `onPointerMove` handler form of {@link applySpotlight}. */
export function onSpotlightMove(event: {
  target: EventTarget | null;
  clientX: number;
  clientY: number;
  pointerType?: string;
}): void {
  // Touch has no hover, so there is nothing to follow.
  if (event.pointerType === "touch") return;
  applySpotlight(event.target, event.clientX, event.clientY);
}
