// Run with `pnpm test`. The restart flow against a FAKE fetch: nothing here
// touches the network, the launcher routes or the live Tasks engine.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { busyTasks, probeEngine, restartEngine } from "./engineRestart.ts";

const API = "http://engine.test";
const noSleep = async () => {};

/** Scripted fake: records every call; `routes` maps "METHOD url" -> response. */
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const key = `${init.method ?? "GET"} ${url}`;
    calls.push(key);
    const handler = routes[key];
    if (!handler) throw new Error(`unexpected call: ${key}`);
    const out = typeof handler === "function" ? handler() : handler;
    if (out instanceof Error) throw out;
    return {
      ok: out.status === undefined ? true : out.status < 400,
      status: out.status ?? 200,
      json: async () => out.body,
    };
  };
  fn.calls = calls;
  return fn;
}

describe("busyTasks / probeEngine", () => {
  it("lists tasks that are not resting", () => {
    assert.deepEqual(
      busyTasks([
        { id: "a", displayName: "A", state: "resting" },
        { id: "b", displayName: "B", state: "working" },
        { id: "c", state: "awaiting_send" },
      ]),
      [
        { label: "B", state: "working" },
        { label: "c", state: "awaiting_send" },
      ],
    );
    assert.deepEqual(busyTasks({ ok: false }), []);
  });

  it("is read-only and reports unreachable", async () => {
    const down = fakeFetch({ [`GET ${API}/tasks`]: new Error("ECONNREFUSED") });
    assert.deepEqual(await probeEngine(down, API), { reachable: false });
    const up = fakeFetch({
      [`GET ${API}/tasks`]: { body: [{ id: "x", state: "resting" }] },
    });
    assert.deepEqual(await probeEngine(up, API), { reachable: true, busy: [] });
    assert.deepEqual(up.calls, [`GET ${API}/tasks`]);
  });
});

describe("restartEngine", () => {
  const opts = (fetchImpl, extra = {}) => ({
    fetchImpl,
    apiUrl: API,
    sleep: noSleep,
    ...extra,
  });

  it("stops the owned engine, waits for it to go away, then starts it", async () => {
    let alive = 2; // answers twice after stop, then goes away
    const f = fakeFetch({
      "POST /api/tasks-engine/stop": { body: { ok: true, stopped: true } },
      [`GET ${API}/tasks`]: () => (alive-- > 0 ? { body: [] } : new Error("down")),
      "POST /api/tasks-engine/start": { body: { ok: true, alreadyRunning: false } },
    });
    const phases = [];
    const out = await restartEngine(opts(f, { onPhase: (p) => phases.push(p) }));
    assert.equal(out.ok, true);
    assert.equal(out.kind, "restarted");
    assert.deepEqual(phases, ["stopping", "starting"]);
    assert.equal(f.calls[0], "POST /api/tasks-engine/stop");
    assert.equal(f.calls.at(-1), "POST /api/tasks-engine/start");
  });

  it("only ever calls the launcher routes and GET /tasks", async () => {
    const f = fakeFetch({
      "POST /api/tasks-engine/stop": { body: { ok: true, stopped: true } },
      [`GET ${API}/tasks`]: new Error("down"),
      "POST /api/tasks-engine/start": { body: { ok: true } },
    });
    await restartEngine(opts(f));
    for (const call of f.calls) {
      assert.ok(
        call.startsWith("POST /api/tasks-engine/") || call === `GET ${API}/tasks`,
        `unexpected call ${call}`,
      );
    }
  });

  it("reports a engine started elsewhere and leaves it alone", async () => {
    const f = fakeFetch({
      "POST /api/tasks-engine/stop": { body: { ok: true, stopped: false } },
      [`GET ${API}/tasks`]: { body: [] },
    });
    const out = await restartEngine(opts(f));
    assert.equal(out.ok, false);
    assert.equal(out.kind, "not-owned");
    assert.ok(!f.calls.includes("POST /api/tasks-engine/start"));
  });

  it("just starts a engine that is not running", async () => {
    const f = fakeFetch({
      "POST /api/tasks-engine/stop": { body: { ok: true, stopped: false } },
      [`GET ${API}/tasks`]: new Error("down"),
      "POST /api/tasks-engine/start": { body: { ok: true, alreadyRunning: false } },
    });
    const out = await restartEngine(opts(f));
    assert.equal(out.ok, true);
    assert.equal(out.kind, "started");
  });

  it("explains that it needs the desktop app (409)", async () => {
    const f = fakeFetch({
      "POST /api/tasks-engine/stop": { status: 409, body: { ok: false, reason: "no" } },
    });
    const out = await restartEngine(opts(f));
    assert.equal(out.ok, false);
    assert.equal(out.kind, "not-desktop");
    assert.deepEqual(f.calls, ["POST /api/tasks-engine/stop"]);
  });

  it("fails when the old engine never stops answering", async () => {
    const f = fakeFetch({
      "POST /api/tasks-engine/stop": { body: { ok: true, stopped: true } },
      [`GET ${API}/tasks`]: { body: [] },
    });
    const out = await restartEngine(opts(f, { stopSettleMs: 0 }));
    assert.equal(out.ok, false);
    assert.equal(out.kind, "stop-failed");
    assert.ok(!f.calls.includes("POST /api/tasks-engine/start"));
  });

  it("surfaces the start route's reason", async () => {
    const f = fakeFetch({
      "POST /api/tasks-engine/stop": { body: { ok: true, stopped: true } },
      [`GET ${API}/tasks`]: new Error("down"),
      "POST /api/tasks-engine/start": { body: { ok: false, reason: "venv missing" } },
    });
    const out = await restartEngine(opts(f));
    assert.equal(out.ok, false);
    assert.equal(out.kind, "start-failed");
    assert.equal(out.message, "venv missing");
  });

  it("reports a network failure on stop", async () => {
    const f = fakeFetch({ "POST /api/tasks-engine/stop": new Error("boom") });
    const out = await restartEngine(opts(f));
    assert.equal(out.ok, false);
    assert.equal(out.kind, "stop-failed");
  });
});
