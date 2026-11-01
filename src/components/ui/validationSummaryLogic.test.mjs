import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { addedHeadline, listValues, summaryLines } from "./validationSummaryLogic.ts";

describe("addedHeadline", () => {
  it("counts new items with the right noun", () => {
    assert.equal(addedHeadline(0, "person", "people"), "0 new people will be added");
    assert.equal(addedHeadline(1, "person", "people"), "1 new person will be added");
    assert.equal(addedHeadline(3, "person", "people"), "3 new people will be added");
  });
});

describe("listValues", () => {
  it("joins with commas", () => {
    assert.equal(listValues(["a", "b"]), "a, b");
  });

  it("shortens a long list", () => {
    assert.equal(listValues(["a", "b", "c", "d", "e"], 3), "a, b, c and 2 more");
    assert.equal(listValues(["a", "b", "c"], 3), "a, b, c");
  });
});

describe("summaryLines", () => {
  it("drops groups with no values and keeps the order", () => {
    const lines = summaryLines([
      { label: "Already on the roster, skipped", values: ["a@x.com"] },
      { label: "Not an email address", values: [], tone: "error" },
    ]);
    assert.deepEqual(lines, [
      { text: "Already on the roster, skipped: a@x.com", tone: "muted" },
    ]);
  });

  it("carries the error tone", () => {
    const lines = summaryLines([
      { label: "Not an email address", values: ["bad"], tone: "error" },
    ]);
    assert.deepEqual(lines, [{ text: "Not an email address: bad", tone: "error" }]);
  });
});
