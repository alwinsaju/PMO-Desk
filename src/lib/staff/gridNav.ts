// Keyboard movement in the shift roster grid (one tab stop, arrow keys inside). Pure: the grid is
// described by which rows can take a cell and how many day columns there are.

export interface GridPos {
  row: number;
  col: number;
}

export interface GridKey {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

const PAGE = 5;

/**
 * Where a key moves the focus from `pos`, or null when the key is not a movement (or nothing
 * would change). `rowEnabled[i]` is false for rows that have no cells to focus (a person with no
 * team yet): moves skip them. Left and Right stop at the ends of a row; Home and End go to the
 * first and last day, with Ctrl to the first and last cell of the grid.
 */
export function moveInGrid(
  pos: GridPos,
  event: GridKey,
  rowEnabled: readonly boolean[],
  cols: number,
): GridPos | null {
  if (event.altKey || cols <= 0) return null;
  const ctrl = event.ctrlKey === true || event.metaKey === true;
  const rows = rowEnabled.length;
  const nextRow = (from: number, step: number, count = 1): number => {
    let at = from;
    let moved = 0;
    for (let i = from + step; i >= 0 && i < rows && moved < count; i += step) {
      if (rowEnabled[i]) {
        at = i;
        moved++;
      }
    }
    return at;
  };
  const first = rowEnabled.indexOf(true);
  const last = rowEnabled.lastIndexOf(true);
  if (first < 0) return null;
  let to: GridPos;
  switch (event.key) {
    case "ArrowLeft":
      to = { row: pos.row, col: Math.max(0, pos.col - 1) };
      break;
    case "ArrowRight":
      to = { row: pos.row, col: Math.min(cols - 1, pos.col + 1) };
      break;
    case "ArrowUp":
      to = { row: nextRow(pos.row, -1), col: pos.col };
      break;
    case "ArrowDown":
      to = { row: nextRow(pos.row, 1), col: pos.col };
      break;
    case "PageUp":
      to = { row: nextRow(pos.row, -1, PAGE), col: pos.col };
      break;
    case "PageDown":
      to = { row: nextRow(pos.row, 1, PAGE), col: pos.col };
      break;
    case "Home":
      to = ctrl ? { row: first, col: 0 } : { row: pos.row, col: 0 };
      break;
    case "End":
      to = ctrl ? { row: last, col: cols - 1 } : { row: pos.row, col: cols - 1 };
      break;
    default:
      return null;
  }
  return to.row === pos.row && to.col === pos.col ? null : to;
}

/**
 * The cell that holds the tab stop: the remembered one while it still exists in the grid, else the
 * first day of the first row that has cells. Null when no row has cells.
 */
export function tabStop(
  remembered: { rowKey: string; date: string } | null,
  rowKeys: readonly (string | null)[],
  days: readonly string[],
): { rowKey: string; date: string } | null {
  if (
    remembered &&
    rowKeys.includes(remembered.rowKey) &&
    days.includes(remembered.date)
  ) {
    return remembered;
  }
  const rowKey = rowKeys.find((key): key is string => key !== null);
  return rowKey && days.length > 0 ? { rowKey, date: days[0] } : null;
}

/** The CSS selector of one cell's button. */
export function cellSelector(rowKey: string, date: string): string {
  const quote = (s: string) => s.replace(/["\\]/g, "\\$&");
  return `[data-roster-cell][data-row-key="${quote(rowKey)}"][data-date="${quote(date)}"]`;
}
