// Pure / injectable half of the local AI runtime (see ARCHITECTURE.md, "Local
// AI runtime"). Everything here is testable under plain Node (`pnpm test`
// imports this .ts file directly), so it takes `fetch`, `exists`, `env`
// etc. as arguments instead of reaching for globals, and imports nothing
// extensionless from siblings (plain Node can't resolve those — the same
// constraint tasks-app/diffView.ts documents). Process management lives in
// lifecycle.ts; the wired-up singleton lives in index.ts.
import path from "node:path";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface AiRuntimeConfig {
  /** Ollama's HTTP root. Only a loopback URL is ever auto-started. */
  baseUrl: string;
  /** Model used when a call site doesn't name one. Call sites should not. */
  defaultModel: string;
  /** Explicit path to ollama.exe; wins over PATH and the default install. */
  ollamaExe?: string;
  /** How long the model stays loaded after a call when AI OS owns the server. */
  keepAlive: string;
  /** Same, when attached to someone else's Ollama (so we don't hog its RAM). */
  externalKeepAlive: string;
  /** Per-attempt cap for one generate call (excludes time waiting in queue). */
  requestTimeoutMs: number;
  /** Context window requested on EVERY call — keep it constant, a different
   *  num_ctx makes Ollama reload the model. */
  numCtx: number;
  /** Hard cap on generated tokens, so a degenerate output can't run forever. */
  maxOutputTokens: number;
  /** May AI OS spawn `ollama serve` when nothing answers? */
  autoStart: boolean;
  /** Load the default model right after the server is up. */
  prewarm: boolean;
  /** How long to wait for a freshly spawned server to answer. */
  startTimeoutMs: number;
}

/**
 * Node's fetch (undici) aborts a non-streaming request after 300 s without
 * response headers, and that failure looks like a dead server. Every call is
 * therefore capped just below it, so our own timeout always fires first and is
 * reported as "timeout" rather than "runtime-down".
 */
export const MAX_REQUEST_TIMEOUT_MS = 280_000;

export function clampTimeoutMs(timeoutMs: number): number {
  return Math.min(MAX_REQUEST_TIMEOUT_MS, Math.max(1, Math.floor(timeoutMs)));
}

export const DEFAULT_AI_RUNTIME_CONFIG: AiRuntimeConfig = {
  baseUrl: "http://127.0.0.1:11434",
  // Chosen by a local bake-off (PMO structuring): best date/owner accuracy and
  // prompt-injection resistance of the models that fit this CPU. Run it with
  // `think: false`; reasoning makes calls several times slower. Fallback:
  // qwen3.5:9b (also think off). Both support /api/chat tool calling.
  defaultModel: "gemma4:12b",
  keepAlive: "30m",
  externalKeepAlive: "5m",
  // CPU-only inference: a cold load is ~20s and a long extraction can take
  // minutes. Generous on purpose; callers are expected to run in background.
  // Per-call values are capped at MAX_REQUEST_TIMEOUT_MS.
  requestTimeoutMs: MAX_REQUEST_TIMEOUT_MS,
  numCtx: 8192,
  maxOutputTokens: 2048,
  autoStart: true,
  prewarm: true,
  startTimeoutMs: 30_000,
};

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function flag(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  return !["0", "false", "off", "no"].includes(raw.trim().toLowerCase());
}

/**
 * Env vars (all optional). OLLAMA_BASE_URL / OLLAMA_MODEL are the names
 * /api/ai/command already used, kept so existing setups keep working.
 *   OLLAMA_BASE_URL, OLLAMA_MODEL, AI_OS_OLLAMA_EXE, AI_OS_AI_AUTOSTART,
 *   AI_OS_AI_PREWARM, AI_OS_AI_KEEP_ALIVE, AI_OS_AI_TIMEOUT_MS,
 *   AI_OS_AI_NUM_CTX, AI_OS_AI_MAX_OUTPUT_TOKENS
 */
