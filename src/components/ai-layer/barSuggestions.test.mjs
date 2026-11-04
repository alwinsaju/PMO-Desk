import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_RECENT_CHIPS, completeFrom, suggestionsFor } from "./barSuggestions.ts";

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

  it("puts recent prompts after favourites and before the app's chips", () => {
    const list = suggestionsFor("pmo-todo", ["Pinned"], 6, ["Recent A", "Recent B"]);
    assert.deepEqual(
      list.map((s) => [s.text, s.favourite, s.recent]),
      [
        ["Pinned", true, false],
        ["Recent A", false, true],
        ["Recent B", false, true],
        ["What's overdue?", false, false],
        ["What do I need to chase?", false, false],
        ["What changed since yesterday?", false, false],
      ],
    );
  });

  it("shows at most three recent prompts and never goes over the cap", () => {
    const recent = ["r1", "r2", "r3", "r4", "r5"];
    const list = suggestionsFor(null, [], 6, recent);
    assert.equal(list.filter((s) => s.recent).length, MAX_RECENT_CHIPS);
    assert.deepEqual(
      list.map((s) => s.text),
      ["r1", "r2", "r3", "Open Dashboard", "Who's off this week?", "What's overdue?"],
    );
    assert.equal(suggestionsFor("staff", ["a", "b"], 6, recent).length, 6);
  });

  it("does not repeat a recent prompt that is a favourite or a starter, ignoring case", () => {
    const list = suggestionsFor(null, ["Open Notes"], 6, [
      "open notes",
      "OPEN DASHBOARD",
      "new",
    ]);
    const lower = list.map((s) => s.text.toLowerCase());
    assert.equal(new Set(lower).size, lower.length);
    assert.equal(list[0].favourite, true);
    assert.equal(list[0].recent, false);
    // The duplicate does not use up one of the three recent slots.
    assert.deepEqual(
      list.filter((s) => s.recent).map((s) => s.text),
      ["OPEN DASHBOARD", "new"],
    );
  });

  it("is unchanged when there is no recent prompt", () => {
    assert.deepEqual(
      suggestionsFor(null, []).map((s) => s.recent),
      Array(6).fill(false),
    );
    assert.equal(suggestionsFor(null, [], 6, []).length, 6);
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
