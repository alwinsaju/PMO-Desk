// Run with `pnpm test`. The PMO store, inbox ingest, structuring queue and the
// approve/reject gate against throwaway temp directories and a fake model.
// Nothing here touches the real inbox, the real data directory, the network
// or Ollama.
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  approveProposal,
  createManualTodo,
  patchTodo,
  rejectProposal,
  retryProposal,
  stageEdits,
  updateConfig,
} from "./actions.ts";
import { MAX_PARSE_FAILURES } from "./ingest.ts";
import { Mutex, writeJsonAtomic } from "./fsx.ts";
import { createPmo } from "./create.ts";
import { createStubGenerator } from "./stubGenerator.ts";
import { draftFromAi, effectiveDraft } from "../todoLogic.ts";
import { AiStructuredSchema } from "../types.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.resolve(here, "..", "..", "..", "..", "pmo-intake", "examples");
const example = async (name) =>
  JSON.parse(await readFile(path.join(examplesDir, name), "utf8"));

const runtimeError = (code, message = code) => {
  const error = new Error(message);
  error.name = "AiRuntimeError";
  error.code = code;
  return error;
};

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
    actionItems: [{ text: "Export the log", owner: null, dueAt: null }],
    checkpointTemplate: "deliverable",
    waitingOn: null,
    tags: ["raid"],
    quote: "send me the consolidated RAID log",
    ...patch,
  });

/** A model whose behaviour a test swaps at will; records every request. */
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

/** Drop an intake into the temp inbox, aged past the "still being written" guard. */
async function drop(name, intake, ageMs = 60_000) {
  const file = path.join(inboxDir, name);
  await writeFile(file, typeof intake === "string" ? intake : JSON.stringify(intake));
  const when = new Date(clock.getTime() - ageMs);
  await utimes(file, when, when);
  return file;
}

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "pmo-data-"));
  inboxDir = await mkdtemp(path.join(os.tmpdir(), "pmo-inbox-"));
  clock = new Date();
  ai = fakeModel();
  pmo = await createPmo({ dataDir, inboxDir, generator: ai, now: () => clock });
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

