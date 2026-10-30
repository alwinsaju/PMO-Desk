// When the opt-in update check is due. Pure, so the page can use it (updates.ts needs Node).

export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Is it time to look again? `enabled` must be true; the first check is always due. */
export function checkDue(
  enabled: boolean,
  lastCheckedAt: string,
  now: Date,
  intervalMs = CHECK_INTERVAL_MS,
): boolean {
  if (!enabled) return false;
  const last = Date.parse(lastCheckedAt);
  return Number.isNaN(last) || now.getTime() - last >= intervalMs;
}
