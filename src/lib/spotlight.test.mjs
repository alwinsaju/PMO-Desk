// Run with `pnpm test`. The cursor-spotlight math against FAKE elements.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applySpotlight, onSpotlightMove } from "./spotlight.ts";

function fakeSpot(left, top) {
  const vars = {};
  return {
    vars,
    getBoundingClientRect: () => ({ left, top }),
    style: { setProperty: (k, v) => (vars[k] = v) },
  };
}

describe("applySpotlight", () => {
  it("sets --mx/--my relative to the innermost .spot", () => {
    const spot = fakeSpot(100, 40);
    const target = { closest: (sel) => (sel === ".spot" ? spot : null) };
    const hit = applySpotlight(target, 130, 90);
    assert.equal(hit, spot);
    assert.deepEqual(spot.vars, { "--mx": "30px", "--my": "50px" });
  });

  it("does nothing outside a .spot (or with no target)", () => {
    assert.equal(applySpotlight({ closest: () => null }, 1, 1), null);
    assert.equal(applySpotlight(null, 1, 1), null);
    assert.equal(applySpotlight({}, 1, 1), null);
  });
});

describe("onSpotlightMove", () => {
  it("ignores touch pointers", () => {
    const spot = fakeSpot(0, 0);
    onSpotlightMove({
      target: { closest: () => spot },
      clientX: 5,
      clientY: 5,
      pointerType: "touch",
    });
    assert.deepEqual(spot.vars, {});
  });

  it("follows mouse and pen pointers", () => {
    const spot = fakeSpot(10, 10);
    onSpotlightMove({
      target: { closest: () => spot },
      clientX: 15,
      clientY: 25,
      pointerType: "mouse",
    });
    assert.deepEqual(spot.vars, { "--mx": "5px", "--my": "15px" });
  });
});
