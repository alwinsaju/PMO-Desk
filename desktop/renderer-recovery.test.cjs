// Run with `pnpm test`. The renderer-crash decision.
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const recovery = require("./renderer-recovery.cjs");

describe("decideRendererGone", () => {
  it("ignores a clean exit (a normal window close)", () => {
    assert.equal(recovery.decideRendererGone({ reason: "clean-exit" }).action, "ignore");
  });

  it("offers a reload for crashes, kills, OOM and unknown reasons", () => {
    for (const reason of [
      "crashed",
      "abnormal-exit",
      "killed",
      "oom",
      "memory-eviction",
      "something-new",
      undefined,
    ]) {
      const result = recovery.decideRendererGone({ reason });
      assert.equal(result.action, "offer-reload", String(reason));
      assert.ok(result.message.length > 0);
    }
  });

  it("offers only quit when a reload cannot help", () => {
    for (const reason of ["launch-failed", "integrity-failure"]) {
      assert.equal(recovery.decideRendererGone({ reason }).action, "offer-quit", reason);
    }
  });

  it("stops offering reloads in a crash loop", () => {
    assert.equal(
      recovery.decideRendererGone({ reason: "crashed", recentCrashes: 2 }).action,
      "offer-reload",
    );
    assert.equal(
      recovery.decideRendererGone({
        reason: "crashed",
        recentCrashes: recovery.CRASH_LOOP_LIMIT,
      }).action,
      "offer-quit",
    );
  });

  it("tolerates a missing argument", () => {
    assert.equal(recovery.decideRendererGone().action, "offer-reload");
  });
});

describe("recordCrash", () => {
  it("keeps only crashes inside the window", () => {
    const now = 1_000_000;
    const old = now - recovery.CRASH_LOOP_WINDOW_MS - 1;
    const edge = now - recovery.CRASH_LOOP_WINDOW_MS;
    assert.deepEqual(recovery.recordCrash([old, edge, now - 5], now), [
      edge,
      now - 5,
      now,
    ]);
    assert.deepEqual(recovery.recordCrash([], now), [now]);
  });
});
