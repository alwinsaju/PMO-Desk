import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isEngineDown, nextPollDelay, OFFLINE_AFTER_FAILURES } from "./pollBackoff.ts";
import { requestEngineStart } from "./engineBanner.ts";

describe("nextPollDelay", () => {
  it("polls every 2s while healthy and after the first miss", () => {
    assert.equal(nextPollDelay(0), 2000);
    assert.equal(nextPollDelay(1), 2000);
  });
  it("backs off 4s, 8s, then caps at 10s", () => {
    assert.equal(nextPollDelay(2), 4000);
    assert.equal(nextPollDelay(3), 8000);
    assert.equal(nextPollDelay(4), 10000);
    assert.equal(nextPollDelay(50), 10000);
  });
  it("treats nonsense counts as healthy", () => {
    assert.equal(nextPollDelay(-1), 2000);
    assert.equal(nextPollDelay(Number.NaN), 2000);
  });
  it("a 35 s outage costs ~6 requests instead of ~26", () => {
    let t = 0;
    let failures = 0;
    let requests = 0;
    while (t < 35_000) {
      requests += 1;
      failures += 1;
      t += nextPollDelay(failures);
    }
    assert.ok(requests <= 7, `requests=${requests}`);
  });
});

describe("isEngineDown", () => {
  it("flags the outage after two consecutive failures", () => {
    assert.equal(OFFLINE_AFTER_FAILURES, 2);
    assert.equal(isEngineDown(0), false);
    assert.equal(isEngineDown(1), false);
    assert.equal(isEngineDown(2), true);
    assert.equal(isEngineDown(9), true);
  });
});

function reply(body, status = 200) {
  return async () => ({ ok: status < 400, status, json: async () => body });
}

describe("requestEngineStart", () => {
  it("returns the engine url on success", async () => {
    const out = await requestEngineStart(
      reply({ ok: true, url: "http://127.0.0.1:8123" }),
    );
    assert.deepEqual(out, { ok: true, url: "http://127.0.0.1:8123" });
  });
  it("posts to the existing start route", async () => {
    let seen;
    await requestEngineStart(async (url, init) => {
      seen = [url, init.method];
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    });
    assert.deepEqual(seen, ["/api/tasks-engine/start", "POST"]);
  });
  it("surfaces the route's reason on refusal", async () => {
    const out = await requestEngineStart(reply({ ok: false, reason: "no python" }));
    assert.deepEqual(out, { ok: false, message: "no python" });
  });
  it("falls back to a generic message", async () => {
    const out = await requestEngineStart(reply({ ok: false }));
    assert.equal(out.ok, false);
    assert.match(out.message, /didn.t start/i);
  });
  it("reports an unreachable launcher", async () => {
    const out = await requestEngineStart(async () => {
      throw new Error("boom");
    });
    assert.equal(out.ok, false);
    assert.match(out.message, /launcher/i);
  });
  it("a non-JSON body is a failure, not a throw", async () => {
    const out = await requestEngineStart(async () => ({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("bad json");
      },
    }));
    assert.equal(out.ok, false);
  });
});
