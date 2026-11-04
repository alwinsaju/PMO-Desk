import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { edgeZone, snapKey, snapRect, snapTarget, SNAP_GAP } from "./windowSnap.ts";
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

describe("snapTarget (live preview)", () => {
  const points = {
    left: { x: 0, y: 400 },
    right: { x: 1426, y: 400 },
    "top-left": { x: 8, y: 90 },
    "top-right": { x: 1418, y: 0 },
    "bottom-left": { x: 3, y: 850 - 90 },
    "bottom-right": { x: 1426, y: 849 },
  };

  it("covers all six zones, with the rect the drop will use", () => {
    for (const [zone, point] of Object.entries(points)) {
      const target = snapTarget(point, vp, insets);
      assert.equal(target.zone, zone);
      assert.deepEqual(target.rect, snapRect(zone, vp, insets));
    }
  });

  it("is null where no zone applies", () => {
    assert.equal(snapTarget({ x: 700, y: 400 }, vp, insets), null);
    assert.equal(snapTarget({ x: 9, y: 400 }, vp, insets), null);
    assert.equal(snapTarget({ x: 1417, y: 400 }, vp, insets), null);
    assert.equal(snapTarget({ x: 700, y: 0 }, vp, insets), null);
  });

  it("switches between a half and a quarter at the corner band", () => {
    assert.equal(snapTarget({ x: 2, y: 91 }, vp, insets).zone, "left");
    assert.equal(snapTarget({ x: 2, y: 90 }, vp, insets).zone, "top-left");
    assert.equal(snapTarget({ x: 2, y: 850 - 91 }, vp, insets).zone, "left");
    assert.equal(snapTarget({ x: 2, y: 850 - 90 }, vp, insets).zone, "bottom-left");
  });

  it("follows the insets", () => {
    const wide = { side: 40, top: 100, bottom: 120 };
    const a = snapTarget(points.left, vp, insets).rect;
    const b = snapTarget(points.left, vp, wide).rect;
    assert.equal(b.x, 40);
    assert.equal(b.y, 100);
    assert.equal(b.height, 850 - 100 - 120);
    assert.notDeepEqual(a, b);
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
