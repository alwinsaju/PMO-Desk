// Pure helpers for the count badge on a dock tile (see dockBadgeStore.ts).

/** What the badge shows: nothing for 0 (or a bad value), the number up to 9,
 *  then "9+" so it never outgrows the tile corner. */
export function badgeText(count: number): string | null {
  if (!Number.isFinite(count) || count < 1) return null;
  const whole = Math.floor(count);
  return whole > 9 ? "9+" : String(whole);
}

/** Spoken label for a tile that carries a badge. */
export function badgedLabel(
  label: string,
  count: number,
  noun = "need attention",
): string {
  return badgeText(count) === null ? label : `${label}, ${Math.floor(count)} ${noun}`;
}
