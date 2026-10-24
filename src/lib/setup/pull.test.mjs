// Run with `pnpm test`. The model download against a FAKE Ollama: no network,
// no model, no waiting (sleep and the clock are injected).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PullTracker, parsePullLine, pullModel } from "./pull.ts";

const ndjson = (events) => events.map((e) => JSON.stringify(e)).join("\n") + "\n";

/** A fetch whose body arrives in the given chunks (strings), then ends. */
function streamResponse(chunks, { status = 200, failAfter = false } = {}) {
  const encoder = new TextEncoder();
  let i = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]));
      } else if (failAfter) {
        controller.error(new Error("socket hang up"));
      } else {
        controller.close();
      }
    },
  });
  return new Response(body, { status });
}

const LAYER = "sha256:aaa";
const SUCCESS = [
  { status: "pulling manifest" },
  { status: `pulling ${LAYER}`, digest: LAYER, total: 1000, completed: 0 },
  { status: `pulling ${LAYER}`, digest: LAYER, total: 1000, completed: 500 },
  { status: `pulling ${LAYER}`, digest: LAYER, total: 1000, completed: 1000 },
  { status: "verifying sha256 digest" },
  { status: "writing manifest" },
  { status: "success" },
];

function run(overrides = {}) {
  const progress = [];
  const sleeps = [];
  let clock = 0;
  const deps = {
    baseUrl: "http://127.0.0.1:11434",
    model: "gemma4:12b",
    ensureServer: async () => true,
    onProgress: (p) => progress.push(p),
    sleep: async (ms) => sleeps.push(ms),
    now: () => (clock += 500),
    ...overrides,
  };
  return { progress, sleeps, result: pullModel(deps) };
}

describe("parsePullLine", () => {
  it("reads one JSON object per line and ignores blanks and junk", () => {
    assert.deepEqual(parsePullLine('{"status":"success"}'), { status: "success" });
    assert.equal(parsePullLine("   "), null);
    assert.equal(parsePullLine("not json"), null);
    assert.equal(parsePullLine("[1]"), null);
  });
});

describe("PullTracker", () => {
  it("sums layers, caps at 100 and reports a speed and an ETA", () => {
    let t = 0;
    const tracker = new PullTracker("m", () => (t += 1000));
    tracker.update({ status: "pulling a", digest: "a", total: 1000, completed: 0 });
    const p = tracker.update({
      status: "pulling a",
      digest: "a",
      total: 1000,
      completed: 250,
    });
    assert.equal(p.phase, "downloading");
    assert.equal(p.percent, 25);
    assert.ok(p.bytesPerSecond > 0);
    assert.ok(p.etaSeconds > 0);
    tracker.update({ status: "pulling b", digest: "b", total: 1000, completed: 1000 });
    assert.equal(tracker.snapshot().totalBytes, 2000);
    assert.ok(tracker.snapshot().percent <= 100);
  });

  it("maps the closing statuses to plain phases", () => {
    const tracker = new PullTracker("m", () => 0);
    assert.equal(
      tracker.update({ status: "verifying sha256 digest" }).phase,
      "verifying",
    );
    assert.equal(tracker.update({ status: "success" }).phase, "done");
    assert.equal(tracker.snapshot().percent, 100);
  });
});

