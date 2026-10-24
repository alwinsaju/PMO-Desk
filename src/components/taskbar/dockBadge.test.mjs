// Run with `pnpm test`. The dock tile count badge's text and spoken label.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { badgeText, badgedLabel } from "./dockBadge.ts";

describe("dock badge", () => {
  it("shows nothing for zero, negatives and junk", () => {
    for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY, 0.4]) {
      assert.equal(badgeText(bad), null);
    }
  });

  it("shows the number, then 9+", () => {
    assert.equal(badgeText(1), "1");
    assert.equal(badgeText(9), "9");
    assert.equal(badgeText(10), "9+");
    assert.equal(badgeText(120), "9+");
  });

  it("extends the tile label only when there is a badge", () => {
    assert.equal(badgedLabel("PMO To-Do", 0), "PMO To-Do");
    assert.equal(badgedLabel("PMO To-Do", 3), "PMO To-Do, 3 need attention");
    assert.equal(badgedLabel("PMO To-Do", 12), "PMO To-Do, 12 need attention");
  });
});
