// Run with `pnpm test`. How the original message is cut around the model's quote.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { quoteSegments } from "./quote.ts";

describe("quoteSegments", () => {
  it("marks the quote between the text before and after it", () => {
    assert.deepEqual(
      quoteSegments(
        "Hi Sam,\nPlease send the RAID log by Friday.\nThanks",
        "send the RAID log",
      ),
      [
        { text: "Hi Sam,\nPlease ", mark: false },
        { text: "send the RAID log", mark: true },
        { text: " by Friday.\nThanks", mark: false },
      ],
    );
  });

  it("finds a quote across different whitespace and curly quotes", () => {
    const segments = quoteSegments(
      "He said: it’s   due\nnext week.",
      "it's due next week",
    );
    assert.deepEqual(
      segments.filter((s) => s.mark).map((s) => s.text),
      ["it’s   due\nnext week"],
    );
  });

  it("leaves out empty parts when the quote starts or ends the message", () => {
    assert.deepEqual(quoteSegments("Send it now", "Send it now"), [
      { text: "Send it now", mark: true },
    ]);
    assert.deepEqual(quoteSegments("Send it now", "Send"), [
      { text: "Send", mark: true },
      { text: " it now", mark: false },
    ]);
  });

  it("returns the whole body unmarked when the quote is missing or not found", () => {
    const whole = [{ text: "Nothing to see", mark: false }];
    assert.deepEqual(quoteSegments("Nothing to see", null), whole);
    assert.deepEqual(quoteSegments("Nothing to see", ""), whole);
    assert.deepEqual(quoteSegments("Nothing to see", "invented sentence"), whole);
  });

  it("returns nothing for an empty body", () => {
    assert.deepEqual(quoteSegments("", "x"), []);
  });
});
