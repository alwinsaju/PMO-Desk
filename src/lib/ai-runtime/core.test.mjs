// Run with `pnpm test` (Node's built-in test runner imports the .ts module
// directly). Covers the pure parts of the local AI runtime plus the Ollama
// client against a FAKE fetch — nothing here ever needs a real Ollama.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import {
  AiRuntimeError,
  DEFAULT_AI_RUNTIME_CONFIG,
  FifoQueue,
  MAX_REQUEST_TIMEOUT_MS,
  buildRepairPrompt,
  clampTimeoutMs,
  createOllamaClient,
  extractJsonText,
  isFetchSilenceTimeout,
  isLocalBaseUrl,
  isOllamaImageName,
  loadAiRuntimeConfig,
  normalizeModelName,
  ollamaHostFor,
  parseModelJson,
  parseTasklistImageName,
  repairJsonText,
  resolveOllamaExe,
  toOllamaFormat,
  validateWithSchema,
} from "./core.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("FifoQueue", () => {
  it("runs one task at a time, in arrival order", async () => {
    const queue = new FifoQueue();
    const log = [];
    let running = 0;
    let maxRunning = 0;
    const job = (name, ms) => () =>
      (async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        log.push(`start ${name}`);
        await new Promise((resolve) => setTimeout(resolve, ms));
        log.push(`end ${name}`);
        running--;
        return name;
      })();

    const results = await Promise.all([
      queue.enqueue(job("a", 20)),
      queue.enqueue(job("b", 1)),
      queue.enqueue(job("c", 1)),
    ]);

    assert.deepEqual(results, ["a", "b", "c"]);
    assert.equal(maxRunning, 1);
    assert.deepEqual(log, ["start a", "end a", "start b", "end b", "start c", "end c"]);
  });

  it("reports waiting length and active state", async () => {
    const queue = new FifoQueue();
    let release;
    const first = queue.enqueue(() => new Promise((resolve) => (release = resolve)));
    const second = queue.enqueue(async () => "second");
    await tick();
    assert.equal(queue.active, true);
    assert.equal(queue.waiting, 1);
    release("first");
    assert.equal(await first, "first");
    assert.equal(await second, "second");
    assert.equal(queue.active, false);
    assert.equal(queue.waiting, 0);
  });

  it("a rejected task does not block the ones behind it", async () => {
    const queue = new FifoQueue();
    const failing = queue.enqueue(async () => {
      throw new Error("boom");
    });
    const after = queue.enqueue(async () => "ok");
    await assert.rejects(failing, /boom/);
    assert.equal(await after, "ok");
  });

  it("turns a synchronous throw into a rejection", async () => {
    const queue = new FifoQueue();
    await assert.rejects(
      queue.enqueue(() => {
        throw new Error("sync");
      }),
      /sync/,
    );
    assert.equal(await queue.enqueue(async () => 1), 1);
  });

  it("rejectWaiting drops queued tasks but not the running one", async () => {
    const queue = new FifoQueue();
    let release;
    const running = queue.enqueue(() => new Promise((resolve) => (release = resolve)));
    const queued = queue.enqueue(async () => "never");
    await tick();
    assert.equal(queue.rejectWaiting(new Error("shutdown")), 1);
    await assert.rejects(queued, /shutdown/);
    release("done");
    assert.equal(await running, "done");
  });
});

