import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { updatedLabel } from "./updatedLabel.ts";

const at = (min) => new Date(Date.UTC(2026, 9, 30, 10, min, 0));

describe("updatedLabel", () => {
  it("says just now for under a minute, or when the clock is slightly behind", () => {
    assert.equal(updatedLabel(at(0), at(0)), "Updated just now");
    assert.equal(updatedLabel(at(5), at(0)), "Updated just now");
    assert.equal(
      updatedLabel(new Date(at(0).getTime() + 59_000), at(0)),
      "Updated just now",
    );
  });
  it("counts minutes", () => {
    assert.equal(updatedLabel(at(0), at(1)), "Updated 1 min ago");
    assert.equal(updatedLabel(at(0), at(42)), "Updated 42 min ago");
  });
  it("counts hours, then falls back", () => {
    assert.equal(updatedLabel(at(0), at(60)), "Updated 1 h ago");
    assert.equal(updatedLabel(at(0), at(60 * 5 + 20)), "Updated 5 h ago");
    assert.equal(updatedLabel(at(0), at(60 * 30)), "Updated over a day ago");
  });
});
