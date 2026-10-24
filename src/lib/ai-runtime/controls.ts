// What the runtime DOES besides generating: look at which models are in memory
// (and log the changes), report status, "Load now", "Unload now", and decide
// whether to pre-load at start. Everything takes its dependencies as arguments
// so `pnpm test` can drive it against a fake fetch; index.ts wires the real ones.
//
// The one rule that matters here: nothing that merely LOOKS may load the model.
// observeModels() and status() only issue GET /api/version, /api/tags and
// /api/ps. Loading happens through client.warm() or a real call, and only when
// loadNow() / a call site asks for it.
import {
  isLocalBaseUrl,
  normalizeModelName,
  type AiRuntimeConfig,
  type FifoQueue,
  type LoadedModel,
  type OllamaClient,
} from "./core.ts";
import type { AiLogState } from "./modelWatch.ts";
import type { AiRuntimeStatus } from "./types.ts";

/** How often to re-read /api/ps while a model is loaded (never while asleep). */
export const WATCH_INTERVAL_MS = 15_000;

export type LoadResult =
  | { ok: true; state: "started" | "already-loaded" | "already-loading" }
  | { ok: false; reason: string };

export type UnloadResult =
  { ok: true; state: "unloaded" | "already-asleep" } | { ok: false; reason: string };

export interface ControlsDeps {
  config: AiRuntimeConfig;
  client: OllamaClient;
  queue: FifoQueue;
  state: AiLogState;
  /** Is the server one AI OS started? (lifecycle.getProcessState) */
  processState: () => { owned: boolean; adopted: boolean };
  /** The keep_alive being sent right now. */
  keepAlive: () => string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** setTimeout stand-in for tests; the real one is unref'd. */
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
}

const sameModel = (a: string, b: string) =>
  normalizeModelName(a) === normalizeModelName(b);

