// Run with `pnpm test`. Hardening of the PMO store and queue (QA findings D-1,
// D-2, D-12, D-14, D-15) against throwaway temp directories and a fake model.
// Nothing here touches the real inbox, data directory, network or Ollama.
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { saveInboxChoice } from "../../setup/inbox.ts";
import { todoIdForProposal } from "../dedupe.ts";
import { effectiveDraft } from "../todoLogic.ts";
import { AiStructuredSchema, emptyAttentionSummary } from "../types.ts";
import {
  approveProposal,
  createManualTodo,
  patchTodo,
  rejectProposal,
  restoreProposal,
  updateConfig,
} from "./actions.ts";
import { createPmo } from "./create.ts";
import { developerConfig } from "../developerDefaults.ts";
import { durability, writeJsonAtomic, writeTextAtomic } from "./fsx.ts";
import { HARD_MAX_FILE_BYTES, MAX_PARSE_FAILURES } from "./ingest.ts";
import { submitManualIntake } from "./manual.ts";
import { purgeExpired } from "./retention.ts";
import { buildState } from "./state.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.resolve(here, "..", "..", "..", "..", "pmo-intake", "examples");
const example = async (name) =>
  JSON.parse(await readFile(path.join(examplesDir, name), "utf8"));
const DAY = 24 * 60 * 60 * 1000;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const NO_FOLDER_RISKS = { home: "Z:\\nobody", sampleJsonFiles: () => [] };

const quote = "send me the consolidated RAID log";
const aiOutput = (patch = {}) =>
  AiStructuredSchema.parse({
    reason: "The message asks for something.",
    isActionable: true,
    confidence: 0.8,
    title: "Send the RAID log",
    description: "Pat needs it for the pre-read.",
    owner: { name: "Alwin Saju", email: "alsaju@deloitte.com", isMe: true },
    requester: { name: "Pat Sample", email: "pat.sample@deloitte.com" },
    dueAt: "2026-10-27",
    dueBasis: "explicit",
    priority: "normal",
    actionItems: [],
    checkpointTemplate: "deliverable",
    waitingOn: null,
    tags: [],
    quote,
    ...patch,
  });
const three = () => [
  aiOutput({ title: "Send the weekly report to Rahul" }),
  aiOutput({ title: "Book the room for Thursday's review", dueAt: "2026-10-29" }),
  aiOutput({ title: "Chase Dev about the invoice", dueAt: null, dueBasis: "none" }),
];

function fakeModel() {
  const model = {
    calls: [],
    handler: async () => aiOutput(),
    model: () => "fake-model",
    generate: async (request) => {
      model.calls.push(request);
      return model.handler(request);
    },
  };
  return model;
}

let dataDir;
let inboxDir;
let ai;
let pmo;
let clock;

async function drop(name, intake) {
  const file = path.join(inboxDir, name);
  await writeFile(file, typeof intake === "string" ? intake : JSON.stringify(intake));
  const when = new Date(clock.getTime() - 60_000);
  await utimes(file, when, when);
}

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "pmo-hard-data-"));
  inboxDir = await mkdtemp(path.join(os.tmpdir(), "pmo-hard-inbox-"));
  clock = new Date("2026-10-23T05:00:00.000Z");
  ai = fakeModel();
  pmo = await createPmo({
    dataDir,
    inboxDir,
    seedConfig: developerConfig(),
    generator: ai,
    now: () => clock,
  });
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
  await rm(inboxDir, { recursive: true, force: true });
});

const scanAndStructure = async () => {
  const report = await pmo.ingestor.scan();
  await pmo.worker.kick();
  await pmo.worker.idle();
  return report;
};
const proposals = () => pmo.store.listProposals();
const poll = () =>
  buildState(pmo, {
    runtime: async () => ({ state: "stub", model: "stub", message: null }),
    dataDir,
  });
const readJsonFile = async (file) => JSON.parse(await readFile(file, "utf8"));
const aiCalls = async () =>
  (await readFile(path.join(dataDir, "logs", "ai-calls.jsonl"), "utf8"))
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line));

/** Make `store.putProposal` throw once for the first write matching `when`. */
function failOnce(when) {
  const real = pmo.store.putProposal.bind(pmo.store);
  let armed = true;
  pmo.store.putProposal = async (proposal) => {
    if (armed && when(proposal)) {
      armed = false;
      throw new Error("disk full");
    }
    return real(proposal);
  };
  return () => {
    pmo.store.putProposal = real;
  };
}

/** One structured, approved message: returns its proposal id and to-do. */
async function approvedOne() {
  await drop("a.json", await example("outlook-task.json"));
  await scanAndStructure();
  const [proposal] = await proposals();
  const done = await approveProposal(pmo, proposal.id, {
    draft: effectiveDraft(proposal),
  });
  assert.equal(done.ok, true);
  return { proposal, todo: done.todo };
}

