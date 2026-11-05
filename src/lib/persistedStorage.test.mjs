// Run with `pnpm test`. The server-backed zustand storage against a fake fetch
// and a fake localStorage: no network, no browser.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import {
  SERVER_WRITE_DEBOUNCE_MS,
  createServerBackedStorage,
} from "./persistedStorage.ts";
import { getSaveStatus, retryDelayMs } from "./uiState/saveStatus.ts";

function fakeLocal(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
  };
}

/** `server` is the stored value (or null); `mode` "ok" | "reject" | "500". */
function fakeServer({ value = null, mode = "ok" } = {}) {
  const calls = [];
  const state = { value, mode };
  const fetch = async (url, init = {}) => {
    calls.push({
      url,
      method: init.method ?? "GET",
      body: init.body,
      keepalive: init.keepalive,
    });
    if (state.mode === "reject") throw new TypeError("network down");
    if (state.mode === "500") return { ok: false, json: async () => ({}) };
    const method = init.method ?? "GET";
    if (method === "PUT") state.value = JSON.parse(init.body).value;
    if (method === "DELETE") state.value = null;
    return { ok: true, json: async () => ({ ok: true, value: state.value }) };
  };
  return { fetch, calls, state, puts: () => calls.filter((c) => c.method === "PUT") };
}

function make(key, { server, local, beacon } = {}) {
  const hide = { callbacks: [] };
  const storage = createServerBackedStorage(key, {
    fetch: server.fetch,
    localStorage: local === null ? null : local,
    sendBeacon: beacon ?? (() => false),
    onPageHide: (cb) => hide.callbacks.push(cb),
  });
  return { storage, hide };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe("getItem", () => {
  it("returns the server value when present, ignoring localStorage", async () => {
    const server = fakeServer({ value: { state: { a: 1 }, version: 0 } });
    const local = fakeLocal({ name: JSON.stringify({ state: { a: 2 } }) });
    const { storage } = make("notes", { server, local });
    assert.deepEqual(JSON.parse(await storage.getItem("name")), {
      state: { a: 1 },
      version: 0,
    });
    assert.equal(server.puts().length, 0);
  });

  it("reads the server only once", async () => {
    const server = fakeServer({ value: { a: 1 } });
    const { storage } = make("notes", { server, local: fakeLocal() });
    const first = await storage.getItem("name");
    const second = await storage.getItem("name");
    assert.equal(first, second);
    assert.equal(server.calls.length, 1);
    assert.equal(server.calls[0].url, "/api/ui-state/notes");
  });

  it("migrates localStorage to an empty server exactly once", async () => {
    const stored = JSON.stringify({ state: { notes: [1] }, version: 1 });
    const server = fakeServer({ value: null });
    const { storage } = make("notes", { server, local: fakeLocal({ name: stored }) });
    assert.equal(await storage.getItem("name"), stored);
    await tick();
    assert.equal(await storage.getItem("name"), stored);
    await storage.getItem("name");
    await tick();
    assert.equal(server.puts().length, 1);
    assert.deepEqual(JSON.parse(server.puts()[0].body), { value: JSON.parse(stored) });
  });

  it("returns null and pushes nothing when neither side has data", async () => {
    const server = fakeServer({ value: null });
    const { storage } = make("notes", { server, local: fakeLocal() });
    assert.equal(await storage.getItem("name"), null);
    await tick();
    assert.equal(server.puts().length, 0);
  });

  it("falls back to localStorage when fetch rejects, without pushing", async () => {
    const server = fakeServer({ mode: "reject" });
    const { storage } = make("notes", { server, local: fakeLocal({ name: '{"a":1}' }) });
    assert.equal(await storage.getItem("name"), '{"a":1}');
    assert.equal(server.puts().length, 0);
  });

  it("falls back to localStorage on a non-200 answer", async () => {
    const server = fakeServer({ mode: "500" });
    const { storage } = make("notes", { server, local: fakeLocal({ name: '{"a":1}' }) });
    assert.equal(await storage.getItem("name"), '{"a":1}');
  });

  it("works with no localStorage at all", async () => {
    const server = fakeServer({ mode: "reject" });
    const { storage } = make("notes", { server, local: null });
    assert.equal(await storage.getItem("name"), null);
    storage.setItem("name", '{"a":1}');
    storage.removeItem("name");
  });

  it("a write made while the first read is in flight is not overwritten", async () => {
    const server = fakeServer({ value: { old: true } });
    const { storage } = make("notes", { server, local: fakeLocal() });
    const read = storage.getItem("name");
    storage.setItem("name", '{"fresh":true}');
    assert.equal(await read, '{"fresh":true}');
  });
});

describe("setItem", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
  afterEach(() => mock.timers.reset());

  it("writes localStorage immediately and the server after the debounce", async () => {
    const server = fakeServer();
    const local = fakeLocal();
    const { storage } = make("notes", { server, local });
    storage.setItem("name", '{"n":1}');
    assert.equal(local.map.get("name"), '{"n":1}');
    assert.equal(server.puts().length, 0);
    mock.timers.tick(SERVER_WRITE_DEBOUNCE_MS - 1);
    assert.equal(server.puts().length, 0);
    mock.timers.tick(1);
    assert.equal(server.puts().length, 1);
    assert.deepEqual(server.state.value, { n: 1 });
  });

  it("coalesces rapid writes: last write wins, one request", () => {
    const server = fakeServer();
    const { storage } = make("notes", { server, local: fakeLocal() });
    storage.setItem("name", '{"n":1}');
    mock.timers.tick(100);
    storage.setItem("name", '{"n":2}');
    mock.timers.tick(100);
    storage.setItem("name", '{"n":3}');
    mock.timers.tick(SERVER_WRITE_DEBOUNCE_MS);
    assert.equal(server.puts().length, 1);
    assert.deepEqual(JSON.parse(server.puts()[0].body), { value: { n: 3 } });
  });

  it("a later getItem sees the written value without another fetch", async () => {
    const server = fakeServer({ value: { old: true } });
    const { storage } = make("notes", { server, local: fakeLocal() });
    storage.setItem("name", '{"n":1}');
    assert.equal(await storage.getItem("name"), '{"n":1}');
    assert.equal(server.calls.filter((c) => c.method === "GET").length, 0);
  });

  it("flushes a pending write on pagehide via sendBeacon", () => {
    const server = fakeServer();
    const beacons = [];
    const { storage, hide } = make("notes", {
      server,
      local: fakeLocal(),
      beacon: (url, body) => (beacons.push({ url, body }), true),
    });
    storage.setItem("name", '{"n":1}');
    hide.callbacks.forEach((cb) => cb());
    assert.equal(beacons.length, 1);
    assert.equal(beacons[0].url, "/api/ui-state/notes");
    assert.deepEqual(JSON.parse(beacons[0].body), { value: { n: 1 } });
    mock.timers.tick(SERVER_WRITE_DEBOUNCE_MS * 2);
    assert.equal(server.puts().length, 0);
  });

  it("flushes with a keepalive fetch when sendBeacon declines", () => {
    const server = fakeServer();
    const { storage, hide } = make("notes", { server, local: fakeLocal() });
    storage.setItem("name", '{"n":1}');
    hide.callbacks.forEach((cb) => cb());
    assert.equal(server.puts().length, 1);
    assert.equal(server.puts()[0].keepalive, true);
  });

  it("pagehide with nothing pending sends nothing", () => {
    const server = fakeServer();
    const { hide } = make("notes", { server, local: fakeLocal() });
    hide.callbacks.forEach((cb) => cb());
    assert.equal(server.calls.length, 0);
  });

  it("ignores a server failure silently", () => {
    const server = fakeServer({ mode: "reject" });
    const local = fakeLocal();
    const { storage } = make("notes", { server, local });
    storage.setItem("name", '{"n":1}');
    mock.timers.tick(SERVER_WRITE_DEBOUNCE_MS);
    assert.equal(local.map.get("name"), '{"n":1}');
  });
});

