// Run with `pnpm test`. How the launcher waits for a freshly started Tasks engine.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  START_POLL_INTERVAL_MS,
  START_TIMEOUT_MS,
  waitForEngine,
} from "./waitForEngine.ts";

/** A fake clock: sleeping advances time, and a probe costs `probeMs`. */
function world({ readyAt = Infinity, probeMs = 0, fatalAt = Infinity, fatalReason = "exited" } = {}) {
  let t = 0;
  const sleeps = [];
  return {
    sleeps,
    time: () => t,
    deps: {
      now: () => t,
      sleep: async (ms) => {
        sleeps.push(ms);
        t += ms;
      },
      ready: async () => {
        t += probeMs;
        return t >= readyAt;
      },
      fatal: () => (t >= fatalAt ? fatalReason : null),
    },
  };
}

describe("waitForEngine", () => {
  it("polls every 250 ms, so an engine that is up after 2.7 s is noticed within one interval", () => {
    assert.equal(START_POLL_INTERVAL_MS, 250);
    const w = world({ readyAt: 2_700 });
    return waitForEngine(w.deps).then((result) => {
      assert.equal(result.status, "ready");
      assert.ok(result.waitedMs >= 2_700 && result.waitedMs < 2_700 + START_POLL_INTERVAL_MS);
      assert.ok(w.sleeps.every((ms) => ms <= START_POLL_INTERVAL_MS));
    });
  });
  it("is ready at once when the engine already answers", async () => {
    const w = world({ readyAt: 0 });
    assert.deepEqual(await waitForEngine(w.deps), { status: "ready", waitedMs: 0, polls: 1 });
    assert.deepEqual(w.sleeps, []);
  });
  it("gives up with a timeout after the budget and never sleeps past it", async () => {
    const w = world();
    const result = await waitForEngine({ ...w.deps, timeoutMs: 1_000 });
    assert.deepEqual(result, { status: "timeout", waitedMs: 1_000 });
    assert.ok(w.time() <= 1_000);
    assert.equal(START_TIMEOUT_MS, 60_000);
  });
  it("stops at once for a spawn failure or an exit before the engine answered", async () => {
    const w = world({ fatalAt: 500, fatalReason: "Couldn't launch the engine" });
    const result = await waitForEngine(w.deps);
    assert.deepEqual(result, { status: "fatal", reason: "Couldn't launch the engine" });
    assert.ok(w.time() <= 500 + START_POLL_INTERVAL_MS);
  });
  it("does not count an exit that follows a successful boot", async () => {
    const w = world({ readyAt: 300, fatalAt: 300 });
    assert.equal((await waitForEngine(w.deps)).status, "ready");
  });
});
