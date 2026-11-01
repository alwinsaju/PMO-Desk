import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_SEPARATORS,
  addChips,
  addNotice,
  chipErrorLines,
  chipErrors,
  consumeDraft,
  removeChip,
  splitChips,
} from "./chipInputLogic.ts";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const validateEmail = (v) => (EMAIL.test(v) ? null : "Not an email address");

describe("splitChips", () => {
  it("splits a pasted list on commas, semicolons, spaces and new lines", () => {
    assert.deepEqual(splitChips("a@x.com, b@y.com; bad\nc@z.com  d@w.com"), [
      "a@x.com",
      "b@y.com",
      "bad",
      "c@z.com",
      "d@w.com",
    ]);
  });

  it("drops empty pieces and trims", () => {
    assert.deepEqual(splitChips(" ,; a ,,\t b ;"), ["a", "b"]);
    assert.deepEqual(splitChips("   "), []);
  });

  it("keeps spaces inside a value when space is not a separator", () => {
    const separators = ["comma", "semicolon", "newline"];
    assert.deepEqual(splitChips("Project management, Risk;Excel", separators), [
      "Project management",
      "Risk",
      "Excel",
    ]);
  });
});

describe("consumeDraft", () => {
  it("commits what is before the last separator and keeps the rest typing", () => {
    assert.deepEqual(consumeDraft("a@x.com, b@y", DEFAULT_SEPARATORS), {
      tokens: ["a@x.com"],
      rest: "b@y",
    });
  });

  it("leaves text without a separator alone", () => {
    assert.deepEqual(consumeDraft("a@x", DEFAULT_SEPARATORS), {
      tokens: [],
      rest: "a@x",
    });
  });

  it("commits everything when the text ends with a separator", () => {
    assert.deepEqual(consumeDraft("a@x.com;", DEFAULT_SEPARATORS), {
      tokens: ["a@x.com"],
      rest: "",
    });
  });

  it("does not treat a space as a separator when it is not enabled", () => {
    assert.deepEqual(consumeDraft("Project man", ["comma"]), {
      tokens: [],
      rest: "Project man",
    });
  });
});

describe("addChips", () => {
  it("normalizes, trims and appends", () => {
    const result = addChips(["a@x.com"], [" B@Y.com "], {
      normalize: (v) => v.toLowerCase(),
    });
    assert.deepEqual(result.values, ["a@x.com", "b@y.com"]);
    assert.deepEqual(result.added, ["b@y.com"]);
  });

  it("skips duplicates of existing chips and of the same paste, ignoring case", () => {
    const result = addChips(["a@x.com"], ["A@X.com", "b@y.com", "B@y.com"]);
    assert.deepEqual(result.values, ["a@x.com", "b@y.com"]);
    assert.deepEqual(result.duplicates, ["A@X.com", "B@y.com"]);
  });

  it("can compare case-sensitively", () => {
    const result = addChips(["a"], ["A"], { caseSensitive: true });
    assert.deepEqual(result.values, ["a", "A"]);
  });

  it("stops at the maximum count and reports the overflow", () => {
    const result = addChips(["a", "b"], ["c", "d", "e"], { max: 3 });
    assert.deepEqual(result.values, ["a", "b", "c"]);
    assert.deepEqual(result.overflow, ["d", "e"]);
  });

  it("ignores empty tokens and keeps invalid ones so they can be flagged", () => {
    const result = addChips([], ["", "  ", "bad"]);
    assert.deepEqual(result.values, ["bad"]);
  });

  it("does not mutate the current values", () => {
    const current = ["a"];
    addChips(current, ["b"]);
    assert.deepEqual(current, ["a"]);
  });

  it("handles the pasted example end to end", () => {
    const result = addChips([], splitChips("a@x.com, b@y.com; bad"));
    assert.deepEqual(result.values, ["a@x.com", "b@y.com", "bad"]);
    assert.deepEqual(chipErrors(result.values, validateEmail), [
      null,
      null,
      "Not an email address",
    ]);
  });
});

describe("chipErrors / removeChip", () => {
  it("returns one error slot per chip", () => {
    assert.deepEqual(chipErrors(["a"], undefined), [null]);
  });

  it("removes by index without mutating", () => {
    const values = ["a", "b", "c"];
    assert.deepEqual(removeChip(values, 1), ["a", "c"]);
    assert.deepEqual(removeChip(values, 9), ["a", "b", "c"]);
    assert.deepEqual(values, ["a", "b", "c"]);
  });
});

describe("addNotice", () => {
  it("explains skipped duplicates and overflow", () => {
    const result = addChips(["a"], ["A", "b", "c"], { max: 2 });
    assert.equal(addNotice(result, 2), "Already added: A. Only 2 allowed, not added: c");
  });

  it("is null when everything was added", () => {
    assert.equal(addNotice(addChips([], ["a"])), null);
  });
});

describe("chipErrorLines", () => {
  it("lists only invalid chips with their error", () => {
    assert.deepEqual(chipErrorLines(["a@x.com", "bad"], [null, "Not an email address"]), [
      "bad: Not an email address",
    ]);
  });

  it("shortens a long list", () => {
    const values = ["1", "2", "3", "4", "5"];
    const errors = values.map(() => "No");
    assert.deepEqual(chipErrorLines(values, errors, 2), ["1: No", "2: No", "and 3 more"]);
  });
});
