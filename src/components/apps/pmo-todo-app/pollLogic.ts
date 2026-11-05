// How the To-Do window follows the server: what to do with each poll's answer and how long
// to wait before the next. Pure, so it is tested (pollLogic.test.mjs).
import type { PmoState } from "@/lib/pmo/types";
import { shareUnchanged } from "./shareState.ts";

/** What a poll brought: nothing new (only the server clock), or a whole new document. */
export type StatePoll =
  | { unchanged: true; serverTime: string }
  | { unchanged: false; state: PmoState; digest: string | null };

export const POLL_INTERVAL_MS = 5000;
export const MAX_POLL_INTERVAL_MS = 30_000;

/** The wait before the next poll: the usual interval, longer when the last answer was slow,
 *  so a big data folder on a busy PC is not asked again before it has recovered. */
export function pollDelay(lastDurationMs: number): number {
  return Math.min(
    MAX_POLL_INTERVAL_MS,
    Math.max(POLL_INTERVAL_MS, Math.round(lastDurationMs) * 5),
  );
}

/** The state after a poll; `prev` is kept (same objects) wherever nothing changed. */
export function mergePoll(prev: PmoState | null, poll: StatePoll): PmoState | null {
  if (poll.unchanged) return prev ? { ...prev, serverTime: poll.serverTime } : prev;
  return prev ? shareUnchanged(prev, poll.state) : poll.state;
}
