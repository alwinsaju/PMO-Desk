// Shared helper for the Tasks engine routes (status, config, start, stop). Not
// a route itself — Next.js's App Router only treats an exact `route.ts`
// filename as a route, so a plain module living alongside them is never
// exposed as an endpoint; it's just code the routes import.
//
// The engine listens on 127.0.0.1 on a port picked at launch (the first free
// one from ENGINE_PORT_START), so nothing here assumes a fixed port: the URL is
// either handed over by AI_OS_TASKS_ENGINE_URL (an engine started by hand), or
// remembered from this server's own launch, or found by asking each port in the
// range whether a Tasks engine answers there.
import net from "node:net";
import { spawnSync, type ChildProcess } from "node:child_process";

declare global {
  var aiOsDesktopEngine: ChildProcess | undefined;
  var aiOsTasksEngineUrl: string | undefined;
}

export const ENGINE_HOST = "127.0.0.1";
const ENGINE_PORT_START = 8000;
const ENGINE_PORT_SPAN = 20;

/** Kept short — this is purely an "is a Tasks engine answering here" probe,
 *  not a real request, so a slow/half-dead connection should fail fast rather
 *  than hang the caller. */
const PROBE_TIMEOUT_MS = 800;
const STOP_TIMEOUT_MS = 10_000;

export const engineUrlFor = (port: number) => `http://${ENGINE_HOST}:${port}`;

/** An engine started by hand (or by a launcher outside this server). */
function configuredUrl(): string | null {
  const value = process.env.AI_OS_TASKS_ENGINE_URL?.trim();
  return value ? value.replace(/\/+$/, "") : null;
}

/**
 * True when a Tasks engine answers GET /health at `url`. The identity check
 * matters: any other local process (or an older service from before the
 * engine moved into this repo) may hold a port in the range and answer `/tasks`.
 */
export async function isTasksEngine(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { service?: string };
    return body.service === "tasks-engine";
  } catch {
    return false;
  }
}

/**
 * URL of the running Tasks engine, or null. Order: the configured URL (when
 * set it is the only answer), the one this server launched or found before,
 * then a scan of the port range. A found engine is remembered.
 */
export async function findRunningEngine(): Promise<string | null> {
  const configured = configuredUrl();
  if (configured) return (await isTasksEngine(configured)) ? configured : null;

  const remembered = globalThis.aiOsTasksEngineUrl;
  if (remembered && (await isTasksEngine(remembered))) return remembered;

  const urls = Array.from({ length: ENGINE_PORT_SPAN }, (_, i) =>
    engineUrlFor(ENGINE_PORT_START + i),
  );
  const answers = await Promise.all(urls.map((url) => isTasksEngine(url)));
  const found = urls.find((_, i) => answers[i]) ?? null;
  globalThis.aiOsTasksEngineUrl = found ?? undefined;
  return found;
}

export function rememberEngineUrl(url: string): void {
  globalThis.aiOsTasksEngineUrl = url;
}

export const hasConfiguredEngine = () => configuredUrl() !== null;
export const configuredEngineUrl = configuredUrl;

/** First port in the range that nothing is listening on (null if all are taken). */
export async function pickFreePort(): Promise<number | null> {
  for (
    let port = ENGINE_PORT_START;
    port < ENGINE_PORT_START + ENGINE_PORT_SPAN;
    port++
  ) {
    if (await isPortFree(port)) return port;
  }
  return null;
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, ENGINE_HOST, () => probe.close(() => resolve(true)));
  });
}

export function registerDesktopEngine(child: ChildProcess): void {
  globalThis.aiOsDesktopEngine = child;
  child.once("exit", () => {
    if (globalThis.aiOsDesktopEngine === child) {
      globalThis.aiOsDesktopEngine = undefined;
      globalThis.aiOsTasksEngineUrl = undefined;
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