export function loadAiRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): AiRuntimeConfig {
  const d = DEFAULT_AI_RUNTIME_CONFIG;
  const baseUrl = (env.OLLAMA_BASE_URL?.trim() || d.baseUrl).replace(/\/+$/, "");
  return {
    baseUrl,
    defaultModel: env.OLLAMA_MODEL?.trim() || d.defaultModel,
    ollamaExe: env.AI_OS_OLLAMA_EXE?.trim() || undefined,
    keepAlive: env.AI_OS_AI_KEEP_ALIVE?.trim() || d.keepAlive,
    externalKeepAlive: d.externalKeepAlive,
    requestTimeoutMs: clampTimeoutMs(positiveInt(env.AI_OS_AI_TIMEOUT_MS, d.requestTimeoutMs)),
    numCtx: positiveInt(env.AI_OS_AI_NUM_CTX, d.numCtx),
    maxOutputTokens: positiveInt(env.AI_OS_AI_MAX_OUTPUT_TOKENS, d.maxOutputTokens),
    autoStart: flag(env.AI_OS_AI_AUTOSTART, d.autoStart),
    prewarm: flag(env.AI_OS_AI_PREWARM, d.prewarm),
    startTimeoutMs: d.startTimeoutMs,
  };
}

/** True for loopback hosts — the only ones AI OS will ever spawn a server for. */
export function isLocalBaseUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, "");
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

/** `host:port` for Ollama's OLLAMA_HOST env var, derived from the base URL so
 *  a spawned server binds exactly where we probe. */
export function ollamaHostFor(baseUrl: string): string {
  const url = new URL(baseUrl);
  const host = url.hostname === "localhost" ? "127.0.0.1" : url.hostname;
  return `${host}:${url.port || "11434"}`;
}

/** "llama3.2" and "llama3.2:latest" name the same installed model. */
export function normalizeModelName(name: string): string {
  const trimmed = name.trim();
  return trimmed.includes(":") ? trimmed : `${trimmed}:latest`;
}

// ---------------------------------------------------------------------------
// Resolving ollama.exe
// ---------------------------------------------------------------------------

export interface ExeResolveOptions {
  env: Record<string, string | undefined>;
  platform: string;
  exists: (candidate: string) => boolean;
  /** Explicit override (config.ollamaExe). */
  override?: string;
}

export interface ExeResolution {
  path?: string;
  source?: "override" | "path" | "default-install";
  /** Every candidate looked at, in order — surfaced in "not found" errors. */
  tried: string[];
}

function readEnv(env: ExeResolveOptions["env"], name: string, platform: string) {
  if (platform !== "win32") return env[name];
  const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : env[key];
}

/** Resolution order: explicit override, then PATH, then the default install
 *  location(s) for the platform. Never executes anything. */
export function resolveOllamaExe(options: ExeResolveOptions): ExeResolution {
  const { env, platform, exists, override } = options;
  const p = platform === "win32" ? path.win32 : path.posix;
  const exeName = platform === "win32" ? "ollama.exe" : "ollama";
  const tried: string[] = [];

  const check = (candidate: string, source: NonNullable<ExeResolution["source"]>) => {
    tried.push(candidate);
    return exists(candidate)
      ? ({ path: candidate, source, tried } as ExeResolution)
      : undefined;
  };

  if (override) {
    // An explicit override that doesn't exist is a misconfiguration, not a
    // reason to silently fall through to a different binary.
    return check(override, "override") ?? { tried };
  }

  const pathVar = readEnv(env, "PATH", platform) ?? "";
  for (const raw of pathVar.split(p.delimiter)) {
    const dir = raw.trim().replace(/^"|"$/g, "");
    if (!dir) continue;
    const hit = check(p.join(dir, exeName), "path");
    if (hit) return hit;
  }

  const defaults: string[] = [];
  if (platform === "win32") {
    const local = readEnv(env, "LOCALAPPDATA", platform);
    if (local) defaults.push(p.join(local, "Programs", "Ollama", exeName));
    const programFiles = readEnv(env, "ProgramFiles", platform);
    if (programFiles) defaults.push(p.join(programFiles, "Ollama", exeName));
  } else if (platform === "darwin") {
    defaults.push(
      "/usr/local/bin/ollama",
      "/opt/homebrew/bin/ollama",
      "/Applications/Ollama.app/Contents/Resources/ollama",
    );
  } else {
    defaults.push("/usr/local/bin/ollama", "/usr/bin/ollama");
  }
  for (const candidate of defaults) {
    const hit = check(candidate, "default-install");
    if (hit) return hit;
  }
  return { tried };
}

