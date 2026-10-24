// Run with `pnpm test`. The decisions behind /api/ai/runtime/{log,load,unload}:
// the origin guard, the `since` cursor and the { ok } envelope.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RingLog } from "./log.ts";
import { guard, handleAction, handleLog, parseLogQuery } from "./routeLogic.ts";

const local = { host: "localhost:3000", origin: null, secFetchSite: null };
const sameOrigin = {
  host: "localhost:3000",
  origin: "http://localhost:3000",
  secFetchSite: "same-origin",
};
const evil = [
  { host: "localhost:3000", origin: "https://evil.example", secFetchSite: "cross-site" },
  { host: "localhost:3000", origin: "https://evil.example", secFetchSite: null },
  { host: "localhost:3000", origin: null, secFetchSite: "cross-site" },
  { host: "localhost:3000", origin: "null", secFetchSite: null },
  { host: "evil.example", origin: null, secFetchSite: null }, // DNS rebinding
  { host: null, origin: null, secFetchSite: null },
];

describe("origin guard", () => {
  it("lets the app's own page and plain local tools through", () => {
    assert.equal(guard(local), null);
    assert.equal(guard(sameOrigin), null);
    assert.equal(
      guard({
        host: "127.0.0.1:3066",
        origin: "http://127.0.0.1:3066",
        secFetchSite: "same-origin",
      }),
      null,
    );
  });

  it("refuses cross-site pages and non-loopback hosts with a 403 and a reason", () => {
    for (const facts of evil) {
      const reply = guard(facts);
      assert.equal(reply.status, 403);
      assert.equal(reply.body.ok, false);
      assert.ok(reply.body.reason);
    }
  });

  it("every route runs the guard before it does anything", async () => {
    let ran = 0;
    for (const facts of evil) {
      const log = await handleLog(facts, new URLSearchParams(), async () => (ran++, {}));
      const load = await handleAction(
        facts,
        async () => (ran++, { ok: true, state: "started" }),
      );
      assert.equal(log.status, 403);
      assert.equal(load.status, 403);
    }
    assert.equal(ran, 0);
  });
});

describe("log query", () => {
  it("parses the cursor leniently", () => {
    const q = (s) => parseLogQuery(new URLSearchParams(s));
    assert.deepEqual(q("since=12&session=abc123&serverLog=1"), {
      since: 12,
      session: "abc123",
      serverLog: true,
    });
    assert.deepEqual(q(""), { since: 0, session: undefined, serverLog: false });
    assert.equal(q("since=-4").since, 0);
    assert.equal(q("since=1.5").since, 0);
    assert.equal(q("since=banana").since, 0);
    assert.equal(q("serverLog=0").serverLog, false);
    assert.equal(q("session=../../etc").session, undefined);
  });

  it("passes the parsed query on and wraps the answer in { ok: true }", async () => {
    let seen;
    const reply = await handleLog(
      local,
      new URLSearchParams("since=7&serverLog=1"),
      async (query) => {
        seen = query;
        return { session: "s", events: [] };
      },
    );
    assert.deepEqual(seen, { since: 7, session: undefined, serverLog: true });
    assert.deepEqual(reply, {
      status: 200,
      body: { ok: true, session: "s", events: [] },
    });
  });

  it("returns only what is newer than the cursor, through a real ring buffer", async () => {
    const ring = new RingLog(100);
    for (let i = 0; i < 5; i++)
      ring.emit({ kind: "prewarm-skipped", reason: "disabled" });
    const read = async ({ since }) => ({
      latestSeq: ring.latestSeq,
      events: ring.since(since),
    });
    const first = await handleLog(local, new URLSearchParams("since=0"), read);
    assert.equal(first.body.events.length, 5);
    ring.emit({ kind: "prewarm-skipped", reason: "disabled" });
    const next = await handleLog(
      local,
      new URLSearchParams(`since=${first.body.latestSeq}`),
      read,
    );
    assert.deepEqual(
      next.body.events.map((e) => e.seq),
      [6],
    );
  });

  it("turns a failure into { ok: false } with HTTP 200", async () => {
    const reply = await handleLog(local, new URLSearchParams(), async () => {
      throw new Error("boom");
    });
    assert.deepEqual(reply, { status: 200, body: { ok: false, reason: "boom" } });
  });
});

describe("load and unload routes", () => {
  it("run the action and return its result as the body", async () => {
    assert.deepEqual(
      await handleAction(sameOrigin, async () => ({ ok: true, state: "unloaded" })),
      { status: 200, body: { ok: true, state: "unloaded" } },
    );
    assert.deepEqual(
      await handleAction(local, async () => ({
        ok: false,
        reason: "The model is busy right now.",
      })),
      { status: 200, body: { ok: false, reason: "The model is busy right now." } },
    );
  });

  it("do not need the desktop-only header (the button is inside the app window)", async () => {
    // Same-origin page, no x-ai-os-desktop: accepted. Stop's header check is not here.
    const reply = await handleAction(sameOrigin, async () => ({
      ok: true,
      state: "started",
    }));
    assert.equal(reply.status, 200);
  });

  it("turn a thrown error into { ok: false }", async () => {
    const reply = await handleAction(local, async () => {
      throw new Error("kaput");
    });
    assert.equal(reply.body.ok, false);
    assert.equal(reply.body.reason, "kaput");
  });
});
