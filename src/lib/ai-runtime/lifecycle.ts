// Owns (or declines to own) the Ollama server process. Mirrors the "owned
// backend lifecycle" of the agent-office backend (see
// src/app/api/agent-office/shared.ts + desktop/main.cjs): state lives on
// globalThis because Next compiles instrumentation and each route into
// separate module graphs, and all of them must see the same child process.
//
// Ownership rules:
//   - Something already answers on the base URL -> reuse it, owned = false,
//     never kill it.
//   - Nothing answers and the URL is loopback -> spawn `ollama serve`
//     ourselves, owned = true, and stop its whole process tree on quit.
//   - A previous AI OS crashed and left an Ollama we started behind (its
//     pidfile says so, its owner PID is dead) -> adopt it (owned = true) so
//     this run cleans it up.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  isLocalBaseUrl,
  isOllamaImageName,
  ollamaHostFor,
  parseTasklistImageName,
  resolveOllamaExe,
  type AiRuntimeConfig,
  type OllamaClient,
} from "./core";

declare global {
  var aiOsOllamaProcess: OllamaProcessState | undefined;
}

export interface OllamaProcessState {
  child?: ChildProcess;
  /** PID of the server we own (spawned, or adopted from a crashed run). */
  pid?: number;
  owned: boolean;
  adopted: boolean;
  exePath?: string;
  startedAt?: number;
  /** In-flight ensure, so concurrent callers share one spawn. */
  starting?: Promise<EnsureServerResult>;
  exitHookInstalled?: boolean;
}

export type EnsureServerResult =
  | { running: true; owned: boolean; started: boolean }
  | { running: false; reason: string };

/** Scratch runtime data, same place agent-office keeps its log. */
const LOG_PATH = path.join(tmpdir(), "ai-os-ollama.log");
const PIDFILE_PATH = path.join(tmpdir(), "ai-os-ollama.json");
const POLL_INTERVAL_MS = 500;
const STOP_TIMEOUT_MS = 10_000;
const LOG_TAIL_CHARS = 600;

export function getProcessState(): OllamaProcessState {
  globalThis.aiOsOllamaProcess ??= { owned: false, adopted: false };
  return globalThis.aiOsOllamaProcess;
}

/**
 * Make sure a server answers on `config.baseUrl`, starting one if allowed.
 * Idempotent and safe to call on every request. Never throws.
 *
 * SAFETY: the only thing ever spawned is the resolved ollama executable with
 * the fixed argument list ["serve"], shell: false — nothing from a request
 * reaches spawn(). Keep it that way.
 */
export function ensureOllamaServer(
  config: AiRuntimeConfig,
  client: OllamaClient,
): Promise<EnsureServerResult> {
  const state = getProcessState();
  if (!state.starting) {
    state.starting = attemptEnsure(state, config, client).finally(() => {
      state.starting = undefined;
    });
  }
  return state.starting;
}

