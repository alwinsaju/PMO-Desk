"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type LaunchPhase = "launching" | "ready" | "failed";

export interface BackendLauncherState {
  phase: LaunchPhase;
  /** Set only when phase === "failed" — what to show the user. */
  reason: string | null;
  /** Re-attempts the launch after a failure. */
  retry: () => void;
}

interface StartResponse {
  ok: boolean;
  alreadyRunning?: boolean;
  reason?: string;
}

/** Generous outer bound on top of the route's own ~20s internal timeout —
 *  this should basically never be what actually fires; it only guards
 *  against the request itself hanging if the route somehow didn't resolve
 *  on its own. */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Fires POST /api/tasks-engine/start once on mount (and again on retry) so
 * the Tasks app's own Tasks engine gets launched automatically
 * instead of requiring `uvicorn` to already be running by hand — see
 * src/app/api/tasks-engine/start/route.ts for the actual spawn logic. That
 * route blocks server-side until the engine is confirmed reachable,
 * already running, or its own bounded timeout elapses, so this hook only
 * ever needs ONE request per attempt rather than a polling loop of its
 * own — a genuinely different job from useTasksData's poll-forever
 * pattern, which is about staying live once already connected, not a
 * one-shot launch check.
 *
 * TasksAppGate only renders the real <TasksApp> once phase === "ready", so
 * useTasksData's own polling never even starts until the engine is
 * already known to be reachable — its very first poll should succeed.
 */
export function useEngineLauncher(): BackendLauncherState {
  const [phase, setPhase] = useState<LaunchPhase>("launching");
  const [reason, setReason] = useState<string | null>(null);

  // Guards against two hazards at once: a stale attempt's response landing
  // after a newer retry has already started (checked via `token`), and any
  // response landing after this hook has unmounted (checked via `alive`).
  const tokenRef = useRef(0);
  const aliveRef = useRef(true);

  const attempt = useCallback(() => {
    const token = ++tokenRef.current;
    setPhase("launching");
    setReason(null);

    fetch("/api/tasks-engine/start", {
      method: "POST",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
      .then((res) => res.json() as Promise<StartResponse>)
      .then((result) => {
        if (!aliveRef.current || token !== tokenRef.current) return;
        if (result.ok) {
          setPhase("ready");
        } else {
          setPhase("failed");
          setReason(result.reason ?? "The engine failed to start.");
        }
      })
      .catch(() => {
        if (!aliveRef.current || token !== tokenRef.current) return;
        setPhase("failed");
        setReason("Couldn't reach the Tasks app's own launcher endpoint.");
      });
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    attempt();
    return () => {
      aliveRef.current = false;
    };
  }, [attempt]);

  return { phase, reason, retry: attempt };
}
