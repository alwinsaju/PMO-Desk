import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { getEngineAuth } from "../../../../lib/tasks-engine/engineAuth.ts";
import { explainEngineExit, type EngineStartFailure } from "../../../../lib/tasks-engine/startFailure.ts";
import { START_TIMEOUT_MS, waitForEngine } from "../../../../lib/tasks-engine/waitForEngine.ts";
import { resolvePython } from "../python";
import {
  configuredEngineUrl,
  engineEnv,
  engineUrlFor,
  findRunningEngine,
  hasConfiguredEngine,
  isTasksEngine,
  pickFreePort,
  registerDesktopEngine,
  rememberEngineUrl,
} from "../shared";

// Launches a live local process and polls it — never safe to treat as
// static/cacheable content.
export const dynamic = "force-dynamic";

/**
 * SAFETY: this route runs exactly ONE fixed local command with fixed
 * arguments - nothing from the incoming request (there's no body read here in
 * the first place) ever reaches `spawn()`. Keep it that way: this exists to
 * launch the Tasks engine, not to run arbitrary commands. Where the engine
 * and its Python live is decided by the repo layout and the documented
 * AI_OS_TASKS_PYTHON setting (see resolvePython), never by a request.
 */
// `pythonw.exe`, not `python.exe` - same interpreter, but compiled as a
// Windows GUI-subsystem binary instead of a console-subsystem one, i.e. it
// never has (or tries to allocate) a console at all. See the note above
// `child.unref()` below for why that distinction is exactly what lets this
// route get both "no visible window" and "survives independently of this
// dev server" at once, which turned out not to be possible with `python.exe`
// no matter how `detached`/`windowsHide` were combined.
const ENGINE_DIR = path.join(process.cwd(), "tasks-engine");

/** Bounded window to confirm the engine actually came up before giving up
 *  and reporting failure (see waitForEngine.ts for the polling interval). */
const DESKTOP_MODE = process.env.AI_OS_DESKTOP_MODE === "1";

/** Diagnostic output lives in the OS temp dir, not inside either project's
 *  own tree — this is scratch runtime data for this route, not source. */
const LOG_PATH = path.join(tmpdir(), "ai-os-tasks-engine.log");
/** How much of the log to fold into a failure's `reason` string, so a
 *  genuine Python/uvicorn error is visible right in the loading screen
 *  instead of sending the user spelunking for a log file. */
const LOG_TAIL_CHARS = 800;

type StartResult =
  | { ok: true; alreadyRunning: boolean; url: string }
  | ({ ok: false } & EngineStartFailure);

// Module-scoped: concurrent/rapid POSTs to this route while the dev server
// is up (React StrictMode's dev-only double-effect, two Tasks windows
// opened close together, a fast close+reopen, ...) coalesce onto ONE
// in-flight attempt instead of racing to spawn multiple uvicorn processes.
// Cleared as soon as that attempt settles, so the next genuinely separate
// call (e.g. clicking Retry after a real failure) starts fresh.
let inFlight: Promise<StartResult> | null = null;

/** POST /api/tasks-engine/start -> StartResult. Idempotent: safe to call
 *  every time the Tasks app opens, whether or not the engine is already
 *  running. See attemptStart() for the actual logic. Keep this POST-only:
 *  desktop/dev-warmup.cjs GETs this path to pre-compile it (answered 405). */
export async function POST() {
  if (!inFlight) {
    inFlight = attemptStart().finally(() => {
      inFlight = null;
    });
  }
  return NextResponse.json(await inFlight);
}