describe("JSON extraction, repair and validation", () => {
  it("extracts JSON from fences and surrounding prose", () => {
    assert.equal(extractJsonText('```json\n{"a":1}\n```'), '{"a":1}');
    assert.equal(
      extractJsonText('Sure! Here you go: {"a":1} Hope that helps.'),
      '{"a":1}',
    );
    assert.equal(extractJsonText("result: [1,2,3] done"), "[1,2,3]");
    assert.equal(extractJsonText('  {"a":1}  '), '{"a":1}');
  });

  it("repairs trailing commas only", () => {
    assert.equal(repairJsonText('{"a":[1,2,],}'), '{"a":[1,2]}');
    assert.equal(repairJsonText('{"a":"x, }"}'), '{"a":"x, }"}');
  });

  it("parseModelJson tries as-is, extracted, then repaired", () => {
    assert.deepEqual(parseModelJson('{"a":1}'), { ok: true, value: { a: 1 } });
    assert.deepEqual(parseModelJson('```json\n{"a":1}\n```'), {
      ok: true,
      value: { a: 1 },
    });
    assert.deepEqual(parseModelJson('{"a":1,}'), { ok: true, value: { a: 1 } });
    const bad = parseModelJson("not json at all");
    assert.equal(bad.ok, false);
    assert.equal(parseModelJson("").ok, false);
  });

  it("validateWithSchema returns data or readable issues", () => {
    const schema = z.object({ title: z.string().min(1), due: z.string().nullable() });
    assert.deepEqual(validateWithSchema(schema, { title: "x", due: null }), {
      ok: true,
      data: { title: "x", due: null },
    });
    const bad = validateWithSchema(schema, { title: "", due: 5 });
    assert.equal(bad.ok, false);
    assert.equal(bad.issues.length, 2);
    assert.match(bad.issues[0], /^title: /);
    assert.match(bad.issues[1], /^due: /);
    assert.match(validateWithSchema(schema, 7).issues[0], /^\(root\): /);
  });

  it("toOllamaFormat produces a plain JSON schema without $schema", () => {
    const format = toOllamaFormat(
      z.object({ title: z.string(), priority: z.enum(["low", "high"]) }),
    );
    assert.equal(format.$schema, undefined);
    assert.equal(format.type, "object");
    assert.deepEqual(format.required, ["title", "priority"]);
    assert.deepEqual(format.properties.priority.enum, ["low", "high"]);
  });

  it("buildRepairPrompt lists every issue", () => {
    const prompt = buildRepairPrompt(["a: bad", "b: worse"]);
    assert.match(prompt, /a: bad; b: worse/);
  });
});

describe("config", () => {
  it("defaults to gemma4 on the standard port", () => {
    const config = loadAiRuntimeConfig({});
    assert.equal(config.defaultModel, "gemma4:12b");
    assert.equal(config.baseUrl, "http://127.0.0.1:11434");
    assert.equal(config.autoStart, true);
    assert.deepEqual(config, { ...DEFAULT_AI_RUNTIME_CONFIG, ollamaExe: undefined });
  });

  it("reads env overrides and ignores junk numbers", () => {
    const config = loadAiRuntimeConfig({
      OLLAMA_BASE_URL: "http://localhost:11500/",
      OLLAMA_MODEL: "llama3.2:latest",
      AI_OS_OLLAMA_EXE: "D:\\tools\\ollama.exe",
      AI_OS_AI_AUTOSTART: "0",
      AI_OS_AI_PREWARM: "false",
      AI_OS_AI_TIMEOUT_MS: "1234",
      AI_OS_AI_NUM_CTX: "banana",
    });
    assert.equal(config.baseUrl, "http://localhost:11500");
    assert.equal(config.defaultModel, "llama3.2:latest");
    assert.equal(config.ollamaExe, "D:\\tools\\ollama.exe");
    assert.equal(config.autoStart, false);
    assert.equal(config.prewarm, false);
    assert.equal(config.requestTimeoutMs, 1234);
    assert.equal(config.numCtx, DEFAULT_AI_RUNTIME_CONFIG.numCtx);
  });

  it("never lets the timeout reach fetch's own 300 s limit", () => {
    assert.ok(MAX_REQUEST_TIMEOUT_MS <= 280_000);
    assert.equal(DEFAULT_AI_RUNTIME_CONFIG.requestTimeoutMs, MAX_REQUEST_TIMEOUT_MS);
    assert.equal(
      loadAiRuntimeConfig({ AI_OS_AI_TIMEOUT_MS: "900000" }).requestTimeoutMs,
      MAX_REQUEST_TIMEOUT_MS,
    );
    assert.equal(clampTimeoutMs(240_000), 240_000);
    assert.equal(clampTimeoutMs(300_000), MAX_REQUEST_TIMEOUT_MS);
    assert.equal(clampTimeoutMs(Number.MAX_SAFE_INTEGER), MAX_REQUEST_TIMEOUT_MS);
    assert.equal(clampTimeoutMs(0), 1);
  });

  it("only treats loopback URLs as local", () => {
    assert.equal(isLocalBaseUrl("http://127.0.0.1:11434"), true);
    assert.equal(isLocalBaseUrl("http://localhost:11434"), true);
    assert.equal(isLocalBaseUrl("http://[::1]:11434"), true);
    assert.equal(isLocalBaseUrl("http://10.0.0.5:11434"), false);
    assert.equal(isLocalBaseUrl("nonsense"), false);
  });

  it("derives OLLAMA_HOST from the base URL", () => {
    assert.equal(ollamaHostFor("http://127.0.0.1:11500"), "127.0.0.1:11500");
    assert.equal(ollamaHostFor("http://localhost"), "127.0.0.1:11434");
  });

  it("normalizes model names", () => {
    assert.equal(normalizeModelName("llama3.2"), "llama3.2:latest");
    assert.equal(normalizeModelName("qwen2.5:7b"), "qwen2.5:7b");
  });
});

