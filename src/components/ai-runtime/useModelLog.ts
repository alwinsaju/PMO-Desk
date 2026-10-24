"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AiLogEvent } from "@/lib/ai-runtime/log";
import type { AiRuntimeStatus } from "@/lib/ai-runtime/types";
import type { ServerLogTail } from "@/lib/ai-runtime/serverLog";
import { fetchModelLog } from "./api";

const POLL_MS = 2000;
/** Same as the server's ring buffer. */
const KEEP_EVENTS = 1000;

export interface ModelLogData {
  /** null until the first answer. */
  session: string | null;
  sessionStartedAt: number | null;
  events: AiLogEvent[];
  status: AiRuntimeStatus | null;
  serverLog: ServerLogTail | null;
  /** server clock minus this browser's clock, for the unload countdown. */
  skewMs: number;
}

const EMPTY: ModelLogData = {
  session: null,
  sessionStartedAt: null,
  events: [],
  status: null,
  serverLog: null,
  skewMs: 0,
};

/**
 * Polls GET /api/ai/runtime/log every ~2 s, ONLY while `active` (the dialog is
 * open) and the tab is visible, and only asks for events newer than the ones it
 * has. Unchanged answers keep their object identity so nothing re-renders (and
 * no scroll position moves) when the model is idle. The route never loads the
 * model; polling cannot wake it.
 */
export function useModelLog(active: boolean, wantServerLog: boolean) {
  const [data, setData] = useState<ModelLogData>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const dataRef = useRef(data);
  const wantRef = useRef(wantServerLog);
  const pollRef = useRef<() => void>(() => {});

  useEffect(() => {
    wantRef.current = wantServerLog;
    if (active && wantServerLog) pollRef.current();
  }, [active, wantServerLog]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (cancelled) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(poll, POLL_MS);
    };

    async function poll() {
      if (cancelled || inFlight) return;
      // A hidden tab does not poll; becoming visible polls at once.
      if (document.visibilityState === "hidden") {
        schedule();
        return;
      }
      inFlight = true;
      try {
        const prev = dataRef.current;
        const reply = await fetchModelLog({
          since: prev.events.at(-1)?.seq ?? 0,
          session: prev.session,
          serverLog: wantRef.current,
        });
        if (cancelled) return;
        if (!reply.ok) {
          setError(reply.reason);
        } else {
          setError(null);
          const next = merge(dataRef.current, reply);
          if (next !== dataRef.current) {
            dataRef.current = next;
            setData(next);
          }
        }
      } catch {
        if (!cancelled) setError("Could not reach the app server.");
      } finally {
        inFlight = false;
        schedule();
      }
    }

    pollRef.current = () => {
      if (timer) clearTimeout(timer);
      void poll();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") pollRef.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      pollRef.current = () => {};
    };
  }, [active]);

  const refresh = useCallback(() => pollRef.current(), []);
  return { data, error, refresh };
}

function merge(
  prev: ModelLogData,
  reply: Extract<Awaited<ReturnType<typeof fetchModelLog>>, { ok: true }>,
): ModelLogData {
  const fresh = reply.reset || prev.session !== reply.session;
  const events = fresh
    ? reply.events
    : reply.events.length > 0
      ? [...prev.events, ...reply.events].slice(-KEEP_EVENTS)
      : prev.events;
  const status = same(prev.status, reply.status) ? prev.status : reply.status;
  const serverLog =
    reply.serverLog === undefined
      ? prev.serverLog
      : same(prev.serverLog, reply.serverLog)
        ? prev.serverLog
        : reply.serverLog;
  const skewMs = reply.now - Date.now();
  if (
    !fresh &&
    events === prev.events &&
    status === prev.status &&
    serverLog === prev.serverLog &&
    Math.abs(skewMs - prev.skewMs) < 1500
  ) {
    return prev;
  }
  return {
    session: reply.session,
    sessionStartedAt: reply.sessionStartedAt,
    events,
    status,
    serverLog,
    // The skew is noise at the second level; keep the first estimate unless it moved a lot.
    skewMs: Math.abs(skewMs - prev.skewMs) < 1500 ? prev.skewMs : skewMs,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
