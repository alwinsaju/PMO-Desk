// Run with `pnpm test`. The child-process environment scrub.
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { TLS_OVERRIDE_NAME, proxyEnv, sanitizeChildEnv } = require("./child-env.cjs");

describe("sanitizeChildEnv", () => {
  it("removes the TLS override and reports it", () => {
    const { env, removed } = sanitizeChildEnv({
      PATH: "C:\\x",
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
    });
    assert.deepEqual(env, { PATH: "C:\\x" });
    assert.deepEqual(removed, [TLS_OVERRIDE_NAME]);
  });

  it("removes it whatever the value or casing (Windows names are case-insensitive)", () => {
    for (const name of [
      "NODE_TLS_REJECT_UNAUTHORIZED",
      "node_tls_reject_unauthorized",
      "Node_Tls_Reject_Unauthorized",
    ]) {
      for (const value of ["0", "1", "", "false"]) {
        const { env, removed } = sanitizeChildEnv({ [name]: value, KEEP: "1" });
        assert.deepEqual(env, { KEEP: "1" }, `${name}=${value}`);
        assert.deepEqual(removed, [name]);
      }
    }
  });

  it("keeps NODE_EXTRA_CA_CERTS and everything else", () => {
    const input = {
      NODE_EXTRA_CA_CERTS: "C:\\certs\\corp.pem",
      HTTPS_PROXY: "http://proxy:8080",
      NODE_TLS_REJECT_UNAUTHORIZED_NOT: "x",
      Path: "C:\\y",
    };
    const { env, removed } = sanitizeChildEnv(input);
    assert.deepEqual(env, input);
    assert.deepEqual(removed, []);
  });

  it("does not modify its input and tolerates a missing one", () => {
    const input = { NODE_TLS_REJECT_UNAUTHORIZED: "0" };
    sanitizeChildEnv(input);
    assert.deepEqual(input, { NODE_TLS_REJECT_UNAUTHORIZED: "0" });
    assert.deepEqual(sanitizeChildEnv(undefined), { env: {}, removed: [] });
  });

  it("removes every casing present at once", () => {
    const { env, removed } = sanitizeChildEnv({
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      node_tls_reject_unauthorized: "0",
    });
    assert.deepEqual(env, {});
    assert.equal(removed.length, 2);
  });
});

describe("proxyEnv", () => {
  it("turns on Node's proxy support when a proxy is configured, whatever the casing", () => {
    assert.deepEqual(proxyEnv({ HTTPS_PROXY: "http://p:8080" }), {
      NODE_USE_ENV_PROXY: "1",
    });
    assert.deepEqual(proxyEnv({ http_proxy: "http://p:8080" }), {
      NODE_USE_ENV_PROXY: "1",
    });
  });

  it("does nothing without a proxy, with an empty one, or when already decided", () => {
    assert.deepEqual(proxyEnv({ PATH: "x" }), {});
    assert.deepEqual(proxyEnv({ HTTPS_PROXY: "  " }), {});
    assert.deepEqual(proxyEnv({ HTTPS_PROXY: "http://p", NODE_USE_ENV_PROXY: "0" }), {});
    assert.deepEqual(proxyEnv(undefined), {});
  });
});
