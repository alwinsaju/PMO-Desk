/** The banner's "Restart Tasks engine" request: POST the existing start route. */

export type StartFetch = (
  input: string,
  init: { method: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export type EngineStartOutcome =
  { ok: true; url?: string } | { ok: false; message: string };

/** Outer bound on top of the route's own ~20 s wait. */
const START_TIMEOUT_MS = 30_000;

/** Starts the engine (no-op when it is already up) and returns where it listens. */
export async function requestEngineStart(
  fetchImpl: StartFetch,
): Promise<EngineStartOutcome> {
  try {
    const res = await fetchImpl("/api/tasks-engine/start", {
      method: "POST",
      signal: AbortSignal.timeout(START_TIMEOUT_MS),
    });
    const body = (await res.json()) as { ok?: boolean; url?: string; reason?: string };
    if (body.ok) return { ok: true, url: body.url };
    return { ok: false, message: body.reason ?? "The Tasks engine didn’t start." };
  } catch {
    return { ok: false, message: "Couldn’t reach the Tasks app’s launcher." };
  }
}