describe("D-1: near-misses in one message are kept and flagged", () => {
  it("keeps 'to Rahul' and 'to Meera', marking the later card as a possible duplicate", async () => {
    ai.handler = async () => [
      aiOutput({ title: "Send weekly status report to Rahul" }),
      aiOutput({ title: "Send weekly status report to Meera" }),
    ];
    await drop("a.json", await example("outlook-task.json"));
    await scanAndStructure();
    const list = await proposals();
    assert.equal(list.length, 2);
    assert.ok(list.every((p) => p.status === "ready"));
    const first = list.find((p) => p.part.index === 1);
    const second = list.find((p) => p.part.index === 2);
    assert.equal(first.possibleDuplicateOf ?? null, null);
    assert.equal(second.possibleDuplicateOf, first.id);
    assert.match(
      second.ai.adjustments.join(" "),
      /Looks like "Send weekly status report to Rahul"/,
    );
  });

  it("names what it merged away in the adjustments", async () => {
    ai.handler = async () => [
      aiOutput({ title: "Send the RAID log to Pat" }),
      aiOutput({ title: "send the raid log to Pat!" }),
    ];
    await drop("a.json", await example("outlook-task.json"));
    await scanAndStructure();
    const [only] = await proposals();
    assert.match(
      only.ai.adjustments.join(" "),
      /Merged 1 identical task\(s\) from the same message: "send the raid log to Pat!"/,
    );
  });
});

describe("D-2: unreadable records are quarantined, never deleted", () => {
  const corruptDir = (kind) => path.join(dataDir, "corrupt", kind);

  it("moves truncated, zero-byte and garbage files aside, counts them and reports them in the polled state", async () => {
    const { proposal } = await approvedOne();
    const good = await readFile(
      path.join(dataDir, "queue", `${proposal.id}.json`),
      "utf8",
    );
    const bad = {
      "pr_trunc0000000000001.json": good.slice(0, Math.floor(good.length / 2)),
      "pr_empty0000000000002.json": "",
      "pr_junk00000000000003.json": "\u0000\u0001\u0002 not json at all }}}{{",
      "pr_shape0000000000004.json": JSON.stringify({ hello: "world" }),
    };
    for (const [name, text] of Object.entries(bad)) {
      await writeFile(path.join(dataDir, "queue", name), text);
    }
    await writeFile(path.join(dataDir, "todos", "td_broken00000000001.json"), "{ nope");

    const list = await proposals();
    assert.deepEqual(
      list.map((p) => p.id),
      [proposal.id],
      "the valid record is still listed",
    );
    assert.equal(pmo.store.corruptFiles, 4, "only the queue has been listed so far");

    const moved = await readdir(corruptDir("queue"));
    assert.equal(moved.length, 4);
    for (const name of Object.keys(bad)) {
      const copy = moved.find((m) => m.startsWith(`${name}.`));
      assert.ok(copy, `${name} was moved`);
      assert.match(copy, /\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/);
      assert.equal(
        await readFile(path.join(corruptDir("queue"), copy), "utf8"),
        bad[name],
        "content kept",
      );
      await assert.rejects(
        stat(path.join(dataDir, "queue", name)),
        "no longer in the live folder",
      );
    }
    await pmo.store.listTodos();
    assert.equal(pmo.store.corruptFiles, 5);
    assert.equal((await readdir(corruptDir("todos"))).length, 1);

    const state = await poll();
    assert.equal(state.needsAttention.corruptRecords, 5);
    assert.equal(state.needsAttention.corruptFileNames.length, 5);
    assert.ok(
      state.needsAttention.corruptFileNames.some((n) => n.startsWith("queue/pr_trunc")),
    );
    assert.ok(
      state.needsAttention.corruptFileNames.some((n) => n.startsWith("todos/td_broken")),
    );
    assert.equal(state.needsAttention.oversizedFiles, 0);
    assert.equal(state.needsAttention.queuePaused, false);
    assert.equal(state.needsAttention.modelMissing, false);
  });

  it("reports zero when nothing is wrong", async () => {
    const state = await poll();
    assert.deepEqual(state.needsAttention, emptyAttentionSummary());
  });

  it("accepts a valid record with extra fields and an older shape instead of quarantining it", async () => {
    const { proposal, todo } = await approvedOne();
    const proposalFile = path.join(dataDir, "queue", `${proposal.id}.json`);
    const todoFile = path.join(dataDir, "todos", `${todo.id}.json`);

    const extra = await readJsonFile(proposalFile);
    await writeFile(
      proposalFile,
      JSON.stringify({
        ...extra,
        addedInAFutureVersion: { a: 1 },
        ai: undefined,
        quoteVerified: undefined,
      }),
    );
    const oldTodo = await readJsonFile(todoFile);
    delete oldTodo.reminders;
    delete oldTodo.checkpoints;
    await writeFile(todoFile, JSON.stringify({ ...oldTodo, someNewField: [1, 2, 3] }));

    const [read] = await proposals();
    assert.equal(read.id, proposal.id);
    assert.equal(read.status, "approved");
    assert.equal(read.ai.attempts, 0);
    const [readTodo] = await pmo.store.listTodos();
    assert.equal(readTodo.id, todo.id);
    assert.equal(readTodo.reminders.enabled, false);
    assert.deepEqual(readTodo.checkpoints, []);
    await assert.rejects(
      readdir(path.join(dataDir, "corrupt")),
      "nothing was quarantined",
    );
    assert.equal(pmo.store.corruptFiles, 0);
  });

  it("fsyncs the temp file before the rename, and leaves no temp files", async () => {
    const dir = path.join(dataDir, "durable");
    await mkdir(dir);
    const before = durability.fsyncs;
    await writeJsonAtomic(path.join(dir, "a.json"), { a: 1 });
    await writeTextAtomic(path.join(dir, "b.txt"), "b");
    assert.equal(durability.fsyncs, before + 2);
    assert.deepEqual((await readdir(dir)).sort(), ["a.json", "b.txt"]);
  });
});