describe("failed saves and restore preference", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
  afterEach(() => mock.timers.reset());

  /** A server whose PUT answers with the given HTTP status; GET returns `value`. */
  function statusServer({ value = null, updatedAt = null, putStatus = 200 } = {}) {
    const state = { value, updatedAt, putStatus, puts: [] };
    const fetch = async (url, init = {}) => {
      if ((init.method ?? "GET") === "GET") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            value: state.value,
            updatedAt: state.updatedAt,
          }),
        };
      }
      if (init.method === "DELETE")
        return { ok: true, status: 200, json: async () => ({}) };
      state.puts.push(JSON.parse(init.body).value);
      if (state.putStatus === "reject") throw new TypeError("network down");
      const ok = state.putStatus < 400;
      if (ok) state.value = JSON.parse(init.body).value;
      return { ok, status: state.putStatus, json: async () => ({ ok }) };
    };
    return { fetch, state };
  }

  const settle = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  it("reports saving, then saved, once the server confirms", async () => {
    const server = statusServer();
    const { storage } = make("status-ok", { server, local: fakeLocal() });
    storage.setItem("name", '{"n":1}');
    assert.deepEqual(getSaveStatus("status-ok"), { state: "saving" });
    mock.timers.tick(SERVER_WRITE_DEBOUNCE_MS);
    await settle();
    assert.deepEqual(getSaveStatus("status-ok"), { state: "saved" });
  });

  it("a 413 is an error that is not retried, and the local copy is kept", async () => {
    const server = statusServer({ putStatus: 413 });
    const local = fakeLocal();
    const { storage } = make("status-big", { server, local });
    storage.setItem("name", '{"n":1}');
    mock.timers.tick(SERVER_WRITE_DEBOUNCE_MS);
    await settle();
    assert.deepEqual(getSaveStatus("status-big"), {
      state: "error",
      failure: "too-large",
      willRetry: false,
    });
    assert.equal(local.map.get("name"), '{"n":1}');
    assert.equal(JSON.parse(local.map.get("name.sync")).dirty, true);
    mock.timers.tick(120_000);
    await settle();
    assert.equal(server.state.puts.length, 1);
  });

  it("a network failure is retried until the server accepts, then marked saved", async () => {
    const server = statusServer({ putStatus: "reject" });
    const local = fakeLocal();
    const { storage } = make("status-retry", { server, local });
    storage.setItem("name", '{"n":1}');
    mock.timers.tick(SERVER_WRITE_DEBOUNCE_MS);
    await settle();
    assert.deepEqual(getSaveStatus("status-retry"), {
      state: "error",
      failure: "unreachable",
      willRetry: true,
    });
    server.state.putStatus = 200;
    mock.timers.tick(retryDelayMs(0));
    await settle();
    assert.deepEqual(getSaveStatus("status-retry"), { state: "saved" });
    assert.deepEqual(server.state.value, { n: 1 });
    assert.equal(JSON.parse(local.map.get("name.sync")).dirty, false);
  });

  it("a new edit replaces a waiting retry with the newest text", async () => {
    const server = statusServer({ putStatus: "reject" });
    const { storage } = make("status-newer", { server, local: fakeLocal() });
    storage.setItem("name", '{"n":1}');
    mock.timers.tick(SERVER_WRITE_DEBOUNCE_MS);
    await settle();
    server.state.putStatus = 200;
    storage.setItem("name", '{"n":2}');
    mock.timers.tick(SERVER_WRITE_DEBOUNCE_MS);
    await settle();
    mock.timers.tick(120_000);
    await settle();
    assert.deepEqual(server.state.value, { n: 2 });
    assert.deepEqual(getSaveStatus("status-newer"), { state: "saved" });
  });

  it("keeps and re-sends the browser's newer unconfirmed copy on restart", async () => {
    const mine = JSON.stringify({ state: { notes: ["big"] }, version: 1 });
    const server = statusServer({
      value: { state: { notes: ["old"] }, version: 1 },
      updatedAt: 1000,
    });
    const local = fakeLocal({
      name: mine,
      "name.sync": JSON.stringify({ dirty: true, at: 2000 }),
    });
    const { storage } = make("restore-local", { server, local });
    assert.equal(await storage.getItem("name"), mine);
    mock.timers.tick(0);
    await settle();
    assert.deepEqual(server.state.value, JSON.parse(mine));
  });

  it("prefers the server when it was written after the unconfirmed local copy", async () => {
    const server = statusServer({ value: { fromServer: true }, updatedAt: 5000 });
    const local = fakeLocal({
      name: '{"fromLocal":true}',
      "name.sync": JSON.stringify({ dirty: true, at: 2000 }),
    });
    const { storage } = make("restore-server", { server, local });
    assert.deepEqual(JSON.parse(await storage.getItem("name")), { fromServer: true });
  });

  it("prefers the server when the local copy was already confirmed", async () => {
    const server = statusServer({ value: { fromServer: true }, updatedAt: 1000 });
    const local = fakeLocal({
      name: '{"fromLocal":true}',
      "name.sync": JSON.stringify({ dirty: false, at: 9000 }),
    });
    const { storage } = make("restore-clean", { server, local });
    assert.deepEqual(JSON.parse(await storage.getItem("name")), { fromServer: true });
  });
});

describe("removeItem", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
  afterEach(() => mock.timers.reset());

  it("clears localStorage and the server, and drops a pending write", async () => {
    const server = fakeServer({ value: { n: 1 } });
    const local = fakeLocal({ name: '{"n":1}' });
    const { storage } = make("notes", { server, local });
    storage.setItem("name", '{"n":2}');
    storage.removeItem("name");
    mock.timers.tick(SERVER_WRITE_DEBOUNCE_MS * 2);
    assert.equal(local.map.has("name"), false);
    assert.equal(server.puts().length, 0);
    assert.equal(server.calls.at(-1).method, "DELETE");
    assert.equal(server.state.value, null);
    assert.equal(await storage.getItem("name"), null);
  });
});
