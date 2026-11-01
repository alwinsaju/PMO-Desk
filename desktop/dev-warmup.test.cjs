// Run with `pnpm test`. The live-dev route warm-up.
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { warmDevRoutes, WARM_ROUTES } = require("./dev-warmup.cjs");

const okResponse = () => ({ arrayBuffer: async () => new ArrayBuffer(0) });

describe("warmDevRoutes", () => {
  it("requests every route against the base URL", async () => {
    const seen = [];
    const result = await warmDevRoutes({
      baseUrl: "http://127.0.0.1:3100",
      fetchImpl: async (url) => {
        seen.push(url.toString());
        return okResponse();
      },
    });
    assert.deepEqual(
      seen.sort(),
      WARM_ROUTES.map((route) => `http://127.0.0.1:3100${route}`).sort(),
    );
    assert.deepEqual(result, { warmed: WARM_ROUTES.length, failed: 0 });
  });

  it("counts failures and keeps going", async () => {
    const result = await warmDevRoutes({
      baseUrl: "http://127.0.0.1:3100",
      routes: ["/a", "/b", "/c"],
      fetchImpl: async (url) => {
        if (url.pathname === "/b") throw new Error("boom");
        return okResponse();
      },
    });
    assert.deepEqual(result, { warmed: 2, failed: 1 });
  });

  it("never runs more requests at once than the concurrency", async () => {
    let active = 0;
    let peak = 0;
    await warmDevRoutes({
      baseUrl: "http://127.0.0.1:3100",
      routes: ["/1", "/2", "/3", "/4", "/5"],
      concurrency: 2,
      fetchImpl: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setImmediate(resolve));
        active -= 1;
        return okResponse();
      },
    });
    assert.equal(peak, 2);
  });

  it("warms the Tasks launcher with a GET so the spawning POST handler never runs", async () => {
    assert.ok(WARM_ROUTES.includes("/api/tasks-engine/start"));
    const methods = [];
    await warmDevRoutes({
      baseUrl: "http://127.0.0.1:3100",
      routes: ["/api/tasks-engine/start"],
      fetchImpl: async (_url, init) => {
        methods.push(init?.method ?? "GET");
        return okResponse();
      },
    });
    assert.deepEqual(methods, ["GET"]);
  });

  it("only warms read-only routes that do not start background work", () => {
    assert.ok(!WARM_ROUTES.includes("/api/pmo/state"));
    assert.ok(WARM_ROUTES.every((route) => route.startsWith("/api/")));
  });
});