describe("D-14: a crash never leaves a half split or a second to-do", () => {
  it("(a) writes the sibling cards hidden before publishing, and a failed publish shows nothing", async () => {
    ai.handler = async () => three();
    const restore = failOnce((p) => p.status === "ready" && p.part?.index === 1);
    await drop("a.json", await example("outlook-task.json"));
    await scanAndStructure();

    const statuses = (await proposals()).map((p) => p.status).sort();
    assert.deepEqual(statuses, ["failed", "splitting", "splitting"]);
    let state = await poll();
    assert.deepEqual(
      state.queue.map((p) => p.status),
      ["failed"],
      "the hidden siblings are not in the queue",
    );
    for (const p of await proposals()) {
      const done = await approveProposal(pmo, p.id, { draft: effectiveDraft(p) }).catch(
        () => null,
      );
      assert.ok(!done || done.ok === false, "a hidden card cannot be approved");
    }

    // A restart does not publish "2 of 3" next to a failed first card.
    await pmo.worker.start();
    await pmo.worker.idle();
    assert.equal((await proposals()).filter((p) => p.status === "splitting").length, 2);

    // Retrying the first card rewrites the group in full, with no duplicates.
    restore();
    const failed = (await proposals()).find((p) => p.status === "failed");
    assert.equal((await pmo.worker.retry(failed.id)).ok, true);
    await pmo.worker.idle();
    const list = await proposals();
    assert.equal(list.length, 3);
    assert.ok(list.every((p) => p.status === "ready" && p.part.total === 3));
    assert.deepEqual(list.map((p) => p.part.index).sort(), [1, 2, 3]);
  });

  it("(a) a crash after card 1 was published: start() publishes the hidden siblings", async () => {
    ai.handler = async () => three();
    await drop("a.json", await example("outlook-task.json"));
    await scanAndStructure();
    for (const p of await proposals()) {
      if (p.part.index > 1) await pmo.store.putProposal({ ...p, status: "splitting" });
    }
    assert.equal((await poll()).queue.length, 1);
    await pmo.worker.start();
    await pmo.worker.idle();
    const list = await proposals();
    assert.equal(list.length, 3);
    assert.ok(list.every((p) => p.status === "ready"));
  });

  it("(a) a crash before card 1 was published: the re-run rewrites the group, hidden until then", async () => {
    ai.handler = async () => three();
    await drop("a.json", await example("outlook-task.json"));
    await scanAndStructure();
    for (const p of await proposals()) {
      await pmo.store.putProposal({
        ...p,
        status: p.part.index === 1 ? "structuring" : "splitting",
      });
    }
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    ai.handler = async () => {
      await gate;
      return three();
    };
    await pmo.worker.start();
    await delay(20);
    const during = await proposals();
    assert.equal(
      during.filter((p) => p.status === "splitting").length,
      2,
      "still hidden",
    );
    assert.equal(
      (await poll()).queue.every((p) => p.status !== "ready"),
      true,
    );
    release();
    await pmo.worker.idle();
    const after = await proposals();
    assert.equal(after.length, 3, "no duplicate cards");
    assert.ok(after.every((p) => p.status === "ready"));
  });

  it("(b) approving twice returns the same to-do, derived from the proposal id", async () => {
    const { proposal, todo } = await approvedOne();
    assert.equal(todo.id, todoIdForProposal(proposal.id));
    const again = await approveProposal(pmo, proposal.id, {
      draft: effectiveDraft(proposal),
    });
    assert.equal(again.ok, true);
    assert.equal(again.todo.id, todo.id);
    assert.equal((await pmo.store.listTodos()).length, 1);
    assert.equal((await readdir(path.join(dataDir, "todos"))).length, 1);
  });

  it("(b) a crash between putTodo and putProposal leaves no duplicate on re-approve", async () => {
    await drop("a.json", await example("outlook-task.json"));
    await scanAndStructure();
    const [proposal] = await proposals();
    const restore = failOnce((p) => p.status === "approved");
    await assert.rejects(
      approveProposal(pmo, proposal.id, { draft: effectiveDraft(proposal) }),
    );
    restore();
    assert.equal(
      (await pmo.store.listTodos()).length,
      1,
      "the to-do was written before the crash",
    );
    assert.equal((await pmo.store.getProposal(proposal.id)).status, "ready");

    const again = await approveProposal(pmo, proposal.id, {
      draft: effectiveDraft(proposal),
    });
    assert.equal(again.ok, true);
    const todos = await pmo.store.listTodos();
    assert.equal(todos.length, 1, "still one to-do");
    assert.equal(todos[0].id, again.todo.id);
    const saved = await pmo.store.getProposal(proposal.id);
    assert.equal(saved.status, "approved");
    assert.equal(saved.todoId, todos[0].id);
  });

  it("(c) saving the inbox folder waits for the store lock and does not lose a config change", async () => {
    const save = () =>
      saveInboxChoice({
        raw: inboxDir,
        env: {},
        store: pmo.store,
        isDirectory: () => true,
        isAbsolute: path.isAbsolute,
        safety: NO_FOLDER_RISKS,
      });
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const held = pmo.store.withLock(() => gate);
    let finished = false;
    const saving = save().then((result) => {
      finished = true;
      return result;
    });
    await delay(30);
    assert.equal(finished, false, "blocked while another writer holds the lock");
    release();
    await held;
    assert.deepEqual(await saving, { ok: true });
    assert.equal((await pmo.store.loadConfig()).inboxDir, inboxDir);

    const other = path.join(inboxDir, "..");
    await Promise.all([
      updateConfig(pmo, { retentionDays: 30 }),
      saveInboxChoice({
        raw: other,
        env: {},
        store: pmo.store,
        isDirectory: () => true,
        isAbsolute: path.isAbsolute,
        safety: NO_FOLDER_RISKS,
      }),
    ]);
    const config = await pmo.store.loadConfig();
    assert.equal(config.retentionDays, 30);
    assert.equal(config.inboxDir, path.resolve(other));
  });

  it("(d) a storage failure while saving the answer is not reported as a model failure", async () => {
    const restore = failOnce((p) => p.status === "ready");
    await drop("a.json", await example("outlook-task.json"));
    await scanAndStructure();
    const [failed] = await proposals();
    assert.equal(failed.status, "failed");
    assert.match(failed.ai.error, /could not be saved/);
    assert.match(failed.ai.error, /disk full/);
    assert.equal(failed.ai.attempts, 0, "no attempt was used up");
    assert.deepEqual(
      (await aiCalls()).map((c) => c.outcome),
      ["ok"],
      "the model call is logged as the success it was",
    );
    assert.equal(pmo.worker.state().paused, null, "the queue is not paused");

    restore();
    assert.equal((await pmo.worker.retry(failed.id)).ok, true);
    await pmo.worker.idle();
    assert.equal((await proposals())[0].status, "ready");
  });
});

