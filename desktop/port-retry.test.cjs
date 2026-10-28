// Run with `pnpm test`. The fresh-port retry decision.
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { shouldRetryOnFreshPort } = require("./port-retry.cjs");

describe("shouldRetryOnFreshPort", () => {
  it("retries when the server reported the port in use", () => {
    assert.equal(
      shouldRetryOnFreshPort({
        output: ["Error: listen EADDRINUSE: address already in use 127.0.0.1:3100"],
      }),
      true,
    );
    assert.equal(shouldRetryOnFreshPort({ output: ["address already in use"] }), true);
    assert.equal(shouldRetryOnFreshPort({ output: ["x", "eaddrinuse"] }), true);
  });

  it("retries when the server exited before it was ready", () => {
    assert.equal(shouldRetryOnFreshPort({ exitedBeforeReady: true, output: [] }), true);
  });

  it("does not retry a plain timeout or an unrelated message", () => {
    assert.equal(shouldRetryOnFreshPort({ output: ["compiled in 3s"] }), false);
    assert.equal(shouldRetryOnFreshPort({ output: [] }), false);
    assert.equal(shouldRetryOnFreshPort({}), false);
    assert.equal(shouldRetryOnFreshPort(), false);
  });

  it("ignores non-string output entries", () => {
    assert.equal(shouldRetryOnFreshPort({ output: [undefined, 3, null] }), false);
  });
});