/** First CSV field of `tasklist /FO CSV /NH` output (the image name), or
 *  undefined when the PID isn't running ("INFO: No tasks ..."). */
export function parseTasklistImageName(csv: string): string | undefined {
  const match = /^"([^"]+)",/m.exec(csv);
  return match?.[1];
}

/** Is this process image an Ollama server binary? (Guards against PID reuse
 *  before we ever kill or adopt a recorded PID.) */
export function isOllamaImageName(image: string | undefined): boolean {
  return image !== undefined && /^ollama(\.exe)?$/i.test(image.trim());
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type AiRuntimeErrorCode =
  "runtime-down" | "model-missing" | "timeout" | "invalid-output";

export class AiRuntimeError extends Error {
  code: AiRuntimeErrorCode;
  /** The model's raw text, for invalid-output (truncated). */
  raw?: string;
  /** Validation problems, for invalid-output. */
  issues?: string[];

  constructor(
    code: AiRuntimeErrorCode,
    message: string,
    extra: { cause?: unknown; raw?: string; issues?: string[] } = {},
  ) {
    super(message, extra.cause === undefined ? undefined : { cause: extra.cause });
    this.name = "AiRuntimeError";
    this.code = code;
    this.raw = extra.raw;
    this.issues = extra.issues;
  }
}

/** Duck-typed on purpose: in Next dev the same module can be instantiated more
 *  than once (separate bundles, HMR), so `instanceof` is not reliable. */
export function isAiRuntimeError(error: unknown): error is AiRuntimeError {
  return (
    error instanceof Error &&
    error.name === "AiRuntimeError" &&
    typeof (error as { code?: unknown }).code === "string"
  );
}

// ---------------------------------------------------------------------------
// FIFO queue (concurrency 1)
// ---------------------------------------------------------------------------

interface QueuedJob {
  start: () => void;
  fail: (error: unknown) => void;
}

/** Runs one async task at a time, strictly in arrival order. A task that
 *  rejects does not block the ones behind it. */
export class FifoQueue {
  private jobs: QueuedJob[] = [];
  private busy = false;

  /** Tasks waiting behind the running one. */
  get waiting(): number {
    return this.jobs.length;
  }

  /** Is a task running right now? */
  get active(): boolean {
    return this.busy;
  }

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.jobs.push({
        start: () => {
          const settle = (done: () => void) => {
            this.busy = false;
            done();
            this.pump();
          };
          Promise.resolve()
            .then(task)
            .then(
              (value) => settle(() => resolve(value)),
              (error) => settle(() => reject(error)),
            );
        },
        fail: reject,
      });
      this.pump();
    });
  }

  /** Reject everything still waiting (not the running task). Used on shutdown. */
  rejectWaiting(error: unknown): number {
    const dropped = this.jobs.splice(0);
    for (const job of dropped) job.fail(error);
    return dropped.length;
  }

  private pump(): void {
    if (this.busy) return;
    const next = this.jobs.shift();
    if (!next) return;
    this.busy = true;
    next.start();
  }
}

// ---------------------------------------------------------------------------
// Model-output JSON parsing / validation
// ---------------------------------------------------------------------------

/** Pull the JSON payload out of text that may be wrapped in a code fence or
 *  surrounded by prose. Returns the input trimmed if no JSON-looking span. */
export function extractJsonText(raw: string): string {
  let text = raw.replace(/^﻿/, "").trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced) text = fenced[1].trim();
  if (text.startsWith("{") || text.startsWith("[")) return text;

  const firstObject = text.indexOf("{");
  const firstArray = text.indexOf("[");
  const starts = [firstObject, firstArray].filter((i) => i >= 0);
  if (starts.length === 0) return text;
  const start = Math.min(...starts);
  const end = text.lastIndexOf(text[start] === "{" ? "}" : "]");
  return end > start ? text.slice(start, end + 1) : text.slice(start);
}

