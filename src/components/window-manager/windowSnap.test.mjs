import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { edgeZone, snapKey, snapRect, SNAP_GAP } from "./windowSnap.ts";
import { mruOrder, stepIndex, switcherKey } from "./windowSwitch.ts";

const vp = { width: 1426, height: 850 };
const insets = { side: 12, top: 88, bottom: 96 };

describe("snapRect", () => {
  it("halves the keep-clear area with a gap between", () => {
    const left = snapRect("left", vp, insets);
    const right = snapRect("right", vp, insets);
    assert.equal(left.x, 12);
    assert.equal(left.y, 88);
    assert.equal(left.height, 850 - 88 - 96);
    assert.equal(right.x - (left.x + left.width), SNAP_GAP);
    assert.equal(right.x + right.width, 1426 - 12);
  });

  it("quarters stay inside the area and do not overlap", () => {
    const tl = snapRect("top-left", vp, insets);
    const br = snapRect("bottom-right", vp, insets);
    assert.ok(tl.x + tl.width < br.x);
    assert.ok(tl.y + tl.height < br.y);
    assert.equal(br.x + br.width, 1426 - 12);
    assert.equal(br.y + br.height, 850 - 96);
  });
});

describe("edgeZone", () => {
  it("snaps at the left and right edges, with corners near the ends", () => {
    assert.equal(edgeZone({ x: 2, y: 400 }, vp), "left");
    assert.equal(edgeZone({ x: 1424, y: 400 }, vp), "right");
    assert.equal(edgeZone({ x: 2, y: 20 }, vp), "top-left");
    assert.equal(edgeZone({ x: 1424, y: 840 }, vp), "bottom-right");
  });

  it("does nothing in the middle or at the top and bottom edges", () => {
    assert.equal(edgeZone({ x: 700, y: 400 }, vp), null);
    assert.equal(edgeZone({ x: 700, y: 2 }, vp), null);
    assert.equal(edgeZone({ x: 700, y: 848 }, vp), null);
  });
});

describe("snapKey", () => {
  const ca = { ctrlKey: true, altKey: true };
  it("maps Ctrl+Alt arrows and number-pad corners", () => {
    assert.equal(snapKey({ key: "ArrowLeft", ...ca }), "left");
    assert.equal(snapKey({ key: "ArrowRight", ...ca }), "right");
    assert.equal(snapKey({ key: "ArrowUp", ...ca }), "maximize");
    assert.equal(snapKey({ key: "ArrowDown", ...ca }), "restore");
    assert.equal(snapKey({ key: "7", ...ca }), "top-left");
    assert.equal(snapKey({ key: "3", ...ca }), "bottom-right");
  });

  it("ignores other combinations", () => {
    assert.equal(snapKey({ key: "ArrowLeft", ctrlKey: true }), null);
    assert.equal(snapKey({ key: "ArrowLeft", ...ca, shiftKey: true }), null);
    assert.equal(snapKey({ key: "ArrowLeft", ...ca, metaKey: true }), null);
    assert.equal(snapKey({ key: "x", ...ca }), null);
  });
});

describe("switcher", () => {
  it("orders windows most recent first and steps both ways with wrap", () => {
    const order = mruOrder([
      { id: "a", zIndex: 100 },
      { id: "c", zIndex: 102 },
      { id: "b", zIndex: 101 },
    ]).map((w) => w.id);
    assert.deepEqual(order, ["c", "b", "a"]);
    assert.equal(stepIndex(0, 3, false), 1);
    assert.equal(stepIndex(2, 3, false), 0);
    assert.equal(stepIndex(0, 3, true), 2);
    assert.equal(stepIndex(0, 0, false), 0);
  });

  it("recognises Ctrl+Tab and Ctrl+Shift+Tab only", () => {
    assert.equal(switcherKey({ key: "Tab", ctrlKey: true }), "next");
    assert.equal(switcherKey({ key: "Tab", ctrlKey: true, shiftKey: true }), "previous");
    assert.equal(switcherKey({ key: "Tab" }), null);
    assert.equal(switcherKey({ key: "Tab", ctrlKey: true, altKey: true }), null);
    assert.equal(switcherKey({ key: "k", ctrlKey: true }), null);
  });
});
