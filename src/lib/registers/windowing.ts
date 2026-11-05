// Showing only the rows that are on screen (plus a few above and below) in a long list. Pure: the page
// measures heights and the scroll position and asks which rows to draw. Rows may differ in height; a row
// that has not been measured yet counts as the average of the measured ones.

/** Lists up to this many rows are drawn whole (no windowing): small lists keep the plain behaviour. */
export const WINDOW_THRESHOLD = 120;

export interface RowWindow {
  /** First row to draw. */
  start: number;
  /** One past the last row to draw. */
  end: number;
  /** Height of the rows before `start`, for a spacer. */
  padTop: number;
  /** Height of the rows from `end` on, for a spacer. */
  padBottom: number;
  /** Height of all rows. */
  total: number;
}

/** offsets[i] is the top of row i; the last entry is the total height. */
export function buildOffsets(
  count: number,
  heightOf: (index: number) => number,
): number[] {
  const offsets = new Array<number>(count + 1);
  offsets[0] = 0;
  for (let i = 0; i < count; i += 1) offsets[i + 1] = offsets[i]! + heightOf(i);
  return offsets;
}

/** The row whose top is at or above `y` and whose bottom is below it (the last row for a `y` past the end). */
export function rowAt(offsets: readonly number[], y: number): number {
  const count = offsets.length - 1;
  if (count <= 0) return 0;
  let low = 0;
  let high = count - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (offsets[mid]! <= y) low = mid;
    else high = mid - 1;
  }
  return low;
}

/**
 * The rows to draw for a viewport that starts `top` pixels into the list and is `viewport` pixels high.
 * `overscan` extra rows are drawn on each side so a fast scroll never shows a blank gap.
 */
export function windowFor(
  offsets: readonly number[],
  top: number,
  viewport: number,
  overscan: number,
): RowWindow {
  const count = offsets.length - 1;
  const total = offsets[count] ?? 0;
  if (count <= 0) return { start: 0, end: 0, padTop: 0, padBottom: 0, total: 0 };
  const first = rowAt(offsets, Math.max(0, top));
  const last = rowAt(offsets, Math.max(0, top + viewport));
  const start = Math.max(0, first - overscan);
  const end = Math.min(count, last + 1 + overscan);
  return {
    start,
    end,
    padTop: offsets[start]!,
    padBottom: total - offsets[end]!,
    total,
  };
}

/** The mean of the measured heights, or `fallback` when none is known yet. */
export function averageHeight(measured: Iterable<number>, fallback: number): number {
  let sum = 0;
  let n = 0;
  for (const h of measured) {
    sum += h;
    n += 1;
  }
  return n === 0 ? fallback : sum / n;
}

/** How far to scroll (as an amount added to the current scroll position) so row `index` starts just under a
 *  sticky header of `header` pixels, given that the viewport now starts `top` pixels into the list. */
export function scrollDeltaFor(
  offsets: readonly number[],
  index: number,
  top: number,
  header: number,
): number {
  const clamped = Math.min(Math.max(0, index), Math.max(0, offsets.length - 2));
  return (offsets[clamped] ?? 0) - top - header;
}

/** How many cards fit across a grid of `width` pixels whose columns are at least `min` wide with `gap` between. */
export function columnsFor(width: number, min: number, gap: number): number {
  return Math.max(1, Math.floor((width + gap) / (min + gap)));
}

/** Splits `count` items into rows of `columns`: how many rows, and which items a range of rows holds. */
export function rowCount(count: number, columns: number): number {
  return Math.ceil(count / Math.max(1, columns));
}

export function itemsOfRows(
  start: number,
  end: number,
  columns: number,
  count: number,
): { from: number; to: number } {
  return { from: start * columns, to: Math.min(count, end * columns) };
}
