// Run with `pnpm test`. The session log's ring buffer and event rules.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LABEL_MAX, RingLog, cleanText, levelFor } from "./log.ts";

const clock = (start = 1_000) => {
  const c = { now: start };
  return { c, fn: () => c.now };
};

const start = (call, extra = {}) => ({
  kind: "call-start",
  call,
  task: "structure",
  label: "Cutover checklist",
  model: "gemma4:12b",
  keepAlive: "2m",
  think: false,
  modelLoaded: true,
  queueWaiting: 0,
  ...extra,
});
const end = (call, extra = {}) => ({
  kind: "call-end",
  call,
  task: "structure",
  model: "gemma4:12b",
  ok: true,
  durationMs: 1000,
  attempts: 1,
  ...extra,
});

describe("RingLog", () => {
  it("numbers events from 1, stamps time and level, and returns them oldest first", () => {
    const { c, fn } = clock(5_000);
    const log = new RingLog(10, fn);
    assert.equal(log.latestSeq, 0);
    const a = log.emit(start("c1"));
    c.now = 6_000;
    const b = log.emit(end("c1"));
    assert.deepEqual([a.seq, b.seq], [1, 2]);
    assert.deepEqual([a.ts, b.ts], [5_000, 6_000]);
    assert.deepEqual([a.level, b.level], ["info", "info"]);
    assert.equal(log.latestSeq, 2);
    assert.deepEqual(
      log.all().map((e) => e.kind),
      ["call-start", "call-end"],
    );
  });

  it("returns only events after the cursor (and everything for 0 / junk)", () => {
    const log = new RingLog(50);
    for (let i = 0; i < 6; i++) log.emit({ kind: "prewarm-skipped", reason: "disabled" });
    assert.deepEqual(
      log.since(4).map((e) => e.seq),
      [5, 6],
    );
    assert.deepEqual(log.since(6), []);
    assert.deepEqual(log.since(99), []);
    assert.equal(log.since(0).length, 6);
    assert.equal(log.since(-3).length, 6);
    assert.equal(log.since(Number.NaN).length, 6);
  });

  it("drops the oldest events past the capacity but keeps counting", () => {
    const log = new RingLog(1000);
    for (let i = 0; i < 1250; i++)
      log.emit({ kind: "prewarm-skipped", reason: "disabled" });
    assert.equal(log.size, 1000);
    assert.equal(log.latestSeq, 1250);
    assert.equal(log.oldestSeq, 251);
    assert.equal(log.since(1248).length, 2);
    // A cursor older than the buffer simply gets what is left.
    assert.equal(log.since(10).length, 1000);
    assert.equal(new RingLog().capacity, 1000);
  });

  it("has a session id that differs between instances", () => {
    assert.notEqual(new RingLog().session, new RingLog().session);
    assert.match(new RingLog().session, /^[a-z0-9]+$/);
  });

  it("hands out call ids in order", () => {
    const log = new RingLog();
    assert.deepEqual(
      [log.nextCallId(), log.nextCallId(), log.nextCallId()],
      ["c1", "c2", "c3"],
    );
  });

  it("keeps free text short and on one line, and drops undefined fields", () => {
    const log = new RingLog();
    const long = "x".repeat(500);
    const event = log.emit(
      start("c1", {
        label: `  Re:\n  budget\t${long}`,
        queueWaiting: 0,
        think: undefined,
      }),
    );
    assert.ok(event.label.length <= LABEL_MAX);
    assert.match(event.label, /^Re: budget x+…$/);
    assert.equal("think" in event, false);
    const ended = log.emit(
      end("c1", { ok: false, errorCode: "timeout", message: long, note: long }),
    );
    assert.ok(ended.message.length <= 200);
    assert.ok(ended.note.length <= 80);
    assert.equal(cleanText("   ", 10), undefined);
    assert.equal(cleanText(42, 10), undefined);
    assert.equal(cleanText("a\u0000b\u2028c", 10), "a b c");
  });

  it("tracks calls in flight, the idle clock and a pending wake", () => {
    const { c, fn } = clock(0);
    const log = new RingLog(10, fn);
    log.emit(start("c1", { modelLoaded: false }));
    assert.deepEqual(
      log.activeCalls().map((a) => [a.call, a.task, a.label, a.modelLoadedBefore]),
      [["c1", "structure", "Cutover checklist", false]],
    );
    assert.deepEqual(log.pendingWake, { ts: 0, task: "structure" });
    c.now = 9_000;
    log.emit(end("c1"));
    assert.deepEqual(log.activeCalls(), []);
    assert.equal(log.lastCallEndAt, 9_000);
    // A call on a loaded model does not claim to have woken it.
    log.pendingWake = null;
    log.emit(start("c2", { modelLoaded: true }));
    assert.equal(log.pendingWake, null);
  });

  it("announces the server going up or down once per change", () => {
    const log = new RingLog();
    const up = { kind: "server-up", how: "reused", owned: false, baseUrl: "http://x" };
    const down = { kind: "server-down", message: "gone", willRetry: true };
    assert.ok(log.emitServer(up));
    assert.equal(log.emitServer(up), null);
    assert.ok(log.emitServer(down));
    assert.equal(log.emitServer(down), null);
    assert.ok(log.emitServer(up));
    assert.equal(log.size, 3);
    // Stopping forgets the state so the next start is announced.
    log.emit({ kind: "server-stop", owned: true, stopped: true });
    assert.ok(log.emitServer(up));
  });
});

describe("event levels", () => {
  it("only trouble is a warning or an error", () => {
    assert.equal(levelFor(start("c1")), "info");
    assert.equal(levelFor(end("c1")), "info");
    assert.equal(levelFor(end("c1", { ok: false, errorCode: "timeout" })), "warn");
    assert.equal(levelFor(end("c1", { ok: false, errorCode: "invalid-output" })), "warn");
    assert.equal(levelFor(end("c1", { ok: false, errorCode: "cancelled" })), "warn");
    assert.equal(levelFor(end("c1", { ok: false, errorCode: "runtime-down" })), "error");
    assert.equal(levelFor(end("c1", { ok: false, errorCode: "model-missing" })), "error");
    assert.equal(
      levelFor({ kind: "call-retry", call: "c1", attempt: 2, reason: "invalid-json" }),
      "warn",
    );
    assert.equal(
      levelFor({ kind: "server-down", message: "x", willRetry: true }),
      "error",
    );
    assert.equal(
      levelFor({
        kind: "model-unloaded",
        model: "m",
        ours: true,
        sizeBytes: 1,
        reason: "idle",
      }),
      "info",
    );
  });
});