describe("inbox ingest", () => {
  it("turns a valid file into one pending proposal with an immutable raw snapshot, and clears the inbox", async () => {
    const intake = await example("outlook-task.json");
    await drop("a.json", intake);
    const report = await pmo.ingestor.scan();
    assert.equal(report.ingested, 1);
    assert.deepEqual(await readdir(inboxDir), []);

    const [proposal] = await proposals();
    assert.equal(proposal.status, "pending");
    assert.equal(proposal.summary.subject, intake.subject);
    assert.equal(proposal.summary.senderAddress, "pat.sample@deloitte.com");
    const raw = await pmo.store.readRaw(proposal.intakeId);
    assert.equal(raw.intake.body.text, intake.body.text);
    assert.match(raw.dedupeKey, /^outlook:/);
    assert.equal(existsSync(path.join(dataDir, "state", "seen.json")), true);
  });

  it("yields one item when the same message is dropped twice", async () => {
    const intake = await example("outlook-task.json");
    await drop("a.json", intake);
    await pmo.ingestor.scan();
    await drop("b-copy.json", intake);
    const second = await pmo.ingestor.scan();
    assert.equal(second.duplicates, 1);
    assert.equal(second.ingested, 0);
    assert.equal((await proposals()).length, 1);
    assert.deepEqual(await readdir(inboxDir), []);

    // Both copies in the same pass.
    const other = { ...intake, sourceId: "another-id" };
    await drop("c.json", other);
    await drop("d.json", other);
    const third = await pmo.ingestor.scan();
    assert.equal(third.ingested, 1);
    assert.equal(third.duplicates, 1);
    assert.equal((await proposals()).length, 2);
  });

  it("quarantines a blocked-domain sender and an un-allowlisted Teams item, keeping no body", async () => {
    await drop("blocked.json", await example("outlook-blocked-domain.json"));
    await drop("teams.json", await example("teams-selected-message.json"));
    const report = await pmo.ingestor.scan();
    assert.equal(report.filtered, 2);
    assert.equal((await proposals()).length, 0);
    assert.deepEqual(await readdir(inboxDir), []);

    const quarantined = await pmo.store.listQuarantine();
    assert.equal(quarantined.length, 2);
    assert.deepEqual(quarantined.map((q) => q.code).sort(), [
      "blocked-domain",
      "tenant-not-allowed",
    ]);
    const teams = quarantined.find((q) => q.code === "tenant-not-allowed");
    assert.equal(teams.tenantId, "00000000-0000-0000-0000-000000000000");
    assert.match(teams.reason, /not on the allowed list/);
    for (const name of await readdir(path.join(dataDir, "quarantine"))) {
      const text = await readFile(path.join(dataDir, "quarantine", name), "utf8");
      assert.ok(!text.includes("update the resourcing tracker"));
      assert.ok(!text.includes("blocked domain, so the item lands"));
    }
    assert.equal((await readdir(path.join(dataDir, "raw"))).length, 0);
  });

  it("lets a quarantined Teams message through once its tenant is allowed and it is sent again", async () => {
    const intake = await example("teams-selected-message.json");
    await drop("t1.json", intake);
    await pmo.ingestor.scan();
    assert.equal((await pmo.store.listQuarantine()).length, 1);

    const done = await updateConfig(pmo, {
      allowedTenantIds: [intake.context.tenantId.toUpperCase()],
    });
    assert.equal(done.ok, true);
    await drop("t2.json", intake);
    const report = await pmo.ingestor.scan();
    assert.equal(report.ingested, 1);
    assert.equal(
      (await pmo.store.listQuarantine()).length,
      0,
      "the stale quarantine record is removed",
    );
    assert.equal((await proposals()).length, 1);
  });

  it("skips files that are too new or too large, and non-JSON files", async () => {
    await drop("fresh.json", await example("outlook-task.json"), 500);
    await drop("big.json", JSON.stringify({ pad: "x".repeat(1_100_000) }));
    await drop("note.txt", "ignore me");
    await writeFile(path.join(inboxDir, "half.json.tmp"), "{");
    const report = await pmo.ingestor.scan();
    assert.equal(report.ingested, 0);
    assert.equal(report.skipped, 2);
    assert.equal((await readdir(inboxDir)).length, 4);

    // Once the fresh file has aged it is picked up.
    clock = new Date(clock.getTime() + 10_000);
    assert.equal((await pmo.ingestor.scan()).ingested, 1);
  });

  it("parks an unparsable file in rejected-files after repeated failed scans", async () => {
    await drop("bad.json", "{ not json");
    await drop("wrong.json", { schema: "pmo-intake/1", source: "outlook" });
    for (let i = 1; i < MAX_PARSE_FAILURES; i++) {
      const report = await pmo.ingestor.scan();
      assert.equal(report.rejected, 0);
      assert.equal((await readdir(inboxDir)).length, 2);
    }
    const last = await pmo.ingestor.scan();
    assert.equal(last.rejected, 2);
    assert.deepEqual(await readdir(inboxDir), []);
    const parked = await readdir(path.join(dataDir, "rejected-files"));
    assert.equal(parked.filter((n) => n.endsWith(".reason.txt")).length, 2);
    const reasons = await Promise.all(
      parked
        .filter((n) => n.endsWith(".reason.txt"))
        .map((n) => readFile(path.join(dataDir, "rejected-files", n), "utf8")),
    );
    assert.ok(reasons.some((r) => /Not valid JSON/.test(r)));
    assert.ok(reasons.some((r) => /sourceId/.test(r)));
    assert.equal(await pmo.store.countRejectedFiles(), 2);
  });

  it("reports a missing inbox folder without creating it", async () => {
    const missing = path.join(inboxDir, "nope");
    const other = await createPmo({
      dataDir,
      inboxDir: missing,
      generator: ai,
      now: () => clock,
    });
    const report = await other.ingestor.scan();
    assert.equal(report.inboxExists, false);
    assert.match(report.errors[0], /not found/);
    assert.equal(existsSync(missing), false);
  });

  it("logs outcomes without message text", async () => {
    await drop("a.json", await example("outlook-task.json"));
    await pmo.ingestor.scan();
    const log = await readFile(path.join(dataDir, "logs", "ingest.jsonl"), "utf8");
    assert.match(log, /"outcome":"ingested"/);
    assert.ok(!log.includes("RAID log"));
  });
});

