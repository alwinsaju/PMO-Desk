"use client";

import { useCallback, useState } from "react";
import {
  approveTask,
  fetchReviewIncidents,
  rejectTask,
  resetTask,
  sendTask,
  startTask,
} from "./api";
import { approveWithReviewCheck, type ReviewBlock } from "./approveGate";
import { refusalText } from "./taskPresenter";
import type { ActionResult } from "./types";
import { notifyGateChanged } from "./useGateData";

export type TaskActionName = "start" | "approve" | "reject" | "send" | "reset";

export interface TaskActionState {
  /** Which action is currently in flight for this task, if any. */
  pending: TaskActionName | null;
  /** The most recent action's rejection reason (`ok: false`) or network
   *  failure message, cleared as soon as another action is attempted. */
  lastFailure: string | null;
  /** Set when Approve was stopped because the review queue still has
   *  unclassified incidents; cleared by the next action or `clearReviewBlock`. */
  reviewBlock: ReviewBlock | null;
  clearReviewBlock: () => void;
  /** Resolves with the engine's reply (null when it couldn't be reached),
   *  so the start form can keep itself open and show a refusal inline. */
  start: () => Promise<ActionResult | null>;
  approve: () => void;
  reject: () => void;
  send: () => void;
  reset: () => void;
}

/**
 * Owns the pending/failure UI state and the actual network call for a
 * single task's action buttons — the ONE place in this app that invokes
 * the five state-machine actions from api.ts. `TaskActionBar` stays a pure
 * presentational component that only ever calls the callbacks this hook
 * returns, which is what let the button/label/disabled logic below be
 * verified interactively (see the app's verification notes) without ever
 * exercising a real network call: a test harness can render
 * `TaskActionBar` directly with hand-written stub callbacks in place of
 * this hook.
 *
 * `onSettled` fires after every call settles (success or failure) so the
 * caller can refetch immediately instead of waiting for the next poll tick
 * (the card's `refresh`).
 */
export function useTaskAction(
  taskId: string,
  onSettled: () => void,
  /** True while the task is paused at the `review_incidents` gate — Approve
   *  then re-checks the live review queue before it is allowed through. */
  atReviewGate = false,
): TaskActionState {
  const [pending, setPending] = useState<TaskActionName | null>(null);
  const [lastFailure, setLastFailure] = useState<string | null>(null);
  const [reviewBlock, setReviewBlock] = useState<ReviewBlock | null>(null);

  function run(
    name: TaskActionName,
    call: (id: string) => Promise<ActionResult>,
  ): Promise<ActionResult | null> {
    setPending(name);
    setLastFailure(null);
    setReviewBlock(null);
    return call(taskId)
      .then((result) => {
        if (!result.ok) setLastFailure(refusalText(result));
        return result;
      })
      .catch(() => {
        setLastFailure("couldn't reach the engine");
        return null;
      })
      .finally(() => {
        setPending(null);
        // A refused approve/send may mean the gate's own data changed.
        notifyGateChanged(taskId);
        onSettled();
      });
  }

  const clearReviewBlock = useCallback(() => setReviewBlock(null), []);

  // Approve at the incident-review gate: re-read the queue first and only
  // let the real approve POST go out once nothing is pending (see
  // approveGate.ts). A queue we can't read stops the approve too.
  function approve() {
    if (!atReviewGate) {
      void run("approve", approveTask);
      return;
    }
    setPending("approve");
    setLastFailure(null);
    setReviewBlock(null);
    approveWithReviewCheck(taskId, { fetchReviewIncidents, approveTask })
      .then((outcome) => {
        if (outcome.kind === "blocked") {
          setReviewBlock(outcome.block);
        } else if (outcome.kind === "unverified") {
          setLastFailure("couldn't verify the review queue — nothing was approved");
        } else if (!outcome.result.ok) {
          setLastFailure(outcome.result.reason ?? "request was rejected");
        }
      })
      .catch(() => {
        setLastFailure("couldn't reach the engine");
      })
      .finally(() => {
        setPending(null);
        onSettled();
      });
  }

  return {
    pending,
    lastFailure,
    reviewBlock,
    clearReviewBlock,
    start: () => run("start", startTask),
    approve,
    reject: () => void run("reject", rejectTask),
    send: () => void run("send", sendTask),
    reset: () => void run("reset", resetTask),
  };
}
