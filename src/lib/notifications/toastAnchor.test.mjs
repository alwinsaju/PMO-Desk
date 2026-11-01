// Run with `pnpm test`. Where the toast stack sits.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toastAnchorBox } from "./toastAnchor.ts";

const viewport = { width: 1600, height: 900 };

describe("toastAnchorBox", () => {
  it("uses the active window's box", () => {
    const box = toastAnchorBox({ left: 100, top: 80, width: 900, height: 600 }, viewport);
    assert.deepEqual(box, { left: 100, top: 80, width: 900, height: 600 });
  });

  it("cuts the box to the part of the window that is on screen", () => {
    const box = toastAnchorBox(
      { left: 1200, top: 500, width: 800, height: 700 },
      viewport,
    );
    assert.deepEqual(box, { left: 1200, top: 500, width: 400, height: 400 });
  });

  it("falls back to the screen corner when there is no window", () => {
    assert.equal(toastAnchorBox(null, viewport), null);
  });

  it("falls back when too little of the window is visible to hold a toast", () => {
    assert.equal(
      toastAnchorBox({ left: 1500, top: 100, width: 800, height: 600 }, viewport),
      null,
    );
    assert.equal(
      toastAnchorBox({ left: 100, top: 850, width: 800, height: 600 }, viewport),
      null,
    );
  });

  it("falls back for an empty box", () => {
    assert.equal(
      toastAnchorBox({ left: 10, top: 10, width: 0, height: 0 }, viewport),
      null,
    );
  });
});
