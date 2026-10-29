// Run with `pnpm test`. The plain-English and raw views of the session log, and
// the model-state words, all derived from the same events.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MEMORY_SIZE, formatBytes } from "../format.ts";
import { RingLog } from "./log.ts";
import {
  aboutBytes,
  buildPlainTimeline,
  describeTask,
  filterEvents,
  filterLines,
  formatClock,
  formatDuration,
  formatKeepAlive,
  formatRawLine,
  modelChipOf,
  modelStateOf,
  plainToText,
  taskNoun,
  unloadCountdown,
  usableExpiry,
} from "./logView.ts";

const GB = 1024 ** 3;
const T0 = Date.parse("2026-10-24T19:31:00Z");

/** A log whose clock the test moves by hand. */
function logAt() {
  const clock = { now: T0 };
  const log = new RingLog(1000, () => clock.now);
  return { log, clock };
}
const lines = (log) => buildPlainTimeline(log.all()).map((e) => e.text);

const callStart = (call, extra = {}) => ({
  kind: "call-start",
  call,
  task: "structure",
  label: "Cutover checklist",
  model: "gemma4:12b",
  keepAlive: "2m",
  think: false,
  modelLoaded: true,
  queueWaiting: 0,
  ...extra,
});
const callEnd = (call, extra = {}) => ({
  kind: "call-end",
  call,
  task: "structure",
  label: "Cutover checklist",
  model: "gemma4:12b",
  ok: true,
  durationMs: 52_000,
  attempts: 1,
  ...extra,
});

