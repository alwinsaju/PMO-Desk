// Run with `pnpm test`. The renderer-crash decision.
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const recovery = require("./renderer-recovery.cjs");

describe("decideRendererGone", () => {
  it("ignores a clean exit (a normal window close)", () => {
    assert.equal(recovery.decideRendererGone({ reason: "clean-exit" }).action, "ignore");
  });

  it("reloads on its own after the first crash and asks on the second", () => {
    for (const reason of [
      "crashed",
      "abnormal-exit",
      "killed",
      "oom",
      "memory-eviction",
      "something-new",
      undefined,
    ]) {
      const first = recovery.decideRendererGone({ reason, recentCrashes: 1 });
      assert.equal(first.action, "auto-reload", String(reason));
      assert.ok(first.message.length > 0);
      assert.equal(
        recovery.decideRendererGone({ reason, recentCrashes: 2 }).action,
        "offer-reload",
        String(reason),
      );
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
    assert.equal(recovery.decideRendererGone().action, "auto-reload");
  });

  it("a crash after the window has passed counts as a first one again", () => {
    const first = 1_000_000;
    const later = first + recovery.CRASH_LOOP_WINDOW_MS + 1;
    const times = recovery.recordCrash(recovery.recordCrash([], first), later);
    assert.equal(
      recovery.decideRendererGone({ reason: "crashed", recentCrashes: times.length })
        .action,
      "auto-reload",
    );
    const quick = recovery.recordCrash(recovery.recordCrash([], first), first + 5_000);
    assert.equal(
      recovery.decideRendererGone({ reason: "crashed", recentCrashes: quick.length })
        .action,
      "offer-reload",
    );
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
