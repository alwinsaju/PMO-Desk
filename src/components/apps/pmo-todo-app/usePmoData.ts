"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PmoState } from "@/lib/pmo/types";
import { pollState } from "./api";
import { mergePoll, pollDelay } from "./pollLogic";

export type ConnectionStatus = "loading" | "online" | "offline";

export interface PmoData {
  state: PmoState | null;
  connection: ConnectionStatus;
  /** Forces a poll now, e.g. right after an action, instead of waiting for the next tick. */
  refetch: () => void;
}

/**
 * Polls GET /api/pmo/state every 5 s (longer when the server is slow), and only while the
 * window is on screen: a hidden tab or minimised app stops asking and catches up the moment
 * it is visible again. While nothing has changed the server answers "unchanged" instead of
 * sending the whole document. Like useTasksData, a failed poll
 * never blanks the screen: the last good state stays and only `connection`
 * flips to "offline". `cancelled`/`inFlight` are effect-local (not refs) for
 * the same StrictMode reason documented there. Each answer is merged into the
 * previous one with `shareUnchanged`, so every record that did not change keeps
 * its object identity (dialogs and memoised plans do not restart on a poll).
 */
export function usePmoData(): PmoData {
  const [state, setState] = useState<PmoState | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus>("loading");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    // Only sent once a full document has arrived, so "unchanged" always has something to apply to.
    let digest: string | null = null;
    let lastDuration = 0;
    const hidden = () => typeof document !== "undefined" && document.hidden;

    async function poll() {
      if (inFlight || cancelled) return;
      if (hidden()) return; // resumed by the visibilitychange listener below
      inFlight = true;
      const started = performance.now();
      try {
        const reply = await pollState(digest);
        if (cancelled) return;
        lastDuration = performance.now() - started;
        if (!reply.unchanged) digest = reply.digest;
        setState((prev) => mergePoll(prev, reply));
        setConnection("online");
      } catch {
        if (!cancelled) setConnection("offline");
      } finally {
        inFlight = false;
        if (!cancelled && !hidden()) {
          timerRef.current = setTimeout(poll, pollDelay(lastDuration));
        }
      }
    }

    pollRef.current = () => {
      if (cancelled) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      void poll();
    };
    const onVisible = () => {
      if (!document.hidden) pollRef.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    void poll();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const refetch = useCallback(() => pollRef.current(), []);

  return { state, connection, refetch };
}
