// Run with `pnpm test`. Plain-language versions of the server's validation text.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { friendlyReason } from "./friendlyReason.ts";

describe("friendlyReason", () => {
  it("a 250-character title", () => {
    assert.equal(
      friendlyReason(
        "Invalid change: title: Too big: expected string to have <=200 characters",
      ),
      "The title is too long. Use 200 characters or fewer.",
    );
  });

  it("an email with its path in brackets", () => {
    assert.equal(
      friendlyReason("Invalid email address (upsert.0.deloitteEmail)"),
      "One of the email addresses does not look right. Check it and try again.",
    );
    assert.equal(
      friendlyReason("Invalid change: upsert.0.deloitteEmail: Invalid email address"),
      "One of the email addresses does not look right. Check it and try again.",
    );
  });

  it("drops the 'body:' prefix from a paste error and keeps a plain message", () => {
    assert.equal(
      friendlyReason("body: Paste some text first."),
      "Paste some text first.",
    );
    assert.equal(
      friendlyReason("Invalid config: me.names: Add at least one name."),
      "Add at least one name.",
    );
  });

  it("small and missing values", () => {
    assert.equal(
      friendlyReason(
        "Invalid to-do: title: Too small: expected string to have >=1 characters",
      ),
      "The title cannot be empty.",
    );
    assert.equal(
      friendlyReason(
        "Invalid request: dueAt: Invalid input: expected string, received undefined",
      ),
      "The due date is missing.",
    );
  });

  it("unknown raw validation text gets the generic sentence", () => {
    assert.match(
      friendlyReason(
        "Invalid change: foo: Invalid input: expected number, received string",
      ),
      /Something you entered/,
    );
  });

  it("leaves plain reasons, URLs and capitalised prefixes alone", () => {
    for (const plain of [
      "Restoring needs your confirmation.",
      "Couldn't reach the local AI model at http://localhost:11434. Make sure Ollama is running.",
      "Note: that to-do is closed.",
      "Unexpected reply from the app server (HTTP 500).",
      "",
    ]) {
      assert.equal(friendlyReason(plain), plain);
    }
  });
});
