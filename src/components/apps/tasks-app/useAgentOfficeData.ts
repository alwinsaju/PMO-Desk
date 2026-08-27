"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchAgents, fetchTasks } from "./api";
import { canStartFromAgents } from "./taskPresenter";
import type { Agent, Task } from "./types";

/** Matches the reference agent-office frontend's own poll cadence (see
 *  main.js's `POLL_MS`). */
const POLL_INTERVAL_MS = 2000;

/** Reflects only the OUTCOME of the most recent poll attempt — "offline"
 *  does not discard whatever tasks/agents were last successfully loaded
 *  (see the hook's own doc comment below for why). */
export type ConnectionStatus = "loading" | "online" | "offline";

export interface AgentOfficeData {
  tasks: Task[];
  agents: Agent[];
  /** True once at least one worker in the pool is idle. */
  canStart: boolean;
  connection: ConnectionStatus;
  /** True once the very first poll has ever succeeded — distinguishes
   *  "still loading for the first time" from "was online, then dropped." */
  hasLoadedOnce: boolean;
  /** Forces an immediate poll, bypassing whatever's left of the current
   *  wait — call after a state-machine action so its effect shows up
   *  without waiting up to POLL_INTERVAL_MS for the next scheduled tick. */
  refetch: () => void;
}

/**
 * Polls GET /tasks + GET /agents every 2s against the agent-office backend
 * (see api.ts). Network failures never blank the UI: the last-known-good
 * tasks/agents stay on screen and only `connection` flips to "offline", so
 * the caller can show a small non-disruptive indicator instead of losing
 * the whole grid — mirroring main.js's `refresh()`, which does the same
 * (`setConnected(false)` on failure, without ever clearing already-rendered
 * cards). Overlapping polls are guarded against, also matching main.js's
 * explicit "never stack overlapping polls" rule.
 */
export function useAgentOfficeData(): AgentOfficeData {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [connection, setConnection] = useState<ConnectionStatus>("loading");
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<() => void>(() => {});

  useEffect(() => {
    // `cancelled` and `inFlight` are deliberately effect-local (not refs):
    // in dev, StrictMode mounts every effect twice (run -> cleanup -> run
    // again) to flush out exactly this class of bug. A ref-based "don't
    // overlap polls" guard would be SHARED across both invocations, so the
    // first invocation's still-in-flight request (its `fetch` hasn't
    // rejected yet when the second invocation starts) would make the
    // second invocation's poll() see the guard as "busy" and bail out
    // immediately — permanently, since the first invocation's own
    // `cancelled` flag then suppresses it from ever updating state or
    // scheduling a follow-up poll either. Net effect: the UI gets stuck on
    // "loading" forever, with no further polls ever firing. Scoping both
    // flags to this specific effect invocation means a cancelled
    // invocation's in-flight request can never block the surviving one.
    let cancelled = false;
    let inFlight = false;

    async function poll() {
      if (inFlight) return;
      inFlight = true;
      try {
        const [nextTasks, nextAgents] = await Promise.all([fetchTasks(), fetchAgents()]);
        if (cancelled) return;
        setTasks(nextTasks);
        setAgents(nextAgents);
        setConnection("online");
        setHasLoadedOnce(true);
      } catch {
        if (!cancelled) setConnection("offline");
      } finally {
        inFlight = false;
        if (!cancelled) timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
      }
    }

    pollRef.current = () => {
      if (cancelled) return; // a stale invocation — refetch() from a live component always hits the current one
      if (timerRef.current) clearTimeout(timerRef.current);
      poll();
    };
    poll();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const refetch = useCallback(() => {
    pollRef.current();
  }, []);

  const canStart = useMemo(() => canStartFromAgents(agents), [agents]);

  return { tasks, agents, canStart, connection, hasLoadedOnce, refetch };
}
