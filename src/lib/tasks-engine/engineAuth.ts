// Server-only: the per-process secret and identity of the Tasks engine this
// Next server launches. Next bundles each route separately, so a module-level
// variable would differ per route; globalThis is the one store they share.
//
// - token:    sent by every caller in X-AI-OS-Token; the engine refuses requests
//             without it, so a web page cannot drive its approve/send gates.
// - instance: echoed by the engine's GET /health; the desktop app adopts only
//             an engine that reports this id (never a foreign one on the same port).
import { randomBytes } from "node:crypto";
import { checkOrigin, factsFromRequest } from "../pmo/server/originCheck.ts";
import { ENGINE_TOKEN_HEADER } from "./engineHeader.ts";

export { ENGINE_TOKEN_HEADER };

interface EngineAuth {
  token: string;
  instance: string;
}

declare global {
  var aiOsEngineAuth: EngineAuth | undefined;
}

/** AI_OS_ENGINE_TOKEN pins the token (for an engine started by hand); otherwise it is random. */
export function getEngineAuth(): EngineAuth {
  globalThis.aiOsEngineAuth ??= {
    token: process.env.AI_OS_ENGINE_TOKEN?.trim() || randomBytes(32).toString("hex"),
    instance: randomBytes(16).toString("hex"),
  };
  return globalThis.aiOsEngineAuth;
}

/** Headers every server-to-engine call must carry. */
export function engineAuthHeaders(): Record<string, string> {
  return { [ENGINE_TOKEN_HEADER]: getEngineAuth().token };
}

/**
 * What GET /api/tasks-engine/token answers. Refused unless the page is this app
 * itself (loopback Host, same origin or no Origin, not a cross-site request).
 * `token: null` = an engine started by hand (AI_OS_TASKS_ENGINE_URL) with no
 * AI_OS_ENGINE_TOKEN agreed with this server, which expects no token.
 */
export function clientTokenReply(request: Request): {
  status: number;
  body: { ok: true; token: string | null } | { ok: false; reason: string };
} {
  const verdict = checkOrigin(factsFromRequest(request));
  if (!verdict.ok) return { status: 403, body: { ok: false, reason: verdict.reason } };
  const external =
    Boolean(process.env.AI_OS_TASKS_ENGINE_URL?.trim()) &&
    !process.env.AI_OS_ENGINE_TOKEN?.trim();
  return { status: 200, body: { ok: true, token: external ? null : getEngineAuth().token } };
}
