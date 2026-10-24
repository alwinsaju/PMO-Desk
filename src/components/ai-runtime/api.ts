// Client for the model log's three routes (same origin; see
// src/lib/ai-runtime/routeLogic.ts). HTTP 200 with an { ok, reason? } envelope for
// every business outcome; only a network failure throws.
import type { AiRuntimeLogResponse } from "@/lib/ai-runtime/types";

const BASE = "/api/ai/runtime";
const TIMEOUT_MS = 10_000;

export type LogReply =
  ({ ok: true } & AiRuntimeLogResponse) | { ok: false; reason: string };
export type ActionReply = { ok: true; state: string } | { ok: false; reason: string };

async function readJson<T>(
  response: Response,
): Promise<T | { ok: false; reason: string }> {
  try {
    return (await response.json()) as T;
  } catch {
    return {
      ok: false,
      reason: `Unexpected reply from the app server (HTTP ${response.status}).`,
    };
  }
}

/** The events after `since` (this session's, if `session` still matches), a
 *  status snapshot, and optionally the tail of Ollama's own server log. Never
 *  loads the model. */
export async function fetchModelLog(query: {
  since: number;
  session: string | null;
  serverLog: boolean;
}): Promise<LogReply> {
  const params = new URLSearchParams({ since: String(query.since) });
  if (query.session) params.set("session", query.session);
  if (query.serverLog) params.set("serverLog", "1");
  const response = await fetch(`${BASE}/log?${params}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return readJson<LogReply>(response);
}

async function post(route: "load" | "unload"): Promise<ActionReply> {
  const response = await fetch(`${BASE}/${route}`, {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS * 2),
  });
  return readJson<ActionReply>(response);
}

/** "Load now": wakes the model in the background; the log shows the progress. */
export const loadModel = () => post("load");
/** "Unload now": frees the model's memory (refused while it is working). */
export const unloadModel = () => post("unload");
