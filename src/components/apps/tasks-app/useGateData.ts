"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getDiff, getFlags, getForm } from "./api";
import { activeGate, type PanelGate } from "./taskPresenter";
import type { FlagsFile, FormPayload, RosterDiff, Task } from "./types";

export type GateStatus = "idle" | "loading" | "ready" | "unavailable";

export interface GateData {
  /** The panel gate the task is waiting at right now (null = none). */
  gate: PanelGate | null;
  status: GateStatus;
  /** Why the gate's data couldn't be read (an older engine without the
   *  route, a missing file, an unreachable engine). */
  error: string | null;
  form: FormPayload | null;
  diff: RosterDiff | null;
  flags: FlagsFile | null;
  refetch: () => void;
}

interface Loaded {
  key: string;
  status: GateStatus;
  error: string | null;
  form: FormPayload | null;
  diff: RosterDiff | null;
  flags: FlagsFile | null;
}

const IDLE: Loaded = {
  key: "",
  status: "idle",
  error: null,
  form: null,
  diff: null,
  flags: null,
};

// A tiny pub/sub so a card's gate summary refreshes right after the detail
// dialog saves answers (or an approve/send settles) without lifting the
// gate data into the polling hook — gate files only change on a human action.
type Listener = (taskId: string) => void;
const listeners = new Set<Listener>();

/** Tells every `useGateData` for `taskId` to re-read its gate files. */
export function notifyGateChanged(taskId: string): void {
  listeners.forEach((listener) => listener(taskId));
}

/**
 * Reads the data behind the gate a task is waiting at (form schema +
 * pending ids, flags, or the roster diff) — once when the gate is entered,
 * and again on `refetch()` / `notifyGateChanged`. Read-only GETs; nothing
 * here mutates. A route the running engine doesn't have yet degrades to
 * `status: "unavailable"` with the reason, never an exception.
 */
export function useGateData(task: Task | null): GateData {
  const gate = task ? activeGate(task) : null;
  const taskId = task?.id ?? "";
  const step = task?.currentStep ?? null;
  const key = gate ? `${taskId}|${gate}|${step}` : "";
  const [loaded, setLoaded] = useState<Loaded>(IDLE);
  const [nonce, setNonce] = useState(0);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    const listener: Listener = (id) => {
      if (id === taskId) refetch();
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [taskId, refetch]);

  useEffect(() => {
    if (!gate) {
      setLoaded(IDLE);
      return;
    }
    let cancelled = false;
    // Keep what's on screen across a refetch of the SAME gate; only a new
    // gate (different key) starts from empty.
    setLoaded((prev) => (prev.key === key ? prev : { ...IDLE, key, status: "loading" }));

    async function load() {
      const unavailable = (reason?: string): Loaded => ({
        ...IDLE,
        key,
        status: "unavailable",
        error: reason ?? "The engine couldn't provide this gate's data.",
      });
      let next: Loaded;
      if (gate === "form") {
        const reply = await getForm(taskId);
        next =
          reply.ok && reply.schema
            ? {
                ...IDLE,
                key,
                status: "ready",
                form: {
                  schema: reply.schema,
                  answers: reply.answers ?? {},
                  pending: reply.pending ?? [],
                },
              }
            : unavailable(reply.reason);
      } else if (gate === "flags") {
        const reply = await getFlags(taskId);
        next = reply.ok
          ? { ...IDLE, key, status: "ready", flags: reply.flags ?? null }
          : unavailable(reply.reason);
      } else {
        const reply = await getDiff(taskId);
        next = reply.ok
          ? { ...IDLE, key, status: "ready", diff: reply.diff ?? null }
          : unavailable(reply.reason);
      }
      // A failed REfetch keeps the last good data on screen.
      if (!cancelled) {
        setLoaded((prev) =>
          next.status === "unavailable" && prev.key === key && prev.status === "ready"
            ? prev
            : next,
        );
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [taskId, gate, key, nonce]);

  // Data from a previous gate must never leak into a new one for a render.
  const current = loaded.key === key ? loaded : IDLE;
  const status: GateStatus = gate
    ? current.key === key
      ? current.status
      : "loading"
    : "idle";
  // Memoized so memo()'d panels/rows that receive `gate` skip re-rendering
  // when a parent re-renders (poll tick, tab switch) without the data changing.
  return useMemo(
    () => ({
      gate,
      status,
      error: current.error,
      form: current.form,
      diff: current.diff,
      flags: current.flags,
      refetch,
    }),
    [gate, status, current.error, current.form, current.diff, current.flags, refetch],
  );
}
