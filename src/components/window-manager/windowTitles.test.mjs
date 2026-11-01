import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attentionSuffix, joinSuffixes, titleWithSuffix } from "./windowTitles.ts";

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

  it("joins the window context and the live status for the title bar", () => {
    assert.equal(
      joinSuffixes("Shift roster", "3 need attention"),
      "Shift roster · 3 need attention",
    );
    assert.equal(joinSuffixes("Shift roster", null), "Shift roster");
    assert.equal(joinSuffixes(undefined, "1 needs attention"), "1 needs attention");
    assert.equal(joinSuffixes("  ", "", null), null);
  });
});
