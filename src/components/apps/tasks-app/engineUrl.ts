/**
 * Where the Tasks engine is listening. The engine takes a port picked at launch
 * (127.0.0.1 only), so the address is not a build-time constant: the launcher
 * hands it over when it starts (or finds) the engine, and any other caller
 * asks this server's /api/tasks-engine/config once and remembers the answer.
 * Cleared after a restart, which may land on a different port.
 */
const CONFIG_ROUTE = "/api/tasks-engine/config";
const CONFIG_TIMEOUT_MS = 5_000;
/** Used only when nothing is running yet; requests then fail as "can't reach". */
const FALLBACK_URL = "http://127.0.0.1:8000";

let known: string | null = null;

export function setEngineUrl(url: string): void {
  known = url;
}

export function resetEngineUrl(): void {
  known = null;
}

/** The engine's base URL. Never throws; a miss is not remembered. */
export async function getEngineUrl(): Promise<string> {
  if (known) return known;
  try {
    const res = await fetch(CONFIG_ROUTE, {
      cache: "no-store",
      signal: AbortSignal.timeout(CONFIG_TIMEOUT_MS),
    });
    const body = (await res.json()) as { url?: string | null };
    if (body.url) {
      known = body.url;
      return known;
    }
  } catch {
    // fall through: the caller's own request will report "can't reach the engine"
  }
  return FALLBACK_URL;
}
