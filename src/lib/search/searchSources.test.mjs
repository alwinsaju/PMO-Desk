import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  combineRecordLoads,
  emptyStateFor,
  initialSources,
  loadedItems,
  pendingSources,
  sourceProblems,
  sourcesReducer,
} from "./searchSources.ts";
import { searchItems } from "./searchIndex.ts";

const item = (id, title) => ({
  id,
  kind: "todo",
  title,
  subtitle: "",
  keywords: "",
  target: { app: "pmo-todo" },
});
const settle = (state, source, result, at = 1) =>
  sourcesReducer(state, { type: "settled", source, result, at });
const ok = (...items) => ({ ok: true, items });

describe("sourcesReducer", () => {
  it("starts idle, so everything counts as pending", () => {
    assert.deepEqual(pendingSources(initialSources()), ["todos", "templates", "records"]);
  });

  it("moves idle -> loading -> ready and stops being pending", () => {
    let s = sourcesReducer(initialSources(), { type: "start", source: "todos" });
    assert.equal(s.todos.status, "loading");
    s = settle(s, "todos", ok(item("todo:1", "Sign-off")));
    assert.equal(s.todos.status, "ready");
    assert.deepEqual(pendingSources(s), ["templates", "records"]);
  });

  it("marks a source failed with its reason", () => {
    const s = settle(initialSources(), "todos", { ok: false, message: "No answer" });
    assert.equal(s.todos.status, "failed");
    assert.deepEqual(sourceProblems(s), ["To-dos could not be loaded: No answer"]);
    assert.ok(!pendingSources(s).includes("todos"));
  });

  it("a failed source goes back to loading when retried", () => {
    let s = settle(initialSources(), "todos", { ok: false, message: "x" });
    s = sourcesReducer(s, { type: "start", source: "todos" });
    assert.equal(s.todos.status, "loading");
    assert.equal(s.todos.error, null);
  });

  it("refreshing a ready source stays ready and keeps its items", () => {
    let s = settle(initialSources(), "todos", ok(item("todo:1", "A")));
    const before = s;
    s = sourcesReducer(s, { type: "start", source: "todos" });
    assert.equal(s, before);
    s = settle(s, "todos", { ok: false, message: "offline" }, 9);
    assert.equal(s.todos.status, "ready");
    assert.equal(s.todos.items.length, 1);
    assert.deepEqual(sourceProblems(s), []);
  });

  it("keeps an empty-but-loaded source ready when a refresh fails", () => {
    let s = settle(initialSources(), "todos", ok());
    s = settle(s, "todos", { ok: false, message: "offline" }, 9);
    assert.equal(s.todos.status, "ready");
  });
});

describe("emptyStateFor", () => {
  it("says it is still searching while any source is pending", () => {
    assert.deepEqual(emptyStateFor(initialSources(), "sign-off"), {
      kind: "searching",
      text: "Searching to-dos, templates and records…",
    });
  });

  it("names only the sources still pending", () => {
    let s = settle(initialSources(), "todos", ok());
    s = settle(s, "records", ok());
    assert.equal(emptyStateFor(s, "x").text, "Searching templates…");
  });

  it("says nothing matches once every source has answered", () => {
    let s = initialSources();
    s = settle(s, "todos", ok());
    s = settle(s, "templates", { ok: false, message: "down" });
    s = settle(s, "records", ok());
    assert.deepEqual(emptyStateFor(s, "  sign-off "), {
      kind: "none",
      text: "Nothing matches “sign-off”.",
    });
  });
});

describe("late sources", () => {
  it("a match from a source that arrives later shows up for the same query", () => {
    let s = initialSources();
    const query = "sign-off";
    const before = searchItems(loadedItems(s), query);
    assert.equal(before.length, 0);
    s = settle(s, "todos", ok(item("todo:1", "Get sign-off on dependency list")));
    const after = searchItems(loadedItems(s), query);
    assert.deepEqual(
      after.map((i) => i.id),
      ["todo:1"],
    );
  });
});

describe("combineRecordLoads", () => {
  const tool = (title, result) => ({ title, result });

  it("joins the items of every tool", () => {
    const out = combineRecordLoads([
      tool("RAID", ok(item("a", "A"))),
      tool("Vendors", ok(item("b", "B"))),
    ]);
    assert.equal(out.ok && out.items.length, 2);
    assert.equal(out.warning, undefined);
  });

  it("one broken tool leaves the rest searchable and is reported", () => {
    const out = combineRecordLoads([
      tool("RAID", ok(item("a", "A"))),
      tool("Vendors", { ok: false, message: "not found" }),
    ]);
    assert.equal(out.ok && out.items.length, 1);
    assert.match(out.warning, /Some PMO tool records could not be loaded \(Vendors\)/);
  });

  it("fails only when every tool failed", () => {
    const out = combineRecordLoads([
      tool("RAID", { ok: false, message: "nope" }),
      tool("Vendors", { ok: false, message: "nope" }),
    ]);
    assert.deepEqual(out, { ok: false, message: "nope" });
  });

  it("an empty tool list is simply empty", () => {
    assert.deepEqual(combineRecordLoads([]), { ok: true, items: [] });
  });
});