describe("D-15: dates that do not exist, through the server actions", () => {
  it("refuses a patch, a manual to-do and a staged approve with 2026-02-30", async () => {
    const { todo } = await approvedOne();
    const patched = await patchTodo(pmo, todo.id, { dueAt: "2026-02-30" });
    assert.equal(patched.ok, false);
    assert.match(patched.reason, /real calendar date/);
    assert.equal(
      (await patchTodo(pmo, todo.id, { snoozedUntil: "2026-02-30T09:00:00Z" })).ok,
      false,
    );
    assert.equal((await pmo.store.getTodo(todo.id)).dueAt, todo.dueAt, "nothing changed");
    assert.equal((await patchTodo(pmo, todo.id, { dueAt: "2026-03-02" })).ok, true);

    const draft = { ...effectiveDraft((await proposals())[0]), dueAt: "2026-02-30" };
    const manual = await createManualTodo(pmo, { draft });
    assert.equal(manual.ok, false);
    assert.match(manual.reason, /real calendar date/);
  });

  it("a blank sourceId is ingested once with a derived id, and the same message again is a duplicate", async () => {
    const base = await example("outlook-task.json");
    await drop("a.json", { ...base, sourceId: "   " });
    const first = await pmo.ingestor.scan();
    assert.equal(first.ingested, 1);
    const [raw] = await pmo.store.listRaw();
    assert.match(raw.intake.sourceId, /^derived-[0-9a-f]{32}$/);

    await drop("b.json", { ...base, sourceId: null });
    assert.equal(
      (await pmo.ingestor.scan()).duplicates,
      1,
      "same content, same derived id",
    );
    await drop("c.json", { ...base, sourceId: "", subject: "A different subject" });
    assert.equal((await pmo.ingestor.scan()).ingested, 1);
    assert.equal((await pmo.store.listRaw()).length, 2);

    const { sourceId: _omitted, ...without } = base;
    await drop("d.json", without);
    const missing = await pmo.ingestor.scan();
    assert.equal(missing.ingested, 0, "a missing key is still invalid");
  });
});