describe("structuring", () => {
  it("fills in a draft, verifies the quote, and records the call", async () => {
    await drop("a.json", await example("outlook-task.json"));
    await scanAndStructure();
    const [proposal] = await proposals();
    assert.equal(proposal.status, "ready");
    assert.equal(proposal.draft.title, "Send the RAID log");
    assert.equal(proposal.isActionable, true);
    assert.equal(proposal.quoteVerified, true);
    assert.equal(proposal.ai.model, "fake-model");
    assert.equal(proposal.ai.attempts, 1);

    // The quoted reply chain never reached the model; the prompt is delimited.
    const { system, prompt } = ai.calls[0];
    assert.ok(system.includes("alsaju@deloitte.com"));
    assert.ok(prompt.includes('<message source="outlook"'));
    assert.ok(!prompt.includes("the template is on the shared drive"));

    const log = (await readFile(path.join(dataDir, "logs", "ai-calls.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.equal(log.length, 1);
    assert.equal(log[0].outcome, "ok");
    assert.equal(log[0].intakeId, proposal.intakeId);
    assert.ok(
      log[0].bytes > 100 &&
        typeof log[0].durationMs === "number" &&
        log[0].model === "fake-model",
    );
  });

  it("flags a quote that is not in the message, without rejecting the draft", async () => {
    ai.handler = async () => aiOutput({ quote: "an invented sentence" });
    await drop("a.json", await example("outlook-task.json"));
    await scanAndStructure();
    const [proposal] = await proposals();
    assert.equal(proposal.status, "ready");
    assert.equal(proposal.quoteVerified, false);
  });

  it("trims a quote that runs past the message and still verifies the part that is real", async () => {
    ai.handler = async () =>
      aiOutput({
        quote:
          "send me the consolidated RAID log for the Contoso Programme by Tuesday 27 October? plus invented trailing words",
      });
    await drop("a.json", await example("outlook-task.json"));
    await scanAndStructure();
    const [proposal] = await proposals();
    assert.equal(proposal.quoteVerified, true);
    assert.equal(
      proposal.draft.quote,
      "send me the consolidated RAID log for the Contoso Programme by Tuesday 27 October?",
    );
  });

  it("keeps a non-actionable message in the queue, marked as such", async () => {
    ai.handler = async () => aiOutput({ isActionable: false, title: "No action" });
    await drop("a.json", await example("outlook-fyi.json"));
    await scanAndStructure();
    const [proposal] = await proposals();
    assert.equal(proposal.status, "ready");
    assert.equal(proposal.isActionable, false);
  });

  it("works through several messages one at a time, in arrival order", async () => {
    let running = 0;
    let max = 0;
    const order = [];
    ai.handler = async ({ prompt }) => {
      running++;
      max = Math.max(max, running);
      order.push(/subject="([^"]*)"/.exec(prompt)[1]);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return aiOutput();
    };
    const base = await example("outlook-task.json");
    for (const n of [1, 2, 3])
      await drop(`m${n}.json`, { ...base, sourceId: `id-${n}`, subject: `Subject ${n}` });
    await pmo.ingestor.scan();
    await pmo.worker.kick();
    assert.ok(pmo.worker.state().total >= 1);
    await pmo.worker.idle();
    assert.equal(max, 1);
    assert.equal((await proposals()).filter((p) => p.status === "ready").length, 3);
    assert.deepEqual(order.slice().sort(), ["Subject 1", "Subject 2", "Subject 3"]);
    assert.deepEqual(pmo.worker.state(), {
      active: null,
      position: 0,
      total: 0,
      waiting: 0,
      paused: null,
    });
  });

  it("leaves the item pending and pauses when the model is down, then recovers on the next scan", async () => {
    ai.handler = async () => {
      throw runtimeError("runtime-down", "Could not reach the local AI runtime.");
    };
    const base = await example("outlook-task.json");
    await drop("a.json", base);
    await drop("b.json", { ...base, sourceId: "second" });
    await scanAndStructure();

    let list = await proposals();
    assert.deepEqual(
      list.map((p) => p.status),
      ["pending", "pending"],
    );
    assert.equal(list[0].ai.attempts, 0, "a runtime outage is not the message's fault");
    assert.equal(pmo.worker.state().paused.code, "runtime-down");
    assert.equal(ai.calls.length, 1, "the queue stops after the first failure");

    // Same outage on the next scan: still pending, still paused.
    await scanAndStructure();
    assert.equal(pmo.worker.state().paused.code, "runtime-down");
    assert.equal(
      (await proposals()).every((p) => p.status === "pending"),
      true,
    );

    // The model comes back; the next scan structures everything.
    ai.handler = async () => aiOutput();
    await scanAndStructure();
    assert.deepEqual(
      (await proposals()).map((p) => p.status),
      ["ready", "ready"],
    );
    assert.equal(pmo.worker.state().paused, null);
  });

  it("reports a missing model the same way", async () => {
    ai.handler = async () => {
      throw runtimeError(
        "model-missing",
        'The local model "x" is not installed. Run: ollama pull x',
      );
    };
    await drop("a.json", await example("outlook-task.json"));
    await scanAndStructure();
    assert.equal(pmo.worker.state().paused.code, "model-missing");
    assert.match(pmo.worker.state().paused.message, /ollama pull/);
    assert.equal((await proposals())[0].status, "pending");
  });

  it("retries a timeout once, then marks the item failed", async () => {
    ai.handler = async () => {
      throw runtimeError("timeout");
    };
    await drop("a.json", await example("outlook-task.json"));
    await scanAndStructure();
    const [proposal] = await proposals();
    assert.equal(ai.calls.length, 2);
    assert.equal(proposal.status, "failed");
    assert.equal(proposal.ai.attempts, 2);
    assert.equal(pmo.worker.state().paused, null, "a timeout does not pause the queue");
  });

  it("fails an invalid-output item, which can then be retried up to three attempts", async () => {
    ai.handler = async () => {
      throw runtimeError("invalid-output", "did not return valid output");
    };
    await drop("a.json", await example("outlook-task.json"));
    await scanAndStructure();
    let [proposal] = await proposals();
    assert.equal(proposal.status, "failed");
    assert.equal(proposal.ai.attempts, 1);
    assert.match(proposal.ai.error, /valid output/);

    assert.equal((await retryProposal(pmo, proposal.id)).ok, true);
    await pmo.worker.idle();
    [proposal] = await proposals();
    assert.equal(proposal.status, "failed");
    assert.equal(proposal.ai.attempts, 2);

    assert.equal((await retryProposal(pmo, proposal.id)).ok, true);
    await pmo.worker.idle();
    [proposal] = await proposals();
    assert.equal(proposal.ai.attempts, 3);

    const refused = await retryProposal(pmo, proposal.id);
    assert.equal(refused.ok, false);
    assert.match(refused.reason, /manually/);
  });

  it("a retried item can succeed", async () => {
    ai.handler = async () => {
      throw runtimeError("invalid-output");
    };
    await drop("a.json", await example("outlook-task.json"));
    await scanAndStructure();
    ai.handler = async () => aiOutput();
    const [failed] = await proposals();
    assert.equal((await retryProposal(pmo, failed.id)).ok, true);
    await pmo.worker.idle();
    assert.equal((await proposals())[0].status, "ready");
    assert.equal(
      (await retryProposal(pmo, failed.id)).ok,
      false,
      "only failed items are retried",
    );
  });

  it("puts items a stopped server left 'structuring' back in the queue on start", async () => {
    await drop("a.json", await example("outlook-task.json"));
    await pmo.ingestor.scan();
    const [proposal] = await proposals();
    await pmo.store.putProposal({ ...proposal, status: "structuring" });

    await pmo.worker.start();
    await pmo.worker.idle();
    assert.equal((await proposals())[0].status, "ready");
  });

  it("does not resurrect an item rejected while the model was working on it", async () => {
    let release;
    ai.handler = () => new Promise((resolve) => (release = () => resolve(aiOutput())));
    await drop("a.json", await example("outlook-task.json"));
    await pmo.ingestor.scan();
    await pmo.worker.kick();
    await new Promise((r) => setTimeout(r, 20));
    const [proposal] = await proposals();
    assert.equal(proposal.status, "structuring");
    await rejectProposal(pmo, proposal.id);
    release();
    await pmo.worker.idle();
    assert.equal((await proposals())[0].status, "rejected");
  });

  it("works with the built-in stub model and its failure markers", async () => {
    const stub = await createPmo({
      dataDir,
      inboxDir,
      generator: createStubGenerator({ dataDir }),
      now: () => clock,
    });
    const base = await example("outlook-task.json");
    await drop("a.json", base);
    await drop("b.json", await example("outlook-fyi.json"));
    await drop("c.json", {
      ...base,
      sourceId: "c",
      body: { text: "Please check this. [[stub-invalid]]", format: "text" },
    });
    await stub.ingestor.scan();
    await stub.worker.kick();
    await stub.worker.idle();
    const byId = Object.fromEntries(
      (await stub.store.listProposals()).map((p) => [
        p.summary.subject + p.intakeId.slice(-3),
        p,
      ]),
    );
    const statuses = Object.values(byId)
      .map((p) => [p.isActionable, p.status])
      .sort();
    assert.deepEqual(statuses, [
      [null, "failed"],
      [false, "ready"],
      [true, "ready"],
    ]);

    // The "stop the model" switch.
    await writeFile(path.join(dataDir, "stub-runtime-down"), "");
    await drop("d.json", { ...base, sourceId: "d" });
    await stub.ingestor.scan();
    await stub.worker.kick();
    await stub.worker.idle();
    assert.equal(stub.worker.state().paused.code, "runtime-down");
    await rm(path.join(dataDir, "stub-runtime-down"));
    await stub.worker.kick();
    await stub.worker.idle();
    assert.equal(
      (await stub.store.listProposals()).filter((p) => p.status === "ready").length,
      3,
    );
  });
});

describe("review gate", () => {
  async function readyProposal(patch) {
    if (patch) ai.handler = async () => aiOutput(patch);
    await drop(`${Math.random()}.json`, {
      ...(await example("outlook-task.json")),
      sourceId: String(Math.random()),
    });
    await scanAndStructure();
    const list = await proposals();
    return list[list.length - 1];
  }

  it("creates no to-do until a human approves", async () => {
    const proposal = await readyProposal();
    assert.equal(proposal.status, "ready");
    assert.equal((await pmo.store.listTodos()).length, 0);
    assert.equal((await readdir(path.join(dataDir, "todos"))).length, 0);
  });

  it("approve creates the to-do from the staged edits and records the audit", async () => {
    const proposal = await readyProposal();
    const draft = {
      ...effectiveDraft(proposal),
      title: "Send RAID log to Pat (edited)",
      priority: "high",
    };
    const result = await approveProposal(pmo, proposal.id, { draft });
    assert.equal(result.ok, true);
    const [todo] = await pmo.store.listTodos();
    assert.equal(todo.id, result.todo.id);
    assert.equal(todo.title, "Send RAID log to Pat (edited)");
    assert.equal(todo.priority, "high");
    assert.equal(todo.status, "open");
    assert.equal(todo.checkpoints.length, 5);
    assert.equal(todo.source.intakeId, proposal.intakeId);
    assert.equal(todo.source.subject, proposal.summary.subject);
    assert.ok(todo.approvedBy);

    const after = await pmo.store.getProposal(proposal.id);
    assert.equal(after.status, "approved");
    assert.equal(after.todoId, todo.id);
    assert.equal(after.draft.title, "Send the RAID log", "the AI draft is never mutated");

    const audit = (await readFile(path.join(dataDir, "audit.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].action, "approve");
    assert.equal(audit[0].edited, true);
    assert.ok(audit[0].user && audit[0].ts);

    // Approving again (a double click) returns the same to-do and creates no second one.
    const again = await approveProposal(pmo, proposal.id, { draft });
    assert.equal(again.ok, true);
    assert.equal(again.todo.id, todo.id);
    assert.equal((await pmo.store.listTodos()).length, 1);
  });

  it("an unedited approve is audited as such", async () => {
    const proposal = await readyProposal();
    await approveProposal(pmo, proposal.id, { draft: draftFromAi(proposal.draft, "x") });
    const audit = (await readFile(path.join(dataDir, "audit.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.equal(audit[0].edited, false);
  });

  it("reject creates no to-do and cannot be approved afterwards", async () => {
    const proposal = await readyProposal();
    assert.equal((await rejectProposal(pmo, proposal.id)).ok, true);
    assert.equal((await pmo.store.listTodos()).length, 0);
    assert.equal((await pmo.store.getProposal(proposal.id)).status, "rejected");
    const late = await approveProposal(pmo, proposal.id, {
      draft: effectiveDraft(proposal),
    });
    assert.equal(late.ok, false);
    assert.equal((await pmo.store.listTodos()).length, 0);
    const audit = (await readFile(path.join(dataDir, "audit.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.deepEqual(
      audit.map((a) => a.action),
      ["reject"],
    );
  });

  it("only a structured item can be approved, and bad drafts are refused", async () => {
    await drop("a.json", await example("outlook-task.json"));
    await pmo.ingestor.scan();
    const [pending] = await proposals();
    const draft = effectiveDraft(pending);
    assert.equal((await approveProposal(pmo, pending.id, { draft })).ok, false);

    const proposal = await readyProposal();
    assert.equal(
      (await approveProposal(pmo, proposal.id, { draft: { ...draft, title: "  " } })).ok,
      false,
    );
    assert.equal((await approveProposal(pmo, proposal.id, {})).ok, false);
    assert.equal(
      (await approveProposal(pmo, "pr_00000000000000000000", { draft })).ok,
      false,
    );
    assert.equal((await approveProposal(pmo, "../../etc/passwd", { draft })).ok, false);
    assert.equal((await pmo.store.listTodos()).length, 0);
  });

  it("stages edits without touching the AI draft", async () => {
    const proposal = await readyProposal();
    const draft = { ...effectiveDraft(proposal), title: "Mine" };
    assert.equal((await stageEdits(pmo, proposal.id, { draft })).ok, true);
    const after = await pmo.store.getProposal(proposal.id);
    assert.equal(after.edits.title, "Mine");
    assert.equal(after.draft.title, "Send the RAID log");
    assert.equal(effectiveDraft(after).title, "Mine");
  });

  it("creates a to-do by hand, optionally standing in for a failed proposal", async () => {
    const plain = await createManualTodo(pmo, {
      draft: {
        ...effectiveDraft({
          draft: null,
          edits: null,
          summary: { subject: "Chase vendor" },
        }),
      },
    });
    assert.equal(plain.ok, true);
    assert.equal(plain.todo.source.source, "manual");
    assert.equal(plain.todo.source.intakeId, null);

    ai.handler = async () => {
      throw runtimeError("invalid-output");
    };
    await drop("f.json", await example("outlook-task.json"));
    await scanAndStructure();
    const failed = (await proposals()).find((p) => p.status === "failed");
    const manual = await createManualTodo(pmo, {
      proposalId: failed.id,
      draft: effectiveDraft(failed),
    });
    assert.equal(manual.ok, true);
    assert.equal(
      manual.todo.title,
      failed.summary.subject,
      "title is prefilled from the subject",
    );
    assert.equal(manual.todo.source.intakeId, failed.intakeId);
    assert.equal((await pmo.store.getProposal(failed.id)).status, "approved");
  });

  it("patches a to-do: ticks, checkpoints, an offer to finish, then done", async () => {
    const proposal = await readyProposal({ checkpointTemplate: "simple" });
    const { todo } = await approveProposal(pmo, proposal.id, {
      draft: effectiveDraft(proposal),
    });

    const ticked = await patchTodo(pmo, todo.id, {
      actionItems: [{ id: todo.actionItems[0].id, done: true }],
    });
    assert.equal(ticked.todo.actionItems[0].done, true);
    assert.equal(ticked.offerDone, false);

    const all = await patchTodo(pmo, todo.id, {
      checkpoints: todo.checkpoints.map((c) => ({ id: c.id, state: "done" })),
    });
    assert.equal(all.offerDone, true);
    assert.equal(all.todo.status, "open");

    const done = await patchTodo(pmo, todo.id, { status: "done" });
    assert.equal(done.todo.status, "done");
    assert.equal((await pmo.store.getTodo(todo.id)).status, "done");

    assert.equal((await patchTodo(pmo, todo.id, { priority: "urgent" })).ok, false);
    assert.equal((await patchTodo(pmo, "td_00000000000000", { title: "x" })).ok, false);

    const audit = (await readFile(path.join(dataDir, "audit.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.deepEqual(
      audit.map((a) => a.action),
      ["approve", "complete"],
    );
  });

  it("serialises overlapping patches so none is lost", async () => {
    const proposal = await readyProposal();
    const { todo } = await approveProposal(pmo, proposal.id, {
      draft: effectiveDraft(proposal),
    });
    await Promise.all([
      patchTodo(pmo, todo.id, { title: "T1" }),
      patchTodo(pmo, todo.id, { priority: "high" }),
      patchTodo(pmo, todo.id, { waitingOn: "Pat" }),
      patchTodo(pmo, todo.id, { addActionItems: [{ text: "extra" }] }),
    ]);
    const stored = await pmo.store.getTodo(todo.id);
    assert.equal(stored.title, "T1");
    assert.equal(stored.priority, "high");
    assert.equal(stored.waitingOn, "Pat");
    assert.equal(stored.actionItems.length, 2);
  });
});

describe("config", () => {
  it("writes defaults on first use, merges patches and never resets other lists", async () => {
    const initial = await pmo.store.loadConfig();
    assert.deepEqual(initial.allowedSenderDomains, ["deloitte.com"]);
    assert.deepEqual(initial.blockedDomains, ["takeda.com"]);
    assert.deepEqual(initial.allowedTenantIds, []);
    assert.equal(initial.me.emails[0], "alsaju@deloitte.com");

    await updateConfig(pmo, {
      blockedDomains: ["Takeda.com", "other.example", "takeda.com"],
    });
    const next = (await updateConfig(pmo, { allowedTenantIds: ["AAAA"] })).config;
    assert.deepEqual(next.blockedDomains, ["takeda.com", "other.example"]);
    assert.deepEqual(next.allowedTenantIds, ["aaaa"]);
    assert.deepEqual(next.allowedSenderDomains, ["deloitte.com"]);
    assert.equal(
      (await updateConfig(pmo, { inboxDir: "C:\\elsewhere" })).config.inboxDir,
      initial.inboxDir,
      "the inbox path is not editable here",
    );
    assert.equal((await updateConfig(pmo, { blockedDomains: "x" })).ok, false);
  });

  it("falls back to the strict defaults if config.json is damaged", async () => {
    await writeFile(path.join(dataDir, "config.json"), "{ broken");
    const config = await pmo.store.loadConfig();
    assert.deepEqual(config.blockedDomains, ["takeda.com"]);
  });
});

describe("storage primitives", () => {
  it("writes JSON atomically and leaves no temp files", async () => {
    const dir = path.join(dataDir, "atomic");
    await mkdir(dir);
    const file = path.join(dir, "x.json");
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        writeJsonAtomic(file, { i, pad: "y".repeat(5000) }),
      ),
    );
    JSON.parse(await readFile(file, "utf8"));
    assert.deepEqual(await readdir(dir), ["x.json"]);
  });

  it("runs mutex tasks one at a time and survives a rejection", async () => {
    const mutex = new Mutex();
    const log = [];
    const a = mutex.run(async () => {
      log.push("a1");
      await new Promise((r) => setTimeout(r, 10));
      log.push("a2");
    });
    const b = mutex.run(async () => {
      log.push("b");
      throw new Error("boom");
    });
    const c = mutex.run(async () => log.push("c"));
    await a;
    await assert.rejects(b);
    await c;
    assert.deepEqual(log, ["a1", "a2", "b", "c"]);
  });

  it("ignores a corrupt record file instead of failing the whole listing", async () => {
    await writeFile(path.join(dataDir, "queue", "pr_deadbeefdeadbeef.json"), "{ nope");
    await drop("a.json", await example("outlook-task.json"));
    await pmo.ingestor.scan();
    assert.equal((await proposals()).length, 1);
    assert.ok(pmo.store.corruptFiles >= 1);
  });
});