/** Cheap, safe fix for the slip small models actually make: trailing commas
 *  before a closing bracket. String-aware, so a ", }" inside a value stays. */
export function repairJsonText(text: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === "\\") out += text[++i] ?? "";
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === ",") {
      const next = /^\s*([}\]])/.exec(text.slice(i + 1));
      if (!next) out += ch;
    } else {
      out += ch;
    }
  }
  return out;
}

export type ParsedJson = { ok: true; value: unknown } | { ok: false; error: string };

/** Parse model text as JSON: as-is, then extracted, then lightly repaired. */
export function parseModelJson(raw: string): ParsedJson {
  const attempts = [
    raw.trim(),
    extractJsonText(raw),
    repairJsonText(extractJsonText(raw)),
  ];
  let lastError = "empty output";
  for (const attempt of attempts) {
    if (!attempt) continue;
    try {
      return { ok: true, value: JSON.parse(attempt) };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return { ok: false, error: lastError };
}

export type Validated<T> = { ok: true; data: T } | { ok: false; issues: string[] };

export function validateWithSchema<S extends z.ZodType>(
  schema: S,
  value: unknown,
): Validated<z.output<S>> {
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, data: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => {
      const where = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${where}: ${issue.message}`;
    }),
  };
}

/** zod schema -> JSON Schema for Ollama's `format`. `io: "input"` because
 *  the model's output is what the schema's *input* side validates. */
export function toOllamaFormat(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, {
    target: "draft-7",
    io: "input",
    unrepresentable: "any",
  }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

export function buildRepairPrompt(issues: string[]): string {
  return `That reply was rejected: ${issues.join("; ")}. Reply again with ONLY the corrected JSON that matches the schema — no prose, no code fences.`;
}

/** Did fetch give up because the server stayed silent (undici's headers/body
 *  timeout, `TypeError: fetch failed` with that cause)? Ollama was busy
 *  generating then, not gone, so it must not be reported as runtime-down.
 *  Matches the cause's error code, not its message; a connect timeout is a
 *  different code and stays runtime-down. */
export function isFetchSilenceTimeout(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth++) {
    const code = (current as { code?: unknown }).code;
    if (code === "UND_ERR_HEADERS_TIMEOUT" || code === "UND_ERR_BODY_TIMEOUT") return true;
    current = current.cause;
  }
  return false;
}

function truncate(text: string, max = 400): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// ---------------------------------------------------------------------------
// Ollama client
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const WARM_PROMPT = "Reply with the single word: ready";
const WARM_NUM_PREDICT = 8;

export interface OllamaClientDeps {
  config: AiRuntimeConfig;
  fetch: typeof fetch;
  queue: FifoQueue;
  /** Runs inside the queue slot before every job (start the server if it is
   *  down, etc.). Throw AiRuntimeError("runtime-down") if it can't be made up. */
  ensure?: () => Promise<void>;
  /** Overrides config.keepAlive (index.ts picks owned vs external). */
  keepAlive?: () => string;
}

export interface GenerateJsonOptions<S extends z.ZodType> {
  system?: string;
  prompt: string;
  /** The caller's contract: converted to Ollama's `format`, then used to
   *  validate the reply. */
  schema: S;
  model?: string;
  timeoutMs?: number;
  /** Ollama's `think` switch for reasoning models (qwen3.5, gemma4, ...). Left
   *  undefined (the default) nothing is sent and the model's own default
   *  applies; `false` turns the thinking phase off, which on CPU saves
   *  minutes. Do not pass `true` for a model without thinking support:
   *  Ollama answers HTTP 400. */
  think?: boolean;
}

export interface GenerateTextOptions {
  system?: string;
  prompt: string;
  model?: string;
  timeoutMs?: number;
  temperature?: number;
  /** See GenerateJsonOptions.think. */
  think?: boolean;
}

interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  format?: Record<string, unknown>;
  temperature: number;
  timeoutMs: number;
  think?: boolean;
  /** Overrides config.maxOutputTokens (the warm-up asks for a few tokens). */
  numPredict?: number;
}

interface ChatReply {
  content: string;
  doneReason?: string;
}

export function createOllamaClient(deps: OllamaClientDeps) {
  const { config, queue } = deps;
  const doFetch = deps.fetch;

  function keepAlive(): string {
    return deps.keepAlive ? deps.keepAlive() : config.keepAlive;
  }

  /** fetch + the error mapping every call shares. */
  async function request(
    route: string,
    init: { method?: string; body?: unknown; timeoutMs: number; model?: string },
  ): Promise<unknown> {
    const timeoutMs = clampTimeoutMs(init.timeoutMs);
    let response: Response;
    try {
      response = await doFetch(`${config.baseUrl}${route}`, {
        method: init.method ?? "POST",
        headers: { "Content-Type": "application/json" },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "TimeoutError" || name === "AbortError" || isFetchSilenceTimeout(error)) {
        throw new AiRuntimeError(
          "timeout",
          `The local AI model did not answer within ${Math.round(timeoutMs / 1000)}s.`,
          { cause: error },
        );
      }
      throw new AiRuntimeError(
        "runtime-down",
        `Could not reach the local AI runtime at ${config.baseUrl}.`,
        { cause: error },
      );
    }

    if (!response.ok) {
      let detail = "";
      try {
        const body = (await response.json()) as { error?: unknown };
        if (typeof body.error === "string") detail = body.error;
      } catch {
        // Body wasn't JSON; the status line below is enough.
      }
      // Only model-bearing calls can mean "model missing" (Ollama answers 404
      // `model 'x' not found`); a 404 from a status route is just an error.
      if (
        init.model !== undefined &&
        (response.status === 404 || /model .*not found/i.test(detail))
      ) {
        throw new AiRuntimeError(
          "model-missing",
          `The local model "${init.model}" is not installed. Run: ollama pull ${init.model}`,
        );
      }
      throw new AiRuntimeError(
        "runtime-down",
        `The local AI runtime returned HTTP ${response.status}${detail ? `: ${detail}` : ""}.`,
      );
    }

    try {
      return await response.json();
    } catch (error) {
      throw new AiRuntimeError(
        "runtime-down",
        "The local AI runtime returned a response that was not valid JSON.",
        { cause: error },
      );
    }
  }

  async function chat(req: ChatRequest): Promise<ChatReply> {
    const payload = (await request("/api/chat", {
      model: req.model,
      timeoutMs: req.timeoutMs,
      body: {
        model: req.model,
        messages: req.messages,
        stream: false,
        ...(req.format ? { format: req.format } : {}),
        ...(req.think === undefined ? {} : { think: req.think }),
        keep_alive: keepAlive(),
        options: {
          temperature: req.temperature,
          num_ctx: config.numCtx,
          num_predict: req.numPredict ?? config.maxOutputTokens,
        },
      },
    })) as { message?: { content?: unknown }; done_reason?: unknown } | null;

    const content = payload?.message?.content;
    if (typeof content !== "string") {
      throw new AiRuntimeError(
        "invalid-output",
        "The local AI runtime's reply had no message content.",
      );
    }
    return {
      content,
      doneReason:
        typeof payload?.done_reason === "string" ? payload.done_reason : undefined,
    };
  }

  /** Every generate call goes through the one queue slot. */
  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    return queue.enqueue(async () => {
      await deps.ensure?.();
      return task();
    });
  }

  /**
   * Structured output: Ollama constrains decoding to the schema (`format`),
   * temperature 0, then the reply is parsed and validated against the
   * caller's zod schema. One repair round-trip if that fails.
   */
  function generateJson<S extends z.ZodType>(
    options: GenerateJsonOptions<S>,
  ): Promise<z.output<S>> {
    const model = options.model ?? config.defaultModel;
    const timeoutMs = options.timeoutMs ?? config.requestTimeoutMs;
    const format = toOllamaFormat(options.schema);

    // Constrained decoding alone gives valid shape; the schema in the prompt
    // is what helps a small model fill the fields sensibly.
    const system = [
      options.system?.trim(),
      `Reply with ONLY a JSON value matching this JSON Schema:\n${JSON.stringify(format)}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    return enqueue(async () => {
      const messages: ChatMessage[] = [
        { role: "system", content: system },
        { role: "user", content: options.prompt },
      ];
      let lastRaw = "";
      let lastIssues: string[] = [];

      for (let attempt = 0; attempt < 2; attempt++) {
        const reply = await chat({
          model,
          messages,
          format,
          temperature: 0,
          timeoutMs,
          think: options.think,
        });
        lastRaw = reply.content;

        const parsed = parseModelJson(reply.content);
        if (parsed.ok) {
          const validated = validateWithSchema(options.schema, parsed.value);
          if (validated.ok) return validated.data;
          lastIssues = validated.issues;
        } else {
          lastIssues = [
            reply.doneReason === "length"
              ? "output was cut off before the JSON was complete"
              : `not valid JSON (${parsed.error})`,
          ];
        }

        messages.push(
          { role: "assistant", content: reply.content },
          { role: "user", content: buildRepairPrompt(lastIssues) },
        );
      }

      throw new AiRuntimeError(
        "invalid-output",
        `The local AI model did not return valid output after a repair attempt: ${lastIssues.join("; ")}`,
        { raw: truncate(lastRaw), issues: lastIssues },
      );
    });
  }

  function generateText(options: GenerateTextOptions): Promise<string> {
    const model = options.model ?? config.defaultModel;
    const timeoutMs = options.timeoutMs ?? config.requestTimeoutMs;
    const messages: ChatMessage[] = [
      ...(options.system?.trim()
        ? [{ role: "system", content: options.system.trim() } as const]
        : []),
      { role: "user", content: options.prompt },
    ];
    return enqueue(async () => {
      const reply = await chat({
        model,
        messages,
        temperature: options.temperature ?? 0,
        timeoutMs,
        think: options.think,
      });
      return reply.content.trim();
    });
  }

  /** Make a model resident with the standard keep_alive and num_ctx, through
   *  the queue so it never races a real call. An empty /api/generate only
   *  allocates the model: the first real call then still spent 60-90 s paging
   *  the weights in. A tiny real chat touches them, so this is one. */
  function warm(model: string = config.defaultModel): Promise<void> {
    return enqueue(async () => {
      await chat({
        model,
        messages: [{ role: "user", content: WARM_PROMPT }],
        temperature: 0,
        timeoutMs: config.requestTimeoutMs,
        think: false,
        numPredict: WARM_NUM_PREDICT,
      });
    });
  }

  /** Unload a model now (keep_alive 0). Bypasses the queue on purpose: used
   *  on shutdown, when waiting behind a long job is the wrong thing to do. */
  async function unload(model: string, timeoutMs = 3_000): Promise<void> {
    await request("/api/generate", {
      model,
      timeoutMs,
      body: { model, stream: false, keep_alive: 0 },
    });
  }

  /** Cheap liveness probe: GET /api/version. Never throws. */
  async function probe(
    timeoutMs = 1_500,
  ): Promise<{ running: boolean; version?: string }> {
    try {
      const payload = (await request("/api/version", { method: "GET", timeoutMs })) as {
        version?: unknown;
      } | null;
      return {
        running: true,
        version: typeof payload?.version === "string" ? payload.version : undefined,
      };
    } catch {
      return { running: false };
    }
  }

  async function modelNames(route: string, timeoutMs: number): Promise<string[]> {
    const payload = (await request(route, { method: "GET", timeoutMs })) as {
      models?: Array<{ name?: unknown }>;
    } | null;
    return (payload?.models ?? [])
      .map((m) => (typeof m.name === "string" ? m.name : ""))
      .filter(Boolean);
  }

  /** Installed models (GET /api/tags). Throws AiRuntimeError if unreachable. */
  const listInstalled = (timeoutMs = 3_000) => modelNames("/api/tags", timeoutMs);
  /** Models currently loaded in memory (GET /api/ps). */
  const listLoaded = (timeoutMs = 3_000) => modelNames("/api/ps", timeoutMs);

  return { generateJson, generateText, warm, unload, probe, listInstalled, listLoaded };
}

export type OllamaClient = ReturnType<typeof createOllamaClient>;
