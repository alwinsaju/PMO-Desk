// Run with `pnpm test`. The two-lane model queue: interactive calls are served
// before waiting background ones, never pre-empt the running call, and stay FIFO
// inside each lane. Fake jobs and a fake fetch only; no Ollama.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_AI_RUNTIME_CONFIG, FifoQueue, createOllamaClient } from "./core.ts";
import { RingLog } from "./log.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A job that records its start and finishes when `release()` is called. */
function gated(order, name) {
  let release;
  const job = () => {
    order.push(name);
    return new Promise((resolve) => (release = () => resolve(name)));
  };
  return { job, release: () => release() };
}

describe("FifoQueue priority lanes", () => {
  it("serves an interactive job that arrives behind 3 queued background jobs next, but never pre-empts the running one", async () => {
    const queue = new FifoQueue();
    const order = [];
    const running = gated(order, "running");
    const jobs = [
      queue.enqueue(running.job),
      ...["bg1", "bg2", "bg3"].map((name) =>
        queue.enqueue(async () => void order.push(name)),
      ),
    ];
    await tick();
    jobs.push(
      queue.enqueue(async () => void order.push("chat"), { priority: "interactive" }),
    );
    await tick();
    assert.deepEqual(order, ["running"], "the running call is not pre-empted");

    running.release();
    await Promise.all(jobs);
    assert.deepEqual(order, ["running", "chat", "bg1", "bg2", "bg3"]);
  });

  it("is first-in-first-out inside each lane", async () => {
    const queue = new FifoQueue();
    const order = [];
    const running = gated(order, "running");
    const all = [queue.enqueue(running.job)];
    await tick();
    for (const [name, priority] of [
      ["bg1", "background"],
      ["i1", "interactive"],
      ["bg2", undefined],
      ["i2", "interactive"],
      ["i3", "interactive"],
      ["bg3", "background"],
    ]) {
      all.push(queue.enqueue(async () => void order.push(name), { priority }));
    }
    running.release();
    await Promise.all(all);
    assert.deepEqual(order, ["running", "i1", "i2", "i3", "bg1", "bg2", "bg3"]);
  });

  it("untagged calls are background", async () => {
    const queue = new FifoQueue();
    const order = [];
    const running = gated(order, "running");
    const all = [queue.enqueue(running.job)];
    await tick();
    all.push(queue.enqueue(async () => void order.push("plain")));
    all.push(
      queue.enqueue(async () => void order.push("chat"), { priority: "interactive" }),
    );
    running.release();
    await Promise.all(all);
    assert.deepEqual(order, ["running", "chat", "plain"]);
  });

  it("counts the jobs ahead of a waiting job (the running one included)", async () => {
    const queue = new FifoQueue();
    const order = [];
    const running = gated(order, "running");
    const all = [queue.enqueue(running.job, { tag: "structure" })];
    await tick();
    assert.equal(queue.aheadOf(["structure"]), null, "a running job is not waiting");

    all.push(queue.enqueue(async () => {}, { tag: "other" }));
    all.push(queue.enqueue(async () => {}, { tag: "update" }));
    assert.equal(queue.aheadOf(["update"]), 2);
    assert.equal(queue.aheadOf(["structure", "update"]), 2);
    assert.equal(queue.aheadOfNew("background"), 3);
    assert.equal(queue.aheadOfNew("interactive"), 1);

    all.push(queue.enqueue(async () => {}, { priority: "interactive", tag: "chaser" }));
    all.push(queue.enqueue(async () => {}, { priority: "interactive", tag: "report" }));
    assert.equal(queue.aheadOf(["update"]), 4, "interactive jobs now jump ahead of it");
    assert.equal(queue.aheadOf(["chaser"]), 1);
    assert.equal(queue.aheadOf(["report"]), 2);
    assert.equal(queue.aheadOf(["nothing"]), null);
    assert.equal(queue.interactiveWaiting, 2);
    assert.equal(queue.waiting, 4);

    running.release();
    await Promise.all(all);
    assert.equal(queue.aheadOf(["update"]), null);
    assert.equal(queue.aheadOfNew(), 0);
  });

  it("rejectWaiting drops both lanes but not the running job", async () => {
    const queue = new FifoQueue();
    const order = [];
    const running = gated(order, "running");
    const first = queue.enqueue(running.job);
    const bg = queue.enqueue(async () => "bg");
    const fg = queue.enqueue(async () => "fg", { priority: "interactive" });
    await tick();
    assert.equal(queue.rejectWaiting(new Error("shutdown")), 2);
    await assert.rejects(bg, /shutdown/);
    await assert.rejects(fg, /shutdown/);
    running.release();
    assert.equal(await first, "running");
  });
});

describe("generate calls and priority", () => {
  const reply = (content) =>
    new Response(JSON.stringify({ message: { role: "assistant", content } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  function setup() {
    const log = new RingLog(1000);
    const started = [];
    const gates = [];
    const client = createOllamaClient({
      config: DEFAULT_AI_RUNTIME_CONFIG,
      queue: new FifoQueue(),
      log,
      fetch: async (_url, init) => {
        const body = JSON.parse(init.body);
        started.push(body.messages.at(-1).content);
        await new Promise((resolve) => gates.push(resolve));
        return reply("ok");
      },
    });
    return { client, log, started, gates };
  }

  it("a chaser draft jumps 3 queued structuring calls but waits for the running one", async () => {
    const { client, log, started, gates } = setup();
    const call = (prompt, priority, task) =>
      client.generateText({ prompt, priority, log: { task, label: prompt } });
    const all = [call("running", undefined, "structure")];
    await tick();
    for (const name of ["s1", "s2", "s3"]) all.push(call(name, undefined, "structure"));
    all.push(call("chaser", "interactive", "chaser"));
    await tick();
    assert.deepEqual(started, ["running"]);

    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      gates.shift()?.();
    }
    await Promise.all(all);
    assert.deepEqual(started, ["running", "chaser", "s1", "s2", "s3"]);

    const queued = log.all().filter((e) => e.kind === "call-queued");
    assert.deepEqual(
      queued.map((e) => [e.label, e.position]),
      [
        ["s1", 1],
        ["s2", 2],
        ["s3", 3],
        ["chaser", 1],
      ],
      "an interactive call's position ignores the background jobs it will jump",
    );
  });
});
