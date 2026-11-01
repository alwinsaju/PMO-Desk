// Run with `pnpm test`. The geometry and plan of the Deloitte switch animation.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { REVEAL_MS, revealRadius, ringPlan } from "./lookTransition.ts";

describe("revealRadius", () => {
  it("reaches the farthest corner", () => {
    assert.equal(revealRadius({ x: 0, y: 0 }, { width: 300, height: 400 }), 500);
    assert.equal(revealRadius({ x: 300, y: 400 }, { width: 300, height: 400 }), 500);
  });

  it("from the middle it is half the diagonal", () => {
    assert.equal(revealRadius({ x: 500, y: 300 }, { width: 1000, height: 600 }), 584);
  });

  it("always covers the whole screen from any point", () => {
    const viewport = { width: 1440, height: 900 };
    for (const [x, y] of [
      [0, 0],
      [1440, 900],
      [720, 450],
      [1300, 40],
      [10, 880],
    ]) {
      const r = revealRadius({ x, y }, viewport);
      for (const [cx, cy] of [
        [0, 0],
        [1440, 0],
        [0, 900],
        [1440, 900],
      ]) {
        assert.ok(Math.hypot(cx - x, cy - y) <= r);
      }
    }
  });
});

describe("ringPlan", () => {
  it("has three rings that trail one another and shrink in reach", () => {
    const rings = ringPlan(true);
    assert.equal(rings.length, 3);
    assert.deepEqual(
      rings.map((r) => r.delay),
      [0, 110, 220],
    );
    assert.ok(rings[0].reach > rings[1].reach && rings[1].reach > rings[2].reach);
    assert.ok(rings[0].opacity > rings[2].opacity);
  });

  it("every ring finishes inside the reveal plus a short tail", () => {
    for (const ring of ringPlan(true)) {
      assert.ok(ring.delay + REVEAL_MS - ring.delay * 0.4 <= REVEAL_MS + 150);
    }
  });

  it("uses the Deloitte greens and blue when entering, other colours when leaving", () => {
    assert.deepEqual(
      ringPlan(true).map((r) => r.color),
      ["#86eb22", "#00a3e0", "#86bc25"],
    );
    const leaving = ringPlan(false).map((r) => r.color);
    assert.equal(
      leaving.some((c) => ["#86eb22", "#86bc25", "#00a3e0"].includes(c)),
      false,
    );
  });
});