async function attemptStart(): Promise<StartResult> {
  const running = await findRunningEngine();
  if (running) {
    return { ok: true, alreadyRunning: true, url: running };
  }
  if (hasConfiguredEngine()) {
    return {
      ok: false,
      reason: `AI_OS_TASKS_ENGINE_URL is set (${configuredEngineUrl()}) but no Tasks engine answers there.`,
    };
  }

  const pythonExe = resolvePython();
  if (!pythonExe) {
    return {
      ok: false,
      reason:
        "No Python found for the Tasks engine. Set AI_OS_TASKS_PYTHON to a Python with tasks-engine/requirements.txt installed, or create tasks-engine/.venv (see tasks-engine/README.md).",
    };
  }
  if (!existsSync(ENGINE_DIR)) {
    return { ok: false, reason: `tasks-engine folder not found at ${ENGINE_DIR}.` };
  }
  const port = await pickFreePort();
  if (port === null) {
    return {
      ok: false,
      reason: "No free port for the Tasks engine (8000-8019 are all in use).",
    };
  }
  const url = engineUrlFor(port);
  const engineArgs = ["main.py", "--port", String(port)];

  let child: ChildProcess;
  try {
    // Truncate first so a failure's log tail (readLogTail below) reflects
    // only THIS attempt, not a mix of old dev-session output.
    writeFileSync(LOG_PATH, "");
    // Real OS file descriptors, not "pipe" — a pipe's other end is this
    // process, which would tie the child's stdio (and by extension, on
    // Windows, its survival) to this process's lifetime. That defeats the
    // whole point of detached+unref() below: this engine has to survive
    // the Next.js dev server hot-reloading or restarting. "ignore" would
    // solve that too but throws the output away entirely; a real log file
    // keeps it without reconnecting the child to us.
    const outFd = openSync(LOG_PATH, "a");
    const errFd = openSync(LOG_PATH, "a");
    child = spawn(pythonExe, engineArgs, {
      cwd: ENGINE_DIR,
      detached: !DESKTOP_MODE,
      stdio: ["ignore", outFd, errFd],
      windowsHide: true,
      // No stray PYTHON* settings; carries this server's engine token and instance id.
      env: engineEnv(process.env, pythonExe),
    });
    // The child gets its own duplicated handles at spawn time; drop our
    // copies right away so a long-lived dev server doesn't accumulate open
    // fds across repeated launches.
    closeQuiet(outFd);
    closeQuiet(errFd);
  } catch (err) {
    return {
      ok: false,
      reason: `Couldn't launch the engine: ${err instanceof Error ? err.message : String(err)}`,
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

  // This must not keep the Next.js dev server's event loop alive on the
  // child's account, and the child must keep running after a Fast
  // Refresh/HMR reload from unrelated file edits. unref() is what actually
  // gets us the first half (this process can exit/idle without waiting on
  // the still-running child); `detached: true` above is what gets us the
  // second (see the GOTCHA below for why it has to be `detached`, not just
  // "don't tie its stdio to us"). Verified live on Windows: this combo
  // survives the dev server being stopped via a plain kill of its PID
  // (Ctrl+C, a crash, a normal Fast Refresh — which never touches this
  // child at all). It does NOT survive an explicit recursive "kill this
  // PID and every descendant" teardown (`taskkill /T`), because Windows
  // still resolves the child's parent PID for tree-kill purposes regardless
  // of `detached` — but the literal scenario this needs to survive (editing
  // unrelated files while this stays running) never does that, so it's
  // unaffected either way.
  //
  // GOTCHA, worked out the hard way on this exact machine — read this
  // before touching the interpreter choice or these spawn options:
  //
  // `detached: true` and `windowsHide: true` sound orthogonal (independence
  // from the parent vs. a hidden window) but on Windows they collide.
  // libuv (the native layer under `child_process.spawn`) implements
  // `detached` as the creation flag `DETACHED_PROCESS`, OR'd into the same
  // `CreateProcess` call as whatever `windowsHide` contributes
  // (`CREATE_NO_WINDOW` + `SW_HIDE`). Per Microsoft's own docs,
  // `CREATE_NO_WINDOW` "is ignored ... if it is used with either
  // CREATE_NEW_CONSOLE or DETACHED_PROCESS" — so with a plain `python.exe`
  // target and both options set, `windowsHide` was silently a no-op on the
  // *direct* child. That alone would "only" mean the direct child inherits
  // whatever console state it has by default, which usually wouldn't pop a
  // new window — except this venv's direct child, `Scripts\python.exe`, is
  // itself just a tiny native launcher stub (this is a Microsoft Store
  // Python install; `pyvenv.cfg`'s `home` points at a WindowsApps alias)
  // that relays to the real interpreter via its own internal, second
  // `CreateProcess` call, entirely outside anything Node/libuv can pass
  // flags to. `DETACHED_PROCESS` leaves that stub with no console at all,
  // so when it then relaunches the real interpreter with no console to
  // inherit and no special flags of its own, Windows falls back to its
  // documented default for an orphaned console app: allocate a *new*,
  // normally-visible console for it — one process hop below anything this
  // route controls. That new console is the window that was actually
  // showing up.
  //
  // The fix is NOT to drop `detached` — that removes the window but was
  // verified live to reintroduce the opposite problem: without
  // `CREATE_NEW_PROCESS_GROUP` (also part of what `detached` sets), the
  // "child" stops being independent of this process's own lifetime on
  // Windows and dies with it (confirmed with a plain, non-tree kill of just
  // this process's PID — same scenario called out above as needing to
  // survive). The actual fix is the executable switch above: `pythonw.exe`
  // is a GUI-subsystem binary, so it never has a console to inherit or
  // avoid in the first place — `DETACHED_PROCESS` becomes a no-op for it
  // instead of a trap, `CREATE_NO_WINDOW`/`SW_HIDE` become moot rather than
  // conflicting with anything, and `detached`'s actually-load-bearing part
  // (`CREATE_NEW_PROCESS_GROUP`, i.e. surviving independently of this
  // process) is free to work unopposed. Verified live: this combination
  // produces no window at any hop AND survives a plain kill of this
  // process's own PID.
  if (DESKTOP_MODE) {
    registerDesktopEngine(child);
  } else {
    child.unref();
  }

  console.log(`[tasks-engine] launching: ${pythonExe} ${engineArgs.join(" ")}`);

  const waited = await waitForEngine({
    ready: () => isTasksEngine(url, getEngineAuth().instance),
    fatal: () => {
      if (spawnError) return `Couldn't launch the engine: ${spawnError}`;
      // A non-zero exit before the port answers is fatal.
      return exitCode !== null && exitCode !== 0 ? `exit:${exitCode}` : null;
    },
    sleep,
    now: Date.now,
  });
  if (waited.status === "ready") {
    rememberEngineUrl(url);
    console.log(`[tasks-engine] engine is up at ${url} after ${waited.waitedMs} ms`);
    return { ok: true, alreadyRunning: false, url };
  }
  if (waited.status === "fatal") {
    if (waited.reason.startsWith("exit:")) {
      const code = Number(waited.reason.slice("exit:".length));
      console.error(`[tasks-engine] process exited with code ${code}`);
      return { ok: false, ...explainEngineExit(code, readLogTail()) };
    }
    console.error(`[tasks-engine] spawn error: ${spawnError}`);
    return { ok: false, reason: waited.reason };
  }
  console.error("[tasks-engine] timed out waiting for the engine to come up");
  return {
    ok: false,
    reason: `The engine didn't respond within ${START_TIMEOUT_MS / 1000}s.${readLogTail()}`,
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
