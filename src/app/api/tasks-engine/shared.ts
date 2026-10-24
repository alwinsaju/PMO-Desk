// Shared helper for the two tasks-engine routes below (status/route.ts,
// start/route.ts). Not a route itself — Next.js's App Router only treats an
// exact `route.ts` filename as a route, so a plain module living alongside
// them is never exposed as an endpoint; it's just code both routes import.
import { spawnSync, type ChildProcess } from "node:child_process";
import { TASKS_ENGINE_URL } from "@/components/apps/tasks-app/api";

declare global {
  var aiOsDesktopEngine: ChildProcess | undefined;
}

/** Kept short — this is purely an "is anything answering on this port"
 *  probe, not a real request, so a slow/half-dead connection should fail
 *  fast rather than hang the caller (same reasoning as tasks-app/api.ts's
 *  own REQUEST_TIMEOUT_MS). */
const PROBE_TIMEOUT_MS = 1500;
const STOP_TIMEOUT_MS = 10_000;

/**
 * True when the Tasks engine answers GET /tasks — the same
 * cheap, already-existing endpoint the Tasks app's own polling hook uses
 * (see tasks-app/api.ts's fetchTasks/TASKS_ENGINE_URL). Defined once
 * here so "is it up" means exactly the same thing everywhere it's checked:
 * the status route reports it directly, and the start route uses it both
 * to avoid spawning a duplicate process and to know when a freshly spawned
 * one has finished booting.
 */
export async function isEngineRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${TASKS_ENGINE_URL}/tasks`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function registerDesktopEngine(child: ChildProcess): void {
  globalThis.aiOsDesktopEngine = child;
  child.once("exit", () => {
    if (globalThis.aiOsDesktopEngine === child) {
      globalThis.aiOsDesktopEngine = undefined;
    }
  });
}

export async function stopDesktopEngine(): Promise<boolean> {
  const child = globalThis.aiOsDesktopEngine;
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
          `The owned Tasks engine did not stop within ${STOP_TIMEOUT_MS / 1000} seconds.`,
        ),
      );
    }, STOP_TIMEOUT_MS);

    child.once("exit", onExit);
    if (!terminateProcessTree(child)) {
      clearTimeout(timeout);
      child.removeListener("exit", onExit);
      reject(new Error("The owned Tasks engine could not be terminated."));
    }
  });

  return true;
}

/**
 * Stops the engine and everything it started. On Windows the venv's
 * `pythonw.exe` can be a launcher that relays to the real interpreter, so a
 * plain `child.kill()` could leave uvicorn running and holding the port;
 * `taskkill /T /F` takes the whole tree. Elsewhere a normal kill is enough.
 */
function terminateProcessTree(child: ChildProcess): boolean {
  if (process.platform === "win32" && child.pid) {
    const result = spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
      shell: false,
      timeout: 5_000,
    });
    if (result.status === 0) return true;
  }
  return child.kill();
}