describe("pullModel", () => {
  it("streams progress from the first byte to done", async () => {
    const { progress, result } = run({
      fetchImpl: async (url, init) => {
        assert.equal(url, "http://127.0.0.1:11434/api/pull");
        assert.deepEqual(JSON.parse(init.body), { model: "gemma4:12b", stream: true });
        return streamResponse([ndjson(SUCCESS)]);
      },
    });
    assert.deepEqual(await result, { ok: true });
    const phases = progress.map((p) => p.phase);
    assert.ok(phases.includes("downloading") && phases.includes("verifying"));
    assert.equal(phases.at(-1), "done");
    assert.equal(progress.at(-1).percent, 100);
  });

  it("copes with lines split across chunks", async () => {
    const text = ndjson(SUCCESS);
    const { result, progress } = run({
      fetchImpl: async () =>
        streamResponse([text.slice(0, 25), text.slice(25, 90), text.slice(90)]),
    });
    assert.deepEqual(await result, { ok: true });
    assert.equal(progress.at(-1).phase, "done");
  });

  it("starts Ollama first and stops with a plain message if it cannot", async () => {
    let fetched = false;
    const { result, progress } = run({
      ensureServer: async () => false,
      fetchImpl: async () => {
        fetched = true;
        return streamResponse([]);
      },
    });
    const outcome = await result;
    assert.equal(outcome.ok, false);
    assert.match(outcome.message, /could not be started/);
    assert.equal(fetched, false);
    assert.equal(progress.at(-1).phase, "error");
  });

  it("retries a dropped download, resuming by asking again, and says so", async () => {
    let calls = 0;
    const { result, progress, sleeps } = run({
      fetchImpl: async () => {
        calls += 1;
        return calls < 3
          ? streamResponse([ndjson(SUCCESS.slice(0, 3))], { failAfter: true })
          : streamResponse([ndjson(SUCCESS)]);
      },
    });
    assert.deepEqual(await result, { ok: true });
    assert.equal(calls, 3);
    assert.deepEqual(sleeps, [2000, 5000]);
    const retry = progress.find((p) => p.attempt === 2 && p.phase === "preparing");
    assert.match(retry.message, /Trying again in 2 seconds/);
    assert.equal(progress.at(-1).attempt, 3);
  });

  it("retries when the connection cannot be made, then gives up after the attempts", async () => {
    let calls = 0;
    const { result, sleeps } = run({
      maxAttempts: 3,
      fetchImpl: async () => {
        calls += 1;
        throw new TypeError("fetch failed");
      },
    });
    const outcome = await result;
    assert.equal(outcome.ok, false);
    assert.equal(outcome.cancelled, false);
    assert.equal(calls, 3);
    assert.equal(sleeps.length, 2);
  });

  it("does not retry an error that retrying cannot fix", async () => {
    let calls = 0;
    const { result } = run({
      fetchImpl: async () => {
        calls += 1;
        return streamResponse([
          ndjson([{ error: "pull model manifest: file does not exist" }]),
        ]);
      },
    });
    const outcome = await result;
    assert.equal(calls, 1);
    assert.equal(outcome.ok, false);
    assert.match(outcome.message, /does not have that model/);
  });

  it("reports a full disk in plain words", async () => {
    const { result } = run({
      fetchImpl: async () =>
        streamResponse([ndjson([{ error: "write: no space left on device" }])]),
    });
    assert.match((await result).message, /Free up space/);
  });

  it("treats a stream that ends without success as an interruption and retries", async () => {
    let calls = 0;
    const { result } = run({
      fetchImpl: async () => {
        calls += 1;
        return calls === 1
          ? streamResponse([ndjson(SUCCESS.slice(0, 3))])
          : streamResponse([ndjson(SUCCESS)]);
      },
    });
    assert.deepEqual(await result, { ok: true });
    assert.equal(calls, 2);
  });

  it("can be cancelled, and keeps partial files for the next try", async () => {
    const controller = new AbortController();
    const { result, progress } = run({
      signal: controller.signal,
      fetchImpl: async () => {
        controller.abort();
        throw new DOMException("aborted", "AbortError");
      },
    });
    const outcome = await result;
    assert.deepEqual(outcome, { ok: false, cancelled: true, message: "cancelled" });
    assert.equal(progress.at(-1).phase, "cancelled");
    assert.match(progress.at(-1).message, /resumes next time/);
  });

  it("reports a refusal from the service", async () => {
    const { result } = run({
      maxAttempts: 1,
      fetchImpl: async () => new Response("model is busy", { status: 500 }),
    });
    const outcome = await result;
    assert.equal(outcome.ok, false);
    assert.match(outcome.message, /model is busy/);
  });
});
