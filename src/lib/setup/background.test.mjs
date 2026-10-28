// Run with `pnpm test`. When Setup probes Outlook and starts Ollama.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OLLAMA_START_RETRY_MS,
  OUTLOOK_REPROBE_MS,
  ollamaStartDue,
  outlookProbeDue,
  parseStatusContext,
} from "./background.ts";

describe("parseStatusContext", () => {
  it("reads the query flags", () => {
    assert.equal(parseStatusContext({ fresh: null, launch: "1" }), "launch");
    assert.equal(parseStatusContext({ fresh: "1", launch: null }), "open");
    assert.equal(parseStatusContext({ fresh: null, launch: null }), "refresh");
  });
});

describe("outlookProbeDue", () => {
  const now = 10 * OUTLOOK_REPROBE_MS;
  it("never at launch, always when Setup opens", () => {
    assert.equal(outlookProbeDue({ context: "launch", cachedAt: undefined, now }), false);
    assert.equal(outlookProbeDue({ context: "open", cachedAt: now, now }), true);
  });
  it("repeats on a refresh only once the result is 30 minutes old", () => {
    const at = (age) => outlookProbeDue({ context: "refresh", cachedAt: now - age, now });
    assert.equal(at(OUTLOOK_REPROBE_MS - 1), false);
    assert.equal(at(OUTLOOK_REPROBE_MS), true);
    assert.equal(outlookProbeDue({ context: "refresh", cachedAt: undefined, now }), true);
  });
});

describe("ollamaStartDue", () => {
  const base = {
    context: "open",
    exeFound: true,
    running: false,
    lastAttemptAt: undefined,
    now: 1_000_000,
  };
  it("starts for the Setup model check", () => {
    assert.equal(ollamaStartDue(base), true);
    assert.equal(ollamaStartDue({ ...base, context: "refresh" }), true);
  });
  it("does not start at launch, when running, or when Ollama is not installed", () => {
    assert.equal(ollamaStartDue({ ...base, context: "launch" }), false);
    assert.equal(ollamaStartDue({ ...base, running: true }), false);
    assert.equal(ollamaStartDue({ ...base, exeFound: false }), false);
  });
  it("waits a minute between tries", () => {
    const last = (age) => ollamaStartDue({ ...base, lastAttemptAt: base.now - age });
    assert.equal(last(OLLAMA_START_RETRY_MS - 1), false);
    assert.equal(last(OLLAMA_START_RETRY_MS), true);
  });
});
