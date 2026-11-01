import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TERMS, countOf, pluralize } from "./terms.ts";
import { noSpellcheck } from "./noSpellcheck.ts";

describe("pluralize / countOf", () => {
  it("picks singular only for exactly one", () => {
    assert.equal(pluralize(1, "person", "people"), "person");
    assert.equal(pluralize(0, "person", "people"), "people");
    assert.equal(pluralize(2, "person", "people"), "people");
  });

  it("defaults the plural to an s", () => {
    assert.equal(countOf(1, "to-do"), "1 to-do");
    assert.equal(countOf(3, "to-do"), "3 to-dos");
    assert.equal(countOf(0, "person", "people"), "0 people");
  });
});

describe("TERMS", () => {
  it("keeps the agreed wording", () => {
    assert.equal(TERMS.todo, "To-do");
    assert.equal(TERMS.timeOff, "Time off");
    assert.equal(TERMS.total, "Total");
    assert.equal(TERMS.pending, "Pending");
    assert.equal(TERMS.teams, "Teams");
  });
});

describe("noSpellcheck", () => {
  it("turns off every browser text helper", () => {
    assert.deepEqual(noSpellcheck, {
      spellCheck: false,
      autoComplete: "off",
      autoCapitalize: "off",
      autoCorrect: "off",
    });
  });
});
