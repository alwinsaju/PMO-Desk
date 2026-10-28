// Run with `pnpm test`. The browser-side engine token: fetched once, sent on every
// engine call, refetched once on a 403. A fake fetch only; no network.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { engineFetch, getEngineToken, setEngineToken } from "./engineClient.ts";

const ENGINE = "http://127.0.0.1:8123/tasks";
const realFetch = globalThis.fetch;
let calls;

const reply = (body, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

function fake(handler) {
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
}

const tokenOf = (call) => new Headers(call.init.headers).get("x-ai-os-token");

beforeEach(() => setEngineToken(undefined));
afterEach(() => {
  globalThis.fetch = realFetch;
  setEngineToken(undefined);
});

describe("engine token client", () => {
  it("fetches the token once and sends it on every engine request", async () => {
    fake((url) => (url.endsWith("/token") ? reply({ ok: true, token: "abc" }) : reply([])));
    await engineFetch(ENGINE);
    await engineFetch(ENGINE, { method: "POST", headers: { "Content-Type": "x/y" } });
    assert.equal(calls.filter((c) => c.url.endsWith("/api/tasks-engine/token")).length, 1);
    const engine = calls.filter((c) => c.url === ENGINE);
    assert.deepEqual(engine.map(tokenOf), ["abc", "abc"]);
    assert.equal(new Headers(engine[1].init.headers).get("content-type"), "x/y");
  });

  it("shares one in-flight token request between concurrent callers", async () => {
    fake((url) => (url.endsWith("/token") ? reply({ ok: true, token: "abc" }) : reply([])));
    await Promise.all([engineFetch(ENGINE), engineFetch(ENGINE), engineFetch(ENGINE)]);
    assert.equal(calls.filter((c) => c.url.endsWith("/token")).length, 1);
  });

  it("sends no header when the server says no token is needed, and remembers that", async () => {
    fake((url) => (url.endsWith("/token") ? reply({ ok: true, token: null }) : reply([])));
    const init = { method: "POST" };
    await engineFetch(ENGINE, init);
    await engineFetch(ENGINE);
    const engine = calls.filter((c) => c.url === ENGINE);
    assert.equal(engine[0].init, init);
    assert.deepEqual(engine.map(tokenOf), [null, null]);
    assert.equal(calls.filter((c) => c.url.endsWith("/token")).length, 1);
  });

  it("does not cache a failed token lookup and still calls the engine", async () => {
    fake((url) => {
      if (url.endsWith("/token")) throw new TypeError("offline");
      return reply([]);
    });
    assert.equal(await getEngineToken(), null);
    await engineFetch(ENGINE);
    assert.equal(tokenOf(calls.at(-1)), null);
    assert.equal(calls.filter((c) => c.url.endsWith("/token")).length, 2);
  });

  it("refetches the token once on a 403 and retries with the new one", async () => {
    setEngineToken("old");
    fake((url, init) => {
      if (url.endsWith("/token")) return reply({ ok: true, token: "new" });
      return new Headers(init.headers).get("x-ai-os-token") === "new"
        ? reply({ ok: true })
        : reply({ ok: false }, 403);
    });
    const res = await engineFetch(ENGINE, { method: "POST" });
    assert.equal(res.status, 200);
    assert.deepEqual(
      calls.map((c) => (c.url === ENGINE ? tokenOf(c) : "token-route")),
      ["old", "token-route", "new"],
    );
  });

  it("returns the 403 without a retry when the token did not change", async () => {
    setEngineToken("same");
    fake((url) =>
      url.endsWith("/token") ? reply({ ok: true, token: "same" }) : reply({}, 403),
    );
    const res = await engineFetch(ENGINE);
    assert.equal(res.status, 403);
    assert.equal(calls.filter((c) => c.url === ENGINE).length, 1);
  });
});
