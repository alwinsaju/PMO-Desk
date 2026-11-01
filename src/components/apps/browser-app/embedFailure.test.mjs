import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addressSecurity,
  classifyWebviewError,
  describeEmbedFailure,
} from "./embedFailure.ts";

describe("describeEmbedFailure", () => {
  it("says the site refuses framing, naming PMO Desk, not 'could not be reached'", () => {
    const f = describeEmbedFailure({ host: "example.com", code: "framing" });
    assert.equal(f.title, "example.com doesn't allow being shown inside PMO Desk");
    assert.doesNotMatch(f.message, /could not be reached/i);
    assert.match(f.message, /regular browser/i);
  });
  it("uses a distinct unreachable message", () => {
    const f = describeEmbedFailure({ host: "example.com", code: "unreachable" });
    assert.equal(f.title, "Can't reach example.com");
    assert.match(f.message, /connection/i);
  });
  it("says you are offline when the device reports it", () => {
    const f = describeEmbedFailure({
      host: "example.com",
      code: "unreachable",
      online: false,
    });
    assert.match(f.title, /offline/i);
  });
  it("an offline device only changes the 'could not connect' answers", () => {
    const f = describeEmbedFailure({ host: "a.com", code: "framing", online: false });
    assert.match(f.title, /doesn't allow/i);
    const g = describeEmbedFailure({ host: "a.com", reason: "private", online: false });
    assert.equal(g.message, "private");
  });
  it("says an unknown host cannot be found", () => {
    const f = describeEmbedFailure({ host: "nope.invalid", code: "not-found" });
    assert.equal(f.title, "Can't find nope.invalid");
    assert.match(f.message, /spelling/i);
  });
  it("falls back to the server's reason for anything else", () => {
    const f = describeEmbedFailure({
      host: "a.com",
      reason: "The site answered with HTTP 503.",
    });
    assert.equal(f.title, "Can't show a.com here");
    assert.equal(f.message, "The site answered with HTTP 503.");
  });
  it("has a generic message when there is no reason", () => {
    assert.ok(describeEmbedFailure({ host: "a.com" }).message.length > 0);
  });
  it("offers Retry unless the site will only refuse again", () => {
    assert.equal(
      describeEmbedFailure({ host: "a.com", code: "framing" }).retryable,
      false,
    );
    for (const code of ["unreachable", "not-found", undefined]) {
      assert.equal(
        describeEmbedFailure({ host: "a.com", code }).retryable,
        true,
        String(code),
      );
    }
    assert.equal(
      describeEmbedFailure({ host: "a.com", code: "unreachable", online: false })
        .retryable,
      true,
    );
  });
  it("gives every failure a cause and a next step for the error card", () => {
    for (const code of ["framing", "unreachable", "not-found", undefined]) {
      const f = describeEmbedFailure({ host: "a.com", code });
      assert.ok(f.cause.length > 0 && f.nextStep.length > 0, String(code));
    }
    assert.match(
      describeEmbedFailure({ host: "a.com", code: "framing" }).nextStep,
      /default browser/i,
    );
    assert.equal(
      describeEmbedFailure({ host: "a.com", reason: "HTTP 503" }).cause,
      "HTTP 503",
    );
  });
});

describe("classifyWebviewError", () => {
  it("maps Chromium net errors to a code", () => {
    assert.equal(classifyWebviewError("ERR_NAME_NOT_RESOLVED"), "not-found");
    assert.equal(classifyWebviewError("ERR_INTERNET_DISCONNECTED"), "unreachable");
    assert.equal(classifyWebviewError("ERR_CONNECTION_TIMED_OUT"), "unreachable");
    assert.equal(classifyWebviewError("ERR_CONNECTION_REFUSED"), "unreachable");
    assert.equal(classifyWebviewError("ERR_BLOCKED_BY_RESPONSE"), "framing");
    assert.equal(classifyWebviewError("something else"), undefined);
    assert.equal(classifyWebviewError(undefined), undefined);
  });
});

describe("addressSecurity", () => {
  it("is secure only for https", () => {
    assert.equal(addressSecurity("https://example.com/"), "secure");
    assert.equal(addressSecurity("http://example.com/"), "insecure");
  });
  it("is internal for pathfinder:// pages and anything else", () => {
    assert.equal(addressSecurity("pathfinder://home"), "internal");
    assert.equal(addressSecurity(""), "internal");
  });
});
