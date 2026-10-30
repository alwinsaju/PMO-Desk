import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { completeFrom, suggestionsFor } from "./barSuggestions.ts";

describe("suggestionsFor", () => {
  it("puts favourites first, then the app's chips, then the defaults", () => {
    const list = suggestionsFor("pmo-todo", ["Who's off today?"]);
    assert.equal(list[0].text, "Who's off today?");
    assert.equal(list[0].favourite, true);
    assert.equal(list[1].text, "What's overdue?");
    assert.equal(list.length, 6);
  });

  it("does not repeat a chip that is also a favourite, ignoring case", () => {
    const list = suggestionsFor("staff", ["who's off this week?"]);
    assert.equal(
      list.filter((s) => s.text.toLowerCase() === "who's off this week?").length,
      1,
    );
    assert.equal(list[0].favourite, true);
  });

  it("falls back to the defaults for an unknown or missing app", () => {
    assert.equal(suggestionsFor(null, [])[0].text, "Open Dashboard");
    assert.equal(suggestionsFor("web-app", [])[0].text, "Open Dashboard");
  });
});

describe("completeFrom", () => {
  const pool = [
    "What's overdue?",
    "who's off this week?",
    "Open Notes",
    "Open Dashboard",
    "show what's overdue",
  ];

  it("completes from the start first, then from inside", () => {
    assert.deepEqual(completeFrom("wh", pool), [
      "What's overdue?",
      "who's off this week?",
      "show what's overdue",
    ]);
    assert.deepEqual(completeFrom("overdue", pool), [
      "What's overdue?",
      "show what's overdue",
    ]);
  });

  it("offers nothing for a very short entry, an exact match or no match", () => {
    assert.deepEqual(completeFrom("w", pool), []);
    assert.deepEqual(completeFrom("open notes", pool), []);
    assert.deepEqual(completeFrom("zzz", pool), []);
  });

  it("caps the list and skips repeats", () => {
    assert.equal(
      completeFrom("op", ["Open A", "open a", "Open B", "Open C", "Open D", "Open E"], 3)
        .length,
      3,
    );
    assert.equal(completeFrom("op", ["Open A", "open a"]).length, 1);
  });
});