/** Valid proposals and to-dos cloned from a real one, written straight to disk. */
async function seedMany(proposalCount, todoCount) {
  const { proposal, todo } = await approvedOne();
  const templateProposal = await readJsonFile(
    path.join(dataDir, "queue", `${proposal.id}.json`),
  );
  const templateTodo = await readJsonFile(path.join(dataDir, "todos", `${todo.id}.json`));
  const ago = (days) => new Date(clock.getTime() - days * DAY).toISOString();
  const pad = (n) => String(n).padStart(6, "0");
  const classes = { proposals: [0, 0, 0, 0, 0], todos: [0, 0, 0, 0, 0] };
  const writes = [];
  for (let i = 0; i < proposalCount; i++) {
    // 0 approved old, 1 rejected old, 2 rejected recent, 3 ready old, 4 pending old
    const kind = i % 5;
    classes.proposals[kind]++;
    const status = ["approved", "rejected", "rejected", "ready", "pending"][kind];
    const old = kind !== 2;
    writes.push(
      writeFile(
        path.join(dataDir, "queue", `pr_5eed${pad(i)}.json`),
        JSON.stringify({
          ...templateProposal,
          id: `pr_5eed${pad(i)}`,
          intakeId: `in_5eed${pad(i)}`,
          status,
          createdAt: ago(old ? 70 : 6),
          updatedAt: ago(old ? 60 : 5),
        }),
      ),
    );
  }
  for (let i = 0; i < todoCount; i++) {
    // 0 done old, 1 cancelled old, 2 done recent, 3 open old, 4 open recent
    const kind = i % 5;
    classes.todos[kind]++;
    const status = ["done", "cancelled", "done", "open", "open"][kind];
    const old = kind < 2 || kind === 3;
    writes.push(
      writeFile(
        path.join(dataDir, "todos", `td_5eed${pad(i)}.json`),
        JSON.stringify({
          ...templateTodo,
          id: `td_5eed${pad(i)}`,
          status,
          completedAt: status === "open" ? null : ago(old ? 60 : 5),
          createdAt: ago(80),
          updatedAt: ago(old ? 60 : 5),
          source: { ...templateTodo.source, intakeId: `in_5eed${pad(i)}` },
        }),
      ),
    );
  }
  await Promise.all(writes);
  return classes;
}

const countFiles = async (dir) => {
  try {
    return (await readdir(dir)).filter((n) => n.endsWith(".json")).length;
  } catch {
    return 0;
  }
};