async function attemptEnsure(
  state: OllamaProcessState,
  config: AiRuntimeConfig,
  client: OllamaClient,
): Promise<EnsureServerResult> {
  if ((await client.probe()).running) {
    if (!state.owned) adoptOrphan(state, config);
    return { running: true, owned: state.owned, started: false };
  }

  // Server is gone. If we thought we owned one, it died on us — forget it.
  if (state.owned) clearOwnership(state);

  if (!config.autoStart) {
    return {
      running: false,
      reason: "Ollama is not running and AI_OS_AI_AUTOSTART is off.",
    };
  }
  if (!isLocalBaseUrl(config.baseUrl)) {
    return {
      running: false,
      reason: `Ollama is not answering at ${config.baseUrl}, and AI OS only starts a server on this machine.`,
    };
  }

  const exe = resolveOllamaExe({
    env: process.env,
    platform: process.platform,
    exists: existsSync,
    override: config.ollamaExe,
  });
  if (!exe.path) {
    return {
      running: false,
      reason: `Ollama is not running and ollama.exe was not found (looked in: ${exe.tried.join(", ") || "nowhere"}). Install Ollama or set AI_OS_OLLAMA_EXE.`,
    };
  }

  let child: ChildProcess;
  try {
    // Truncate so a failure's log tail reflects only THIS attempt.
    writeFileSync(LOG_PATH, "");
    // Real fds, not "pipe": a pipe nobody reads can fill and stall the server.
    const outFd = openSync(LOG_PATH, "a");
    const errFd = openSync(LOG_PATH, "a");
    // Deliberately NOT `detached`: libuv puts a non-detached child in a
    // Windows job object that is killed when this process dies, so even a
    // hard kill of the Next server (crash, force quit) takes Ollama with it.
    child = spawn(exe.path, ["serve"], {
      env: { ...process.env, OLLAMA_HOST: ollamaHostFor(config.baseUrl) },
      stdio: ["ignore", outFd, errFd],
      windowsHide: true,
      shell: false,
    });
    closeQuiet(outFd);
    closeQuiet(errFd);
  } catch (error) {
    return {
      running: false,
      reason: `Could not launch Ollama: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  let spawnError: string | undefined;
  let exited = false;
  child.once("error", (error) => {
    spawnError = error.message;
  });
  child.once("exit", () => {
    exited = true;
    if (state.child === child) clearOwnership(state);
  });

  state.child = child;
  state.pid = child.pid;
  state.exePath = exe.path;
  state.startedAt = Date.now();
  installExitHook(state);
  if (child.pid) writePidfile(child.pid, config, exe.path);

  const deadline = Date.now() + config.startTimeoutMs;
  while (Date.now() < deadline) {
    if (spawnError) break;
    if ((await client.probe()).running) {
      // The child exiting while the port still answers means someone else
      // (e.g. the Ollama tray app) won the race to bind it: theirs, not ours.
      if (exited) {
        clearOwnership(state);
        return { running: true, owned: false, started: false };
      }
      state.owned = true;
      state.adopted = false;
      console.log(`[ai-runtime] started ollama (pid ${child.pid}) at ${config.baseUrl}`);
      return { running: true, owned: true, started: true };
    }
    if (exited) break;
    await sleep(POLL_INTERVAL_MS);
  }

  const reason = spawnError
    ? `Could not launch Ollama: ${spawnError}`
    : exited
      ? `Ollama exited before it came up.${readLogTail()}`
      : `Ollama did not answer within ${config.startTimeoutMs / 1000}s.${readLogTail()}`;
  // We started it and it never became usable: don't leave it running.
  if (!exited) await killProcessTree(child.pid);
  clearOwnership(state);
  return { running: false, reason };
}

/**
 * Stop the server only if AI OS owns it: unload models (keep_alive 0), then
 * kill the whole process tree (ollama serve spawns runner children).
 * No-op for a reused external server.
 */
export async function stopOwnedOllama(
  client: OllamaClient,
): Promise<{ stopped: boolean }> {
  const state = getProcessState();
  if (!state.owned || !state.pid) return { stopped: false };
  const { pid } = state;

  try {
    const loaded = await client.listLoaded(2_000);
    await Promise.all(loaded.map((model) => client.unload(model).catch(() => undefined)));
  } catch {
    // Server already gone or unresponsive; killing it below is what matters.
  }

  await killProcessTree(pid);
  await waitForExit(pid);
  clearOwnership(state);
  return { stopped: true };
}

/** Forget the server we owned and drop the crash-recovery pidfile. */
function clearOwnership(state: OllamaProcessState): void {
  state.child = undefined;
  state.pid = undefined;
  state.owned = false;
  state.adopted = false;
  removePidfile();
}

// ---------------------------------------------------------------------------
// Crash/force-quit safety net
// ---------------------------------------------------------------------------

/** Last-chance synchronous cleanup when this Node process exits normally
 *  (dev server Ctrl+C, SIGTERM, uncaught exception). A hard kill
 *  (TerminateProcess) can't run this; the pidfile + adoptOrphan cover that
 *  on the next launch. */
function installExitHook(state: OllamaProcessState): void {
  if (state.exitHookInstalled) return;
  state.exitHookInstalled = true;
  process.on("exit", () => {
    if (state.owned && state.pid) killProcessTreeSync(state.pid);
  });
}

interface Pidfile {
  pid: number;
  ownerPid: number;
  baseUrl: string;
  exe: string;
  startedAt: number;
}

function writePidfile(pid: number, config: AiRuntimeConfig, exe: string): void {
  const record: Pidfile = {
    pid,
    ownerPid: process.pid,
    baseUrl: config.baseUrl,
    exe,
    startedAt: Date.now(),
  };
  try {
    writeFileSync(PIDFILE_PATH, JSON.stringify(record));
  } catch {
    // Best effort: only the crash-recovery path depends on it.
  }
}

function removePidfile(): void {
  try {
    rmSync(PIDFILE_PATH, { force: true });
  } catch {
    // Best effort.
  }
}

function readPidfile(): Pidfile | undefined {
  try {
    const raw = JSON.parse(readFileSync(PIDFILE_PATH, "utf8")) as Partial<Pidfile>;
    if (
      Number.isInteger(raw.pid) &&
      Number.isInteger(raw.ownerPid) &&
      typeof raw.baseUrl === "string"
    ) {
      return raw as Pidfile;
    }
  } catch {
    // Missing or corrupt: nothing to adopt.
  }
  return undefined;
}

/** Take ownership of an Ollama a crashed AI OS started and never stopped.
 *  Only when its recorded owner is dead, the PID is alive, and the PID's
 *  image really is Ollama (PID reuse after a reboot must never get a random
 *  process killed). A server started by a still-running dev server is left
 *  alone. */
function adoptOrphan(state: OllamaProcessState, config: AiRuntimeConfig): void {
  const record = readPidfile();
  if (!record || record.baseUrl !== config.baseUrl) return;
  if (record.ownerPid === process.pid || isPidAlive(record.ownerPid)) return;
  if (!isPidAlive(record.pid) || !isOllamaImageName(imageNameOf(record.pid))) {
    removePidfile();
    return;
  }
  state.owned = true;
  state.adopted = true;
  state.pid = record.pid;
  state.exePath = record.exe;
  installExitHook(state);
  writePidfile(record.pid, config, record.exe);
  console.log(
    `[ai-runtime] adopted orphaned ollama (pid ${record.pid}) from a previous run`,
  );
}

// ---------------------------------------------------------------------------
// Process helpers (fixed args, shell: false)
// ---------------------------------------------------------------------------

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: exists but not ours to signal.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function imageNameOf(pid: number): string | undefined {
  try {
    if (process.platform === "win32") {
      const out = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
        encoding: "utf8",
        windowsHide: true,
        shell: false,
        timeout: 5_000,
      });
      return parseTasklistImageName(out.stdout ?? "");
    }
    const out = spawnSync("ps", ["-p", String(pid), "-o", "comm="], {
      encoding: "utf8",
      shell: false,
      timeout: 5_000,
    });
    return path.basename((out.stdout ?? "").trim()) || undefined;
  } catch {
    return undefined;
  }
}

/** Windows: `taskkill /T /F` takes the runner children with it. Elsewhere a
 *  plain SIGTERM to the server is what Ollama expects. */
function killProcessTree(pid: number | undefined): Promise<void> {
  if (!pid) return Promise.resolve();
  return new Promise((resolve) => {
    try {
      const killer =
        process.platform === "win32"
          ? spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
              stdio: "ignore",
              windowsHide: true,
              shell: false,
            })
          : undefined;
      if (!killer) {
        process.kill(pid, "SIGTERM");
        resolve();
        return;
      }
      killer.once("error", () => resolve());
      killer.once("exit", () => resolve());
    } catch {
      resolve();
    }
  });
}

function killProcessTreeSync(pid: number): void {
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
        shell: false,
        timeout: 5_000,
      });
    } else {
      process.kill(pid, "SIGTERM");
    }
  } catch {
    // Already gone.
  }
}

async function waitForExit(pid: number): Promise<void> {
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (isPidAlive(pid) && Date.now() < deadline) await sleep(100);
}

function readLogTail(): string {
  try {
    const content = readFileSync(LOG_PATH, "utf8").trim();
    if (!content) return "";
    return ` Last output:\n${content.length > LOG_TAIL_CHARS ? content.slice(-LOG_TAIL_CHARS) : content}`;
  } catch {
    return "";
  }
}

function closeQuiet(fd: number): void {
  try {
    closeSync(fd);
  } catch {
    // Best-effort fd hygiene only.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