describe("resolveOllamaExe", () => {
  const win = (existing, env = {}, override) =>
    resolveOllamaExe({
      platform: "win32",
      env: {
        Path: "C:\\Windows;C:\\Tools\\Ollama;",
        LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
        ProgramFiles: "C:\\Program Files",
        ...env,
      },
      exists: (p) => existing.includes(p),
      override,
    });

  it("prefers the explicit override", () => {
    const hit = win(
      ["D:\\o\\ollama.exe", "C:\\Tools\\Ollama\\ollama.exe"],
      {},
      "D:\\o\\ollama.exe",
    );
    assert.deepEqual(hit, {
      path: "D:\\o\\ollama.exe",
      source: "override",
      tried: ["D:\\o\\ollama.exe"],
    });
  });

  it("does not fall through when the override is missing", () => {
    const hit = win(["C:\\Tools\\Ollama\\ollama.exe"], {}, "D:\\nope\\ollama.exe");
    assert.equal(hit.path, undefined);
    assert.deepEqual(hit.tried, ["D:\\nope\\ollama.exe"]);
  });

  it("finds ollama.exe on PATH (env keys are case-insensitive on Windows)", () => {
    const hit = win(["C:\\Tools\\Ollama\\ollama.exe"]);
    assert.equal(hit.path, "C:\\Tools\\Ollama\\ollama.exe");
    assert.equal(hit.source, "path");
  });

  it("falls back to the default install location", () => {
    const expected = "C:\\Users\\me\\AppData\\Local\\Programs\\Ollama\\ollama.exe";
    const hit = win([expected]);
    assert.equal(hit.path, expected);
    assert.equal(hit.source, "default-install");
    assert.equal(hit.tried.at(-1), expected);
  });

  it("reports every place it looked when nothing is found", () => {
    const hit = win([]);
    assert.equal(hit.path, undefined);
    assert.ok(hit.tried.includes("C:\\Windows\\ollama.exe"));
    assert.ok(hit.tried.includes("C:\\Program Files\\Ollama\\ollama.exe"));
  });

  it("strips quotes from PATH entries and works on posix", () => {
    const quoted = win(["C:\\My Tools\\ollama.exe"], { Path: '"C:\\My Tools"' });
    assert.equal(quoted.path, "C:\\My Tools\\ollama.exe");
    const posix = resolveOllamaExe({
      platform: "linux",
      env: { PATH: "/bin:/opt/bin" },
      exists: (p) => p === "/opt/bin/ollama",
    });
    assert.equal(posix.path, "/opt/bin/ollama");
  });
});

describe("process image helpers", () => {
  it("parses tasklist CSV output", () => {
    assert.equal(
      parseTasklistImageName('"ollama.exe","19236","Console","1","44,088 K"\r\n'),
      "ollama.exe",
    );
    assert.equal(
      parseTasklistImageName(
        "INFO: No tasks are running which match the specified criteria.",
      ),
      undefined,
    );
  });

  it("recognises only Ollama binaries", () => {
    assert.equal(isOllamaImageName("ollama.exe"), true);
    assert.equal(isOllamaImageName("OLLAMA.EXE"), true);
    assert.equal(isOllamaImageName("ollama"), true);
    assert.equal(isOllamaImageName("ollama app.exe"), false);
    assert.equal(isOllamaImageName("chrome.exe"), false);
    assert.equal(isOllamaImageName(undefined), false);
  });
});

// ---------------------------------------------------------------------------
// Client against a fake fetch
// ---------------------------------------------------------------------------

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const chatReply = (content, extra = {}) =>
  json({ message: { role: "assistant", content }, ...extra });

