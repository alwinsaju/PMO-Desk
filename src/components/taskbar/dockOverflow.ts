// Pure maths for a dock that is wider than the screen: how many tiles fit, and
// which to keep. Hidden apps stay reachable from the App Menu ("more apps").

const TILE = 46;
/** An app tile's width with "Show dock labels" on (a fixed column; DockTile.tsx uses `w-[60px]`). */
export const DOCK_LABELLED_TILE_WIDTH = 60;
const GAP = 6;
/** Pill padding and screen margin, the trailing divider and the launcher group. The launchers
 *  stay 46px wide either way. */
const RESERVED = 32 + 20 + 10 + 2 * TILE + GAP + 14;

/** How many app tiles fit next to the launcher group in a viewport this wide. With labels on
 *  each tile is wider, so fewer fit and more of the tail moves into the App Menu. */
export function dockCapacity(viewportWidth: number, labelled = false): number {
  if (!Number.isFinite(viewportWidth)) return Number.POSITIVE_INFINITY;
  const tile = labelled ? DOCK_LABELLED_TILE_WIDTH : TILE;
  return Math.max(3, Math.floor((viewportWidth - RESERVED + GAP) / (tile + GAP)));
}

export interface SplitResult<T> {
  shown: T[];
  hidden: T[];
}

/** Keeps `items` in order when they fit. Otherwise every app that is running is
 *  kept (so a window never loses its tile), then the first ones in dock order
 *  fill what is left; the rest are reported as hidden. */
export function splitDockItems<T extends { id: string }>(
  items: readonly T[],
  capacity: number,
  runningIds: ReadonlySet<string>,
): SplitResult<T> {
  if (items.length <= capacity) return { shown: [...items], hidden: [] };
  const keep = new Set<string>();
  for (const item of items) {
    if (keep.size >= capacity) break;
    if (runningIds.has(item.id)) keep.add(item.id);
  }
  for (const item of items) {
    if (keep.size >= capacity) break;
    keep.add(item.id);
  }
  return {
    shown: items.filter((item) => keep.has(item.id)),
    hidden: items.filter((item) => !keep.has(item.id)),
  };
}
