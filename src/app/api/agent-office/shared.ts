// Shared helper for the two agent-office routes below (status/route.ts,
// start/route.ts). Not a route itself — Next.js's App Router only treats an
// exact `route.ts` filename as a route, so a plain module living alongside
// them is never exposed as an endpoint; it's just code both routes import.
import type { ChildProcess } from "node:child_process";
import { AGENT_OFFICE_API_URL } from "@/components/apps/tasks-app/api";

declare global {
  var aiOsDesktopBackend: ChildProcess | undefined;
}

/** Kept short — this is purely an "is anything answering on this port"
 *  probe, not a real request, so a slow/half-dead connection should fail
 *  fast rather than hang the caller (same reasoning as tasks-app/api.ts's
 *  own REQUEST_TIMEOUT_MS). */
const PROBE_TIMEOUT_MS = 1500;
const STOP_TIMEOUT_MS = 10_000;

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

export function registerDesktopBackend(child: ChildProcess): void {
  globalThis.aiOsDesktopBackend = child;
  child.once("exit", () => {
    if (globalThis.aiOsDesktopBackend === child) {
      globalThis.aiOsDesktopBackend = undefined;
    }
  });
}

export async function stopDesktopBackend(): Promise<boolean> {
  const child = globalThis.aiOsDesktopBackend;
  if (!child || child.exitCode !== null || child.killed) {
    return false;
  }

  await new Promise<void>((resolve, reject) => {
    const onExit = () => {
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(() => {
      child.removeListener("exit", onExit);
      reject(
        new Error(
          `The owned Agent Office backend did not stop within ${STOP_TIMEOUT_MS / 1000} seconds.`,
        ),
      );
    }, STOP_TIMEOUT_MS);

    child.once("exit", onExit);
    if (!child.kill()) {
      clearTimeout(timeout);
      child.removeListener("exit", onExit);
      reject(new Error("The owned Agent Office backend could not be terminated."));
    }
  });

  return true;
}
