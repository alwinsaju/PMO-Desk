// Shared helper for the two agent-office routes below (status/route.ts,
// start/route.ts). Not a route itself — Next.js's App Router only treats an
// exact `route.ts` filename as a route, so a plain module living alongside
// them is never exposed as an endpoint; it's just code both routes import.
import { AGENT_OFFICE_API_URL } from "@/components/apps/tasks-app/api";

/** Kept short — this is purely an "is anything answering on this port"
 *  probe, not a real request, so a slow/half-dead connection should fail
 *  fast rather than hang the caller (same reasoning as tasks-app/api.ts's
 *  own REQUEST_TIMEOUT_MS). */
const PROBE_TIMEOUT_MS = 1500;

/**
 * True when the agent-office FastAPI backend answers GET /tasks — the same
 * cheap, already-existing endpoint the Tasks app's own polling hook uses
 * (see tasks-app/api.ts's fetchTasks/AGENT_OFFICE_API_URL). Defined once
 * here so "is it up" means exactly the same thing everywhere it's checked:
 * the status route reports it directly, and the start route uses it both
 * to avoid spawning a duplicate process and to know when a freshly spawned
 * one has finished booting.
 */
export async function isBackendRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${AGENT_OFFICE_API_URL}/tasks`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}
