// Browser side of the engine token (see engineAuth.ts): the Tasks app calls the
// engine directly, and the engine refuses requests without X-AI-OS-Token. The
// token comes from this app's own /api/tasks-engine/token route, once, and is
// refetched once when the engine answers 403 (the server may have restarted).
import { ENGINE_TOKEN_HEADER } from "./engineHeader.ts";

const TOKEN_ROUTE = "/api/tasks-engine/token";
const TOKEN_TIMEOUT_MS = 5_000;

/** undefined = not fetched yet; null = the server says the engine wants no token. */
let cached: string | null | undefined;
let pending: Promise<string | null | undefined> | null = null;

/** Pins the answer (tests, or a caller that already has it). */
export function setEngineToken(token: string | null | undefined): void {
  cached = token;
}

async function fetchToken(): Promise<string | null | undefined> {
  try {
    const res = await fetch(TOKEN_ROUTE, {
      cache: "no-store",
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { ok?: boolean; token?: string | null };
    if (body.ok !== true) return undefined;
    return typeof body.token === "string" && body.token ? body.token : null;
  } catch {
    return undefined; // a miss is not remembered; the engine call reports its own failure
  }
}

/** The engine token, or null when none is needed / available. Never throws. */
export async function getEngineToken(refresh = false): Promise<string | null> {
  if (!refresh && cached !== undefined) return cached;
  pending ??= fetchToken().finally(() => {
    pending = null;
  });
  const fetched = await pending;
  if (fetched !== undefined) cached = fetched;
  return fetched ?? null;
}

function withToken(init: RequestInit, token: string | null): RequestInit {
  if (!token) return init;
  const headers = new Headers(init.headers);
  headers.set(ENGINE_TOKEN_HEADER, token);
  return { ...init, headers };
}

/** fetch() to the engine with the token attached; retries once on 403 with a fresh token. */
export async function engineFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await getEngineToken();
  const res = await fetch(url, withToken(init, token));
  if (res.status !== 403) return res;
  const fresh = await getEngineToken(true);
  if (fresh === token) return res;
  return fetch(url, withToken(init, fresh));
}
