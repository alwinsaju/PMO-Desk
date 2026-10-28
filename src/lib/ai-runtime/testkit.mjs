// Shared fakes for the ai-runtime tests (not a test file itself): a fake Ollama
// behind a `fetch`, and a log state that is NOT the process-wide one. Nothing
// here ever touches a real Ollama or the network.
import {
  DEFAULT_AI_RUNTIME_CONFIG,
  FifoQueue,
  createOllamaClient,
  pickKeepAlive,
} from "./core.ts";
import { createRuntimeControls } from "./controls.ts";
import { RingLog } from "./log.ts";
import { ModelTracker } from "./modelWatch.ts";

export const GB = 1024 ** 3;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function keepAliveMs(value) {
  if (value === 0 || value === "0") return 0;
  const m = /^(\d+)(s|m|h)$/.exec(String(value));
  if (!m) return 5 * 60_000;
  return Number(m[1]) * { s: 1000, m: 60_000, h: 3_600_000 }[m[2]];
}

/**
 * A fake Ollama. `st.loaded` is what /api/ps lists; a chat loads the model (and
 * records the keep_alive that was sent), /api/generate with keep_alive 0 unloads
 * it, and `expire()` plays "keep_alive ran out". `st.calls` records everything
 * so tests can assert what was (not) asked.
 */
export function fakeOllama(options = {}) {
  const clock = options.clock ?? { now: Date.now() };
  const st = {
    up: true,
    version: "0.99.0",
    installed: options.installed ?? ["gemma4:12b"],
    loaded: new Map(),
    calls: [],
    reply: '{"ok":true}',
    chatDelay: null,
    clock,
  };

  const load = (name, keepAlive) => {
    st.loaded.set(name, {
      name,
      size: 8 * GB,
      expiresAt: new Date(clock.now + keepAliveMs(keepAlive)).toISOString(),
    });
  };

  async function fetch(url, init) {
    const route = new URL(url).pathname;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body) : undefined;
    st.calls.push({ route, method, body });
    if (!st.up) throw new TypeError("fetch failed");
    switch (route) {
      case "/api/version":
        return json({ version: st.version });
      case "/api/tags":
        return json({ models: st.installed.map((name) => ({ name })) });
      case "/api/ps":
        return json({
          models: [...st.loaded.values()].map((m) => ({
            name: m.name,
            model: m.name,
            size: m.size,
            size_vram: 0,
            expires_at: m.expiresAt,
          })),
        });
      case "/api/chat": {
        if (!st.installed.includes(body.model)) {
          return json({ error: `model '${body.model}' not found` }, 404);
        }
        if (st.chatDelay) await st.chatDelay;
        const wasLoaded = st.loaded.has(body.model);
        load(body.model, body.keep_alive);
        return json({
          message: { role: "assistant", content: st.reply },
          done_reason: "stop",
          prompt_eval_count: 100,
          eval_count: 40,
          eval_duration: 4e9,
          load_duration: wasLoaded ? 5e6 : 19e9,
        });
      }
      case "/api/generate":
        if (body.keep_alive === 0) st.loaded.delete(body.model);
        return json({ done: true });
      default:
        return json({ error: "not found" }, 404);
    }
  }

  return {
    st,
    fetch,
    /** keep_alive ran out. */
    expire: (name = "gemma4:12b") => st.loaded.delete(name),
    /** Requests that are not plain reads. */
    mutating: () => st.calls.filter((c) => c.method !== "GET"),
  };
}

/** A log state like the global one, but private to the test. */
export function makeLogState(now = Date.now) {
  const ring = new RingLog(1000, now);
  return {
    ring,
    tracker: new ModelTracker(ring),
    loadInFlight: false,
    prewarmDecided: false,
  };
}

/**
 * A client + controls wired to a fake Ollama and a private log. `timers` holds
 * the watch timers the controls armed (fire one with `timers.shift()()`).
 * `owned` picks which keep_alive is sent, like index.ts does.
 */
export function makeRuntime(overrides = {}, ollamaOptions = {}, owned = false, models) {
  const ollama = fakeOllama(ollamaOptions);
  const clock = ollama.st.clock;
  const now = () => clock.now;
  const state = makeLogState(now);
  const config = { ...DEFAULT_AI_RUNTIME_CONFIG, ...overrides };
  const queue = new FifoQueue();
  const timers = [];
  const keepAlive = () => pickKeepAlive(config, owned);
  let controls;
  const client = createOllamaClient({
    config,
    queue,
    fetch: ollama.fetch,
    keepAlive,
    log: state.ring,
    now,
    models,
    observe: async (model) => {
      const loaded = await controls.observeModels();
      return loaded === null ? null : loaded.some((m) => m.name === model);
    },
    afterCall: () => void controls.observeModels(),
  });
  controls = createRuntimeControls({
    config,
    client,
    queue,
    state,
    processState: () => ({ owned, adopted: false }),
    keepAlive,
    models,
    now,
    sleep: async () => {},
    setTimer: (fn) => {
      timers.push(fn);
      return timers.length;
    },
  });
  return { ollama, state, config, queue, client, controls, clock, timers };
}
