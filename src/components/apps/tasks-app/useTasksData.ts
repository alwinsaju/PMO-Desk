"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ENGINE_RESTARTED_EVENT } from "@/lib/engineRestart";
import { fetchTasks } from "./api";
import { isEngineDown, nextPollDelay } from "./pollBackoff";
import type { Task } from "./types";

/** Reflects only the OUTCOME of the most recent poll attempt — "offline"
 *  does not discard whatever tasks were last successfully loaded
 *  (see the hook's own doc comment below for why). */
export type ConnectionStatus = "loading" | "online" | "offline";

export interface TasksData {
  tasks: Task[];
  connection: ConnectionStatus;
  /** True once the very first poll has ever succeeded — distinguishes
   *  "still loading for the first time" from "was online, then dropped." */
  hasLoadedOnce: boolean;
  /** Forces an immediate poll, bypassing whatever's left of the current
   *  wait — call after a state-machine action so its effect shows up
   *  without waiting for the next scheduled tick. */
  refetch: () => void;
}

/**
 * Polls GET /tasks every 2s against the Tasks engine, backing off to 10s
 * while it is unreachable (see pollBackoff.ts)
 * (see api.ts). Network failures never blank the UI: the last-known-good
 * tasks stay on screen and only `connection` flips to "offline" (after two
 * failed polls in a row), so
 * the caller can show a small non-disruptive indicator instead of losing
 * the whole grid — mirroring main.js's `refresh()`, which does the same
 * (`setConnected(false)` on failure, without ever clearing already-rendered
 * cards). Overlapping polls are guarded against, also matching main.js's
 * explicit "never stack overlapping polls" rule. Polling pauses while the
 * document is hidden, and `api.ts` returns the previous parsed value when a
 * poll's body is unchanged, so an idle poll costs no React re-render.
 */
export function useTasksData(): TasksData {
  const [tasks, setTasks] = useState<Task[]>([]);
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
    let failures = 0;

    async function poll() {
      if (inFlight) return;
      inFlight = true;
      try {
        const nextTasks = await fetchTasks();
        if (cancelled) return;
        failures = 0;
        setTasks(nextTasks);
        setConnection("online");
        setHasLoadedOnce(true);
      } catch {
        failures += 1;
        if (!cancelled && isEngineDown(failures)) setConnection("offline");
      } finally {
        inFlight = false;
        // A hidden window (minimized / covered / another tab) stops polling;
        // the visibilitychange listener below resumes it with an immediate poll.
        if (!cancelled && !document.hidden) {
          timerRef.current = setTimeout(poll, nextPollDelay(failures));
        }
      }
    }

    function onVisibilityChange() {
      if (cancelled || document.hidden) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      void poll();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    pollRef.current = () => {
      if (cancelled) return; // a stale invocation — refetch() from a live component always hits the current one
      if (timerRef.current) clearTimeout(timerRef.current);
      poll();
    };
    poll();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const refetch = useCallback(() => {
    pollRef.current();
  }, []);

  // The settings menu's "Restart Tasks engine" fires this once the new engine is
  // up, so tasks reappear at once instead of at the next 2s tick.
  useEffect(() => {
    const onRestarted = () => pollRef.current();
    window.addEventListener(ENGINE_RESTARTED_EVENT, onRestarted);
    return () => window.removeEventListener(ENGINE_RESTARTED_EVENT, onRestarted);
  }, []);

  return { tasks, connection, hasLoadedOnce, refetch };
}
