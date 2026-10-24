"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PmoState } from "@/lib/pmo/types";
import { fetchState } from "./api";
import { shareUnchanged } from "./shareState";

const POLL_INTERVAL_MS = 3000;

export type ConnectionStatus = "loading" | "online" | "offline";

export interface PmoData {
  state: PmoState | null;
  connection: ConnectionStatus;
  /** Forces a poll now, e.g. right after an action, instead of waiting for the next tick. */
  refetch: () => void;
}

/**
 * Polls GET /api/pmo/state every 3s. Like useAgentOfficeData, a failed poll
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

    async function poll() {
      if (inFlight) return;
      inFlight = true;
      try {
        const next = await fetchState();
        if (cancelled) return;
        setState((prev) => (prev ? shareUnchanged(prev, next) : next));
        setConnection("online");
      } catch {
        if (!cancelled) setConnection("offline");
      } finally {
        inFlight = false;
        if (!cancelled) timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
      }
    }

    pollRef.current = () => {
      if (cancelled) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      void poll();
    };
    void poll();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const refetch = useCallback(() => pollRef.current(), []);

  return { state, connection, refetch };
}
