// Public entry point of the local AI runtime (server-side only: import from
// route handlers / server code, never from a client component). See
// ARCHITECTURE.md, "Local AI runtime".
//
//   import { generateJson } from "@/lib/ai-runtime";
//   const todo = await generateJson({ system, prompt: message, schema: todoSchema,
//     log: { task: "structure", label: subject } });
//
// Call sites never name a model or a URL; both come from config (env).
import { closeSync, fstatSync, openSync, readSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import {
  AiRuntimeError,
  FifoQueue,
  chatStats,
  createOllamaClient,
  loadAiRuntimeConfig,
  logMessage,
  normalizeModelName,
  pickKeepAlive,
  type AiRuntimeConfig,
  type GenerateJsonOptions,
  type GenerateTextOptions,
  type OllamaClient,
} from "./core";
import { markAiUsed } from "./aiUsed";
import { createRuntimeControls, type RuntimeControls } from "./controls";
import {
  ensureOllamaServer,
  getProcessState,
  stopOwnedOllama,
  type EnsureServerResult,
} from "./lifecycle";
import { cleanText, type AiLogEvent } from "./log";
import {
  createModelResolver,
  saveModelChoice,
  type ModelResolver,
  type SaveResult,
} from "./modelChoice";
import { LIGHT_MODEL, sameModel } from "../setup/models";
import { getAiLogState } from "./modelWatch";
import { readServerLogTail, resolveServerLog, type ServerLogTail } from "./serverLog";
import type { AiRuntimeLogResponse, AiRuntimeStatus } from "./types";
import type { z } from "zod";

export {
  AiRuntimeError,
  MAX_REQUEST_TIMEOUT_MS,
  clampTimeoutMs,
  isAiRuntimeError,
} from "./core";
export type {
  AiRuntimeConfig,
  AiRuntimeErrorCode,
  CallPriority,
  GenerateJsonOptions,
  GenerateTextOptions,
} from "./core";
export type { AiCallLogOptions } from "./log";
export type { EnsureServerResult } from "./lifecycle";
export type { AiRuntimeLogResponse, AiRuntimeStatus } from "./types";
export type { LoadResult, UnloadResult } from "./controls";

/** What every module instance must share (see `shared()`): plain state only,
 *  nothing that carries a class the caller might `instanceof`-check. The session
 *  log and the load/unload flags live in modelWatch.ts's `getAiLogState()`. */
interface SharedRuntimeState {
  queue: FifoQueue;
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
  globalThis.aiOsAiRuntime ??= { queue: new FifoQueue() };
  return globalThis.aiOsAiRuntime;
}

interface AiRuntime {
  config: AiRuntimeConfig;
  client: OllamaClient;
  controls: RuntimeControls;
  models: ModelResolver;
}

let instance: AiRuntime | undefined;

function runtime(): AiRuntime {
  if (!instance) {
    const config = loadAiRuntimeConfig();
    const queue = shared().queue;
    const state = getAiLogState();
    const keepAlive = () => pickKeepAlive(config, getProcessState().owned);
    const models = createModelResolver();
    // eslint-disable-next-line prefer-const -- referenced lazily by the client's hooks
    let controls: RuntimeControls;
    const client: OllamaClient = createOllamaClient({
      config,
      fetch: (input, init) => fetch(input, init),
      queue,
      // Before every job: if the server went away (or was never started,
      // e.g. plain `next start`), bring it back or fail as runtime-down.
      ensure: async () => {
        markAiUsed();
        const result = await ensureOllamaServer(config, client);
        if (!result.running) throw new AiRuntimeError("runtime-down", result.reason);
      },
      keepAlive,
      log: state.ring,
      models,
      // A plain GET of /api/ps: tells the log whether this call has to wake the
      // model, and notices a sleep that happened since the last look.
      observe: async (model) => {
        const loaded = await controls.observeModels();
        return loaded === null
          ? null
          : loaded.some((m) => normalizeModelName(m.name) === normalizeModelName(model));
      },
      afterCall: () => void controls.observeModels(),
    });
    controls = createRuntimeControls({
      config,
      client,
      queue,
      state,
      processState: getProcessState,
      keepAlive,
      models,
    });
    instance = { config, client, controls, models };
  }
  return instance;
}

export function getAiRuntimeConfig(): AiRuntimeConfig {
  return runtime().config;
}

/** The model calls use right now: OLLAMA_MODEL, else Setup's saved choice,
 *  else the default, or the one allowed model that is installed. */
export function getActiveModel(): string {
  return runtime().models.current().model;
}

export interface ModelOption {
  id: string;
  kind: "accurate" | "fast";
  /** null when Ollama could not be asked. */
  installed: boolean | null;
}

export interface ModelOptions {
  /** The model calls use right now. */
  active: string;
  /** The model that was asked for (differs from `active` while it is still downloading). */
  preferred: string;
  options: ModelOption[];
}

/** The switchable models and whether each is installed (GET /api/tags only). */
export async function getModelOptions(): Promise<ModelOptions> {
  const { models, client, config } = runtime();
  let installed: string[] | null;
  try {
    installed = await client.listInstalled(2_000);
  } catch {
    installed = null;
  }
  models.observeInstalled(installed);
  const choice = models.current();
  const has = (id: string) =>
    installed === null ? null : installed.some((n) => sameModel(n, id));
  return {
    active: choice.model,
    preferred: choice.preferred,
    options: [
      { id: config.defaultModel, kind: "accurate", installed: has(config.defaultModel) },
      { id: LIGHT_MODEL, kind: "fast", installed: has(LIGHT_MODEL) },
    ],
  };
}

/** Saves which model calls use from now on (one of the allowed models). The next call picks it up. */
export function chooseActiveModel(model: string): SaveResult {
  return saveModelChoice(model);
}

/** The light model's exact installed name, or undefined when it is not installed or Ollama
 *  cannot be asked: PTO emails are read with it, and without it fall back to the chosen model. */
export async function getLightModelIfInstalled(): Promise<string | undefined> {
  try {
    const installed = await runtime().client.listInstalled(2_000);
    return installed.find((name) => sameModel(name, LIGHT_MODEL));
  } catch {
    return undefined;
  }
}

/** The keep_alive every request to Ollama should carry right now (2 minutes by
 *  default; owned vs reused already applied). The command route sends it too. */
export function getKeepAlive(): string {
  const { config } = runtime();
  return pickKeepAlive(config, getProcessState().owned);
}

/**
 * Raw message -> validated object. Ollama's structured outputs (`format` =
 * JSON schema derived from `schema`), temperature 0, validated against the
 * zod schema, one repair retry. Calls are serialized FIFO, one at a time, so
 * this can take minutes under load on CPU: run it from background work, not
 * a blocking UI path. Rejects with AiRuntimeError (code: "runtime-down" |
 * "model-missing" | "timeout" | "invalid-output"). This is what loads the
 * model when it is asleep: the first call after a sleep takes 1-2 minutes more.
 *
 * Pass `log: { task, label }` so the model log can say what the call was for
 * (the label is a short human string such as a message subject; it stays in
 * memory, is cut to 60 characters, and never includes the prompt).
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
 * Make sure the server is up (starting it if allowed and nothing answers).
 * The MODEL is not loaded here unless AI_OS_AI_PREWARM is on (it is off by
 * default): it loads when the first call needs it. Never throws; inspect the
 * result. Safe to call repeatedly.
 */
export async function ensureRuntime(
  options: { prewarm?: boolean } = {},
): Promise<EnsureServerResult> {
  const rt = runtime();
  const result = await ensureOllamaServer(rt.config, rt.client);
  if (!result.running) return result;
  rt.controls.prewarmOnStart({ override: options.prewarm, fresh: result.started });
  return result;
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

/** Read-only snapshot for /api/ai/runtime. Never starts, stops or loads
 *  anything: only GET /api/version, /api/tags and /api/ps. */
export function getRuntimeStatus(): Promise<AiRuntimeStatus> {
  return runtime().controls.status();
}

/** What the runtime is doing right now, from memory only (no request to Ollama):
 *  lets a cached status snapshot show a call that started after it was taken. */
export function getLiveActivity(): Pick<
  AiRuntimeStatus,
  "activeCalls" | "loadInFlight" | "queue"
> {
  const { ring } = getAiLogState();
  const { queue } = shared();
  return {
    activeCalls: ring.activeCalls(),
    loadInFlight: getAiLogState().loadInFlight,
    queue: { waiting: queue.waiting, active: queue.active },
  };
}

/** How many calls (the running one included) are ahead of the next waiting call
 *  whose task kind is in `tasks`; null if none of them is waiting. In memory only. */
export function getQueueAhead(tasks: readonly string[]): number | null {
  return shared().queue.aheadOf(tasks);
}

/** POST /api/ai/runtime/load: wake the model in the background. */
export function loadModelNow() {
  return runtime().controls.loadNow();
}

/** POST /api/ai/runtime/unload: free the model's memory now (default model only). */
export function unloadModelNow() {
  return runtime().controls.unloadNow();
}

// ---------------------------------------------------------------------------
// The session log
// ---------------------------------------------------------------------------

/** Read-only file access for the server-log tail: open "r", read, close. */
const serverLogFs = {
  size(file: string): number | null {
    try {
      return statSync(file).size;
    } catch {
      return null;
    }
  },
  read(file: string, start: number, length: number): string {
    const fd = openSync(file, "r");
    try {
      const size = fstatSync(fd).size;
      const len = Math.max(0, Math.min(length, size - start));
      const buffer = Buffer.alloc(len);
      readSync(fd, buffer, 0, len, start);
      return buffer.toString("utf8");
    } finally {
      closeSync(fd);
    }
  },
};

export function readOllamaServerLog(ownedByUs: boolean): ServerLogTail {
  return readServerLogTail(
    resolveServerLog({
      owned: ownedByUs,
      platform: process.platform,
      env: process.env,
      tmpDir: tmpdir(),
      home: homedir(),
    }),
    serverLogFs,
  );
}

/**
 * GET /api/ai/runtime/log: the session's events after `since` plus a fresh
 * status snapshot (which also re-reads /api/ps, so a sleep is noticed while the
 * dialog is open). `serverLog` adds the tail of Ollama's own log. Never loads
 * the model.
 */
export async function getRuntimeLog(query: {
  since?: number;
  session?: string;
  serverLog?: boolean;
}): Promise<AiRuntimeLogResponse> {
  const status = await getRuntimeStatus();
  const { ring } = getAiLogState();
  const sameSession = query.session === undefined || query.session === ring.session;
  const events: AiLogEvent[] = ring.since(sameSession ? (query.since ?? 0) : 0);
  return {
    session: ring.session,
    sessionStartedAt: ring.startedAt,
    now: Date.now(),
    reset: !sameSession,
    latestSeq: ring.latestSeq,
    events,
    status,
    ...(query.serverLog ? { serverLog: readOllamaServerLog(status.ownedByUs) } : {}),
  };
}

/**
 * For code that talks to Ollama itself instead of going through generateJson
 * (the command route: it needs /api/chat tool calling and must not queue behind
 * background work). Logs the call like the others and gives back the keep_alive
 * to send. Call `done(payload)` with Ollama's reply or `fail(error)`.
 */
export async function startExternalCall(meta: {
  task: string;
  label?: string;
  think?: boolean;
}) {
  const { client, controls, models: resolver, config } = runtime();
  // Ollama is no longer started at launch for someone who has not used AI yet.
  markAiUsed();
  await ensureOllamaServer(config, client);
  try {
    resolver.observeInstalled(await client.listInstalled(2_000));
  } catch {
    resolver.observeInstalled(null);
  }
  const model = resolver.current().model;
  const { ring } = getAiLogState();
  const call = ring.nextCallId();
  const keepAlive = getKeepAlive();
  const label = cleanText(meta.label, 60);
  let loaded: boolean | null = null;
  try {
    const models = await controls.observeModels();
    loaded =
      models === null
        ? null
        : models.some((m) => normalizeModelName(m.name) === normalizeModelName(model));
  } catch {
    // A log detail only.
  }
  const startedAt = Date.now();
  ring.emit({
    kind: "call-start",
    call,
    task: meta.task,
    label,
    model,
    keepAlive,
    ...(meta.think === undefined ? {} : { think: meta.think }),
    modelLoaded: loaded,
    queueWaiting: 0,
  });
  const finish = (rest: Record<string, unknown>) => {
    ring.emit({
      kind: "call-end",
      call,
      task: meta.task,
      label,
      model,
      durationMs: Date.now() - startedAt,
      attempts: 1,
      ...rest,
    } as Extract<AiLogEvent, { kind: "call-end" }>);
    void controls.observeModels();
  };
  return {
    keepAlive,
    /** The model this call must ask Ollama for. */
    model,
    /** Was the model in memory when the call started? null = could not tell. */
    modelLoaded: loaded,
    /** The call succeeded: `payload` is Ollama's parsed reply (only its
     *  counters are read). */
    done: (payload: unknown) => finish({ ok: true, ...chatStats(payload) }),
    /** The call failed: `code` is an AiRuntimeErrorCode-style word. */
    fail: (code: string, message: string) =>
      finish({ ok: false, errorCode: code, message }),
    /** Convenience for a caught error. */
    failWith: (error: unknown) => {
      const { code, message } = logMessage(error);
      finish({ ok: false, errorCode: code, message });
    },
  };
}
