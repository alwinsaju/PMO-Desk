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