describe("plain English timeline", () => {
  it("merges a waking call into 'Waking the model... ready in 19 s' and 'done in 33 s (3 action items found)'", () => {
    const { log, clock } = logAt();
    log.emit(callStart("c1", { modelLoaded: false }));
    // While it runs: both lines are pending.
    let timeline = buildPlainTimeline(log.all());
    assert.deepEqual(
      timeline.map((e) => [e.text, e.pending]),
      [
        ["Waking the model (loading gemma4:12b into memory)…", true],
        ['Reading a message "Cutover checklist" to propose a to-do…', true],
      ],
    );
    clock.now += 52_000;
    log.emit(callEnd("c1", { loadMs: 19_000, note: "3 action items found" }));
    timeline = buildPlainTimeline(log.all());
    assert.deepEqual(
      timeline.map((e) => [e.text, e.pending, e.tone]),
      [
        [
          "Waking the model (loading gemma4:12b into memory)… ready in 19 s.",
          false,
          "good",
        ],
        [
          'Reading a message "Cutover checklist" to propose a to-do… done in 33 s (3 action items found).',
          false,
          "good",
        ],
      ],
    );
    // One line per call: the keys do not change between start and end.
    assert.deepEqual(
      timeline.map((e) => e.key),
      ["c1:wake", "c1"],
    );
  });

  it("a call on a loaded model has no wake line", () => {
    const { log } = logAt();
    log.emit(callStart("c1"));
    log.emit(callEnd("c1", { loadMs: 5 }));
    assert.deepEqual(lines(log), [
      'Reading a message "Cutover checklist" to propose a to-do… done in 52 s.',
    ]);
  });

  it("works out a wake from load_duration when the model state was unknown", () => {
    const { log } = logAt();
    log.emit(callStart("c1", { modelLoaded: null }));
    log.emit(callEnd("c1", { loadMs: 12_000 }));
    assert.match(lines(log)[0], /^Waking the model .* ready in 12 s\.$/);
  });

  it("words a retry, in the order it happened", () => {
    const { log } = logAt();
    log.emit(callStart("c1"));
    log.emit({ kind: "call-retry", call: "c1", attempt: 2, reason: "invalid-json" });
    log.emit(callEnd("c1", { attempts: 2, durationMs: 90_000 }));
    assert.deepEqual(lines(log), [
      'Reading a message "Cutover checklist" to propose a to-do… done in 1 min 30 s.',
      'Retrying "Cutover checklist": the model\'s answer was not valid JSON, asked it to fix it.',
    ]);
    const { log: other } = logAt();
    other.emit(callStart("c1"));
    other.emit({ kind: "call-retry", call: "c1", attempt: 2, reason: "invalid-schema" });
    other.emit({ kind: "call-retry", call: "c2", attempt: 2, reason: "cut-off" });
    assert.match(lines(other)[1], /did not match the expected format/);
    assert.match(lines(other)[2], /^Retrying: the model's answer was cut off/);
  });

  it("explains each way a call fails, with the right tone", () => {
    const cases = [
      ["timeout", "the model did not answer in time", "warn"],
      ["runtime-down", "Ollama could not be reached", "bad"],
      ["model-missing", "the model is not installed", "bad"],
      ["invalid-output", "the model's answer was not valid, even after a retry", "warn"],
    ];
    for (const [errorCode, why, tone] of cases) {
      const { log } = logAt();
      log.emit(callStart("c1"));
      log.emit(callEnd("c1", { ok: false, errorCode, loadMs: 3000, durationMs: 4000 }));
      const [entry] = buildPlainTimeline(log.all()).slice(-1);
      assert.equal(
        entry.text,
        `Reading a message "Cutover checklist" to propose a to-do… failed after 4.0 s: ${why}.`,
      );
      assert.equal(entry.tone, tone);
    }
  });

  it("a wake that never finished says so", () => {
    const { log } = logAt();
    log.emit(callStart("c1", { modelLoaded: false }));
    log.emit(callEnd("c1", { ok: false, errorCode: "timeout", durationMs: 280_000 }));
    assert.deepEqual(
      lines(log)[0],
      "Waking the model (loading gemma4:12b into memory)… did not finish: the model did not answer in time.",
    );
  });

  it("describes load, pre-load and the already-loaded case", () => {
    const { log } = logAt();
    log.emit(callStart("c1", { task: "load", label: "Load now", modelLoaded: false }));
    log.emit(callEnd("c1", { task: "load", durationMs: 19_000 }));
    log.emit(callStart("c2", { task: "load", modelLoaded: true }));
    log.emit(callEnd("c2", { task: "load", durationMs: 1_200 }));
    log.emit(callStart("c3", { task: "prewarm", modelLoaded: false }));
    assert.deepEqual(lines(log), [
      "Waking the model on request (loading gemma4:12b into memory)… ready in 19 s.",
      "The model is already loaded; it is ready (checked in 1.2 s).",
      "Pre-loading the model at start-up (loading gemma4:12b into memory)…",
    ]);
  });

  it("words queueing with the queue depth", () => {
    const { log } = logAt();
    log.emit({
      kind: "call-queued",
      call: "c2",
      task: "structure",
      label: "Budget",
      position: 1,
      waiting: 1,
    });
    log.emit({
      kind: "call-queued",
      call: "c3",
      task: "chaser",
      label: "Send the deck",
      position: 2,
      waiting: 2,
    });
    assert.deepEqual(lines(log), [
      'Queued: Reading a message "Budget" to propose a to-do. 1 message waiting.',
      'Queued: Drafting a chaser for "Send the deck". 2 requests waiting.',
    ]);
  });

  it("words the model sleeping, in every way it can go", () => {
    const { log } = logAt();
    const gone = (extra) =>
      log.emit({
        kind: "model-unloaded",
        model: "gemma4:12b",
        ours: true,
        sizeBytes: 8 * GB,
        reason: "idle",
        ...extra,
      });
    gone({ idleMs: 120_000 });
    gone({});
    gone({ reason: "manual" });
    gone({ reason: "shutdown" });
    gone({ reason: "other" });
    gone({ ours: false, model: "llama3.2:latest" });
    assert.deepEqual(lines(log), [
      "Model went to sleep after 2 min idle, memory freed (about 8 GB).",
      "Model went to sleep after sitting idle, memory freed (about 8 GB).",
      "Model unloaded on request, memory freed (about 8 GB).",
      "Model unloaded because AI OS is closing, memory freed (about 8 GB).",
      "Model is no longer in memory (about 8 GB freed).",
      "llama3.2:latest (loaded by another program) left memory.",
    ]);
  });

  it("words loads a call did not cause, and hides the ones that have their own line", () => {
    const { log } = logAt();
    const loaded = (extra) =>
      log.emit({
        kind: "model-loaded",
        model: "gemma4:12b",
        ours: true,
        sizeBytes: 8 * GB,
        cause: "other",
        ...extra,
      });
    loaded({ cause: "call" });
    loaded({ cause: "manual" });
    loaded({ cause: "already" });
    loaded({ ours: false, model: "llama3.2:latest" });
    assert.deepEqual(lines(log), [
      "The model gemma4:12b was already in memory (about 8 GB).",
      "Another program loaded llama3.2:latest into Ollama (about 8 GB). AI OS does not manage it.",
    ]);
  });

  it("words the server's life", () => {
    const { log } = logAt();
    const base = { baseUrl: "http://127.0.0.1:11434" };
    log.emit({
      kind: "server-up",
      how: "started",
      owned: true,
      version: "0.40.9",
      ...base,
    });
    log.emit({ kind: "server-up", how: "reused", owned: false, ...base });
    log.emit({ kind: "server-up", how: "adopted", owned: true, ...base });
    log.emit({
      kind: "server-down",
      message: "Ollama is not answering at http://x.",
      willRetry: true,
    });
    log.emit({ kind: "server-down", message: "It is off.", willRetry: false });
    log.emit({ kind: "server-stop", owned: true, stopped: true });
    log.emit({ kind: "server-stop", owned: false, stopped: false });
    log.emit({ kind: "prewarm-skipped", reason: "disabled" });
    log.emit({ kind: "unload-request", model: "gemma4:12b", by: "user", keepAlive: 0 });
    log.emit({
      kind: "unload-request",
      model: "gemma4:12b",
      by: "shutdown",
      keepAlive: 0,
    });
    assert.deepEqual(lines(log), [
      "Started Ollama 0.40.9. AI OS owns it and stops it when you quit.",
      "Connected to an Ollama that was already running. AI OS will not stop it.",
      "Took over an Ollama that an earlier AI OS session left running. AI OS stops it when you quit.",
      "Could not reach Ollama, will retry. Ollama is not answering at http://x.",
      "Ollama is not available. It is off.",
      "AI OS closed and stopped the Ollama it started.",
      "AI OS closed; the shared Ollama was left running.",
      "The model is not loaded at start-up: it wakes when something needs it, which saves memory.",
      "Asked Ollama to unload the model now.",
      "Unloading the model before Ollama stops.",
    ]);
  });

  it("covers every event kind (a new kind must be worded or consciously hidden)", () => {
    // The kinds buildPlainTimeline handles; keep in step with log.ts's AiLogBody.
    const { log } = logAt();
    const bodies = [
      { kind: "server-up", how: "started", owned: true, baseUrl: "x" },
      { kind: "server-down", message: "m", willRetry: true },
      { kind: "server-stop", owned: true, stopped: true },
      { kind: "prewarm-skipped", reason: "disabled" },
      { kind: "model-loaded", model: "m", ours: true, sizeBytes: 1, cause: "already" },
      { kind: "model-unloaded", model: "m", ours: true, sizeBytes: 1, reason: "idle" },
      { kind: "unload-request", model: "m", by: "user", keepAlive: 0 },
      { kind: "call-queued", call: "c1", task: "chaser", position: 1, waiting: 1 },
      callStart("c2"),
      { kind: "call-retry", call: "c2", attempt: 2, reason: "cut-off" },
      callEnd("c2"),
    ];
    for (const body of bodies) log.emit(body);
    const timeline = buildPlainTimeline(log.all());
    assert.equal(timeline.length, bodies.length - 1, "start+end share a line");
    for (const entry of timeline) assert.ok(entry.text.length > 5);
  });

  it("orders by sequence and gives a stable key per entry", () => {
    const { log } = logAt();
    log.emit(callStart("c1"));
    log.emit({ kind: "prewarm-skipped", reason: "disabled" });
    log.emit(callEnd("c1"));
    const a = buildPlainTimeline(log.all());
    log.emit({ kind: "prewarm-skipped", reason: "disabled" });
    const b = buildPlainTimeline(log.all());
    assert.deepEqual(
      a.map((e) => e.key),
      b.slice(0, 2).map((e) => e.key),
    );
    assert.deepEqual(
      a.map((e) => e.seq),
      [...a.map((e) => e.seq)].sort((x, y) => x - y),
    );
  });

  it("still shows a call whose start has scrolled out of the buffer", () => {
    const { log } = logAt();
    log.emit(callEnd("c9", { note: "not a task" }));
    assert.equal(
      lines(log)[0],
      'Reading a message "Cutover checklist" to propose a to-do… done in 52 s (not a task).',
    );
  });

  it("plainToText prefixes each line with its clock time", () => {
    const { log } = logAt();
    log.emit({ kind: "prewarm-skipped", reason: "disabled" });
    assert.equal(
      plainToText(buildPlainTimeline(log.all()), "UTC"),
      "19:31  The model is not loaded at start-up: it wakes when something needs it, which saves memory.",
    );
  });

  it("words every task kind", () => {
    assert.equal(
      describeTask("update", "Re: scope"),
      'Reading a reply "Re: scope" to update a to-do',
    );
    assert.equal(
      describeTask("update-signoff", "Re: scope"),
      'Reading a reply "Re: scope" to check for a sign-off',
    );
    assert.equal(
      describeTask("signoff-request", "Go-live"),
      'Improving a sign-off request for "Go-live"',
    );
    assert.equal(
      describeTask("report", "2026-10-19 to 2026-10-25"),
      "Writing the report highlights for 2026-10-19 to 2026-10-25",
    );
    assert.equal(
      describeTask("command", "Notes"),
      "Answering a command-bar request (Notes)",
    );
    assert.equal(describeTask("something-new"), "Running a model request");
    assert.deepEqual(
      [
        "structure",
        "update",
        "update-signoff",
        "chaser",
        "signoff-request",
        "report",
        "command",
        "x",
      ].map(taskNoun),
      [
        "a message",
        "a reply",
        "a sign-off reply",
        "a chaser",
        "a sign-off request",
        "the report",
        "a command",
        "a request",
      ],
    );
  });
});

describe("raw lines", () => {
  it("prints timestamp, level, id, kind and the numbers (tokens, tokens/s, keep_alive, think, attempt)", () => {
    const { log } = logAt();
    log.emit(callStart("c1", { modelLoaded: false, queueWaiting: 2 }));
    log.emit({ kind: "call-retry", call: "c1", attempt: 2, reason: "invalid-json" });
    log.emit(
      callEnd("c1", {
        attempts: 2,
        promptTokens: 1432,
        evalTokens: 210,
        tokensPerSecond: 8.4,
        loadMs: 19_000,
        note: "3 action items found",
      }),
    );
    const [start, retry, end] = log.all().map(formatRawLine);
    assert.equal(
      start,
      '2026-10-24T19:31:00.000Z INFO  #1 call-start call=c1 task=structure label="Cutover checklist" model=gemma4:12b keep_alive=2m think=false model_loaded=false queue_waiting=2',
    );
    assert.equal(
      retry,
      "2026-10-24T19:31:00.000Z WARN  #2 call-retry call=c1 attempt=2 reason=invalid-json",
    );
    assert.equal(
      end,
      '2026-10-24T19:31:00.000Z INFO  #3 call-end call=c1 task=structure label="Cutover checklist" model=gemma4:12b ok=true attempts=2 duration_ms=52000 load_ms=19000 prompt_tokens=1432 eval_tokens=210 tokens_per_second=8.4 note="3 action items found"',
    );
  });

  it("prints queue position, error code and message", () => {
    const { log } = logAt();
    log.emit({
      kind: "call-queued",
      call: "c2",
      task: "structure",
      label: "Budget",
      position: 1,
      waiting: 2,
    });
    log.emit(
      callEnd("c2", { ok: false, errorCode: "timeout", message: "No answer in 280s." }),
    );
    const [queued, ended] = log.all().map(formatRawLine);
    assert.match(queued, /queue_position=1 queue_waiting=2/);
    assert.match(ended, /ERROR|WARN /);
    assert.match(ended, /error_code=timeout message="No answer in 280s\."/);
  });

  it("renders every kind without throwing", () => {
    const { log } = logAt();
    log.emit({
      kind: "server-up",
      how: "started",
      owned: true,
      baseUrl: "http://127.0.0.1:11434",
      version: "0.1",
    });
    log.emit({
      kind: "model-loaded",
      model: "m",
      ours: true,
      sizeBytes: 5,
      cause: "call",
      expiresAt: "2026-10-24T19:33:00Z",
    });
    log.emit({
      kind: "model-unloaded",
      model: "m",
      ours: true,
      sizeBytes: 5,
      reason: "idle",
      idleMs: 120000,
    });
    for (const line of log.all().map(formatRawLine))
      assert.match(line, /^\d{4}-\d\d-\d\dT.*Z (INFO |WARN |ERROR) #\d+ [a-z-]+/);
  });
});

describe("filters", () => {
  const { log } = logAt();
  log.emit(callStart("c1"));
  log.emit({ kind: "call-retry", call: "c1", attempt: 2, reason: "cut-off" });
  log.emit(
    callEnd("c1", { ok: false, errorCode: "runtime-down", message: "Ollama gone" }),
  );
  const events = log.all();

  it("level filter keeps that level and above", () => {
    assert.equal(filterEvents(events, { level: "all" }).length, 3);
    assert.deepEqual(
      filterEvents(events, { level: "warn" }).map((e) => e.kind),
      ["call-retry", "call-end"],
    );
    assert.deepEqual(
      filterEvents(events, { level: "error" }).map((e) => e.kind),
      ["call-end"],
    );
  });

  it("text filter matches the printed line, case-insensitively, and combines with level", () => {
    assert.equal(filterEvents(events, { text: "RUNTIME-DOWN" }).length, 1);
    assert.equal(filterEvents(events, { text: "cutover" }).length, 2);
    assert.equal(filterEvents(events, { text: "cutover", level: "error" }).length, 1);
    assert.equal(filterEvents(events, { text: "nothing like this" }).length, 0);
    assert.equal(filterEvents(events, { text: "  " }).length, 3);
    assert.deepEqual(filterLines(["A one", "b two", "C ONE"], "one"), ["A one", "C ONE"]);
    assert.deepEqual(filterLines(["x"], undefined), ["x"]);
  });
});

describe("small formatters", () => {
  it("formats durations, bytes, clock times and keep-alives", () => {
    assert.deepEqual(
      [0, 850, 3200, 19_000, 60_000, 72_000, 3_600_000].map(formatDuration),
      ["0 ms", "850 ms", "3.2 s", "19 s", "1 min", "1 min 12 s", "60 min"],
    );
    assert.equal(formatBytes(8.1 * GB, MEMORY_SIZE), "8.1 GB");
    assert.equal(formatBytes(420 * 1024 ** 2, MEMORY_SIZE), "420 MB");
    assert.equal(formatBytes(0, MEMORY_SIZE), "0 MB");
    assert.equal(aboutBytes(7.6 * GB), "about 8 GB");
    assert.equal(formatClock(T0, "UTC"), "19:31");
    assert.deepEqual(["2m", "30s", "1h", "1h30m", "-1"].map(formatKeepAlive), [
      "2 min",
      "30 s",
      "1 h",
      "1h30m",
      "-1",
    ]);
  });

  it("counts down to a deadline and ignores 'forever'", () => {
    assert.equal(unloadCountdown("2026-10-24T19:32:32Z", T0), "1:32");
    assert.equal(unloadCountdown("2026-10-24T19:31:05Z", T0), "0:05");
    assert.equal(unloadCountdown("2026-10-24T19:30:00Z", T0), null);
    assert.equal(unloadCountdown(null, T0), null);
    assert.equal(unloadCountdown("garbage", T0), null);
    assert.equal(usableExpiry("2318-01-01T00:00:00Z", T0), null);
    assert.equal(usableExpiry("2026-10-24T19:32:32Z", T0), "2026-10-24T19:32:32.000Z");
  });
});

describe("modelStateOf", () => {
  const status = (patch = {}) => ({
    running: true,
    ownedByUs: false,
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
  const inMemory = {
    modelLoaded: true,
    loaded: [
      {
        name: "gemma4:12b",
        sizeBytes: 8 * GB,
        sizeVramBytes: 0,
        expiresAt: "2026-10-24T19:33:00Z",
      },
    ],
  };
  const call = (task, modelLoadedBefore = true) => ({
    call: "c1",
    task,
    startedAt: T0,
    modelLoadedBefore,
  });

  it("asleep, ready, working, loading, down and missing", () => {
    assert.equal(modelStateOf(status(), T0).state, "asleep");
    const ready = modelStateOf(status(inMemory), T0);
    assert.deepEqual(
      [ready.state, ready.unloadsAt, ready.sizeBytes],
      ["ready", "2026-10-24T19:33:00.000Z", 8 * GB],
    );
    const working = modelStateOf(
      status({ ...inMemory, activeCalls: [call("chaser")] }),
      T0,
    );
    assert.deepEqual([working.state, working.task], ["working", "chaser"]);
    assert.equal(
      modelStateOf(status({ activeCalls: [call("structure", false)] }), T0).state,
      "loading",
    );
    assert.equal(
      modelStateOf(status({ ...inMemory, activeCalls: [call("load")] }), T0).state,
      "loading",
    );
    assert.equal(modelStateOf(status({ loadInFlight: true }), T0).state, "loading");
    assert.equal(modelStateOf(status({ running: false }), T0).state, "down");
    assert.equal(
      modelStateOf(status({ modelInstalled: false }), T0).state,
      "model-missing",
    );
    assert.equal(modelStateOf(status({ running: false, ...inMemory }), T0).sizeBytes, 0);
  });

  it("matches the model by its normalized name", () => {
    const s = status({
      defaultModel: "llama3.2",
      modelLoaded: true,
      loaded: [
        { name: "llama3.2:latest", sizeBytes: 5, sizeVramBytes: 0, expiresAt: null },
      ],
    });
    assert.equal(modelStateOf(s, T0).sizeBytes, 5);
  });

  it("words the chip: asleep when idle, a countdown while loaded, the task while working", () => {
    const chip = (patch) => modelChipOf(modelStateOf(status(patch), T0), T0);
    assert.deepEqual(chip({}), { label: "Model asleep", tone: "idle", busy: false });
    assert.equal(chip(inMemory).label, "Model ready · 2:00");
    assert.equal(chip(inMemory).tone, "ready");
    const reading = chip({ ...inMemory, activeCalls: [call("pto-email")] });
    assert.deepEqual(reading, {
      label: "Working on a PTO email",
      tone: "working",
      busy: true,
    });
    assert.equal(chip({ activeCalls: [call("pto-email", false)] }).tone, "waking");
    assert.equal(chip({ running: false }).tone, "off");
    assert.equal(chip({ modelInstalled: false }).label, "Model missing");
  });
});
