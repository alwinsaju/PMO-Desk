// Client for the app's own /api/registers routes (same origin, local files only). A failure is
// a value with a plain reason, never a throw.
import { explainError } from "@/lib/platform/friendlyError";
import type { RegisterSummary } from "@/lib/registers/alerts";
import type { FieldValue, RegisterRecord } from "@/lib/registers/types";

export type RegisterReply<T extends object = object> =
  ({ ok: true } & T) | { ok: false; reason: string; detail?: string };

export interface RegisterData {
  items: RegisterRecord[];
  config: Record<string, FieldValue>;
}

export interface RecordInput {
  id?: string;
  values: Record<string, FieldValue>;
  todoId?: string;
}

async function call<T extends object>(
  path: string,
  init?: RequestInit,
): Promise<RegisterReply<T>> {
  try {
    const res = await fetch(`/api/registers/${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
      ...init,
    });
    const body = (await res.json().catch(() => null)) as RegisterReply<T> | null;
    if (body && body.ok === false) {
      return { ...body, detail: `HTTP ${res.status} ${path}: ${body.reason}` };
    }
    if (body) return body;
    const plain = explainError("", { status: res.status });
    return { ok: false, reason: plain.message, detail: `HTTP ${res.status} ${path}` };
  } catch (error) {
    const plain = explainError(error);
    return { ok: false, reason: plain.message, detail: `${path}: ${plain.detail}` };
  }
}

export const fetchRegister = (id: string) => call<RegisterData>(id);

export const changeRegister = (
  id: string,
  changes: {
    upsert?: RecordInput[];
    remove?: string[];
    config?: Record<string, FieldValue>;
  },
) =>
  call<RegisterData>(id, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  });

export const fetchSummaries = () => call<{ summaries: RegisterSummary[] }>("summary");