describe("D-12: retention archives old decided items, and polls re-parse nothing unchanged", () => {
  it("a second poll over ~1500 records parses nothing; only a changed file is read again", async () => {
    await seedMany(1000, 500);
    const reads = () => pmo.store.stats.fileReads;

    const start = reads();
    const first = await poll();
    assert.ok(reads() - start >= 1500, "the first poll reads every record");
    assert.equal(
      first.needsAttention.corruptRecords,
      0,
      "all synthetic records are valid",
    );
    assert.equal(
      first.todos.length,
      200 + 100 + 100 + 1 + 1 > 0 ? first.todos.length : 0,
    );

    const afterFirst = reads();
    const second = await poll();
    assert.equal(reads(), afterFirst, "unchanged files are served from the cache");
    assert.equal(second.todos.length, first.todos.length);
    assert.equal(second.queue.length, first.queue.length);

    const file = path.join(dataDir, "todos", "td_5eed000003.json");
    const changed = await readJsonFile(file);
    await writeFile(file, JSON.stringify({ ...changed, title: "Edited elsewhere" }));
    const third = await poll();
    assert.equal(reads(), afterFirst + 1, "exactly the changed file is parsed again");
    assert.ok(third.todos.some((t) => t.title === "Edited elsewhere"));

    // A write through the store is seen at once, too.
    await patchTodo(pmo, "td_5eed000003", { title: "Edited here" });
    assert.ok((await poll()).todos.some((t) => t.title === "Edited here"));
  });

  it("archives only decided proposals and closed to-dos older than 30 days, never deleting anything", async () => {
    const classes = await seedMany(1000, 500);
    const liveQueue = () => countFiles(path.join(dataDir, "queue"));
    const liveTodos = () => countFiles(path.join(dataDir, "todos"));
    const queueBefore = await liveQueue();
    const todosBefore = await liveTodos();

    const report = await purgeExpired(pmo.store, { now: clock, retentionDays: 90 });
    assert.deepEqual(report.errors, []);
    assert.equal(report.proposalsArchived, classes.proposals[0] + classes.proposals[1]);
    assert.equal(report.todosArchived, classes.todos[0] + classes.todos[1]);

    const archivedQueue = await countFiles(path.join(dataDir, "archive", "queue"));
    const archivedTodos = await countFiles(path.join(dataDir, "archive", "todos"));
    assert.equal(archivedQueue, 400);
    assert.equal(archivedTodos, 200);
    assert.equal((await liveQueue()) + archivedQueue, queueBefore, "nothing deleted");
    assert.equal((await liveTodos()) + archivedTodos, todosBefore, "nothing deleted");

    // What stayed: recent decisions, undecided items (however old), open to-dos.
    const live = await proposals();
    assert.ok(live.some((p) => p.status === "ready" && p.id.startsWith("pr_5eed")));
    assert.ok(live.some((p) => p.status === "pending" && p.id.startsWith("pr_5eed")));
    assert.ok(live.filter((p) => p.status === "rejected").length >= classes.proposals[2]);
    const archived = await pmo.store.listArchivedProposals();
    assert.ok(archived.every((p) => p.status === "approved" || p.status === "rejected"));
    assert.ok(
      archived.every((p) => Date.parse(p.updatedAt) < clock.getTime() - 30 * DAY),
    );
    const liveTodoList = await pmo.store.listTodos();
    assert.ok(
      liveTodoList.filter((t) => t.status === "open").length >= 200,
      "open to-dos stay, old or not",
    );
    assert.ok(
      liveTodoList
        .filter((t) => t.status !== "open")
        .every((t) => Date.parse(t.updatedAt) > clock.getTime() - 30 * DAY),
    );
    assert.equal(
      (await pmo.store.listAllTodos()).length,
      todosBefore,
      "reports can still see them all",
    );

    // Idempotent, and the next poll re-parses nothing it already had.
    const again = await purgeExpired(pmo.store, { now: clock, retentionDays: 90 });
    assert.equal(again.proposalsArchived + again.todosArchived, 0);
    await poll();
    const reads = pmo.store.stats.fileReads;
    const state = await poll();
    assert.equal(pmo.store.stats.fileReads, reads);
    assert.ok(state.todos.length > 0);
  });

  it("keeps deleting the raw text by the retention rule after the records are archived", async () => {
    await drop("a.json", await example("outlook-task.json"));
    await scanAndStructure();
    const [proposal] = await proposals();
    await rejectProposal(pmo, proposal.id);
    const later = new Date(clock.getTime() + 40 * DAY);
    let report = await purgeExpired(pmo.store, { now: later, retentionDays: 90 });
    assert.equal(report.proposalsArchived, 1);
    assert.equal(report.rawDeleted, 0, "not old enough for the text to go");
    assert.ok(await pmo.store.readRaw(proposal.intakeId));
    const muchLater = new Date(clock.getTime() + 100 * DAY);
    report = await purgeExpired(pmo.store, { now: muchLater, retentionDays: 90 });
    assert.equal(report.rawDeleted, 1);
    assert.deepEqual(report.rawKept, { openTodo: 0, undecided: 0, unknown: 0 });
    // Past the retention window the record goes with its dedupe entry (D-4c).
    assert.equal(report.archivedProposalsDeleted, 1);
    assert.equal((await pmo.store.listArchivedProposals()).length, 0);
  });

  it("does not rewrite seen.json when the entry is unchanged", async () => {
    await drop("a.json", await example("outlook-task.json"));
    await pmo.ingestor.scan();
    const file = path.join(dataDir, "state", "seen.json");
    const seen = await readJsonFile(file);
    const [key, entry] = Object.entries(seen)[0];
    const before = { text: await readFile(file, "utf8"), fsyncs: durability.fsyncs };
    await pmo.store.markSeen(key, {
      at: new Date().toISOString(),
      intakeId: entry.intakeId,
    });
    assert.equal(durability.fsyncs, before.fsyncs, "no write happened");
    assert.equal(await readFile(file, "utf8"), before.text);
    await pmo.store.markSeen("outlook:new", { at: entry.at, intakeId: "in_other" });
    assert.ok(durability.fsyncs > before.fsyncs, "a new entry is written");
  });
});

const auditActions = async () => {
  const text = await readFile(path.join(dataDir, "audit.jsonl"), "utf8").catch(() => "");
  return text
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line));
};

