import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  IDLE_THINKING,
  SLOW_HINT_AFTER_SECONDS,
  STOPPED_NOTICE,
  isThinking,
  thinkingHint,
  thinkingReducer,
} from "./thinkingState.ts";

const run = (actions, from = IDLE_THINKING) => actions.reduce(thinkingReducer, from);

describe("thinkingReducer", () => {
  it("starts idle", () => {
    assert.equal(isThinking(IDLE_THINKING), false);
    assert.equal(IDLE_THINKING.stopped, false);
  });

  it("start begins the clock at zero", () => {
    const s = run([{ type: "start", at: 1000 }]);
    assert.equal(isThinking(s), true);
    assert.equal(s.elapsedSeconds, 0);
    assert.equal(s.stopped, false);
  });

  it("tick counts whole elapsed seconds", () => {
    const s = run([
      { type: "start", at: 1000 },
      { type: "tick", now: 13_900 },
    ]);
    assert.equal(s.elapsedSeconds, 12);
  });

  it("tick keeps the same state object when the second has not changed", () => {
    const a = run([
      { type: "start", at: 0 },
      { type: "tick", now: 5200 },
    ]);
    assert.equal(thinkingReducer(a, { type: "tick", now: 5900 }), a);
  });

  it("tick never goes negative and is ignored while idle", () => {
    const s = run([
      { type: "start", at: 5000 },
      { type: "tick", now: 1000 },
    ]);
    assert.equal(s.elapsedSeconds, 0);
    assert.equal(
      thinkingReducer(IDLE_THINKING, { type: "tick", now: 9000 }),
      IDLE_THINKING,
    );
  });

  it("stop returns to idle and remembers it was stopped", () => {
    const s = run([
      { type: "start", at: 0 },
      { type: "tick", now: 30_000 },
      { type: "stop" },
    ]);
    assert.equal(isThinking(s), false);
    assert.equal(s.stopped, true);
    assert.equal(s.elapsedSeconds, 0);
  });

  it("stop while idle changes nothing", () => {
    assert.equal(thinkingReducer(IDLE_THINKING, { type: "stop" }), IDLE_THINKING);
  });

  it("finish and a new start both clear the stopped flag", () => {
    const stopped = run([{ type: "start", at: 0 }, { type: "stop" }]);
    assert.equal(thinkingReducer(stopped, { type: "finish" }), IDLE_THINKING);
    assert.equal(thinkingReducer(stopped, { type: "start", at: 5 }).stopped, false);
  });
});

describe("thinkingHint", () => {
  it("stays quiet at first, then warns that local models are slow and how to stop", () => {
    assert.equal(thinkingHint(0), null);
    assert.equal(thinkingHint(SLOW_HINT_AFTER_SECONDS - 1), null);
    const hint = thinkingHint(SLOW_HINT_AFTER_SECONDS);
    assert.match(hint, /minute/i);
    assert.match(hint, /Esc/);
  });
});

describe("STOPPED_NOTICE", () => {
  it("is the short confirmation", () => {
    assert.equal(STOPPED_NOTICE, "Stopped.");
  });
});
