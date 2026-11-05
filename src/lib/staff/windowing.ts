// Windowing for long fixed-height lists (the Directory with thousands of people): which rows to
// draw for the scroll position, and where to scroll to bring one into view. Pure.

export const ROW_HEIGHT = 52;

export interface WindowInput {
  /** Rows in the whole list. */
  count: number;
  rowHeight: number;
  /** How far the scroll container is scrolled, in pixels. */
  scrollTop: number;
  /** Height of the scroll container's visible area. */
  viewportHeight: number;
  /** Extra rows drawn above and below what is visible, so fast scrolling shows no blanks. */
  overscan?: number;
  /** A sticky header above the first row (it covers the top of the viewport). */
  headerHeight?: number;
}

export interface WindowRange {
  /** First row drawn. */
  start: number;
  /** One past the last row drawn. */
  end: number;
  /** Blank height standing in for the rows above and below. */
  padTop: number;
  padBottom: number;
}

export function windowRange({
  count,
  rowHeight,
  scrollTop,
  viewportHeight,
  overscan = 8,
  headerHeight = 0,
}: WindowInput): WindowRange {
  if (count <= 0 || rowHeight <= 0) return { start: 0, end: 0, padTop: 0, padBottom: 0 };
  const firstVisible = Math.floor((Math.max(0, scrollTop) - headerHeight) / rowHeight);
  const lastVisible = Math.ceil(
    (Math.max(0, scrollTop) + viewportHeight - headerHeight) / rowHeight,
  );
  const start = Math.min(count - 1, Math.max(0, firstVisible - overscan));
  const end = Math.min(count, Math.max(start + 1, lastVisible + overscan));
  return { start, end, padTop: start * rowHeight, padBottom: (count - end) * rowHeight };
}

/**
 * The scrollTop that brings row `index` fully into view (not under the sticky header), changing
 * the scroll as little as possible; null when it is visible already.
 */
export function scrollTopToReveal({
  index,
  rowHeight,
  scrollTop,
  viewportHeight,
  headerHeight = 0,
}: {
  index: number;
  rowHeight: number;
  scrollTop: number;
  viewportHeight: number;
  headerHeight?: number;
}): number | null {
  const top = index * rowHeight; // row top, relative to the first row
  const bottom = headerHeight + (index + 1) * rowHeight;
  if (top < scrollTop) return Math.max(0, top);
  if (bottom > scrollTop + viewportHeight) return bottom - viewportHeight;
  return null;
}
