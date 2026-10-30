// Run with `pnpm test`. Spelling help in the command bar.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { closestWord, editDistance, suggestTask, suggestWhen } from "./didYouMean.ts";
import { resolveWhen } from "./whenPhrase.ts";

const TODAY = "2026-10-30";

describe("editDistance and closestWord", () => {
  it("counts single-letter slips", () => {
    assert.equal(editDistance("monday", "monday"), 0);
    assert.equal(editDistance("mondy", "monday"), 1);
    assert.equal(editDistance("frday", "friday"), 1);
    assert.equal(editDistance("abc", "xyz"), 3);
  });

  it("finds the nearest word, never for a word that is already right or far off", () => {
    assert.equal(closestWord("tomorow", ["today", "tomorrow"]), "tomorrow");
    assert.equal(closestWord("monday", ["monday"]), null);
    assert.equal(closestWord("banana", ["monday", "friday"]), null);
    assert.equal(closestWord("to", ["today"]), null);
  });
});

describe("suggestWhen", () => {
  const suggest = (phrase) => suggestWhen(phrase, TODAY, resolveWhen);

  it("fixes a misspelt day or month", () => {
    assert.equal(suggest("nxt mondy"), "next monday");
    assert.equal(suggest("next mondy"), "next monday");
    assert.equal(suggest("tomorow"), "tomorrow");
    assert.equal(suggest("5 novmber"), "5 november");
  });

  it("offers nothing when the phrase is fine or still unreadable after the fix", () => {
    assert.equal(suggest("next monday"), null);
    assert.equal(suggest("blorp"), null);
    assert.equal(suggest("this fridy and more words"), null);
  });
});

describe("suggestTask", () => {
  it("finds the task behind a misspelt name", () => {
    assert.equal(suggestTask("agin report")?.id, "weekly-aging-report");
    assert.equal(suggestTask("prepare the backlg report")?.id, "weekly-backlog-report");
    assert.equal(suggestTask("decembr disconnect")?.id, "december-disconnect");
  });

  it("says nothing for an exact name, nonsense or an empty text", () => {
    assert.equal(suggestTask("aging report"), null);
    assert.equal(suggestTask("zzzzzz qqqq"), null);
    assert.equal(suggestTask(""), null);
  });
});
