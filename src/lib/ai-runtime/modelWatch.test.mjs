// Run with `pnpm test`. The load/unload transition detector.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseLoadedModels } from "./core.ts";
import { GB, makeLogState } from "./testkit.mjs";

const model = (name = "gemma4:12b", expiresAt = null) => ({
  name,
  sizeBytes: 8 * GB,
  sizeVramBytes: 0,
  expiresAt,
});
const opts = (now) => ({ now, defaultModel: "gemma4:12b" });
const kinds = (events) => events.map((e) => e.kind);

describe("ModelTracker", () => {
  it("says nothing while nothing changes, and does not announce an empty server", () => {
    const { tracker } = makeLogState();
    assert.deepEqual(tracker.observe([], opts(0)), []);
    assert.equal(tracker.anyLoaded(), false);
    tracker.observe([model()], opts(1));
    assert.deepEqual(tracker.observe([model()], opts(2)), []);
  });

  it("logs a load a call caused, once, and clears the pending wake", () => {
    const { ring, tracker } = makeLogState();
    tracker.observe([], opts(0));
    ring.emit({
      kind: "call-start",
      call: "c1",
      task: "structure",
      model: "gemma4:12b",
      keepAlive: "2m",
      modelLoaded: false,
      queueWaiting: 0,
    });
    const [loaded] = tracker.observe(
      [model("gemma4:12b", "2026-10-24T10:02:00Z")],
      opts(1),
    );
    assert.equal(loaded.kind, "model-loaded");
    assert.equal(loaded.cause, "call");
    assert.equal(loaded.ours, true);
    assert.equal(loaded.sizeBytes, 8 * GB);
    assert.equal(ring.pendingWake, null);
    assert.equal(tracker.anyLoaded(), true);
  });

  it("tells a Load now from a call, and a model that was there from one that appeared", () => {
    const manual = makeLogState();
    manual.tracker.observe([], opts(0));
    manual.ring.emit({
      kind: "call-start",
      call: "c1",
      task: "load",
      model: "gemma4:12b",
      keepAlive: "2m",
      modelLoaded: false,
      queueWaiting: 0,
    });
    assert.equal(manual.tracker.observe([model()], opts(1))[0].cause, "manual");

    // First look at a server that already holds the model.
    const already = makeLogState();
    assert.equal(already.tracker.observe([model()], opts(0))[0].cause, "already");

    // Something else loaded it later, with no call of ours behind it.
    const other = makeLogState();
    other.tracker.observe([], opts(0));
    assert.equal(other.tracker.observe([model()], opts(1))[0].cause, "other");
  });

  it("calls an unload 'idle' once the keep-alive deadline passed, with the idle time", () => {
    const { ring, tracker } = makeLogState();
    tracker.observe([], opts(0));
    ring.emit({
      kind: "call-start",
      call: "c1",
      task: "structure",
      model: "gemma4:12b",
      keepAlive: "2m",
      modelLoaded: false,
      queueWaiting: 0,
    });
    const t0 = Date.parse("2026-10-24T10:00:00Z");
    ring.lastCallEndAt = t0;
    tracker.observe([model("gemma4:12b", "2026-10-24T10:02:00Z")], opts(t0));
    const [gone] = tracker.observe([], opts(t0 + 125_000));
    assert.equal(gone.kind, "model-unloaded");
    assert.equal(gone.reason, "idle");
    assert.equal(gone.idleMs, 120_000);
    assert.equal(gone.sizeBytes, 8 * GB);
    assert.equal(tracker.anyLoaded(), false);
  });

  it("does not call an early disappearance idle", () => {
    const { tracker } = makeLogState();
    const t0 = Date.parse("2026-10-24T10:00:00Z");
    tracker.observe([model("gemma4:12b", "2026-10-24T10:30:00Z")], opts(t0));
    const [gone] = tracker.observe([], opts(t0 + 5_000));
    assert.equal(gone.reason, "other");
  });

  it("uses the reason we were told about (manual, shutdown) exactly once", () => {
    const { tracker } = makeLogState();
    tracker.observe([model()], opts(0));
    tracker.expectUnload("gemma4:12b", "manual");
    assert.equal(tracker.observe([], opts(1))[0].reason, "manual");
    tracker.observe([model()], opts(2));
    // Not expected this time.
    assert.equal(tracker.observe([], opts(3))[0].reason, "other");

    tracker.observe([model()], opts(4));
    tracker.expectUnload("gemma4:12b", "shutdown");
    tracker.clearExpected("gemma4:12b");
    assert.equal(tracker.observe([], opts(5))[0].reason, "other");
  });

  it("separates our model from someone else's", () => {
    const { tracker } = makeLogState();
    const events = tracker.observe(
      [model("gemma4:12b"), model("llama3.2:latest")],
      opts(0),
    );
    assert.deepEqual(
      events.map((e) => [e.model, e.ours]),
      [
        ["gemma4:12b", true],
        ["llama3.2:latest", false],
      ],
    );
    const gone = tracker.observe([model("gemma4:12b")], opts(1));
    assert.deepEqual(kinds(gone), ["model-unloaded"]);
    assert.equal(gone[0].ours, false);
  });

  it("reset forgets what was loaded without announcing unloads", () => {
    const { ring, tracker } = makeLogState();
    tracker.observe([model()], opts(0));
    const before = ring.size;
    tracker.reset();
    assert.equal(tracker.anyLoaded(), false);
    assert.equal(ring.size, before);
  });
});

describe("parseLoadedModels", () => {
  it("reads name, size and expiry from /api/ps, and tolerates junk", () => {
    assert.deepEqual(
      parseLoadedModels({
        models: [
          { name: "a:1", size: 100, size_vram: 40, expires_at: "2026-10-24T10:00:00Z" },
          { model: "b:2" },
          { size: 5 },
          null,
        ],
      }),
      [
        {
          name: "a:1",
          sizeBytes: 100,
          sizeVramBytes: 40,
          expiresAt: "2026-10-24T10:00:00Z",
        },
        { name: "b:2", sizeBytes: 0, sizeVramBytes: 0, expiresAt: null },
      ],
    );
    assert.deepEqual(parseLoadedModels(null), []);
    assert.deepEqual(parseLoadedModels({ models: "nope" }), []);
  });

  it("parses the nanosecond timestamps Ollama really sends", () => {
    assert.ok(Number.isFinite(Date.parse("2026-10-24T19:33:01.123456789+05:30")));
  });
});