function makeClient(handler, overrides = {}) {
  const calls = [];
  const config = { ...DEFAULT_AI_RUNTIME_CONFIG, ...overrides };
  const client = createOllamaClient({
    config,
    queue: new FifoQueue(),
    fetch: async (url, init) => {
      const call = {
        route: new URL(url).pathname,
        method: init?.method,
        body: init?.body ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      return handler(call, init);
    },
  });
  return { client, calls };
}

const todoSchema = z.object({
  title: z.string().min(1),
  priority: z.enum(["low", "high"]),
});

describe("generateJson", () => {
  it("sends schema as format, temperature 0, and returns validated data", async () => {
    const { client, calls } = makeClient(() =>
      chatReply('{"title":"Send report","priority":"high"}'),
    );
    const result = await client.generateJson({
      system: "Extract a todo.",
      prompt: "please send the report asap",
      schema: todoSchema,
    });

    assert.deepEqual(result, { title: "Send report", priority: "high" });
    assert.equal(calls.length, 1);
    const { body, route } = calls[0];
    assert.equal(route, "/api/chat");
    assert.equal(body.model, DEFAULT_AI_RUNTIME_CONFIG.defaultModel);
    assert.equal(body.stream, false);
    assert.equal(body.options.temperature, 0);
    assert.equal(body.options.num_ctx, DEFAULT_AI_RUNTIME_CONFIG.numCtx);
    assert.equal(body.format.type, "object");
    assert.deepEqual(body.format.required, ["title", "priority"]);
    assert.equal(body.messages[0].role, "system");
    assert.match(body.messages[0].content, /^Extract a todo\./);
    assert.match(body.messages[0].content, /JSON Schema/);
    assert.deepEqual(body.messages[1], {
      role: "user",
      content: "please send the report asap",
    });
  });

  it("honours an explicit model and keeps call sites free of defaults", async () => {
    const { client, calls } = makeClient(() =>
      chatReply('{"title":"t","priority":"low"}'),
    );
    await client.generateJson({
      prompt: "x",
      schema: todoSchema,
      model: "llama3.2:latest",
    });
    assert.equal(calls[0].body.model, "llama3.2:latest");
  });

  it("repairs once: feeds the problem back and accepts the corrected reply", async () => {
    const replies = [
      '{"title":"","priority":"urgent"}',
      '{"title":"Fixed","priority":"low"}',
    ];
    const { client, calls } = makeClient(() => chatReply(replies.shift()));
    const result = await client.generateJson({ prompt: "x", schema: todoSchema });

    assert.deepEqual(result, { title: "Fixed", priority: "low" });
    assert.equal(calls.length, 2);
    const second = calls[1].body.messages;
    assert.equal(second.at(-2).role, "assistant");
    assert.equal(second.at(-2).content, '{"title":"","priority":"urgent"}');
    assert.equal(second.at(-1).role, "user");
    assert.match(second.at(-1).content, /title: /);
    assert.match(second.at(-1).content, /priority: /);
  });

  it("repairs unparseable text too, and tolerates a code fence without a retry", async () => {
    const fenced = makeClient(() =>
      chatReply('```json\n{"title":"t","priority":"low"}\n```'),
    );
    assert.equal(
      (await fenced.client.generateJson({ prompt: "x", schema: todoSchema })).title,
      "t",
    );
    assert.equal(fenced.calls.length, 1);

    const replies = ["I cannot do that", '{"title":"t","priority":"low"}'];
    const retried = makeClient(() => chatReply(replies.shift()));
    await retried.client.generateJson({ prompt: "x", schema: todoSchema });
    assert.equal(retried.calls.length, 2);
  });

  it("throws invalid-output after the single repair attempt fails", async () => {
    const { client, calls } = makeClient(() => chatReply('{"title":""}'));
    await assert.rejects(
      client.generateJson({ prompt: "x", schema: todoSchema }),
      (error) => {
        assert.ok(error instanceof AiRuntimeError);
        assert.equal(error.code, "invalid-output");
        assert.equal(error.raw, '{"title":""}');
        assert.ok(error.issues.length > 0);
        return true;
      },
    );
    assert.equal(calls.length, 2);
  });

  it("treats a truncated reply as invalid output", async () => {
    const { client } = makeClient(() =>
      chatReply('{"title":"cut o', { done_reason: "length" }),
    );
    await assert.rejects(
      client.generateJson({ prompt: "x", schema: todoSchema }),
      (error) => error.code === "invalid-output" && /cut off/.test(error.issues[0]),
    );
  });

  it("maps a 404 model error to model-missing", async () => {
    const { client } = makeClient(() => json({ error: "model 'nope' not found" }, 404));
    await assert.rejects(
      client.generateJson({ prompt: "x", schema: todoSchema, model: "nope" }),
      (error) => error.code === "model-missing" && /ollama pull nope/.test(error.message),
    );
  });

  it("maps connection failures to runtime-down", async () => {
    const { client } = makeClient(() => {
      throw new TypeError("fetch failed");
    });
    await assert.rejects(
      client.generateJson({ prompt: "x", schema: todoSchema }),
      (error) => error.code === "runtime-down",
    );
  });

  it("maps server errors to runtime-down with the status", async () => {
    const { client } = makeClient(() => json({ error: "runner crashed" }, 500));
    await assert.rejects(
      client.generateText({ prompt: "x" }),
      (error) =>
        error.code === "runtime-down" && /500.*runner crashed/.test(error.message),
    );
  });

  it("maps a request that outlives timeoutMs to timeout", async () => {
    const { client } = makeClient(
      (_call, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(init.signal.reason));
        }),
    );
    await assert.rejects(
      client.generateJson({ prompt: "x", schema: todoSchema, timeoutMs: 25 }),
      (error) => error.code === "timeout",
    );
  });

  it("clamps a longer per-call timeout and reports the clamped value", async () => {
    const { client } = makeClient(() => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    await assert.rejects(
      client.generateText({ prompt: "x", timeoutMs: 600_000 }),
      (error) => error.code === "timeout" && /within 280s/.test(error.message),
    );
  });

  it("maps fetch's 300 s silence abort to timeout, not runtime-down", async () => {
    // What Node's fetch really throws: TypeError "fetch failed" whose cause
    // carries the undici code (checked against undici 7).
    const undiciError = (code, name) =>
      Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error(name), { name, code }),
      });
    for (const [code, name] of [
      ["UND_ERR_HEADERS_TIMEOUT", "HeadersTimeoutError"],
      ["UND_ERR_BODY_TIMEOUT", "BodyTimeoutError"],
    ]) {
      const { client } = makeClient(() => {
        throw undiciError(code, name);
      });
      await assert.rejects(
        client.generateJson({ prompt: "x", schema: todoSchema }),
        (error) => error.code === "timeout",
      );
    }

    // Not being able to connect at all is still a dead server.
    const refused = makeClient(() => {
      throw undiciError("UND_ERR_CONNECT_TIMEOUT", "ConnectTimeoutError");
    });
    await assert.rejects(
      refused.client.generateText({ prompt: "x" }),
      (error) => error.code === "runtime-down",
    );
  });

  it("recognizes the undici silence timeouts only by their code", () => {
    const wrap = (cause) => Object.assign(new TypeError("fetch failed"), { cause });
    const coded = (code) => Object.assign(new Error("x"), { code });
    assert.equal(isFetchSilenceTimeout(wrap(coded("UND_ERR_HEADERS_TIMEOUT"))), true);
    assert.equal(isFetchSilenceTimeout(wrap(wrap(coded("UND_ERR_BODY_TIMEOUT")))), true);
    assert.equal(isFetchSilenceTimeout(wrap(coded("ECONNREFUSED"))), false);
    assert.equal(isFetchSilenceTimeout(new Error("Headers Timeout Error")), false);
    assert.equal(isFetchSilenceTimeout("UND_ERR_HEADERS_TIMEOUT"), false);
    assert.equal(isFetchSilenceTimeout(undefined), false);
  });

  it("runs the ensure hook inside the queue slot before each call", async () => {
    const order = [];
    const queue = new FifoQueue();
    const client = createOllamaClient({
      config: DEFAULT_AI_RUNTIME_CONFIG,
      queue,
      ensure: async () => {
        order.push("ensure");
      },
      fetch: async () => {
        order.push("fetch");
        return chatReply("hi");
      },
    });
    await client.generateText({ prompt: "x" });
    assert.deepEqual(order, ["ensure", "fetch"]);

    const failing = createOllamaClient({
      config: DEFAULT_AI_RUNTIME_CONFIG,
      queue: new FifoQueue(),
      ensure: async () => {
        throw new AiRuntimeError("runtime-down", "no ollama");
      },
      fetch: async () => assert.fail("must not be called"),
    });
    await assert.rejects(failing.generateText({ prompt: "x" }), /no ollama/);
  });

  it("serializes concurrent calls through the one queue", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const seen = [];
    const { client } = makeClient(async (call) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      seen.push(call.body.messages.at(-1).content);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight--;
      return chatReply("ok");
    });
    await Promise.all(["1", "2", "3"].map((prompt) => client.generateText({ prompt })));
    assert.equal(maxInFlight, 1);
    assert.deepEqual(seen, ["1", "2", "3"]);
  });
});

