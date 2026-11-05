// Ticking rows: toggling, the header box, and acting only on rows that are on screen.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allSelected,
  selectedText,
  selectionView,
  toggleAll,
  toggleId,
  withoutIds,
} from "./multiSelect.ts";

describe("toggleId", () => {
  it("ticks and unticks without changing the original", () => {
    const start = new Set(["a"]);
    const added = toggleId(start, "b");
    assert.deepEqual([...added], ["a", "b"]);
    assert.deepEqual([...toggleId(added, "a")], ["b"]);
    assert.deepEqual([...start], ["a"]);
  });
});

describe("allSelected / toggleAll", () => {
  it("is false for an empty list", () => {
    assert.equal(allSelected(new Set(["a"]), []), false);
  });

  it("ticks every shown row, then unticks them, leaving hidden ticks alone", () => {
    const shown = ["a", "b"];
    const ticked = toggleAll(new Set(["z"]), shown);
    assert.deepEqual([...ticked].sort(), ["a", "b", "z"]);
    assert.equal(allSelected(ticked, shown), true);
    assert.deepEqual([...toggleAll(ticked, shown)], ["z"]);
  });

  it("ticks the rest when only some are ticked", () => {
    assert.deepEqual([...toggleAll(new Set(["a"]), ["a", "b"])].sort(), ["a", "b"]);
  });
});

describe("withoutIds", () => {
  it("drops the given ids", () => {
    assert.deepEqual([...withoutIds(new Set(["a", "b", "c"]), ["a", "c", "x"])], ["b"]);
  });
});

describe("selectionView", () => {
  const rows = (...ids) => ids.map((id) => ({ id }));

  it("keeps shown order and counts ticked rows hidden by a filter", () => {
    const all = ["a", "b", "c", "d"];
    const view = selectionView(rows("c", "a"), all, new Set(["a", "b", "c"]));
    assert.deepEqual(
      view.visible.map((r) => r.id),
      ["c", "a"],
    );
    assert.equal(view.hidden, 1);
  });

  it("does not count ticked ids that no longer exist", () => {
    const view = selectionView(rows("a"), ["a"], new Set(["a", "gone"]));
    assert.equal(view.visible.length, 1);
    assert.equal(view.hidden, 0);
  });
});

describe("selectedText", () => {
  it("mentions hidden rows only when there are some", () => {
    assert.equal(selectedText(3, 0), "3 selected");
    assert.match(selectedText(3, 2), /3 selected \(2 more hidden by the filter/);
    assert.equal(selectedText(2, 0, "ticked"), "2 ticked");
    assert.equal(
      selectedText(1, 1, "ticked"),
      "1 ticked (1 more hidden by the filter, not included)",
    );
  });
});
