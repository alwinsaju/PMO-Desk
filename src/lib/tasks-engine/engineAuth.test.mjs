// Run with `pnpm test`. The per-process engine token/instance and the rules for
// who may read the token.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  clientTokenReply,
  engineAuthHeaders,
  ENGINE_TOKEN_HEADER,
  getEngineAuth,
} from "./engineAuth.ts";

const request = (headers) => new Request("http://127.0.0.1:3000/api/tasks-engine/token", { headers });

afterEach(() => {
  globalThis.aiOsEngineAuth = undefined;
  delete process.env.AI_OS_TASKS_ENGINE_URL;
  delete process.env.AI_OS_ENGINE_TOKEN;
});

describe("getEngineAuth", () => {
  it("creates a random 256-bit token and an instance id once per process", () => {
    const first = getEngineAuth();
    assert.match(first.token, /^[0-9a-f]{64}$/);
    assert.match(first.instance, /^[0-9a-f]{32}$/);
    assert.equal(getEngineAuth(), first);
    globalThis.aiOsEngineAuth = undefined;
    assert.notEqual(getEngineAuth().token, first.token);
  });

  it("lets AI_OS_ENGINE_TOKEN pin the token", () => {
    process.env.AI_OS_ENGINE_TOKEN = " pinned ";
    assert.equal(getEngineAuth().token, "pinned");
  });

  it("builds the engine header", () => {
    assert.equal(ENGINE_TOKEN_HEADER, "X-AI-OS-Token");
    assert.deepEqual(engineAuthHeaders(), { "X-AI-OS-Token": getEngineAuth().token });
  });
});

describe("clientTokenReply", () => {
  const ok = { host: "127.0.0.1:3000" };

  it("hands the token to the app itself (no Origin, or same origin)", () => {
    for (const extra of [
      {},
      { origin: "http://127.0.0.1:3000" },
      { "sec-fetch-site": "same-origin" },
      { "sec-fetch-site": "none" },
    ]) {
      const reply = clientTokenReply(request({ ...ok, ...extra }));
      assert.equal(reply.status, 200);
      assert.equal(reply.body.token, getEngineAuth().token);
    }
  });

  it("refuses other origins, cross-site fetches and non-loopback hosts", () => {
    const refused = [
      { host: "127.0.0.1:3000", origin: "https://evil.example" },
      { host: "127.0.0.1:3000", origin: "http://127.0.0.1:4000" },
      { host: "127.0.0.1:3000", "sec-fetch-site": "cross-site" },
      { host: "127.0.0.1:3000", "sec-fetch-site": "same-site" },
      { host: "evil.example" },
    ];
    for (const headers of refused) {
      const reply = clientTokenReply(request(headers));
      assert.equal(reply.status, 403, JSON.stringify(headers));
      assert.equal(reply.body.ok, false);
      assert.ok(!("token" in reply.body));
    }
  });

  it("says no token for an engine started by hand unless one is pinned", () => {
    process.env.AI_OS_TASKS_ENGINE_URL = "http://127.0.0.1:9000";
    assert.equal(clientTokenReply(request(ok)).body.token, null);
    process.env.AI_OS_ENGINE_TOKEN = "pinned";
    assert.equal(clientTokenReply(request(ok)).body.token, "pinned");
  });
});