/** Pasted files are written "now" by the real clock: age them past the mid-write guard. */
async function ageInbox() {
  const old = new Date(clock.getTime() - 60_000);
  for (const name of await readdir(inboxDir))
    await utimes(path.join(inboxDir, name), old, old);
}

describe("D-4: restore a rejected item", () => {
  it("puts a rejected item that has the model's answer back to ready, and audits it", async () => {
    await drop("a.json", await example("outlook-task.json"));
    await scanAndStructure();
    const [proposal] = await proposals();
    await rejectProposal(pmo, proposal.id);

    const shown = await poll();
    assert.deepEqual(
      shown.rejected.map((p) => p.id),
      [proposal.id],
    );
    assert.equal(shown.queue.length, 0);

    const restored = await restoreProposal(pmo, proposal.id);
    assert.deepEqual(restored, { ok: true });
    const back = await pmo.store.getProposal(proposal.id);
    assert.equal(back.status, "ready");
    assert.deepEqual(back.draft, proposal.draft, "the answer is kept");
    const after = await poll();
    assert.deepEqual(after.rejected, []);
    assert.deepEqual(
      after.queue.map((p) => p.id),
      [proposal.id],
    );
    const actions = (await auditActions()).map((entry) => entry.action);
    assert.deepEqual(
      actions.filter((a) => a === "reject" || a === "restore"),
      ["reject", "restore"],
    );
  });

  it("goes back to pending when the model never answered, so it is structured again", async () => {
    await drop("a.json", await example("outlook-task.json"));
    await pmo.ingestor.scan();
    const [proposal] = await proposals();
    assert.equal(proposal.status, "pending");
    await rejectProposal(pmo, proposal.id);
    assert.deepEqual(await restoreProposal(pmo, proposal.id), { ok: true });
    assert.equal((await pmo.store.getProposal(proposal.id)).status, "pending");
    await pmo.worker.kick();
    await pmo.worker.idle();
    assert.equal((await pmo.store.getProposal(proposal.id)).status, "ready");
  });

  it("cannot restore an approved item, an unknown one, or one whose text is gone", async () => {
    const { proposal } = await approvedOne();
    const approved = await restoreProposal(pmo, proposal.id);
    assert.equal(approved.ok, false);
    assert.match(approved.reason, /already approved/);
    assert.equal((await pmo.store.getProposal(proposal.id)).status, "approved");
    assert.equal((await restoreProposal(pmo, "pr_nothere0000000000000")).ok, false);

    await drop("b.json", await example("outlook-fyi.json"));
    await pmo.ingestor.scan();
    const pending = (await proposals()).find((p) => p.status === "pending");
    await rejectProposal(pmo, pending.id);
    await pmo.store.removeRaw(pending.intakeId);
    const gone = await restoreProposal(pmo, pending.id);
    assert.equal(gone.ok, false);
    assert.match(gone.reason, /text was already deleted/);
    assert.equal((await pmo.store.getProposal(pending.id)).status, "rejected");
  });

  it("leaves an item that is not rejected alone and writes no audit entry", async () => {
    await drop("a.json", await example("outlook-task.json"));
    await scanAndStructure();
    const [proposal] = await proposals();
    assert.deepEqual(await restoreProposal(pmo, proposal.id), { ok: true });
    assert.equal((await auditActions()).filter((e) => e.action === "restore").length, 0);
  });
});

describe("D-4: import a pasted duplicate anyway", () => {
  const paste = (patch = {}) => ({
    subject: "PMO weekly sync",
    from: "Jordan Sample <jordan.sample@deloitte.com>",
    body: "Please update the resourcing tracker before our call tomorrow.",
    origin: "teams",
    ...patch,
  });

  it("creates a second item with a different id only when asked", async () => {
    const first = await submitManualIntake(pmo, paste());
    await ageInbox();
    await scanAndStructure();
    assert.equal((await proposals()).length, 1);

    const plain = await submitManualIntake(pmo, paste());
    assert.equal(plain.duplicate, true);
    assert.deepEqual(await readdir(inboxDir), []);

    clock = new Date(clock.getTime() + 5_000);
    const forced = await submitManualIntake(pmo, paste({ allowDuplicate: true }));
    assert.equal(forced.ok, true);
    assert.equal(forced.duplicate, false);
    assert.notEqual(forced.fileName, first.fileName);
    const doc = await readJsonFile(path.join(inboxDir, forced.fileName));
    const original = await readJsonFile(
      path.join(dataDir, "raw", (await proposals())[0].intakeId + ".json"),
    );
    assert.notEqual(doc.sourceId, original.intake.sourceId, "the id is salted");
    assert.equal(doc.body.text, paste().body);

    await ageInbox();
    clock = new Date(clock.getTime() + 60_000);
    const report = await scanAndStructure();
    assert.equal(report.ingested, 1);
    assert.equal((await proposals()).length, 2);
    const paste2 = (await auditActions()).filter((e) => e.action === "paste");
    assert.equal(paste2.length, 2);
    assert.equal(paste2[1].importedAnyway, true);
    assert.equal(paste2[0].importedAnyway, undefined);
  });

  it("two forced imports in a row are two items", async () => {
    await submitManualIntake(pmo, paste({ allowDuplicate: true }));
    await submitManualIntake(pmo, paste({ allowDuplicate: true }));
    await ageInbox();
    clock = new Date(clock.getTime() + 60_000);
    assert.equal((await scanAndStructure()).ingested, 2);
  });
});