export function createRuntimeControls(deps: ControlsDeps) {
  const { config, client, queue, state } = deps;
  const { ring, tracker } = state;
  const now = deps.now ?? Date.now;
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const setTimer =
    deps.setTimer ??
    ((fn: () => void, ms: number) => {
      const timer = setTimeout(fn, ms);
      timer.unref?.();
      return timer;
    });

  /**
   * Read /api/ps (never loads anything), log what changed since last time, and
   * keep the watch timer armed exactly while something is loaded. Returns null
   * when Ollama can't be asked.
   */
  async function observeModels(): Promise<LoadedModel[] | null> {
    let models: LoadedModel[];
    try {
      models = await client.listLoadedDetailed(2_000);
    } catch {
      return null;
    }
    tracker.observe(models, { now: now(), defaultModel: config.defaultModel });
    scheduleWatch();
    return models;
  }

  /** A timer that exists only while a model is loaded: it is how "the model
   *  went to sleep" gets noticed with no UI open. Asleep = no timer at all. */
  function scheduleWatch(): void {
    if (state.watchTimer || !tracker.anyLoaded()) return;
    state.watchTimer = setTimer(() => {
      state.watchTimer = undefined;
      void observeModels();
    }, WATCH_INTERVAL_MS);
  }

  const isOurModelIn = (models: LoadedModel[]) =>
    models.some((m) => sameModel(m.name, config.defaultModel));

  /** Read-only snapshot. GETs only. */
  async function status(): Promise<AiRuntimeStatus> {
    const proc = deps.processState();
    const base = {
      ownedByUs: proc.owned,
      adopted: proc.adopted,
      baseUrl: config.baseUrl,
      defaultModel: config.defaultModel,
      queue: { waiting: queue.waiting, active: queue.active },
      activeCalls: ring.activeCalls(),
      loadInFlight: state.loadInFlight,
      canAutoStart: config.autoStart && isLocalBaseUrl(config.baseUrl),
      keepAlive: deps.keepAlive(),
      prewarm: config.prewarm,
    };

    const probe = await client.probe();
    if (!probe.running) {
      // Went away since we last saw it up: say so once, and forget what was
      // loaded (it is not any more).
      if (ring.serverState === "up") {
        ring.emitServer({
          kind: "server-down",
          message: `Ollama is not answering at ${config.baseUrl}.`,
          willRetry: base.canAutoStart,
        });
        tracker.reset();
      }
      return {
        ...base,
        running: false,
        modelInstalled: null,
        modelLoaded: false,
        loadedModels: [],
        loaded: [],
      };
    }
    if (ring.serverState === "down") {
      ring.emitServer({
        kind: "server-up",
        how: proc.owned ? (proc.adopted ? "adopted" : "started") : "reused",
        owned: proc.owned,
        baseUrl: config.baseUrl,
        version: probe.version,
      });
    }

    const wanted = normalizeModelName(config.defaultModel);
    const [installed, loaded] = await Promise.all([
      client.listInstalled().then(
        (names) => names.map(normalizeModelName),
        () => null,
      ),
      observeModels(),
    ]);
    return {
      ...base,
      running: true,
      version: probe.version,
      modelInstalled: installed === null ? null : installed.includes(wanted),
      modelLoaded: loaded !== null && isOurModelIn(loaded),
      loadedModels: (loaded ?? []).map((m) => m.name),
      loaded: loaded ?? [],
    };
  }

  /**
   * "Load now": the same tiny real chat the old pre-warm used, through the
   * queue, in the background (loading takes 20 s to minutes, so the route
   * answers at once and the log shows the progress).
   */
  async function loadNow(): Promise<LoadResult> {
    if (state.loadInFlight) return { ok: true, state: "already-loading" };
    if (ring.activeCalls().some((c) => c.modelLoadedBefore === false)) {
      // A real call is already waking it.
      return { ok: true, state: "already-loading" };
    }
    const models = await observeModels();
    if (models === null) {
      if (!(config.autoStart && isLocalBaseUrl(config.baseUrl))) {
        return {
          ok: false,
          reason: "Ollama is not running, and AI OS is not set up to start it.",
        };
      }
    } else if (isOurModelIn(models)) {
      return { ok: true, state: "already-loaded" };
    }
    runWarm({ task: "load", label: "Load now" });
    return { ok: true, state: "started" };
  }

  function runWarm(log: { task: string; label: string }): void {
    state.loadInFlight = true;
    client
      .warm(config.defaultModel, log)
      // The failure is already in the log (call-end with its error code).
      .catch(() => undefined)
      .finally(() => {
        state.loadInFlight = false;
      });
  }

  /**
   * "Unload now": keep_alive 0 for the AI OS default model only, never another
   * model in a shared Ollama, and never while a call is running (it would cut
   * the answer short). Goes through the queue so no call can start mid-unload.
   */
  async function unloadNow(): Promise<UnloadResult> {
    if (
      queue.active ||
      queue.waiting > 0 ||
      state.loadInFlight ||
      ring.activeCalls().length > 0
    ) {
      return {
        ok: false,
        reason: "The model is busy right now. Try again when it has finished.",
      };
    }
    const before = await observeModels();
    if (before === null) return { ok: false, reason: "Ollama is not running." };
    if (!isOurModelIn(before)) return { ok: true, state: "already-asleep" };

    const model = config.defaultModel;
    ring.emit({ kind: "unload-request", model, by: "user", keepAlive: 0 });
    tracker.expectUnload(model, "manual");
    try {
      await queue.enqueue(() => client.unload(model, 10_000));
    } catch (error) {
      tracker.clearExpected(model);
      return {
        ok: false,
        reason: `Ollama did not unload the model: ${error instanceof Error ? error.message : "unknown error"}`,
      };
    }
    // /api/ps can still list it for a moment.
    for (let i = 0; i < 6; i++) {
      const after = await observeModels();
      if (after === null || !isOurModelIn(after)) break;
      await sleep(400);
    }
    return { ok: true, state: "unloaded" };
  }

  /**
   * Once the server is up: load the model right away ONLY if AI_OS_AI_PREWARM
   * is on. Off (the default), say so once in the log and do nothing; the model
   * loads when the first call needs it.
   */
  function prewarmOnStart(
    options: { override?: boolean; fresh?: boolean } = {},
  ): "started" | "skipped" | "already" {
    // A server we just (re)started has nothing loaded: decide again.
    if (options.fresh) state.prewarmDecided = false;
    const want = options.override ?? config.prewarm;
    if (!want) {
      if (!state.prewarmDecided) {
        state.prewarmDecided = true;
        ring.emit({ kind: "prewarm-skipped", reason: "disabled" });
      }
      return "skipped";
    }
    if (state.prewarmDecided) return "already";
    state.prewarmDecided = true;
    runWarm({ task: "prewarm", label: "Pre-load at start" });
    return "started";
  }

  return { observeModels, scheduleWatch, status, loadNow, unloadNow, prewarmOnStart };
}

export type RuntimeControls = ReturnType<typeof createRuntimeControls>;
