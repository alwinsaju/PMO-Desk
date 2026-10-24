// Run with `pnpm test`. Lazy model loading, status polling, Load now / Unload now
// and the sleep detector, all against a fake Ollama (testkit.mjs).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_AI_RUNTIME_CONFIG, loadAiRuntimeConfig } from "./core.ts";
import { makeRuntime } from "./testkit.mjs";

const settle = async (state) => {
  for (let i = 0; i < 100 && state.loadInFlight; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};
// afterCall's look at /api/ps is fire-and-forget; give it a moment to land.
const flush = () => new Promise((resolve) => setTimeout(resolve, 10));
const kinds = (rt) => rt.state.ring.all().map((e) => e.kind);
const chats = (rt) => rt.ollama.st.calls.filter((c) => c.route === "/api/chat");

describe("nothing loads the model but a call (lazy loading)", () => {
  it("the default config does not pre-load, and the env switch turns it on", () => {
    assert.equal(DEFAULT_AI_RUNTIME_CONFIG.prewarm, false);
    assert.equal(loadAiRuntimeConfig({}).prewarm, false);
    assert.equal(loadAiRuntimeConfig({ AI_OS_AI_PREWARM: "1" }).prewarm, true);
    assert.equal(loadAiRuntimeConfig({ AI_OS_AI_PREWARM: "true" }).prewarm, true);
    assert.equal(loadAiRuntimeConfig({ AI_OS_AI_PREWARM: "0" }).prewarm, false);
    assert.equal(loadAiRuntimeConfig({ AI_OS_AI_PREWARM: "" }).prewarm, false);
  });

  it("start-up work with the pre-warm off sends nothing and says so once", () => {
    const rt = makeRuntime();
    assert.equal(rt.controls.prewarmOnStart(), "skipped");
    assert.equal(rt.controls.prewarmOnStart(), "skipped");
    assert.equal(rt.ollama.st.calls.length, 0);
    assert.deepEqual(kinds(rt), ["prewarm-skipped"]);
    assert.equal(rt.state.loadInFlight, false);
  });

  it("start-up work with the pre-warm on loads through a real call, once per server start", async () => {
    const rt = makeRuntime({ prewarm: true });
    assert.equal(rt.controls.prewarmOnStart(), "started");
    assert.equal(rt.controls.prewarmOnStart(), "already");
    await settle(rt.state);
    assert.equal(chats(rt).length, 1);
    assert.equal(chats(rt)[0].body.think, false);
    assert.equal(
      rt.state.ring.all().find((e) => e.kind === "call-start").task,
      "prewarm",
    );
    // A server that was restarted has nothing loaded: decide again.
    assert.equal(rt.controls.prewarmOnStart({ fresh: true }), "started");
    await settle(rt.state);
    // And an explicit override beats the config either way.
    const off = makeRuntime({ prewarm: true });
    assert.equal(off.controls.prewarmOnStart({ override: false }), "skipped");
    assert.equal(off.ollama.st.calls.length, 0);
  });

  it("status polling only reads: GET version/tags/ps, never a chat or generate", async () => {
    const rt = makeRuntime();
    for (let i = 0; i < 5; i++) await rt.controls.status();
    await rt.controls.observeModels();
    assert.deepEqual(rt.ollama.mutating(), []);
    assert.deepEqual([...new Set(rt.ollama.st.calls.map((c) => c.route))].sort(), [
      "/api/ps",
      "/api/tags",
      "/api/version",
    ]);
    assert.equal(rt.ollama.st.loaded.size, 0, "the model is still asleep");
    const status = await rt.controls.status();
    assert.equal(status.running, true);
    assert.equal(status.modelLoaded, false);
    assert.equal(status.modelInstalled, true);
    assert.deepEqual(status.loaded, []);
  });

  it("status reports a loaded model with its memory and deadline, and the config in force", async () => {
    const rt = makeRuntime({ prewarm: false });
    await rt.client.generateText({ prompt: "x", log: { task: "chaser" } });
    const status = await rt.controls.status();
    assert.equal(status.modelLoaded, true);
    assert.equal(status.loaded[0].name, "gemma4:12b");
    assert.ok(status.loaded[0].sizeBytes > 0);
    assert.ok(Date.parse(status.loaded[0].expiresAt) > rt.clock.now);
    assert.equal(status.keepAlive, "2m");
    assert.equal(status.prewarm, false);
    assert.equal(status.ownedByUs, false);
    assert.deepEqual(status.activeCalls, []);
  });

  it("the first call wakes the model and says so; the second finds it loaded", async () => {
    const rt = makeRuntime();
    await rt.client.generateText({
      prompt: "x",
      log: { task: "chaser", label: "Send the deck" },
    });
    await rt.client.generateText({
      prompt: "y",
      log: { task: "chaser", label: "Send the deck" },
    });
    const starts = rt.state.ring.all().filter((e) => e.kind === "call-start");
    const ends = rt.state.ring.all().filter((e) => e.kind === "call-end");
    assert.deepEqual(
      starts.map((e) => e.modelLoaded),
      [false, true],
    );
    assert.equal(ends[0].loadMs, 19000);
    assert.ok(ends[1].loadMs < 1000);
    assert.deepEqual(
      [ends[0].promptTokens, ends[0].evalTokens, ends[0].tokensPerSecond],
      [100, 40, 10],
    );
    // The transition detector logged the load once, caused by the call.
    const loads = rt.state.ring.all().filter((e) => e.kind === "model-loaded");
    assert.equal(loads.length, 1);
    assert.equal(loads[0].cause, "call");
    assert.equal(starts[0].keepAlive, "2m");
  });
});

describe("the sleep detector", () => {
  it("logs 'idle' when the keep-alive runs out, after a lazy look, and nothing while asleep", async () => {
    const rt = makeRuntime();
    await rt.client.generateText({ prompt: "x", log: { task: "chaser" } });
    await flush();
    assert.equal(rt.state.tracker.anyLoaded(), true);

    // keep_alive (2 minutes) passes and Ollama frees the model.
    rt.clock.now += 125_000;
    rt.ollama.expire();
    await rt.controls.status();
    const gone = rt.state.ring.all().find((e) => e.kind === "model-unloaded");
    assert.equal(gone.reason, "idle");
    assert.equal(gone.ours, true);
    assert.equal(gone.sizeBytes, 8 * 1024 ** 3);
    assert.ok(gone.idleMs >= 119_000 && gone.idleMs <= 121_000, `idleMs ${gone.idleMs}`);
    // Looking again changes nothing.
    const size = rt.state.ring.size;
    await rt.controls.status();
    assert.equal(rt.state.ring.size, size);
  });

  it("keeps a watch timer only while a model is loaded", async () => {
    const rt = makeRuntime();
    // Asleep: observing and polling arm nothing.
    await rt.controls.status();
    await rt.controls.observeModels();
    assert.equal(rt.timers.length, 0);

    await rt.client.generateText({ prompt: "x", log: { task: "chaser" } });
    await flush();
    assert.equal(rt.timers.length, 1, "armed once while loaded (not once per look)");
    await rt.controls.observeModels();
    assert.equal(rt.timers.length, 1);

    // The timer fires while the model is still loaded: it looks and re-arms.
    const fire = rt.timers.shift();
    rt.state.watchTimer = undefined;
    fire();
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(rt.timers.length, 1);

    // The model goes away: the next tick notices and does NOT re-arm.
    rt.clock.now += 130_000;
    rt.ollama.expire();
    rt.timers.shift()();
    rt.state.watchTimer = undefined;
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(rt.timers.length, 0);
    assert.ok(rt.state.ring.all().some((e) => e.kind === "model-unloaded"));
  });

  it("logs the server going away once and forgets what was loaded", async () => {
    const rt = makeRuntime();
    rt.state.ring.emitServer({
      kind: "server-up",
      how: "reused",
      owned: false,
      baseUrl: "http://127.0.0.1:11434",
    });
    await rt.client.generateText({ prompt: "x", log: { task: "chaser" } });
    rt.ollama.st.up = false;
    const down = await rt.controls.status();
    await rt.controls.status();
    assert.equal(down.running, false);
    assert.equal(rt.state.ring.all().filter((e) => e.kind === "server-down").length, 1);
    assert.equal(rt.state.tracker.anyLoaded(), false);
    // And back again.
    rt.ollama.st.up = true;
    await rt.controls.status();
    assert.equal(rt.state.ring.all().filter((e) => e.kind === "server-up").length, 2);
  });
});

describe("Load now", () => {
  it("wakes the model in the background with the standard keep_alive, once", async () => {
    const rt = makeRuntime();
    const first = await rt.controls.loadNow();
    assert.deepEqual(first, { ok: true, state: "started" });
    assert.equal(rt.state.loadInFlight, true);
    assert.deepEqual(await rt.controls.loadNow(), { ok: true, state: "already-loading" });
    await settle(rt.state);
    assert.equal(chats(rt).length, 1);
    assert.equal(chats(rt)[0].body.keep_alive, "2m");
    assert.equal(chats(rt)[0].body.options.num_predict <= 16, true);
    assert.equal(rt.state.ring.all().find((e) => e.kind === "call-start").task, "load");
    const loaded = rt.state.ring.all().find((e) => e.kind === "model-loaded");
    assert.equal(loaded.cause, "manual");
    assert.deepEqual(await rt.controls.loadNow(), { ok: true, state: "already-loaded" });
    assert.equal(chats(rt).length, 1, "no second chat");
  });

  it("refuses when Ollama is down and AI OS may not start it", async () => {
    const rt = makeRuntime({ autoStart: false });
    rt.ollama.st.up = false;
    const reply = await rt.controls.loadNow();
    assert.equal(reply.ok, false);
    assert.match(reply.reason, /not running/);
    assert.equal(rt.state.loadInFlight, false);
  });

  it("a failed load is in the log and clears the in-flight flag", async () => {
    const rt = makeRuntime({}, { installed: [] });
    assert.deepEqual(await rt.controls.loadNow(), { ok: true, state: "started" });
    await settle(rt.state);
    assert.equal(rt.state.loadInFlight, false);
    const end = rt.state.ring.all().find((e) => e.kind === "call-end");
    assert.equal(end.ok, false);
    assert.equal(end.errorCode, "model-missing");
  });
});

describe("Unload now", () => {
  it("unloads the default model with keep_alive 0 and logs it as a request", async () => {
    const rt = makeRuntime();
    await rt.client.generateText({ prompt: "x", log: { task: "chaser" } });
    const reply = await rt.controls.unloadNow();
    assert.deepEqual(reply, { ok: true, state: "unloaded" });
    const posts = rt.ollama.mutating().filter((c) => c.route === "/api/generate");
    assert.equal(posts.length, 1);
    assert.deepEqual(posts[0].body, {
      model: "gemma4:12b",
      stream: false,
      keep_alive: 0,
    });
    assert.equal(rt.ollama.st.loaded.size, 0);
    const k = kinds(rt);
    assert.ok(k.includes("unload-request"));
    const gone = rt.state.ring.all().find((e) => e.kind === "model-unloaded");
    assert.equal(gone.reason, "manual");
  });

  it("never touches another model in a shared Ollama", async () => {
    const rt = makeRuntime();
    await rt.client.generateText({ prompt: "x", log: { task: "chaser" } });
    rt.ollama.st.loaded.set("llama3.2:latest", {
      name: "llama3.2:latest",
      size: 2e9,
      expiresAt: new Date(rt.clock.now + 60_000).toISOString(),
    });
    await rt.controls.unloadNow();
    assert.deepEqual([...rt.ollama.st.loaded.keys()], ["llama3.2:latest"]);
    assert.ok(rt.ollama.mutating().every((c) => c.body.model === "gemma4:12b"));
  });

  it("is refused while a call is running, and sends nothing", async () => {
    const rt = makeRuntime();
    let release;
    rt.ollama.st.chatDelay = new Promise((resolve) => (release = resolve));
    const running = rt.client.generateText({ prompt: "x", log: { task: "chaser" } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const reply = await rt.controls.unloadNow();
    assert.equal(reply.ok, false);
    assert.match(reply.reason, /busy/);
    assert.equal(
      rt.ollama.mutating().filter((c) => c.route === "/api/generate").length,
      0,
    );
    release();
    await running;
  });

  it("is a no-op (and sends nothing) when the model is already asleep", async () => {
    const rt = makeRuntime();
    assert.deepEqual(await rt.controls.unloadNow(), {
      ok: true,
      state: "already-asleep",
    });
    assert.deepEqual(rt.ollama.mutating(), []);
  });

  it("says so when Ollama is not running", async () => {
    const rt = makeRuntime();
    rt.ollama.st.up = false;
    const reply = await rt.controls.unloadNow();
    assert.equal(reply.ok, false);
    assert.match(reply.reason, /not running/);
  });
});

describe("keep_alive on every request (owned and reused)", () => {
  it("defaults to 2 minutes for an owned server and for a reused one", async () => {
    const owned = makeRuntime({}, {}, true);
    const reused = makeRuntime({}, {}, false);
    for (const rt of [owned, reused]) {
      await rt.client.generateText({ prompt: "x", log: { task: "chaser" } });
      assert.equal(chats(rt)[0].body.keep_alive, "2m");
    }
    assert.equal(DEFAULT_AI_RUNTIME_CONFIG.keepAlive, "2m");
    assert.equal(DEFAULT_AI_RUNTIME_CONFIG.externalKeepAlive, "2m");
  });

  it("AI_OS_AI_KEEP_ALIVE overrides both, and a bad value falls back", async () => {
    const config = loadAiRuntimeConfig({ AI_OS_AI_KEEP_ALIVE: "20s" });
    assert.deepEqual([config.keepAlive, config.externalKeepAlive], ["20s", "20s"]);
    for (const owned of [true, false]) {
      const rt = makeRuntime(
        { keepAlive: config.keepAlive, externalKeepAlive: config.externalKeepAlive },
        {},
        owned,
      );
      await rt.client.generateText({ prompt: "x", log: { task: "chaser" } });
      assert.equal(chats(rt)[0].body.keep_alive, "20s");
    }
    const junk = loadAiRuntimeConfig({ AI_OS_AI_KEEP_ALIVE: "banana" });
    assert.deepEqual([junk.keepAlive, junk.externalKeepAlive], ["2m", "2m"]);
    assert.equal(
      loadAiRuntimeConfig({ AI_OS_AI_KEEP_ALIVE: "1h30m" }).keepAlive,
      "1h30m",
    );
    assert.equal(loadAiRuntimeConfig({ AI_OS_AI_KEEP_ALIVE: "-1" }).keepAlive, "-1");
    assert.equal(loadAiRuntimeConfig({ AI_OS_AI_KEEP_ALIVE: "  5m " }).keepAlive, "5m");
  });
});
