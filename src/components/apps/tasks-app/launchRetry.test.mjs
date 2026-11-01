import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { abortableSleep, runEngineLaunch } from "./launchRetry.ts";

const reply = (status, body) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => {
    if (body === undefined) throw new Error("not json");
    return body;
  },
});

/** Fake clock: sleeping just moves time forward, every call is logged. */
function harness(replies, { signal = new AbortController().signal, ...extra } = {}) {
  let clock = 0;
  const sleeps = [];
  const retries = [];
  let calls = 0;
  const deps = {
    fetchImpl: async (...args) => {
      const next = replies[Math.min(calls, replies.length - 1)];
      calls += 1;
      clock += 100;
      return next(...args);
    },
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
    signal,
    onRetry: (info) => retries.push(info),
    ...extra,
  };
  return { deps, sleeps, retries, calls: () => calls };
}

const ready = reply(200, { ok: true, url: "http://127.0.0.1:8001" });

describe("runEngineLaunch", () => {
  it("returns ready straight away when the first attempt works", async () => {
    const h = harness([ready]);
    assert.deepEqual(await runEngineLaunch(h.deps), {
      status: "ready",
      url: "http://127.0.0.1:8001",
    });
    assert.deepEqual(h.sleeps, []);
  });

  it("retries a 404 with back-off and then succeeds", async () => {
    const h = harness([reply(404), reply(404), reply(503), ready]);
    const out = await runEngineLaunch(h.deps);
    assert.equal(out.status, "ready");
    assert.deepEqual(h.sleeps, [500, 1000, 2000]);
    assert.deepEqual(
      h.retries.map((r) => [r.attempt, r.detail]),
      [
        [1, "HTTP 404"],
        [2, "HTTP 404"],
        [3, "HTTP 503"],
      ],
    );
  });

  it("retries a network error and a 502", async () => {
    const boom = async () => {
      throw new TypeError("fetch failed");
    };
    const h = harness([boom, reply(502), ready]);
    assert.equal((await runEngineLaunch(h.deps)).status, "ready");
    assert.deepEqual(
      h.retries.map((r) => r.detail),
      ["no response", "HTTP 502"],
    );
  });

  it("gives up after the budget and names the cause", async () => {
    const h = harness([reply(404)]);
    const out = await runEngineLaunch(h.deps);
    assert.equal(out.status, "failed");
    assert.match(out.reason, /^The engine did not answer after 12 s \(HTTP 404\)\.$/);
    assert.ok(h.calls() >= 5 && h.calls() <= 9);
    assert.ok(h.sleeps.every((ms) => ms <= 3000));
  });

  it("never sleeps past the budget", async () => {
    const h = harness([reply(404)], { budgetMs: 1000 });
    await runEngineLaunch(h.deps);
    assert.ok(h.sleeps.reduce((a, b) => a + b, 0) <= 1000);
  });

  it("does not retry when the engine reports a real reason", async () => {
    const h = harness([reply(200, { ok: false, reason: "No Python found" }), ready]);
    assert.deepEqual(await runEngineLaunch(h.deps), {
      status: "failed",
      reason: "No Python found",
    });
    assert.equal(h.calls(), 1);
  });

  it("does not retry a failure without a reason, and says so plainly", async () => {
    const h = harness([reply(200, { ok: false })]);
    const out = await runEngineLaunch(h.deps);
    assert.equal(out.reason, "The engine failed to start.");
    assert.equal(h.calls(), 1);
  });

  it("rejects an engine address that is not http(s)", async () => {
    const h = harness([reply(200, { ok: true, url: "javascript:alert(1)" })]);
    const out = await runEngineLaunch(h.deps);
    assert.equal(out.status, "failed");
    assert.equal(h.calls(), 1);
  });

  it("treats an unreadable 500 as transient", async () => {
    const h = harness([reply(500), ready]);
    assert.equal((await runEngineLaunch(h.deps)).status, "ready");
    assert.match(h.retries[0].detail, /HTTP 500/);
  });

  it("stops quietly when aborted before starting", async () => {
    const controller = new AbortController();
    controller.abort();
    const h = harness([ready], { signal: controller.signal });
    assert.deepEqual(await runEngineLaunch(h.deps), { status: "aborted" });
    assert.equal(h.calls(), 0);
  });

  it("ignores a stale reply that lands after the abort", async () => {
    const controller = new AbortController();
    const h = harness(
      [
        async () => {
          controller.abort();
          return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true, url: "http://x" }),
          };
        },
      ],
      { signal: controller.signal },
    );
    assert.deepEqual(await runEngineLaunch(h.deps), { status: "aborted" });
  });

  it("aborts while waiting between attempts without another request", async () => {
    const controller = new AbortController();
    const h = harness([reply(404), ready], {
      signal: controller.signal,
      sleep: async () => controller.abort(),
    });
    assert.deepEqual(await runEngineLaunch(h.deps), { status: "aborted" });
    assert.equal(h.calls(), 1);
  });
});

describe("abortableSleep", () => {
  it("resolves early when aborted", async () => {
    const controller = new AbortController();
    const started = Date.now();
    const pending = abortableSleep(5000, controller.signal);
    controller.abort();
    await pending;
    assert.ok(Date.now() - started < 1000);
  });

  it("resolves at once for an already-aborted signal", async () => {
    await abortableSleep(5000, AbortSignal.abort());
  });

  it("waits for the delay otherwise", async () => {
    await abortableSleep(5, new AbortController().signal);
  });
});
