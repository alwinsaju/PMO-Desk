import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { answerTitle, formatElapsed, placeholderFor } from "./barText.ts";

describe("answerTitle", () => {
  it("echoes the question with a capital and tidy spaces", () => {
    assert.equal(answerTitle("  what's   overdue? "), "What's overdue?");
  });

  it("falls back to Answer and shortens long questions", () => {
    assert.equal(answerTitle("   "), "Answer");
    const long = answerTitle("x".repeat(100));
    assert.equal(long.length, 60);
    assert.ok(long.endsWith("…"));
  });
});

describe("placeholderFor", () => {
  it("keeps the plain wording for each state", () => {
    assert.equal(placeholderFor(null), "Ask AI to do something…");
    assert.equal(placeholderFor("thinking"), "Thinking…");
    assert.equal(placeholderFor("working"), "Working…");
    assert.equal(placeholderFor("completed"), "Done…");
  });

  it("explains a wake-up while thinking, with the time so far", () => {
    const text = placeholderFor("thinking", { waking: true, elapsedSeconds: 75 });
    assert.equal(text, "Waking the AI model… 1:15");
  });

  it("shows the running clock while a model answer is awaited", () => {
    assert.equal(
      placeholderFor("thinking", {
        waking: false,
        elapsedSeconds: 0,
        thinkingSeconds: 12,
      }),
      "Thinking… 0:12",
    );
  });

  it("only says it while thinking", () => {
    assert.equal(
      placeholderFor("working", { waking: true, elapsedSeconds: 5 }),
      "Working…",
    );
  });
});

describe("formatElapsed", () => {
  it("formats minutes and padded seconds and survives bad input", () => {
    assert.equal(formatElapsed(0), "0:00");
    assert.equal(formatElapsed(7.9), "0:07");
    assert.equal(formatElapsed(155), "2:35");
    assert.equal(formatElapsed(-4), "0:00");
    assert.equal(formatElapsed(NaN), "0:00");
  });
});
