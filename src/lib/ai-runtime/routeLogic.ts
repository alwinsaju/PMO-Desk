// The decisions behind the /api/ai/runtime/{log,load,unload} routes, kept out
// of the route files so `pnpm test` can run them without Next.
//
// Guard choice (see ARCHITECTURE.md): these routes use the same origin check as
// the /api/pmo routes (loopback Host, same-origin / no cross-site Origin or
// Sec-Fetch-Site), NOT the desktop-only header that /api/ai/runtime/stop needs.
// Stop kills a process and is only ever called by the Electron shell, which can
// set a custom header. Load and unload are reversible and only touch AI OS's own
// default model, and the button that calls them lives inside the app window,
// whose requests are ordinary same-origin fetches that carry no such header (and
// the same page works in a plain browser tab in dev). A web page on another
// site, or a DNS-rebinding page, is still refused by the origin check.
import { checkOrigin, type RequestFacts } from "../pmo/server/originCheck.ts";
import type { LoadResult, UnloadResult } from "./controls.ts";
import type { AiRuntimeLogResponse } from "./types.ts";

export interface RouteReply {
  status: number;
  body: Record<string, unknown>;
}

/** null = allowed. */
export function guard(facts: RequestFacts): RouteReply | null {
  const verdict = checkOrigin(facts);
  return verdict.ok ? null : { status: 403, body: { ok: false, reason: verdict.reason } };
}

export interface LogQuery {
  since: number;
  session?: string;
  serverLog: boolean;
}

/** Lenient on purpose: junk becomes "from the start", never an error. */
export function parseLogQuery(params: URLSearchParams): LogQuery {
  const since = Number(params.get("since"));
  const session = params.get("session")?.trim();
  return {
    since: Number.isInteger(since) && since > 0 ? since : 0,
    session: session && /^[a-z0-9]{1,40}$/i.test(session) ? session : undefined,
    serverLog: params.get("serverLog") === "1",
  };
}

export async function handleLog(
  facts: RequestFacts,
  params: URLSearchParams,
  read: (query: LogQuery) => Promise<AiRuntimeLogResponse>,
): Promise<RouteReply> {
  const refused = guard(facts);
  if (refused) return refused;
  try {
    return { status: 200, body: { ok: true, ...(await read(parseLogQuery(params))) } };
  } catch (error) {
    return {
      status: 200,
      body: {
        ok: false,
        reason: error instanceof Error ? error.message : "Unexpected error.",
      },
    };
  }
}

/** Load / unload: the guard, then the action; its { ok, ... } result is the body.
 *  HTTP 200 for every business outcome (this repo's envelope), 403 only for a
 *  refused origin. */
export async function handleAction(
  facts: RequestFacts,
  run: () => Promise<LoadResult | UnloadResult>,
): Promise<RouteReply> {
  const refused = guard(facts);
  if (refused) return refused;
  try {
    return { status: 200, body: { ...(await run()) } };
  } catch (error) {
    return {
      status: 200,
      body: {
        ok: false,
        reason: error instanceof Error ? error.message : "Unexpected error.",
      },
    };
  }
}
