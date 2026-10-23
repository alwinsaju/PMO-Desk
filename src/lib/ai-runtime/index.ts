// Public entry point of the local AI runtime (server-side only: import from
// route handlers / server code, never from a client component). See
// ARCHITECTURE.md, "Local AI runtime".
//
//   import { generateJson } from "@/lib/ai-runtime";
//   const todo = await generateJson({ system, prompt: message, schema: todoSchema });
//
// Call sites never name a model or a URL; both come from config (env).
import {
  AiRuntimeError,
  FifoQueue,
  createOllamaClient,
  isLocalBaseUrl,
  loadAiRuntimeConfig,
  normalizeModelName,
  type AiRuntimeConfig,
  type GenerateJsonOptions,
  type GenerateTextOptions,
  type OllamaClient,
} from "./core";
import {
  ensureOllamaServer,
  getProcessState,
  stopOwnedOllama,
  type EnsureServerResult,
} from "./lifecycle";
import type { z } from "zod";

export { AiRuntimeError, isAiRuntimeError } from "./core";
export type {
  AiRuntimeConfig,
  AiRuntimeErrorCode,
  GenerateJsonOptions,
  GenerateTextOptions,
} from "./core";
export type { EnsureServerResult } from "./lifecycle";

export interface AiRuntimeStatus {
  /** Does something answer on the Ollama base URL right now? */
  running: boolean;
  /** AI OS started this server (or adopted one a crashed run left behind)
   *  and will stop it on quit. false = someone else's, never killed. */
  ownedByUs: boolean;
  /** ownedByUs, but inherited from a previous crashed AI OS run. */
  adopted: boolean;
  version?: string;
  baseUrl: string;
  defaultModel: string;
  /** null when the server can't be asked. */
  modelInstalled: boolean | null;
  /** Is the default model resident in memory right now? */
  modelLoaded: boolean;
  loadedModels: string[];
  queue: { waiting: number; active: boolean };
  /** May AI OS start Ollama on its own if it is down? */
  canAutoStart: boolean;
}

/** What every module instance must share (see `shared()`): plain state only,
 *  nothing that carries a class the caller might `instanceof`-check. */
interface SharedRuntimeState {
  queue: FifoQueue;
  prewarmStarted: boolean;
}

declare global {
  var aiOsAiRuntime: SharedRuntimeState | undefined;
}

// Next compiles instrumentation and every route into separate module graphs,
// so this file can be instantiated several times in one process. They must
// share ONE queue (the concurrency-1 guarantee) and one view of the server
// process (lifecycle.ts keeps that on globalThis too). The client, config and
// error classes stay per instance, so the AiRuntimeError a caller gets is
// the one from the module it imported.
function shared(): SharedRuntimeState {
  globalThis.aiOsAiRuntime ??= { queue: new FifoQueue(), prewarmStarted: false };
  return globalThis.aiOsAiRuntime;
}

interface AiRuntime {
  config: AiRuntimeConfig;
  client: OllamaClient;
}

let instance: AiRuntime | undefined;

function runtime(): AiRuntime {
  if (!instance) {
    const config = loadAiRuntimeConfig();
    const client: OllamaClient = createOllamaClient({
      config,
      fetch: (input, init) => fetch(input, init),
      queue: shared().queue,
      // Before every job: if the server went away (or was never started,
      // e.g. plain `next start`), bring it back or fail as runtime-down.
      ensure: async () => {
        const result = await ensureOllamaServer(config, client);
        if (!result.running) throw new AiRuntimeError("runtime-down", result.reason);
      },
      keepAlive: () =>
        getProcessState().owned ? config.keepAlive : config.externalKeepAlive,
    });
    instance = { config, client };
  }
  return instance;
}

export function getAiRuntimeConfig(): AiRuntimeConfig {
  return runtime().config;
}

/**
 * Raw message -> validated object. Ollama's structured outputs (`format` =
 * JSON schema derived from `schema`), temperature 0, validated against the
 * zod schema, one repair retry. Calls are serialized FIFO, one at a time, so
 * this can take minutes under load on CPU: run it from background work, not
 * a blocking UI path. Rejects with AiRuntimeError (code: "runtime-down" |
 * "model-missing" | "timeout" | "invalid-output").
 */
export function generateJson<S extends z.ZodType>(
  options: GenerateJsonOptions<S>,
): Promise<z.output<S>> {
  return runtime().client.generateJson(options);
}

/** Plain text completion through the same queue. Rejects with AiRuntimeError. */
export function generateText(options: GenerateTextOptions): Promise<string> {
  return runtime().client.generateText(options);
}

/**
 * Make sure the server is up (starting it if allowed and nothing answers) and,
 * once per process, begin loading the default model in the background.
 * Never throws; inspect the result. Safe to call repeatedly.
 */
export async function ensureRuntime(
  options: { prewarm?: boolean } = {},
): Promise<EnsureServerResult> {
  const rt = runtime();
  const result = await ensureOllamaServer(rt.config, rt.client);
  if (!result.running) return result;

  const state = shared();
  const wantPrewarm = options.prewarm ?? rt.config.prewarm;
  if (result.started) state.prewarmStarted = false; // fresh server: nothing loaded
  if (wantPrewarm && !state.prewarmStarted) {
    state.prewarmStarted = true;
    void prewarm(rt);
  }
  return result;
}

async function prewarm(rt: AiRuntime): Promise<void> {
  const { client, config } = rt;
  try {
    const wanted = normalizeModelName(config.defaultModel);
    const loaded = (await client.listLoaded()).map(normalizeModelName);
    if (loaded.includes(wanted)) return;
    await client.warm(config.defaultModel);
    console.log(`[ai-runtime] model ${config.defaultModel} loaded`);
  } catch (error) {
    // Pre-warming is an optimization; a missing model etc. surfaces on the
    // first real call with its proper typed error.
    console.warn(
      `[ai-runtime] prewarm skipped: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Shutdown: drop queued jobs, and if AI OS owns the server, unload the model
 * and kill its process tree. A reused external server is left running.
 */
export async function stopRuntime(): Promise<{ stopped: boolean }> {
  const rt = runtime();
  shared().queue.rejectWaiting(
    new AiRuntimeError("runtime-down", "The local AI runtime is shutting down."),
  );
  return stopOwnedOllama(rt.client);
}

/** Read-only snapshot for /api/ai/runtime. Never starts or stops anything. */
export async function getRuntimeStatus(): Promise<AiRuntimeStatus> {
  const { config, client } = runtime();
  const { queue } = shared();
  const state = getProcessState();
  const base = {
    ownedByUs: state.owned,
    adopted: state.adopted,
    baseUrl: config.baseUrl,
    defaultModel: config.defaultModel,
    queue: { waiting: queue.waiting, active: queue.active },
    canAutoStart: config.autoStart && isLocalBaseUrl(config.baseUrl),
  };

  const probe = await client.probe();
  if (!probe.running) {
    return {
      ...base,
      running: false,
      modelInstalled: null,
      modelLoaded: false,
      loadedModels: [],
    };
  }

  const wanted = normalizeModelName(config.defaultModel);
  const [installed, loaded] = await Promise.all([
    client.listInstalled().then(
      (names) => names.map(normalizeModelName),
      () => null,
    ),
    client.listLoaded().then(
      (names) => names,
      () => [] as string[],
    ),
  ]);
  return {
    ...base,
    running: true,
    version: probe.version,
    modelInstalled: installed === null ? null : installed.includes(wanted),
    modelLoaded: loaded.map(normalizeModelName).includes(wanted),
    loadedModels: loaded,
  };
}
