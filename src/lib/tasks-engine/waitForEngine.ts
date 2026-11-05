// How the engine launcher waits for a freshly started Tasks engine. Pure: the probe, the clock and the
// sleep are injected so the timing can be tested without a real process.

/** How often the launcher asks the engine whether it is up. The engine itself answers about 2.5 s
 *  after it is spawned, so a long interval only adds its own length on top of that. */
export const START_POLL_INTERVAL_MS = 250;
/** Long enough for a cold boot on a slow disk with a virus scanner, short enough not to spin forever. */
export const START_TIMEOUT_MS = 60_000;

export interface WaitDeps {
  /** True once the engine answers its identity check. */
  ready: () => Promise<boolean>;
  /** A reason to stop waiting at once (the process failed to spawn or exited), else null. */
  fatal: () => string | null;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  timeoutMs?: number;
  intervalMs?: number;
}

export type WaitResult =
  | { status: "ready"; waitedMs: number; polls: number }
  | { status: "fatal"; reason: string }
  | { status: "timeout"; waitedMs: number };

export async function waitForEngine(deps: WaitDeps): Promise<WaitResult> {
  const { ready, fatal, sleep, now, timeoutMs = START_TIMEOUT_MS, intervalMs = START_POLL_INTERVAL_MS } = deps;
  const startedAt = now();
  const deadline = startedAt + timeoutMs;
  let polls = 0;
  while (now() < deadline) {
    polls += 1;
    if (await ready()) return { status: "ready", waitedMs: now() - startedAt, polls };
    // Looked at only once the engine has not answered: an exit that merely follows a successful boot
    // must not count as a failure.
    const stop = fatal();
    if (stop) return { status: "fatal", reason: stop };
    await sleep(Math.min(intervalMs, Math.max(0, deadline - now())));
  }
  return { status: "timeout", waitedMs: now() - startedAt };
}
