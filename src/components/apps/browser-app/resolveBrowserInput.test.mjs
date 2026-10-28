import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BLOCKED_ADDRESS_MESSAGE, resolveBrowserInput } from "./resolveBrowserInput.ts";

describe("resolveBrowserInput", () => {
  it("treats blank input as empty", () => {
    assert.deepEqual(resolveBrowserInput("   "), { kind: "empty" });
  });

  it("keeps http and https URLs", () => {
    assert.deepEqual(resolveBrowserInput("https://example.com/a?b=1"), {
      kind: "url",
      url: "https://example.com/a?b=1",
    });
    assert.equal(resolveBrowserInput("http://127.0.0.1:1/").kind, "url");
    assert.equal(resolveBrowserInput("HTTP://Example.com").kind, "url");
  });

  it("adds https:// to bare hosts", () => {
    assert.deepEqual(resolveBrowserInput("example.com"), {
      kind: "url",
      url: "https://example.com/",
    });
    assert.equal(resolveBrowserInput("en.wikipedia.org/wiki/Cat").kind, "url");
    assert.equal(resolveBrowserInput("localhost:3000").kind, "url");
    assert.equal(resolveBrowserInput("192.168.1.10:8080/x").kind, "url");
  });

  it("turns other text into a DuckDuckGo search", () => {
    const res = resolveBrowserInput("hello   world search");
    assert.equal(res.kind, "search");
    assert.equal(res.url, "https://duckduckgo.com/?q=hello%20world%20search");
    assert.equal(res.query, "hello world search");
  });

  it("searches for text that merely looks odd", () => {
    assert.equal(resolveBrowserInput("note: buy milk").kind, "search");
    assert.equal(resolveBrowserInput("cats").kind, "search");
    assert.equal(resolveBrowserInput("what is 3.14").kind, "search");
  });

  it("encodes the query", () => {
    const res = resolveBrowserInput("a&b=c #d");
    assert.equal(res.url, "https://duckduckgo.com/?q=a%26b%3Dc%20%23d");
  });

  it("caps very long queries", () => {
    const res = resolveBrowserInput("x ".repeat(5000));
    assert.ok(res.query.length <= 1000);
  });

  it("refuses script, data, file and other non-web schemes", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<b>x</b>",
      "file:///C:/Windows/win.ini",
      "vbscript:x",
      "ftp://host/file",
      "custom://thing",
    ]) {
      assert.deepEqual(
        resolveBrowserInput(bad),
        { kind: "blocked", reason: BLOCKED_ADDRESS_MESSAGE },
        bad,
      );
    }
  });

  it("falls back to search for an unparsable http URL", () => {
    assert.equal(resolveBrowserInput("http://").kind, "search");
  });
});

describe("resolveBrowserInput edge cases", () => {
  it("encodes a space inside a bare host's path instead of searching", () => {
    assert.deepEqual(resolveBrowserInput("example.com/a b"), {
      kind: "url",
      url: "https://example.com/a%20b",
    });
  });

  it("treats a host followed by prose as a search", () => {
    assert.equal(resolveBrowserInput("example.com is down").kind, "search");
  });

  it("handles an uppercase scheme and surrounding whitespace", () => {
    assert.deepEqual(resolveBrowserInput("  HTTPS://Example.com/Path  "), {
      kind: "url",
      url: "https://example.com/Path",
    });
    assert.equal(resolveBrowserInput("\t example.com \n").kind, "url");
    assert.equal(resolveBrowserInput("  JAVASCRIPT:alert(1) ").kind, "blocked");
  });

  it("uses the exact blocked wording", () => {
    assert.equal(BLOCKED_ADDRESS_MESSAGE, "That address type is not allowed.");
  });
});
