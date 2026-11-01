"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { setEngineUrl } from "./engineUrl";
import { abortableSleep, runEngineLaunch } from "./launchRetry";

export type LaunchPhase = "launching" | "ready" | "failed";

export interface EngineLauncherState {
  phase: LaunchPhase;
  /** Set only when phase === "failed" — what to show the user. */
  reason: string | null;
  /** When the current launch began (ms since epoch), for an elapsed-time readout. */
  startedAt: number | null;
  /** While launching: why the last attempt was retried (e.g. "HTTP 404"). */
  retrying: string | null;
  /** Re-attempts the launch after a failure. */
  retry: () => void;
}

/**
 * Fires POST /api/tasks-engine/start on mount (and again on retry) so
 * the Tasks app's own Tasks engine gets launched automatically
 * instead of requiring `uvicorn` to already be running by hand — see
 * src/app/api/tasks-engine/start/route.ts for the actual spawn logic. That
 * route blocks server-side until the engine is confirmed reachable,
 * already running, or its own bounded timeout elapses. Transient failures
 * (route still compiling, network blip) are retried with back-off for about
 * 12 s by runEngineLaunch (launchRetry.ts); a failure the route reports
 * itself is shown at once.
 *
 * TasksAppGate only renders the real <TasksApp> once phase === "ready", so
 * useTasksData's own polling never even starts until the engine is
 * already known to be reachable — its very first poll should succeed.
 */
export function useEngineLauncher(): EngineLauncherState {
  const [phase, setPhase] = useState<LaunchPhase>("launching");
  const [reason, setReason] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);

  // Aborting the previous controller covers both a stale attempt landing after
  // a newer retry began and any response arriving after unmount.
  const controllerRef = useRef<AbortController | null>(null);

  const attempt = useCallback(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setPhase("launching");
    setReason(null);
    setRetrying(null);
    setStartedAt(Date.now());

    void runEngineLaunch({
      fetchImpl: fetch,
      sleep: abortableSleep,
      now: Date.now,
      signal: controller.signal,
      onRetry: (info) => setRetrying(info.detail),
    }).then((outcome) => {
      if (outcome.status === "aborted") return;
      if (outcome.status === "ready") {
        setEngineUrl(outcome.url);
        setPhase("ready");
      } else {
        setPhase("failed");
        setReason(outcome.reason);
      }
    });
  }, []);

  useEffect(() => {
    attempt();
    return () => controllerRef.current?.abort();
  }, [attempt]);

  return { phase, reason, startedAt, retrying, retry: attempt };
}
