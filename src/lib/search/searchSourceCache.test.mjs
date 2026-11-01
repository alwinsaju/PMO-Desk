import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSourceCache } from "./searchSourceCache.ts";

const todo = {
  id: "todo:1",
  kind: "todo",
  title: "A",
  subtitle: "",
  keywords: "",
  target: { app: "x" },
};

/** Loaders that count their calls and answer when the test says so. */
function setup() {
  let clock = 0;
  const calls = { todos: 0, templates: 0, records: 0 };
  const pending = { todos: [], templates: [], records: [] };
  const loaders = Object.fromEntries(
    Object.keys(calls).map((id) => [
      id,
      () => {
        calls[id] += 1;
        return new Promise((resolve, reject) => pending[id].push({ resolve, reject }));
      },
    ]),
  );
  const cache = createSourceCache({ loaders, now: () => clock });
  const answerAll = (items = []) =>
    Object.values(pending).forEach((queue) =>
      queue.splice(0).forEach((p) => p.resolve({ ok: true, items })),
    );
  return {
    cache,
    calls,
    pending,
    answerAll,
    advance: (ms) => {
      clock += ms;
    },
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe("createSourceCache", () => {
  it("loads every source once and shares in-flight loads", async () => {
    const t = setup();
    const a = t.cache.ensure(60_000);
    const b = t.cache.ensure(60_000);
    assert.deepEqual(t.calls, { todos: 1, templates: 1, records: 1 });
    t.answerAll([todo]);
    await Promise.all([a, b]);
    assert.equal(t.cache.getState().todos.status, "ready");
  });

  it("reuses fresh data and refreshes stale data in the background", async () => {
    const t = setup();
    const first = t.cache.ensure(60_000);
    t.answerAll([todo]);
    await first;

    t.advance(10_000);
    await t.cache.ensure(60_000);
    assert.equal(t.calls.todos, 1, "within the prefetch window: no new request");

    t.advance(10_000);
    const refresh = t.cache.ensure(5_000);
    assert.equal(t.calls.todos, 2, "older than the open window: refresh starts");
    assert.equal(t.cache.getState().todos.status, "ready", "old items stay visible");
    assert.equal(t.cache.getState().todos.items.length, 1);
    t.answerAll([todo, { ...todo, id: "todo:2" }]);
    await refresh;
    assert.equal(t.cache.getState().todos.items.length, 2);
  });

  it("the TTL boundary is exact", async () => {
    const t = setup();
    const first = t.cache.ensure(1000);
    t.answerAll();
    await first;
    t.advance(999);
    await t.cache.ensure(1000);
    assert.equal(t.calls.todos, 1);
    t.advance(1);
    void t.cache.ensure(1000);
    assert.equal(t.calls.todos, 2);
  });

  it("turns a thrown loader into a failed source and retries it next time", async () => {
    const t = setup();
    const first = t.cache.ensure(60_000);
    t.pending.todos.splice(0).forEach((p) => p.reject(new Error("socket hang up")));
    t.answerAll();
    await first;
    assert.equal(t.cache.getState().todos.status, "failed");
    assert.equal(t.cache.getState().todos.error, "socket hang up");

    const retry = t.cache.ensure(60_000);
    assert.equal(t.calls.todos, 2);
    assert.equal(t.calls.templates, 1, "sources that worked are not reloaded");
    t.answerAll([todo]);
    await retry;
    assert.equal(t.cache.getState().todos.status, "ready");
  });

  it("notifies subscribers on change only, and stops after unsubscribe", async () => {
    const t = setup();
    let notified = 0;
    const off = t.cache.subscribe(() => (notified += 1));
    const first = t.cache.ensure(60_000);
    const afterStart = notified;
    assert.equal(afterStart, 3);
    t.answerAll();
    await first;
    assert.equal(notified, 6);
    off();
    t.advance(100_000);
    void t.cache.ensure(0);
    await tick();
    assert.equal(notified, 6);
  });

  it("keeps the state object stable while nothing changes", async () => {
    const t = setup();
    const first = t.cache.ensure(60_000);
    t.answerAll();
    await first;
    const before = t.cache.getState();
    await t.cache.ensure(60_000);
    assert.equal(t.cache.getState(), before);
  });
});
