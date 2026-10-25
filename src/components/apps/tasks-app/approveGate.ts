import type { ActionResult, ReviewQueue } from "./types";

/** The Approve click was stopped because incidents still need a Subcategory2. */
export interface ReviewBlock {
  pending: number;
  /** First few unresolved incident numbers (best effort — may be empty if
   *  the queue couldn't be re-read after a engine refusal). */
  numbers: string[];
}

export type ApproveOutcome =
  | { kind: "blocked"; block: ReviewBlock }
  /** The queue couldn't be re-read, so approve was NOT attempted. */
  | { kind: "unverified" }
  | { kind: "result"; result: ActionResult };

/** How many unresolved incident numbers to name in the "still need" message. */
export const BLOCK_PREVIEW_COUNT = 5;

function blockFromQueue(queue: ReviewQueue): ReviewBlock {
  const unresolved = queue.incidents.filter((i) => !i.resolved_subcategory2);
  return {
    pending: Math.max(queue.pending, unresolved.length),
    numbers: unresolved.slice(0, BLOCK_PREVIEW_COUNT).map((i) => i.number),
  };
}

/**
 * Approve for a task paused at the `review_incidents` gate. The engine
 * decides pending purely from its own saved files, so before asking it to
 * approve we re-read that same queue (read-only GET) and refuse locally if
 * anything is still unclassified — nothing mutating is sent until the
 * server itself says pending === 0. If the queue can't be read at all the
 * approve is NOT attempted (`unverified`), because proceeding blind is
 * exactly how a stale screen would let a half-classified run through; the
 * engine's own gate remains the final check either way. If the engine still
 * refuses with a pending count (the queue changed under us), that refusal
 * is turned into the same block so the user gets the same guidance.
 *
 * Dependencies are injected so this stays pure and testable without a
 * network: the hook passes the real api.ts functions.
 */
export async function approveWithReviewCheck(
  taskId: string,
  deps: {
    fetchReviewIncidents: (taskId: string) => Promise<ReviewQueue>;
    approveTask: (taskId: string) => Promise<ActionResult>;
  },
): Promise<ApproveOutcome> {
  let queue: ReviewQueue;
  try {
    queue = await deps.fetchReviewIncidents(taskId);
  } catch {
    return { kind: "unverified" };
  }
  if (queue.pending > 0) {
    return { kind: "blocked", block: blockFromQueue(queue) };
  }

  const result = await deps.approveTask(taskId);
  if (!result.ok && typeof result.pending === "number" && result.pending > 0) {
    let numbers: string[] = [];
    try {
      numbers = blockFromQueue(await deps.fetchReviewIncidents(taskId)).numbers;
    } catch {
      // Count alone is still useful.
    }
    return { kind: "blocked", block: { pending: result.pending, numbers } };
  }
  return { kind: "result", result };
}
