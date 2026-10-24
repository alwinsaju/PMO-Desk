// Run with `pnpm test`. The polled state keeps the identity of whatever did not
// change between two polls.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shareUnchanged } from "./shareState.ts";

const make = (over = {}) => ({
  serverTime: "2026-10-24T10:00:00Z",
  todos: [
    { id: "a", title: "A", items: [{ id: 1, done: false }] },
    { id: "b", title: "B", items: [] },
  ],
  config: { reminders: { enabled: true }, names: ["x", "y"] },
  ...over,
});

describe("shareUnchanged", () => {
  it("returns the previous object when nothing changed", () => {
    const prev = make();
    assert.equal(shareUnchanged(prev, make()), prev);
  });

  it("reuses every unchanged branch and replaces only the path to a change", () => {
    const prev = make();
    const next = shareUnchanged(
      prev,
      make({
        serverTime: "2026-10-24T10:00:03Z",
        todos: [
          { id: "a", title: "A", items: [{ id: 1, done: true }] },
          { id: "b", title: "B", items: [] },
        ],
      }),
    );
    assert.notEqual(next, prev);
    assert.equal(next.serverTime, "2026-10-24T10:00:03Z");
    assert.equal(next.config, prev.config, "untouched sibling object");
    assert.notEqual(next.todos, prev.todos);
    assert.notEqual(next.todos[0], prev.todos[0]);
    assert.equal(next.todos[1], prev.todos[1], "the other to-do keeps its identity");
    assert.equal(next.todos[0].items[0].done, true);
  });

  it("handles added, removed and reordered list items", () => {
    const prev = make();
    const added = shareUnchanged(
      prev,
      make({ todos: [...make().todos, { id: "c", title: "C", items: [] }] }),
    );
    assert.equal(added.todos.length, 3);
    assert.equal(added.todos[0], prev.todos[0]);
    assert.equal(added.todos[1], prev.todos[1]);
    const removed = shareUnchanged(prev, make({ todos: [make().todos[0]] }));
    assert.deepEqual(
      removed.todos.map((t) => t.id),
      ["a"],
    );
    assert.equal(removed.todos[0], prev.todos[0]);
    const swapped = shareUnchanged(prev, make({ todos: [...make().todos].reverse() }));
    assert.deepEqual(
      swapped.todos.map((t) => t.id),
      ["b", "a"],
    );
  });

  it("copes with a first poll, type changes and null", () => {
    const first = make();
    assert.equal(shareUnchanged(null, first), first);
    assert.equal(shareUnchanged(undefined, 5), 5);
    assert.deepEqual(shareUnchanged({ a: 1 }, { a: null }), { a: null });
    assert.deepEqual(shareUnchanged({ a: [1] }, { a: { b: 1 } }), { a: { b: 1 } });
    assert.deepEqual(shareUnchanged({ a: 1, b: 2 }, { a: 1 }), { a: 1 });
  });

  it("never returns a value that differs from next", () => {
    const prev = make();
    const next = make({ config: { reminders: { enabled: false }, names: ["x"] } });
    assert.deepEqual(shareUnchanged(prev, next), next);
  });
});
