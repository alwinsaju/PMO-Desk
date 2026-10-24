"use client";

import { useSyncExternalStore } from "react";
import { AGENT_OFFICE_API_URL } from "@/components/apps/tasks-app/api";
import {
  BACKEND_RESTARTED_EVENT,
  probeBackend,
  restartBackend,
  type BusyTask,
  type RestartPhase,
} from "@/lib/backendRestart";

/**
 * State for the settings menu's "Restart backend" row. It lives in a small
 * module-level store (not component state) because the menu unmounts its
 * rows when it closes, and a restart that is already running must not be
 * forgotten (or started twice) just because the menu was closed and reopened.
 */
export type BackendRestartStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "confirm"; busy: BusyTask[] }
  | { kind: "working"; phase: RestartPhase }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

const DONE_VISIBLE_MS = 6_000;

let status: BackendRestartStatus = { kind: "idle" };
const listeners = new Set<() => void>();

function setStatus(next: BackendRestartStatus) {
  status = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const browserFetch = (...args: Parameters<typeof fetch>) => fetch(...args);

/** Step 1: look (read-only) at what the backend is doing, and ask for
 *  confirmation if any task is not idle. */
async function requestRestart() {
  if (status.kind === "checking" || status.kind === "working") return;
  setStatus({ kind: "checking" });
  const probe = await probeBackend(browserFetch, AGENT_OFFICE_API_URL);
  if (probe.reachable && probe.busy.length > 0) {
    setStatus({ kind: "confirm", busy: probe.busy });
    return;
  }
  await runRestart();
}

/** Step 2: stop and start through this app's own launcher routes. */
async function runRestart() {
  if (status.kind === "working") return;
  setStatus({ kind: "working", phase: "stopping" });
  const outcome = await restartBackend({
    fetchImpl: browserFetch,
    apiUrl: AGENT_OFFICE_API_URL,
    onPhase: (phase) => setStatus({ kind: "working", phase }),
  });

  if (!outcome.ok) {
    setStatus({ kind: "error", message: outcome.message });
    return;
  }

  window.dispatchEvent(new Event(BACKEND_RESTARTED_EVENT));
  const done: BackendRestartStatus = { kind: "done", message: outcome.message };
  setStatus(done);
  setTimeout(() => {
    if (status === done) setStatus({ kind: "idle" });
  }, DONE_VISIBLE_MS);
}

function cancelRestart() {
  if (status.kind === "confirm") setStatus({ kind: "idle" });
}

export function useBackendRestart() {
  const current = useSyncExternalStore(
    subscribe,
    () => status,
    () => status,
  );
  return {
    status: current,
    requestRestart: () => void requestRestart(),
    confirmRestart: () => void runRestart(),
    cancelRestart,
  };
}
