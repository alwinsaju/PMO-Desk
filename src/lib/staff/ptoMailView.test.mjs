// Run with `pnpm test`. How a PTO email is laid out in the Time off detail dialog.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { splitAroundQuote } from "./ptoMailView.ts";

describe("splitAroundQuote", () => {
  it("marks the quoted sentence and keeps the text around it", () => {
    const parts = splitAroundQuote(
      "Hi team. I am off 5-6 Nov. Thanks!",
      "I am off 5-6 Nov.",
    );
    assert.deepEqual(parts, [
      { text: "Hi team. ", quoted: false },
      { text: "I am off 5-6 Nov.", quoted: true },
      { text: " Thanks!", quoted: false },
    ]);
  });

  it("ignores case and spacing differences in the quote", () => {
    const parts = splitAroundQuote("I am off\n  5-6 Nov", "i AM off 5-6 nov");
    assert.deepEqual(parts, [{ text: "I am off\n  5-6 Nov", quoted: true }]);
  });

  it("returns the whole text when the quote is not in it or is empty", () => {
    assert.deepEqual(splitAroundQuote("Hello", "bye"), [
      { text: "Hello", quoted: false },
    ]);
    assert.deepEqual(splitAroundQuote("Hello", "  "), [{ text: "Hello", quoted: false }]);
    assert.deepEqual(splitAroundQuote("", "x"), []);
  });

  it("treats regex characters in the quote as plain text", () => {
    const parts = splitAroundQuote("Off (2 days) [maybe]?", "(2 days) [maybe]?");
    assert.deepEqual(parts, [
      { text: "Off ", quoted: false },
      { text: "(2 days) [maybe]?", quoted: true },
    ]);
  });
});
