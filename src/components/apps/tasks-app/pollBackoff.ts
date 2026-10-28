/** Poll scheduling for the Tasks app while the engine may be down (QA UI-8). */

/** Normal poll interval, also used right after the first failed poll. */
export const BASE_POLL_MS = 2000;
/** Longest wait between polls during a long outage. */
export const MAX_POLL_MS = 10_000;
/** Consecutive failed polls before the "can't reach the engine" banner shows. */
export const OFFLINE_AFTER_FAILURES = 2;

/** Wait before the next poll: 2s, 2s, 4s, 8s, then 10s. 0 = last poll succeeded. */
export function nextPollDelay(consecutiveFailures: number): number {
  if (!Number.isFinite(consecutiveFailures) || consecutiveFailures <= 1) {
    return BASE_POLL_MS;
  }
  return Math.min(BASE_POLL_MS * 2 ** (consecutiveFailures - 1), MAX_POLL_MS);
}

/** True once enough polls in a row have failed to call it an outage. */
export function isEngineDown(consecutiveFailures: number): boolean {
  return consecutiveFailures >= OFFLINE_AFTER_FAILURES;
}
