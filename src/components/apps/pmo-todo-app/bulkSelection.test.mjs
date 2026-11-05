// Run with `pnpm test`. What the to-do bulk bar acts on: only ticked to-dos that are on screen.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bulkPatches, bulkSummary, bulkUndo } from "../../../lib/pmo/pmoViews.ts";
import { appliedUndo, todoBulkSelection } from "./bulkSelection.ts";

const todo = (id, over = {}) => ({
  id,
  title: `Title ${id}`,
  status: "open",
  priority: "normal",
  tags: [],
  reminders: { enabled: false, remindAt: null, snoozedUntil: null, lastRemindedAt: null },
  ...over,
});
const a = todo("a");
const b = todo("b");
const c = todo("c", { status: "done" });
const all = [a, b, c];
const ids = (list) => list.map((t) => t.id);

describe("todoBulkSelection", () => {
  it("counts every ticked to-do when none is hidden", () => {
    const sel = todoBulkSelection(all, all, new Set(["a", "b"]));
    assert.deepEqual(ids(sel.todos), ["a", "b"]);
    assert.equal(sel.hidden, 0);
    assert.equal(sel.text, "2 ticked");
  });

  it("leaves out ticked to-dos the filter hides and says so (the QA case)", () => {
    // Two ticked, the search shows only one of them.
    const sel = todoBulkSelection([a], all, new Set(["a", "b"]));
    assert.deepEqual(ids(sel.todos), ["a"]);
    assert.equal(sel.hidden, 1);
    assert.equal(sel.text, "1 ticked (1 more hidden by the filter, not included)");
  });

  it("every bulk action only sees the visible ticked to-dos", () => {
    const sel = todoBulkSelection([a], all, new Set(["a", "b"]));
    for (const action of [
      { type: "done" },
      { type: "cancel" },
      { type: "snooze", until: "2026-11-06T03:30:00.000Z" },
      { type: "priority", priority: "high" },
      { type: "tag", tag: "x" },
    ]) {
      assert.deepEqual(ids(bulkPatches(action, sel.todos)), ["a"], action.type);
      assert.deepEqual(ids(bulkUndo(action, sel.todos)), ["a"], `${action.type} undo`);
    }
  });

  it("keeps the order shown and ignores ticked ids that no longer exist", () => {
    const sel = todoBulkSelection([b, a], [a, b], new Set(["a", "b", "deleted"]));
    assert.deepEqual(ids(sel.todos), ["b", "a"]);
    assert.equal(sel.hidden, 0);
  });

  it("has no actionable to-dos when everything ticked is hidden", () => {
    const sel = todoBulkSelection([c], all, new Set(["a", "b"]));
    assert.equal(sel.todos.length, 0);
    assert.equal(sel.hidden, 2);
    assert.equal(sel.text, "0 ticked (2 more hidden by the filter, not included)");
  });

  it("does not change the selection it was given", () => {
    const selected = new Set(["a", "b"]);
    todoBulkSelection([a], all, selected);
    assert.deepEqual([...selected], ["a", "b"]);
  });
});

describe("appliedUndo", () => {
  it("undoes exactly what was changed, and the summary counts the same", () => {
    const sel = todoBulkSelection([a, b], all, new Set(["a", "b", "c"]));
    const action = { type: "done" };
    const patches = bulkPatches(action, sel.todos);
    const undo = bulkUndo(action, sel.todos);
    assert.deepEqual(ids(undo), ["a", "b"]);
    assert.deepEqual(ids(appliedUndo(patches, undo, [true, true])), ["a", "b"]);
    // The server refused b: there is nothing of b's to put back.
    assert.deepEqual(ids(appliedUndo(patches, undo, [true, false])), ["a"]);
    assert.deepEqual(appliedUndo(patches, undo, [false, false]), []);
    assert.equal(bulkSummary(action, patches.length), "Marked 2 to-dos done.");
  });
});
