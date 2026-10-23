// Client for the app's own /api/pmo routes (same origin; local files only).
// Mirrors the repo convention: HTTP 200 with an { ok, reason? } envelope, so
// a business failure is a value here and only a network failure throws.
import type {
  PmoConfig,
  PmoConfigPatch,
  PmoState,
  RawRecord,
  Todo,
  TodoDraft,
} from "@/lib/pmo/types";
import type { TodoPatch } from "@/lib/pmo/todoLogic";

const BASE = "/api/pmo";
const TIMEOUT_MS = 15_000;

export type Reply<T extends object = object> =
  ({ ok: true } & T) | { ok: false; reason: string };

async function call<T extends object>(
  path: string,
  method: "GET" | "POST" | "PATCH" | "PUT" = "GET",
  body?: unknown,
): Promise<Reply<T>> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  try {
    return (await response.json()) as Reply<T>;
  } catch {
    return {
      ok: false,
      reason: `Unexpected reply from the app server (HTTP ${response.status}).`,
    };
  }
}

/** Throws when the server can't be reached or refuses (so the poller can show "offline"). */
export async function fetchState(): Promise<PmoState> {
  const reply = await call<PmoState>("/state");
  if (!reply.ok) throw new Error(reply.reason);
  return reply;
}

export const scanNow = () =>
  call<{
    report: { ingested: number; duplicates: number; filtered: number; rejected: number };
  }>("/ingest/scan", "POST");

export const approveProposal = (id: string, draft: TodoDraft) =>
  call<{ todo: Todo }>(`/queue/${id}/approve`, "POST", { draft });
export const rejectProposal = (id: string) => call(`/queue/${id}/reject`, "POST");
export const retryProposal = (id: string) => call(`/queue/${id}/retry`, "POST");
export const stageEdits = (id: string, draft: TodoDraft) =>
  call(`/queue/${id}`, "PATCH", { draft });

export const fetchRaw = (intakeId: string) =>
  call<{ record: RawRecord }>(`/raw/${intakeId}`);

export const createTodo = (draft: TodoDraft, proposalId?: string) =>
  call<{ todo: Todo }>("/todos", "POST", { draft, proposalId });
export const patchTodo = (id: string, patch: TodoPatch) =>
  call<{ todo: Todo; offerDone: boolean }>(`/todos/${id}`, "PATCH", patch);

export const updateConfig = (patch: PmoConfigPatch) =>
  call<{ config: PmoConfig }>("/config", "PUT", patch);
