// "Restart Tasks engine" logic for the settings menu, kept free of React and of any
// global fetch so `pnpm test` can drive it against a FAKE fetch.
//
// SAFETY: the Tasks engine is live production (real Outlook sends).
// This module only ever
//   - READS  GET  <engine>/tasks            (is anything running?)
//   - CALLS  POST /api/tasks-engine/stop     (this app's own launcher routes)
//            POST /api/tasks-engine/start
// It never calls a engine action endpoint (start/approve/send/reset/rescan).

import { ENGINE_TOKEN_HEADER } from "./tasks-engine/engineHeader.ts";
import { getEngineToken } from "./tasks-engine/engineClient.ts";

/** Window event fired after a successful restart so the Tasks app can poll at
 *  once instead of waiting for its next tick. */
export const ENGINE_RESTARTED_EVENT = "ai-os:engine-restarted";

export interface TaskLike {
  id?: string;
  displayName?: string;
  name?: string;
  state?: string;
}

export type FetchLike = (
  input: string,
  init?: { method?: string; signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** A task that is not "resting": a run in progress, waiting on the user, or
 *  errored. Restarting the engine forgets all of them. */
export interface BusyTask {
  label: string;
  state: string;
}

export type EngineProbe = { reachable: false } | { reachable: true; busy: BusyTask[] };

/** Read-only GET /tasks. `reachable: false` when nothing answers. */
export async function probeEngine(
  fetchImpl: FetchLike,
  apiUrl: string,
  timeoutMs = 3_000,
  tokenProvider: () => Promise<string | null> = getEngineToken,
): Promise<EngineProbe> {
  try {
    const token = await tokenProvider();
    const res = await fetchImpl(`${apiUrl}/tasks`, {
      signal: AbortSignal.timeout(timeoutMs),
      ...(token ? { headers: { [ENGINE_TOKEN_HEADER]: token } } : {}),
    });
    if (!res.ok) return { reachable: false };
    return { reachable: true, busy: busyTasks(await res.json()) };
  } catch {
    return { reachable: false };
  }
}

export function busyTasks(payload: unknown): BusyTask[] {
  if (!Array.isArray(payload)) return [];
  const busy: BusyTask[] = [];
  for (const raw of payload as TaskLike[]) {
    if (!raw || typeof raw !== "object" || !raw.state || raw.state === "resting")
      continue;
    busy.push({
      label: raw.displayName || raw.name || raw.id || "Unnamed task",
      state: raw.state,
    });
  }
  return busy;
}

export type RestartPhase = "stopping" | "starting";

export type RestartOutcome =
  | { ok: true; kind: "restarted" | "started"; message: string }
  | {
      ok: false;
      kind: "not-desktop" | "not-owned" | "stop-failed" | "start-failed";
      message: string;
    };

export interface RestartOptions {
  fetchImpl: FetchLike;
  apiUrl: string;
  onPhase?: (phase: RestartPhase) => void;
  /** How long to wait for the stopped engine to stop answering. */
  stopSettleMs?: number;
  /** Outer bound for the start request (the route has its own ~20 s limit). */
  startTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Restarts the engine this AI OS instance launched:
 *   1. POST /api/tasks-engine/stop  (kills only a engine this app started),
 *   2. wait until the old one stops answering,
 *   3. POST /api/tasks-engine/start (waits until the new one answers).
 *
 * Edge cases: outside the desktop app the stop route answers 409; a engine
 * someone else started (terminal, an earlier session) is never touched, and
 * is reported; a engine that is simply down is just started.
 */
export async function restartEngine({
  fetchImpl,
  apiUrl,
  onPhase,
  stopSettleMs = 10_000,
  startTimeoutMs = 30_000,
  sleep = defaultSleep,
}: RestartOptions): Promise<RestartOutcome> {
  onPhase?.("stopping");

  let stopped = false;
  try {
    const res = await fetchImpl("/api/tasks-engine/stop", {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 409) {
      return {
        ok: false,
        kind: "not-desktop",
        message: "Restarting the engine only works in the AI OS desktop app.",
      };
    }
    const body = (await res.json()) as {
      ok?: boolean;
      stopped?: boolean;
      reason?: string;
    };
    if (!res.ok || body.ok === false) {
      return {
        ok: false,
        kind: "stop-failed",
        message: body.reason ?? `Stop request failed (${res.status}).`,
      };
    }
    stopped = body.stopped === true;
  } catch (error) {
    return {
      ok: false,
      kind: "stop-failed",
      message: `Could not stop the engine: ${describeError(error)}`,
    };
  }

  if (!stopped) {
    // Nothing of ours to stop. Either the engine is down (just start it) or
    // somebody else owns it (leave it alone).
    if ((await probeEngine(fetchImpl, apiUrl)).reachable) {
      return {
        ok: false,
        kind: "not-owned",
        message:
          "The engine was started outside AI OS (for example from a terminal), so it can't be restarted from here. Close that process and restart again.",
      };
    }
  } else {
    const deadline = Date.now() + stopSettleMs;
    while ((await probeEngine(fetchImpl, apiUrl, 1_000)).reachable) {
      if (Date.now() >= deadline) {
        return {
          ok: false,
          kind: "stop-failed",
          message: "The engine was told to stop but is still answering on its port.",
        };
      }
      await sleep(300);
    }
  }

  onPhase?.("starting");
  try {
    const res = await fetchImpl("/api/tasks-engine/start", {
      method: "POST",
      signal: AbortSignal.timeout(startTimeoutMs),
    });
    const body = (await res.json()) as { ok?: boolean; reason?: string };
    if (!body.ok) {
      return {
        ok: false,
        kind: "start-failed",
        message: body.reason ?? "The engine failed to start.",
      };
    }
  } catch (error) {
    return {
      ok: false,
      kind: "start-failed",
      message: `Could not start the engine: ${describeError(error)}`,
    };
  }

  return stopped
    ? { ok: true, kind: "restarted", message: "Engine restarted" }
    : { ok: true, kind: "started", message: "Engine was not running; started it" };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