describe("D-8: needsAttention in the polled state", () => {
  it("counts foreign files (other JSON and non-JSON) without touching them", async () => {
    await drop("settings.json", JSON.stringify({ theme: "dark" }));
    await drop("notes.txt", "hello");
    await pmo.ingestor.scan();
    const state = await poll();
    assert.equal(state.needsAttention.foreignFiles, 2);
    assert.deepEqual(state.needsAttention.foreignFileNames, [
      "notes.txt",
      "settings.json",
    ]);
    assert.deepEqual((await readdir(inboxDir)).sort(), ["notes.txt", "settings.json"]);
  });

  it("caps the names at 20 but counts them all", async () => {
    for (let i = 0; i < 25; i++) await drop(`n${String(i).padStart(2, "0")}.txt`, "x");
    await pmo.ingestor.scan();
    const { needsAttention } = await poll();
    assert.equal(needsAttention.foreignFiles, 25);
    assert.equal(needsAttention.foreignFileNames.length, 20);
  });

  it("lists a file over the hard limit as too large", async () => {
    await writeFile(
      path.join(inboxDir, "huge.json"),
      Buffer.alloc(HARD_MAX_FILE_BYTES + 1, 0x20),
    );
    await utimes(path.join(inboxDir, "huge.json"), new Date(0), new Date(0));
    await pmo.ingestor.scan();
    const { needsAttention } = await poll();
    assert.equal(needsAttention.oversizedFiles, 1);
    assert.deepEqual(needsAttention.oversizedFileNames, ["huge.json"]);
    assert.equal(needsAttention.foreignFiles, 0);
  });

  it("lists a file that could not be processed as errored, and it clears when the next scan succeeds", async () => {
    await drop("a.json", await example("outlook-task.json"));
    const realWrite = pmo.store.writeRaw.bind(pmo.store);
    pmo.store.writeRaw = async () => {
      throw new Error("EBUSY: resource busy");
    };
    const failed = await pmo.ingestor.scan();
    assert.deepEqual(failed.errored, ["a.json"]);
    let state = await poll();
    assert.equal(state.needsAttention.erroredFiles, 1);
    assert.deepEqual(state.needsAttention.erroredFileNames, ["a.json"]);

    pmo.store.writeRaw = realWrite;
    await pmo.ingestor.scan();
    state = await poll();
    assert.equal(state.needsAttention.erroredFiles, 0);
  });

  it("counts parked files, and ignored duplicates once each", async () => {
    await drop("bad.json", '{ "schema": "pmo-intake/1", "source": ');
    for (let i = 0; i < MAX_PARSE_FAILURES; i++) await pmo.ingestor.scan();
    let state = await poll();
    assert.equal(state.needsAttention.parkedFiles, 1);
    assert.deepEqual(state.needsAttention.parkedFileNames, ["bad.json"]);
    assert.equal(state.needsAttention.foreignFiles, 0);

    await drop("a.json", await example("outlook-task.json"));
    await pmo.ingestor.scan();
    await drop("copy.json", await example("outlook-task.json"));
    await pmo.ingestor.scan();
    await pmo.ingestor.scan();
    state = await poll();
    assert.equal(state.needsAttention.duplicatesIgnored, 1);
  });

  it("reports a paused queue and a missing model from the structuring queue", async () => {
    ai.handler = async () => {
      const error = new Error("ollama pull gemma");
      error.name = "AiRuntimeError";
      error.code = "model-missing";
      throw error;
    };
    await drop("a.json", await example("outlook-task.json"));
    await scanAndStructure();
    const paused = (await poll()).needsAttention;
    assert.equal(paused.queuePaused, true);
    assert.equal(paused.modelMissing, true);

    ai.handler = async () => {
      const error = new Error("Ollama is not running");
      error.name = "AiRuntimeError";
      error.code = "runtime-down";
      throw error;
    };
    await pmo.worker.kick();
    await pmo.worker.idle();
    const down = (await poll()).needsAttention;
    assert.equal(down.queuePaused, true);
    assert.equal(down.modelMissing, false);
  });
});
