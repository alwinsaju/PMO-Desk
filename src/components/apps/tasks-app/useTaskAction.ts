"use client";

import { useState } from "react";
import { approveTask, rejectTask, resetTask, sendTask, startTask } from "./api";
import type { ActionResult } from "./types";

export type TaskActionName = "start" | "approve" | "reject" | "send" | "reset";

export interface TaskActionState {
  /** Which action is currently in flight for this task, if any. */
  pending: TaskActionName | null;
  /** The most recent action's rejection reason (`ok: false`) or network
   *  failure message, cleared as soon as another action is attempted. */
  lastFailure: string | null;
  start: () => void;
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
 * — mirrors main.js's `buildActions(task, api, refresh, ...)`, where
 * `refresh` is exactly this "onDone" callback.
 */
export function useTaskAction(taskId: string, onSettled: () => void): TaskActionState {
  const [pending, setPending] = useState<TaskActionName | null>(null);
  const [lastFailure, setLastFailure] = useState<string | null>(null);

  function run(name: TaskActionName, call: (id: string) => Promise<ActionResult>) {
    setPending(name);
    setLastFailure(null);
    call(taskId)
      .then((result) => {
        if (!result.ok) setLastFailure(result.reason ?? "request was rejected");
      })
      .catch(() => {
        setLastFailure("couldn't reach the backend");
      })
      .finally(() => {
        setPending(null);
        onSettled();
      });
  }

  return {
    pending,
    lastFailure,
    start: () => run("start", startTask),
    approve: () => run("approve", approveTask),
    reject: () => run("reject", rejectTask),
    send: () => run("send", sendTask),
    reset: () => run("reset", resetTask),
  };
}
