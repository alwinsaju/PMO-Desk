// Run with `pnpm test`. The source line in a Saved examples row: a saved example keeps the
// email subject, never the sender, so it must never be labelled "From".
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exampleLabel, exampleSourceLine } from "./savedExampleView.ts";

describe("exampleSourceLine", () => {
  it("labels an email subject as the subject", () => {
    const line = exampleSourceLine({
      subject: "Please send the vendor contract summary",
      message: "Hi, can you send it?",
    });
    assert.equal(line, "Subject: Please send the vendor contract summary");
    assert.doesNotMatch(line, /^From/);
  });

  it("labels the start of the text as the message when there is no subject", () => {
    assert.equal(
      exampleSourceLine({ subject: "  ", message: "Priya  asked\nfor the deck" }),
      "Message: Priya asked for the deck",
    );
  });

  it("shortens a long label", () => {
    const label = exampleLabel({ subject: "x".repeat(200), message: "" });
    assert.equal(label.length, 90);
    assert.ok(label.endsWith("…"));
  });
});
