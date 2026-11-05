// Rendering a long to-do list in pages: the first page draws at once, the rest as the
// person scrolls (or presses J/K/End past the last card). Pure, so the paging rules
// are tested (renderWindow.test.mjs).

/** Cards drawn at first, and added each time the end of the list comes into view. */
export const PAGE_SIZE = 60;

/** The limit after revealing one more page, or enough pages to show `upTo` (an index). */
export function growLimit(
  limit: number,
  total: number,
  upTo: number | null = null,
  page = PAGE_SIZE,
): number {
  const wanted = upTo === null ? limit + page : Math.max(limit + page, upTo + 1);
  // Whole pages, so the footer count moves in steps people recognise.
  const rounded = upTo === null ? wanted : Math.ceil(wanted / page) * page;
  return Math.min(total, rounded);
}

/**
 * When a key would move past the cards that are drawn, the index to reveal; else null.
 * `current` is the focused card (-1 when the list itself has focus); only moving keys count.
 */
export function revealTarget(
  key: string,
  current: number,
  drawn: number,
  total: number,
): number | null {
  if (drawn >= total) return null;
  if (key === "End") return total - 1;
  if ((key === "j" || key === "ArrowDown") && current === drawn - 1) return drawn;
  return null;
}

/** "Showing 60 of 523" for the footer; null when everything is drawn. */
export function windowNote(drawn: number, total: number): string | null {
  return drawn >= total ? null : `Showing ${drawn} of ${total} to-dos`;
}
