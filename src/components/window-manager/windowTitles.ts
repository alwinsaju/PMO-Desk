// Short status text shown after a window's title, e.g. "PMO To-Do (3 need attention)",
// so the dock, the title bar and a screen reader say what is waiting. Pure.

/** "1 needs attention" / "3 need attention"; nothing when there is nothing waiting. */
export function attentionSuffix(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  const n = Math.floor(count);
  return n === 1 ? "1 needs attention" : `${n} need attention`;
}

export function titleWithSuffix(
  title: string,
  suffix: string | null | undefined,
): string {
  return suffix ? `${title} (${suffix})` : title;
}

/** The text after the app name in the title bar: the window's own context (e.g. the open
 *  tab, "Shift roster") then the app's live status ("3 need attention"), joined with a
 *  middle dot. Null when there is neither. */
export function joinSuffixes(...parts: Array<string | null | undefined>): string | null {
  const text = parts
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" · ");
  return text || null;
}
