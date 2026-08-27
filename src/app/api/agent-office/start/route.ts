import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { isBackendRunning } from "../shared";

// Launches a live local process and polls it — never safe to treat as
// static/cacheable content.
export const dynamic = "force-dynamic";

/**
 * SAFETY: this route runs exactly ONE fixed, hardcoded local command with
 * fixed arguments — nothing from the incoming request (there's no body
 * read here in the first place) ever reaches `spawn()`. Keep it that way:
 * this exists to launch this one specific backend, not to run arbitrary
 * commands. If the venv/repo ever move, update the two constants below
 * rather than parameterizing them from a request.
 */
const PYTHON_EXE = "C:\\Projects\\Agents-workspace\\.venv\\Scripts\\python.exe";
const AGENT_OFFICE_CWD = "C:\\Projects\\Agents-workspace\\agent-office";
const UVICORN_ARGS = ["-m", "uvicorn", "backend.main:app", "--port", "8000"];

/** Bounded window to confirm the backend actually came up before giving up
 *  and reporting failure — long enough for a cold `uvicorn` boot, short
 *  enough that the frontend's loading screen never spins forever. */
const START_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 750;

/** Diagnostic output lives in the OS temp dir, not inside either project's
 *  own tree — this is scratch runtime data for this route, not source. */
const LOG_PATH = path.join(tmpdir(), "ai-os-agent-office.log");
/** How much of the log to fold into a failure's `reason` string, so a
 *  genuine Python/uvicorn error is visible right in the loading screen
 *  instead of sending the user spelunking for a log file. */
const LOG_TAIL_CHARS = 800;

type StartResult = { ok: true; alreadyRunning: boolean } | { ok: false; reason: string };

// Module-scoped: concurrent/rapid POSTs to this route while the dev server
// is up (React StrictMode's dev-only double-effect, two Tasks windows
// opened close together, a fast close+reopen, ...) coalesce onto ONE
// in-flight attempt instead of racing to spawn multiple uvicorn processes.
// Cleared as soon as that attempt settles, so the next genuinely separate
// call (e.g. clicking Retry after a real failure) starts fresh.
let inFlight: Promise<StartResult> | null = null;

/** POST /api/agent-office/start -> StartResult. Idempotent: safe to call
 *  every time the Tasks app opens, whether or not the backend is already
 *  running. See attemptStart() for the actual logic. */
export async function POST() {
  if (!inFlight) {
    inFlight = attemptStart().finally(() => {
      inFlight = null;
    });
  }
  return NextResponse.json(await inFlight);
}

async function attemptStart(): Promise<StartResult> {
  if (await isBackendRunning()) {
    return { ok: true, alreadyRunning: true };
  }

  if (!existsSync(PYTHON_EXE)) {
    return {
      ok: false,
      reason: `Python venv not found at ${PYTHON_EXE}. Set up Agents-workspace's .venv first (see its README), or start the backend manually.`,
    };
  }
  if (!existsSync(AGENT_OFFICE_CWD)) {
    return {
      ok: false,
      reason: `agent-office folder not found at ${AGENT_OFFICE_CWD}.`,
    };
  }

  let child: ChildProcess;
  try {
    // Truncate first so a failure's log tail (readLogTail below) reflects
    // only THIS attempt, not a mix of old dev-session output.
    writeFileSync(LOG_PATH, "");
    // Real OS file descriptors, not "pipe" — a pipe's other end is this
    // process, which would tie the child's stdio (and by extension, on
    // Windows, its survival) to this process's lifetime. That defeats the
    // whole point of detached+unref() below: this backend has to survive
    // the Next.js dev server hot-reloading or restarting. "ignore" would
    // solve that too but throws the output away entirely; a real log file
    // keeps it without reconnecting the child to us.
    const outFd = openSync(LOG_PATH, "a");
    const errFd = openSync(LOG_PATH, "a");
    child = spawn(PYTHON_EXE, UVICORN_ARGS, {
      cwd: AGENT_OFFICE_CWD,
      detached: true,
      stdio: ["ignore", outFd, errFd],
      windowsHide: true,
    });
    // The child gets its own duplicated handles at spawn time; drop our
    // copies right away so a long-lived dev server doesn't accumulate open
    // fds across repeated launches.
    closeQuiet(outFd);
    closeQuiet(errFd);
  } catch (err) {
    return {
      ok: false,
      reason: `Couldn't launch the backend: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let spawnError: string | null = null;
  let exitCode: number | null = null;
  child.once("error", (err) => {
    spawnError = err.message;
  });
  child.once("exit", (code) => {
    exitCode = code;
  });

  // Detach for real: this process must not keep the Next.js dev server's
  // event loop alive on the child's account, and the child must keep
  // running after a Fast Refresh/HMR reload from unrelated file edits.
  // Verified live on Windows: detached+unref() survives the dev server
  // being stopped via a plain kill of its PID (Ctrl+C, a crash, a normal
  // Fast Refresh — which never touches this child at all) — but NOT an
  // explicit recursive "kill this PID and every descendant" teardown
  // (`taskkill /T`), because Windows still resolves the child's parent PID
  // for tree-kill purposes regardless of `detached`. That's a difference
  // between kill *mechanisms*, not a gap in this flag combination — the
  // literal scenario this needs to survive (editing unrelated files while
  // this stays running) never kills anything, so it's unaffected either way.
  child.unref();

  console.log(`[agent-office] launching: ${PYTHON_EXE} ${UVICORN_ARGS.join(" ")}`);

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (spawnError) {
      console.error(`[agent-office] spawn error: ${spawnError}`);
      return { ok: false, reason: `Couldn't launch the backend: ${spawnError}` };
    }
    if (await isBackendRunning()) {
      console.log("[agent-office] backend is up");
      return { ok: true, alreadyRunning: false };
    }
    // The child exiting doesn't necessarily mean failure on its own — e.g.
    // it may have lost a startup race to bind :8000 against another
    // instance that's now serving the port just fine, which the
    // isBackendRunning() check above already would have caught. Only
    // treat a non-zero exit as fatal once the port also isn't answering.
    if (exitCode !== null && exitCode !== 0) {
      console.error(`[agent-office] process exited with code ${exitCode}`);
      return {
        ok: false,
        reason: `The backend process exited (code ${exitCode}) before it came up.${readLogTail()}`,
      };
    }
    await sleep(POLL_INTERVAL_MS);
  }

  console.error("[agent-office] timed out waiting for the backend to come up");
  return {
    ok: false,
    reason: `The backend didn't respond within ${START_TIMEOUT_MS / 1000}s.${readLogTail()}`,
  };
}

/** Best-effort tail of the launch log, prefixed for direct inclusion in a
 *  failure's `reason` string — "" (nothing appended) if the log can't be
 *  read for any reason. */
function readLogTail(): string {
  try {
    const content = readFileSync(LOG_PATH, "utf8").trim();
    if (!content) return "";
    const tail =
      content.length > LOG_TAIL_CHARS ? content.slice(-LOG_TAIL_CHARS) : content;
    return ` Last output:\n${tail}`;
  } catch {
    return "";
  }
}

function closeQuiet(fd: number): void {
  try {
    closeSync(fd);
  } catch {
    // Best-effort cleanup only — a failure to close doesn't affect
    // correctness, only (very slowly) fd accounting.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
