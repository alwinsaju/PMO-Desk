import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_POLL_INTERVAL_MS,
  POLL_INTERVAL_MS,
  mergePoll,
  pollDelay,
} from "./pollLogic.ts";

test("pollDelay: the usual interval, longer after a slow answer, never beyond the cap", () => {
  assert.equal(pollDelay(40), POLL_INTERVAL_MS);
  assert.equal(pollDelay(1000), 5000);
  assert.equal(pollDelay(1200), 6000);
  assert.equal(pollDelay(60_000), MAX_POLL_INTERVAL_MS);
});

test("mergePoll: an unchanged answer moves only the clock", () => {
  const prev = { serverTime: "a", todos: [{ id: 1 }], today: "2026-11-05" };
  const next = mergePoll(prev, { unchanged: true, serverTime: "b" });
  assert.equal(next.serverTime, "b");
  assert.equal(next.todos, prev.todos);
  assert.equal(mergePoll(null, { unchanged: true, serverTime: "b" }), null);
});

test("mergePoll: a new document shares what did not change", () => {
  const prev = { serverTime: "a", todos: [{ id: 1 }, { id: 2 }], today: "d" };
  const state = { serverTime: "b", todos: [{ id: 1 }, { id: 3 }], today: "d" };
  const next = mergePoll(prev, { unchanged: false, state, digest: "x" });
  assert.equal(next.todos[0], prev.todos[0]);
  assert.equal(next.todos[1].id, 3);
  assert.equal(mergePoll(null, { unchanged: false, state, digest: null }), state);
});
