import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { postCommand } from "./commandClient.ts";

const reply = (value) => async () => ({ json: async () => value });
const base = { timeoutMs: 5_000, unreachableMessage: "Couldn't reach it." };

/** A fetch that never answers on its own; it rejects when its signal aborts. */
const hanging = (seen) => (url, init) =>
  new Promise((_, reject) => {
    seen.signal = init.signal;
    init.signal.addEventListener("abort", () => reject(init.signal.reason));
  });

describe("postCommand", () => {
  it("posts the body as JSON and returns the parsed result", async () => {
    let sent;
    const outcome = await postCommand(
      "/api/x",
      { prompt: "hi" },
      {
        ...base,
        signal: new AbortController().signal,
        fetchImpl: async (url, init) => {
          sent = { url, init };
          return { json: async () => ({ type: "message", text: "ok" }) };
        },
      },
    );
    assert.deepEqual(outcome, {
      kind: "result",
      result: { type: "message", text: "ok" },
    });
    assert.equal(sent.url, "/api/x");
    assert.equal(sent.init.method, "POST");
    assert.equal(sent.init.body, JSON.stringify({ prompt: "hi" }));
  });

  it("reports Stop as stopped, not as an error", async () => {
    const controller = new AbortController();
    const seen = {};
    const pending = postCommand(
      "/api/x",
      {},
      {
        ...base,
        signal: controller.signal,
        fetchImpl: hanging(seen),
      },
    );
    controller.abort();
    assert.deepEqual(await pending, { kind: "stopped" });
    assert.equal(seen.signal.aborted, true);
  });

  it("maps a network failure to the unreachable error", async () => {
    const outcome = await postCommand(
      "/api/x",
      {},
      {
        ...base,
        signal: new AbortController().signal,
        fetchImpl: async () => {
          throw new TypeError("fetch failed");
        },
      },
    );
    assert.deepEqual(outcome, {
      kind: "result",
      result: { type: "error", kind: "unreachable", message: "Couldn't reach it." },
    });
  });

  it("gives up by itself after the timeout (an error, not a Stop)", async () => {
    const outcome = await postCommand(
      "/api/x",
      {},
      {
        ...base,
        timeoutMs: 20,
        signal: new AbortController().signal,
        fetchImpl: hanging({}),
      },
    );
    assert.equal(outcome.kind, "result");
    assert.equal(outcome.result.type, "error");
  });

  it("an already-stopped signal never calls fetch", async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;
    const outcome = await postCommand(
      "/api/x",
      {},
      {
        ...base,
        signal: controller.signal,
        fetchImpl: reply(() => {
          called = true;
        }),
      },
    );
    assert.deepEqual(outcome, { kind: "stopped" });
    assert.equal(called, false);
  });
});
