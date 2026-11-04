// Run with `pnpm test`. How many dock tiles fit, and which are kept when they do not all fit.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DOCK_LABELLED_TILE_WIDTH,
  dockCapacity,
  splitDockItems,
} from "./dockOverflow.ts";

const ids = (list) => list.map((i) => i.id);
const items = (...names) => names.map((id) => ({ id }));

describe("dockCapacity", () => {
  it("grows with the screen and never drops below 3", () => {
    assert.ok(dockCapacity(1920) > dockCapacity(1024));
    assert.equal(dockCapacity(100), 3);
  });

  it("fits the 24 built-in apps on a wide screen but not at 1024", () => {
    assert.ok(dockCapacity(1920) >= 24);
    assert.ok(dockCapacity(1024) < 24);
  });

  it("has no limit for a junk width", () => {
    assert.equal(dockCapacity(Number.NaN), Number.POSITIVE_INFINITY);
    assert.equal(dockCapacity(Number.NaN, true), Number.POSITIVE_INFINITY);
  });

  it("is unchanged when labels are off", () => {
    for (const width of [600, 1024, 1366, 1920, 2560]) {
      assert.equal(dockCapacity(width, false), dockCapacity(width));
    }
  });

  it("fits fewer tiles when labels widen them, so more of the tail goes to the App Menu", () => {
    assert.ok(DOCK_LABELLED_TILE_WIDTH > 46);
    for (const width of [1024, 1366, 1920]) {
      assert.ok(dockCapacity(width, true) < dockCapacity(width, false));
    }
    assert.equal(dockCapacity(100, true), 3);
  });
});

describe("splitDockItems", () => {
  it("keeps everything when it fits", () => {
    const out = splitDockItems(items("a", "b", "c"), 3, new Set());
    assert.deepEqual(ids(out.shown), ["a", "b", "c"]);
    assert.deepEqual(out.hidden, []);
  });

  it("hides the tail in dock order when nothing is running", () => {
    const out = splitDockItems(items("a", "b", "c", "d", "e"), 3, new Set());
    assert.deepEqual(ids(out.shown), ["a", "b", "c"]);
    assert.deepEqual(ids(out.hidden), ["d", "e"]);
  });

  it("keeps running apps visible, in their original order", () => {
    const out = splitDockItems(items("a", "b", "c", "d", "e"), 3, new Set(["e"]));
    assert.deepEqual(ids(out.shown), ["a", "b", "e"]);
    assert.deepEqual(ids(out.hidden), ["c", "d"]);
  });

  it("never shows more than the capacity even if more are running", () => {
    const out = splitDockItems(items("a", "b", "c", "d"), 2, new Set(["b", "c", "d"]));
    assert.deepEqual(ids(out.shown), ["b", "c"]);
    assert.equal(out.hidden.length, 2);
  });
});
