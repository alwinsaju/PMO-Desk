// Run with `pnpm test`. What the Ollama client writes to the session log for
// each call, against a fake fetch. The privacy rule is checked here by value
// (a secret in the prompt / reply never shows up in any event) and, for the code,
// by logPrivacy.test.mjs.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { waitFor } from "../testUtils.mjs";
import {
  AiRuntimeError,
  DEFAULT_AI_RUNTIME_CONFIG,
  FifoQueue,
  chatStats,
  createOllamaClient,
  logMessage,
  normalizeKeepAlive,
  pickKeepAlive,
} from "./core.ts";
import { RingLog } from "./log.ts";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const schema = z.object({ title: z.string().min(1), items: z.array(z.string()) });
const STATS = {
  prompt_eval_count: 1432,
  eval_count: 210,
  eval_duration: 25e9,
  load_duration: 19e9,
};

function setup(handler, extra = {}) {
  const log = new RingLog(1000);
  const calls = [];
  const client = createOllamaClient({
    config: DEFAULT_AI_RUNTIME_CONFIG,
    queue: new FifoQueue(),
    log,
    fetch: async (url, init) => {
      const call = {
        route: new URL(url).pathname,
        body: init?.body ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      return handler(call);
    },
    ...extra,
  });
  return { client, log, calls };
}
const reply = (content, extra = {}) =>
  json({ message: { role: "assistant", content }, ...extra });
const kinds = (log) => log.all().map((e) => e.kind);

describe("what a call logs", () => {
  it("start and end with the task, label, model, keep_alive, think, tokens and tokens/s", async () => {
    const { client, log } = setup(() =>
      reply('{"title":"T","items":["a","b","c"]}', STATS),
    );
    const result = await client.generateJson({
      prompt: "x",
      schema,
      think: false,
      log: {
        task: "structure",
        label: "Cutover checklist",
        note: (r) => `${r.items.length} action items found`,
      },
    });
    assert.equal(result.items.length, 3);
    const [start, end] = log.all();
    assert.equal(start.kind, "call-start");
    assert.deepEqual(
      [start.call, start.task, start.label, start.model, start.keepAlive, start.think],
      ["c1", "structure", "Cutover checklist", "gemma4:12b", "2m", false],
    );
    assert.equal(end.kind, "call-end");
    assert.equal(end.ok, true);
    assert.equal(end.call, "c1");
    assert.equal(end.attempts, 1);
    assert.equal(end.promptTokens, 1432);
    assert.equal(end.evalTokens, 210);
    assert.equal(end.tokensPerSecond, 8.4);
    assert.equal(end.loadMs, 19000);
    assert.equal(end.note, "3 action items found");
    assert.ok(end.durationMs >= 0);
  });

  it("uses a generic task when the caller says nothing, and omits counters Ollama did not send", async () => {
    const { client, log } = setup(() => reply('{"title":"T","items":[]}'));
    await client.generateJson({ prompt: "x", schema });
    await client.generateText({ prompt: "x" });
    const starts = log.all().filter((e) => e.kind === "call-start");
    assert.deepEqual(
      starts.map((e) => e.task),
      ["json", "text"],
    );
    const end = log.all().find((e) => e.kind === "call-end");
    assert.equal("promptTokens" in end, false);
    assert.equal("tokensPerSecond" in end, false);
    assert.equal(starts[0].think, undefined);
  });

  it("logs the repair round-trip, with both attempts summed", async () => {
    const replies = ["not json at all", '{"title":"T","items":[]}'];
    const { client, log, calls } = setup(() => reply(replies.shift(), STATS));
    await client.generateJson({
      prompt: "x",
      schema,
      log: { task: "update", label: "Re: scope" },
    });
    assert.equal(calls.length, 2);
    assert.deepEqual(kinds(log), ["call-start", "call-retry", "call-end"]);
    const [, retry, end] = log.all();
    assert.deepEqual(
      [retry.call, retry.attempt, retry.reason],
      ["c1", 2, "invalid-json"],
    );
    assert.equal(retry.level, "warn");
    assert.equal(end.attempts, 2);
    assert.equal(end.promptTokens, 2864);
    assert.equal(end.evalTokens, 420);
  });

  it("tells a schema miss and a cut-off reply apart", async () => {
    const miss = setup(() => reply('{"title":"","items":[]}'));
    await assert.rejects(miss.client.generateJson({ prompt: "x", schema }));
    assert.equal(
      miss.log.all().find((e) => e.kind === "call-retry").reason,
      "invalid-schema",
    );

    const cut = setup(() => reply('{"title":"cut o', { done_reason: "length" }));
    await assert.rejects(cut.client.generateJson({ prompt: "x", schema }));
    assert.equal(cut.log.all().find((e) => e.kind === "call-retry").reason, "cut-off");
  });

  it("logs a failure with its code, and never the model's own text", async () => {
    const SECRET = "SECRET-REPLY-TEXT-9d1f";
    const { client, log } = setup(() => reply(`{"title":"${SECRET}"}`));
    await assert.rejects(
      client.generateJson({
        prompt: "PROMPT-SECRET-77",
        schema,
        log: { task: "structure" },
      }),
      (error) => error.code === "invalid-output" && error.raw.includes(SECRET),
    );
    const end = log.all().find((e) => e.kind === "call-end");
    assert.equal(end.ok, false);
    assert.equal(end.errorCode, "invalid-output");
    assert.equal(end.level, "warn");
    assert.equal(end.attempts, 2);
    assert.match(end.message, /did not pass validation \(\d+ problems?\)/);
    const dump = JSON.stringify(log.all());
    assert.equal(dump.includes(SECRET), false);
    assert.equal(dump.includes("PROMPT-SECRET-77"), false);
  });

  it("maps runtime failures to error events (ensure failing still logs start and end)", async () => {
    const { client, log } = setup(() => assert.fail("must not be called"), {
      ensure: async () => {
        throw new AiRuntimeError("runtime-down", "Ollama is not running.");
      },
    });
    await assert.rejects(
      client.generateText({ prompt: "x", log: { task: "chaser", label: "L" } }),
    );
    assert.deepEqual(kinds(log), ["call-start", "call-end"]);
    const end = log.all()[1];
    assert.deepEqual(
      [end.ok, end.errorCode, end.level, end.message],
      [false, "runtime-down", "error", "Ollama is not running."],
    );
    assert.equal(log.activeCalls().length, 0);
  });

  it("marks a call as queued when something is ahead, with the depth", async () => {
    let release;
    const { client, log } = setup(
      () =>
        new Promise((resolve) => {
          release = () => resolve(reply("ok"));
        }),
    );
    const first = client.generateText({
      prompt: "1",
      log: { task: "chaser", label: "A" },
    });
    const second = client.generateText({
      prompt: "2",
      log: { task: "structure", label: "B" },
    });
    const third = client.generateText({
      prompt: "3",
      log: { task: "structure", label: "C" },
    });
    await waitFor(
      () =>
        log.all().filter((e) => e.kind === "call-queued").length >= 2 &&
        log.activeCalls().length === 1,
    );
    const queued = log.all().filter((e) => e.kind === "call-queued");
    assert.deepEqual(
      queued.map((e) => [e.label, e.position, e.waiting]),
      [
        ["B", 1, 1],
        ["C", 2, 2],
      ],
    );
    assert.equal(log.activeCalls().length, 1);
    for (let i = 0; i < 3; i++) {
      await waitFor(() => release);
      const done = release;
      release = undefined;
      done();
    }
    await Promise.all([first, second, third]);
    assert.equal(log.activeCalls().length, 0);
    // Starts happen strictly in arrival order, with what is still waiting.
    assert.deepEqual(
      log
        .all()
        .filter((e) => e.kind === "call-start")
        .map((e) => [e.label, e.queueWaiting]),
      [
        ["A", 2],
        ["B", 1],
        ["C", 0],
      ],
    );
  });

  it("a summarizer that throws never fails the call", async () => {
    const { client, log } = setup(() => reply('{"title":"T","items":[]}'));
    await client.generateJson({
      prompt: "x",
      schema,
      log: {
        task: "structure",
        note: () => {
          throw new Error("bad summarizer");
        },
      },
    });
    assert.equal(log.all().at(-1).ok, true);
    assert.equal("note" in log.all().at(-1), false);
  });

  it("a client without a log works exactly as before", async () => {
    const calls = [];
    const client = createOllamaClient({
      config: DEFAULT_AI_RUNTIME_CONFIG,
      queue: new FifoQueue(),
      fetch: async (_url, init) => (calls.push(JSON.parse(init.body)), reply("hi")),
    });
    assert.equal(
      await client.generateText({ prompt: "x", log: { task: "chaser" } }),
      "hi",
    );
    assert.equal(calls[0].keep_alive, "2m");
  });

  it("runs the observe and afterCall hooks around every call", async () => {
    const order = [];
    const { client, log } = setup(() => (order.push("fetch"), reply("ok")), {
      observe: async (model) => (order.push(`observe ${model}`), false),
      afterCall: () => order.push("after"),
    });
    await client.generateText({ prompt: "x" });
    assert.deepEqual(order, ["observe gemma4:12b", "fetch", "after"]);
    assert.equal(log.all()[0].modelLoaded, false);
  });
});

describe("helpers", () => {
  it("chatStats reads the counters of an Ollama reply (for the command route)", () => {
    assert.deepEqual(chatStats(STATS), {
      promptTokens: 1432,
      evalTokens: 210,
      tokensPerSecond: 8.4,
      loadMs: 19000,
    });
    assert.deepEqual(chatStats(null), {});
    assert.deepEqual(chatStats({ eval_count: "x", load_duration: -5 }), {});
  });

  it("logMessage keeps our wording and hides a model reply", () => {
    const invalid = new AiRuntimeError("invalid-output", "…SECRET…", {
      raw: "SECRET",
      issues: ["a: SECRET", "b: SECRET"],
    });
    assert.deepEqual(logMessage(invalid), {
      code: "invalid-output",
      message: "The model's answer did not pass validation (2 problems).",
    });
    assert.deepEqual(logMessage(new AiRuntimeError("timeout", "No answer.")), {
      code: "timeout",
      message: "No answer.",
    });
    assert.equal(logMessage(new Error("plain")).code, "error");
  });

  it("normalizeKeepAlive accepts what Ollama accepts and nothing else", () => {
    for (const ok of ["2m", "30s", "1h", "1h30m", "500ms", "0", "-1", "90"]) {
      assert.equal(normalizeKeepAlive(ok, "2m"), ok);
    }
    for (const bad of ["", "   ", "two minutes", "5 min", "m", "2x", undefined]) {
      assert.equal(normalizeKeepAlive(bad, "2m"), "2m");
    }
  });

  it("pickKeepAlive follows ownership", () => {
    const config = {
      ...DEFAULT_AI_RUNTIME_CONFIG,
      keepAlive: "3m",
      externalKeepAlive: "1m",
    };
    assert.equal(pickKeepAlive(config, true), "3m");
    assert.equal(pickKeepAlive(config, false), "1m");
  });
});