describe("generateText and model control", () => {
  it("returns trimmed text without a format", async () => {
    const { client, calls } = makeClient(() => chatReply("  hello  "));
    assert.equal(
      await client.generateText({ system: "Be brief.", prompt: "hi" }),
      "hello",
    );
    assert.equal(calls[0].body.format, undefined);
    assert.equal(calls[0].body.options.temperature, 0);
    assert.deepEqual(calls[0].body.messages[0], { role: "system", content: "Be brief." });
  });

  it("sends `think` only when the caller sets it (default request is unchanged)", async () => {
    const { client, calls } = makeClient(() =>
      chatReply('{"title":"t","priority":"low"}'),
    );
    await client.generateJson({ prompt: "x", schema: todoSchema });
    await client.generateText({ prompt: "x" });
    assert.equal("think" in calls[0].body, false);
    assert.equal("think" in calls[1].body, false);

    await client.generateJson({ prompt: "x", schema: todoSchema, think: false });
    await client.generateText({ prompt: "x", think: false });
    assert.equal(calls[2].body.think, false);
    assert.equal(calls[3].body.think, false);

    await client.generateText({ prompt: "x", think: true });
    assert.equal(calls[4].body.think, true);
  });

  it("keeps `think` on the repair round-trip too", async () => {
    const replies = [
      '{"title":"","priority":"urgent"}',
      '{"title":"ok","priority":"low"}',
    ];
    const { client, calls } = makeClient(() => chatReply(replies.shift()));
    await client.generateJson({ prompt: "x", schema: todoSchema, think: false });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].body.think, false);
    assert.equal(calls[1].body.think, false);
  });

  it("applies keep_alive from config or the override", async () => {
    const owned = makeClient(() => chatReply("x"));
    await owned.client.generateText({ prompt: "x" });
    assert.equal(owned.calls[0].body.keep_alive, DEFAULT_AI_RUNTIME_CONFIG.keepAlive);

    const calls = [];
    const client = createOllamaClient({
      config: DEFAULT_AI_RUNTIME_CONFIG,
      queue: new FifoQueue(),
      keepAlive: () => "5m",
      fetch: async (_url, init) => {
        calls.push(JSON.parse(init.body));
        return chatReply("x");
      },
    });
    await client.generateText({ prompt: "x" });
    assert.equal(calls[0].keep_alive, "5m");
  });

  it("warm is a tiny real chat (weights paged in); unload sends keep_alive 0", async () => {
    const { client, calls } = makeClient((call) =>
      call.route === "/api/chat" ? chatReply("ready") : json({ done: true }),
    );
    await client.warm();
    await client.unload("gemma4:12b");
    assert.equal(calls[0].route, "/api/chat");
    assert.equal(calls[0].body.model, DEFAULT_AI_RUNTIME_CONFIG.defaultModel);
    assert.equal(calls[0].body.messages.length, 1);
    assert.equal(calls[0].body.messages[0].role, "user");
    assert.equal(calls[0].body.think, false);
    assert.equal(calls[0].body.stream, false);
    assert.ok(calls[0].body.options.num_predict <= 16, "only a few tokens");
    assert.equal(calls[0].body.options.num_ctx, DEFAULT_AI_RUNTIME_CONFIG.numCtx);
    assert.equal(calls[0].body.keep_alive, DEFAULT_AI_RUNTIME_CONFIG.keepAlive);
    assert.equal(calls[1].route, "/api/generate");
    assert.equal(calls[1].body.keep_alive, 0);
  });

  it("warm goes through the queue behind a running job", async () => {
    let release;
    const order = [];
    const { client } = makeClient(async (call) => {
      order.push(call.body.messages[0].content);
      if (order.length === 1) await new Promise((resolve) => (release = resolve));
      return chatReply("ok");
    });
    const first = client.generateText({ prompt: "real job" });
    const warming = client.warm();
    await tick();
    await tick();
    assert.deepEqual(order, ["real job"]);
    release();
    await Promise.all([first, warming]);
    assert.equal(order.length, 2);
  });

  it("probe and model listings never throw / map names", async () => {
    const up = makeClient((call) => {
      if (call.route === "/api/version") return json({ version: "0.40.9" });
      if (call.route === "/api/tags")
        return json({ models: [{ name: "a:1" }, { name: "b:2" }] });
      return json({ models: [{ name: "b:2" }] });
    });
    assert.deepEqual(await up.client.probe(), { running: true, version: "0.40.9" });
    assert.deepEqual(await up.client.listInstalled(), ["a:1", "b:2"]);
    assert.deepEqual(await up.client.listLoaded(), ["b:2"]);

    const down = makeClient(() => {
      throw new TypeError("fetch failed");
    });
    assert.deepEqual(await down.client.probe(), { running: false });
  });
});
