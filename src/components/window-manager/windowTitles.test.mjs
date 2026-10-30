import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attentionSuffix, titleWithSuffix } from "./windowTitles.ts";

describe("window title suffix", () => {
  it("says what is waiting, in the right grammar", () => {
    assert.equal(attentionSuffix(1), "1 needs attention");
    assert.equal(attentionSuffix(3), "3 need attention");
    assert.equal(attentionSuffix(2.9), "2 need attention");
  });

  it("says nothing when nothing is waiting or the count is not a number", () => {
    for (const n of [0, -2, NaN, Infinity]) assert.equal(attentionSuffix(n), null);
  });

  it("adds the suffix in brackets, or leaves the title alone", () => {
    assert.equal(
      titleWithSuffix("PMO To-Do", "3 need attention"),
      "PMO To-Do (3 need attention)",
    );
    assert.equal(titleWithSuffix("PMO To-Do", null), "PMO To-Do");
    assert.equal(titleWithSuffix("PMO To-Do", ""), "PMO To-Do");
  });
});
