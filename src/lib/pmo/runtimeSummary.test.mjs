// Run with `pnpm test`. The model status the PMO toolbar shows, derived from the
// AI runtime's status. An unloaded model is the normal idle state.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WAKE_NOTE, summarizeRuntime } from "./runtimeSummary.ts";

const GB = 1024 ** 3;
const NOW = Date.parse("2026-10-24T10:00:00Z");
const status = (patch = {}) => ({
  running: true,
  ownedByUs: true,
  adopted: false,
  baseUrl: "http://127.0.0.1:11434",
  defaultModel: "gemma4:12b",
  modelInstalled: true,
  modelLoaded: false,
  loadedModels: [],
  loaded: [],
  queue: { waiting: 0, active: false },
  activeCalls: [],
  loadInFlight: false,
  canAutoStart: true,
  keepAlive: "2m",
  prewarm: false,
  ...patch,
});
const loaded = {
  modelLoaded: true,
  loadedModels: ["gemma4:12b"],
  loaded: [
    {
      name: "gemma4:12b",
      sizeBytes: 8 * GB,
      sizeVramBytes: 0,
      expiresAt: "2026-10-24T10:02:00Z",
    },
  ],
};
const call = (task, modelLoadedBefore = true) => ({
  call: "c1",
  task,
  startedAt: NOW,
  modelLoadedBefore,
});

describe("summarizeRuntime", () => {
  it("a running server with nothing loaded is 'asleep': information, not a warning", () => {
    const s = summarizeRuntime(status(), NOW);
    assert.equal(s.state, "asleep");
    assert.equal(s.model, "gemma4:12b");
    assert.match(s.message, /asleep to save memory/);
    assert.match(s.message, /first message takes 1-2 minutes longer/);
    assert.doesNotMatch(s.message, /cold|not loaded yet/i);
    assert.equal(s.unloadsAt, null);
  });

  it("idle in memory is 'ready' with the deadline to unload", () => {
    const s = summarizeRuntime(status(loaded), NOW);
    assert.deepEqual(
      [s.state, s.message, s.unloadsAt],
      ["ready", null, "2026-10-24T10:02:00.000Z"],
    );
  });

  it("a call on a loaded model is 'working' on that task", () => {
    const s = summarizeRuntime(status({ ...loaded, activeCalls: [call("chaser")] }), NOW);
    assert.deepEqual([s.state, s.task, s.message], ["working", "chaser", null]);
  });

  it("a call that has to load the model is 'loading', and says the first message is slower", () => {
    const s = summarizeRuntime(status({ activeCalls: [call("structure", false)] }), NOW);
    assert.equal(s.state, "loading");
    assert.match(s.message, /waking up/);
    assert.ok(s.message.includes(WAKE_NOTE));
    // Load now counts too, even with the weights already listed.
    assert.equal(
      summarizeRuntime(status({ ...loaded, loadInFlight: true }), NOW).state,
      "loading",
    );
  });

  it("down and missing keep their existing wording", () => {
    assert.deepEqual(
      summarizeRuntime(status({ running: false }), NOW).message,
      "Local model not running.",
    );
    assert.equal(
      summarizeRuntime(status({ modelInstalled: false }), NOW).message,
      "Model missing: run ollama pull gemma4:12b",
    );
  });

  it("an 'infinite' keep-alive has no countdown", () => {
    const forever = status({
      ...loaded,
      loaded: [{ ...loaded.loaded[0], expiresAt: "2318-01-01T00:00:00Z" }],
    });
    assert.equal(summarizeRuntime(forever, NOW).unloadsAt, null);
  });
});
