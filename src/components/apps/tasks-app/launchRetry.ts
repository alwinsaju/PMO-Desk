/**
 * Retry policy for the first "start the Tasks engine" request. In live-dev the
 * route is compiled on first use, so the very first POST can answer 404/502/503
 * (or not at all) while the engine is already fine; a real failure reported by
 * the route (no Python, engine crashed, ...) is never retried. Pure: fetch,
 * sleep and clock are injected.
 */

export type StartFetch = (
  input: string,
  init: { method: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export type LaunchOutcome =
  | { status: "ready"; url: string }
  | { status: "failed"; reason: string }
  | { status: "aborted" };

export interface LaunchRetryInfo {
  attempt: number;
  elapsedMs: number;
  /** Why the last attempt did not count, e.g. "HTTP 404". */
  detail: string;
}

export interface LaunchDeps {
  fetchImpl: StartFetch;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  now: () => number;
  signal: AbortSignal;
  onRetry?: (info: LaunchRetryInfo) => void;
  budgetMs?: number;
  delaysMs?: readonly number[];
  requestTimeoutMs?: number;
}

export const LAUNCH_BUDGET_MS = 12_000;
/** The last delay repeats until the budget is used up. */
export const RETRY_DELAYS_MS: readonly number[] = [500, 1_000, 2_000, 3_000];
/** The route itself waits up to ~20 s for a cold engine; this only guards a hung request. */
export const REQUEST_TIMEOUT_MS = 30_000;

const START_ROUTE = "/api/tasks-engine/start";
const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([404, 502, 503]);

type AttemptResult =
  | { kind: "ready"; url: string }
  | { kind: "definitive"; reason: string }
  | { kind: "transient"; detail: string };

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

async function readReply(res: Awaited<ReturnType<StartFetch>>): Promise<AttemptResult> {
  if (TRANSIENT_STATUSES.has(res.status)) {
    return { kind: "transient", detail: `HTTP ${res.status}` };
  }
  let body: { ok?: unknown; url?: unknown; reason?: unknown };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    return { kind: "transient", detail: `HTTP ${res.status}, unreadable reply` };
  }
  if (body.ok === true) {
    return isHttpUrl(body.url)
      ? { kind: "ready", url: body.url }
      : {
          kind: "definitive",
          reason: "The launcher did not say where the engine listens.",
        };
  }
  const reason = typeof body.reason === "string" && body.reason ? body.reason : null;
  return { kind: "definitive", reason: reason ?? "The engine failed to start." };
}

async function attemptOnce({
  fetchImpl,
  signal,
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
}: LaunchDeps): Promise<AttemptResult | "aborted"> {
  try {
    const res = await fetchImpl(START_ROUTE, {
      method: "POST",
      signal: AbortSignal.any([signal, AbortSignal.timeout(requestTimeoutMs)]),
    });
    const result = await readReply(res);
    return signal.aborted ? "aborted" : result;
  } catch {
    return signal.aborted ? "aborted" : { kind: "transient", detail: "no response" };
  }
}

export async function runEngineLaunch(deps: LaunchDeps): Promise<LaunchOutcome> {
  const {
    sleep,
    now,
    signal,
    onRetry,
    budgetMs = LAUNCH_BUDGET_MS,
    delaysMs = RETRY_DELAYS_MS,
  } = deps;
  const startedAt = now();
  for (let attempt = 1; ; attempt++) {
    if (signal.aborted) return { status: "aborted" };
    const result = await attemptOnce(deps);
    if (result === "aborted") return { status: "aborted" };
    if (result.kind === "ready") return { status: "ready", url: result.url };
    if (result.kind === "definitive") return { status: "failed", reason: result.reason };

    const elapsedMs = now() - startedAt;
    if (elapsedMs >= budgetMs) {
      const seconds = Math.round(elapsedMs / 1000);
      return {
        status: "failed",
        reason: `The engine did not answer after ${seconds} s (${result.detail}).`,
      };
    }
    onRetry?.({ attempt, elapsedMs, detail: result.detail });
    const delay = Math.min(
      delaysMs[Math.min(attempt - 1, delaysMs.length - 1)] ?? 0,
      budgetMs - elapsedMs,
    );
    await sleep(delay, signal);
  }
}

/** Resolves after `ms`, or immediately once `signal` aborts. */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done);
  });
}
