// Run with `pnpm test`.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { resetTlsWarning, withoutTlsOverride } from "./childEnv.ts";

describe("withoutTlsOverride", () => {
  beforeEach(resetTlsWarning);

  it("drops NODE_TLS_REJECT_UNAUTHORIZED in any casing and keeps the rest", () => {
    const messages = [];
    const env = withoutTlsOverride(
      {
        PATH: "x",
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
        node_tls_reject_unauthorized: "0",
        A: "1",
      },
      (m) => messages.push(m),
    );
    assert.deepEqual(env, { PATH: "x", A: "1" });
    assert.equal(messages.length, 1);
  });

  it("warns only once, and not at all when the variable is absent", () => {
    const messages = [];
    const warn = (m) => messages.push(m);
    withoutTlsOverride({ A: "1" }, warn);
    assert.equal(messages.length, 0);
    withoutTlsOverride({ NODE_TLS_REJECT_UNAUTHORIZED: "0" }, warn);
    withoutTlsOverride({ NODE_TLS_REJECT_UNAUTHORIZED: "0" }, warn);
    assert.equal(messages.length, 1);
  });
});
