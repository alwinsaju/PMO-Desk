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
import { waitFor } from "../../testUtils.mjs";
import {
  approveProposal,
  createManualTodo,
  patchTodo,
  rejectProposal,
  retryProposal,
  stageEdits,
  updateConfig,
} from "./actions.ts";
import { HARD_MAX_FILE_BYTES, MAX_BODY_CHARS, MAX_PARSE_FAILURES } from "./ingest.ts";
import { submitManualIntake } from "./manual.ts";
import { purgeExpired } from "./retention.ts";
import { Mutex, writeJsonAtomic } from "./fsx.ts";
import { createPmo } from "./create.ts";
import { developerConfig } from "../developerDefaults.ts";
import { replyStatus } from "../fieldErrors.ts";
import { malformedConfigEntries } from "../configHealth.ts";
import { createStubGenerator } from "./stubGenerator.ts";
import { nextTodoDraft } from "../recurrence.ts";
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
  clock = new Date("2026-10-23T05:00:00.000Z"); // Friday 10:30 IST (fixed: the draft's dates are checked against "today")
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

describe("several tasks in one message", () => {
  const quote = "send me the consolidated RAID log";
  const three = () => [
    aiOutput({ title: "Send the weekly report to Rahul", quote }),
    aiOutput({
      title: "Book the room for Thursday's review",
      quote,
      dueAt: "2026-10-29",
    }),
    aiOutput({
      title: "Chase Dev about the invoice",
      quote,
      dueAt: null,
      dueBasis: "none",
    }),
  ];

  it("turns each independent task into its own ready review item linked to the same message", async () => {
    ai.handler = async () => three();
    await drop("a.json", await example("outlook-task.json"));
    await scanAndStructure();
    const list = await proposals();
    assert.equal(list.length, 3);
    assert.equal(new Set(list.map((p) => p.intakeId)).size, 1);
    assert.ok(list.every((p) => p.status === "ready" && p.draft));
    assert.deepEqual(list.map((p) => p.draft.title).sort(), [
      "Book the room for Thursday's review",
      "Chase Dev about the invoice",
      "Send the weekly report to Rahul",
    ]);
    assert.deepEqual(list.map((p) => p.part.index).sort(), [1, 2, 3]);
    assert.ok(list.every((p) => p.part.total === 3));
    assert.equal(ai.calls.length, 1, "one model call for the whole message");

    // Each is approvable on its own and becomes a separate to-do.
    for (const p of list) {
      const done = await approveProposal(pmo, p.id, { draft: effectiveDraft(p) });
      assert.equal(done.ok, true);
    }
    const todos = await pmo.store.listTodos();
    assert.equal(todos.length, 3);
    assert.equal(new Set(todos.map((t) => t.source.intakeId)).size, 1);
  });

  it("a single-task answer (list or bare object) gives one proposal without a part", async () => {
    for (const answer of [() => [aiOutput()], () => aiOutput()]) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = await mkdtemp(path.join(os.tmpdir(), "pmo-data-"));
      pmo = await createPmo({
        dataDir,
        inboxDir,
        seedConfig: developerConfig(),
        generator: ai,
        now: () => clock,
      });
      ai.handler = async () => answer();
      await drop("a.json", await example("outlook-task.json"));
      await scanAndStructure();
      const list = await proposals();
      assert.equal(list.length, 1);
      assert.equal(list[0].part ?? null, null);
    }
  });

  it("drops duplicates the model repeated and FYI entries", async () => {
    ai.handler = async () => [
      aiOutput({ title: "Send the RAID log to Pat" }),
      aiOutput({ title: "Send RAID log to Pat" }),
      aiOutput({ title: "Thanks for the update", isActionable: false }),
    ];
    await drop("a.json", await example("outlook-task.json"));
    await scanAndStructure();
    const list = await proposals();
    assert.equal(list.length, 1);
    assert.equal(list[0].part ?? null, null);
    assert.match(list[0].ai.adjustments.join(" "), /Merged 1 identical task/);
  });

  it("keeps the raw message until every split task is decided", async () => {
    ai.handler = async () => three();
    await drop("a.json", await example("outlook-task.json"));
    await scanAndStructure();
    const list = await proposals();
    await rejectProposal(pmo, list[0].id);
    const later = new Date(clock.getTime() + 400 * 86_400_000);
    await purgeExpired(pmo.store, { now: later, retentionDays: 7 });
    assert.ok(await pmo.store.readRaw(list[0].intakeId), "two tasks are still undecided");
  });
});

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

  it("lets a flow-built Teams item with no tenant ID through once its chat (Conversation ID) is allowlisted", async () => {
    const full = await example("teams-v2-selected-message.json");
    // As a flow that could not supply the tenant id would send it.
    const intake = {
      ...full,
      context: { chatId: full.context.chatId, chatType: "group" },
    };
    await drop("v2a.json", intake);
    await pmo.ingestor.scan();
    const [held] = await pmo.store.listQuarantine();
    assert.equal(held.code, "teams-not-allowlisted");
    assert.equal(held.tenantId, null);
    assert.equal(
      held.chatId,
      intake.context.chatId,
      "the Filtered tab can offer Allow this chat",
    );

    const done = await updateConfig(pmo, { teamsChatAllowlist: [held.chatId] });
    assert.equal(done.ok, true);
    assert.deepEqual(done.config.teamsChatAllowlist, [intake.context.chatId]);
    await drop("v2b.json", intake);
    const report = await pmo.ingestor.scan();
    assert.equal(report.ingested, 1);
    assert.equal((await pmo.store.listQuarantine()).length, 0);
    assert.equal((await proposals()).length, 1);
  });

  it("skips files that are too new, and leaves other JSON and non-JSON files alone", async () => {
    await drop("fresh.json", await example("outlook-task.json"), 500);
    await drop("big.json", JSON.stringify({ pad: "x".repeat(1_100_000) }));
    await drop("note.txt", "ignore me");
    await writeFile(path.join(inboxDir, "half.json.tmp"), "{");
    const report = await pmo.ingestor.scan();
    assert.equal(report.ingested, 0);
    assert.equal(report.skipped, 1);
    assert.deepEqual(report.foreign, ["big.json", "note.txt"]);
    assert.deepEqual(report.oversized, []);
    assert.equal((await readdir(inboxDir)).length, 4);

    // Once the fresh file has aged it is picked up.
    clock = new Date(clock.getTime() + 10_000);
    assert.equal((await pmo.ingestor.scan()).ingested, 1);
  });

  it("never moves or deletes JSON that is not a PMO message, however often it scans", async () => {
    const settings = JSON.stringify({ theme: "dark", schema: "vscode/1" });
    await drop("settings.json", settings);
    await drop("list.json", "[1, 2, 3]");
    await drop("broken-other.json", "{ not json");
    for (let i = 0; i <= MAX_PARSE_FAILURES + 1; i++) {
      const report = await pmo.ingestor.scan();
      assert.equal(report.rejected, 0);
      assert.equal(report.foreign.length, 3);
    }
    assert.deepEqual((await readdir(inboxDir)).sort(), [
      "broken-other.json",
      "list.json",
      "settings.json",
    ]);
    assert.equal(await readFile(path.join(inboxDir, "settings.json"), "utf8"), settings);
    assert.equal(await pmo.store.countRejectedFiles(), 0);
  });

  it("reports a file over the hard limit as too large and leaves it where it is", async () => {
    await writeFile(
      path.join(inboxDir, "huge.json"),
      Buffer.alloc(HARD_MAX_FILE_BYTES + 1, 0x20),
    );
    await utimes(path.join(inboxDir, "huge.json"), new Date(0), new Date(0));
    const report = await pmo.ingestor.scan();
    assert.deepEqual(report.oversized, ["huge.json"]);
    assert.equal(report.skipped, 1);
    assert.deepEqual(await readdir(inboxDir), ["huge.json"]);
  });

  it("keeps the first million characters of a very long body and flags the proposal", async () => {
    const intake = await example("outlook-task.json");
    intake.body.text = `${"A".repeat(1_500_000)} tail`;
    await drop("long.json", intake);
    const report = await pmo.ingestor.scan();
    assert.equal(report.ingested, 1);
    assert.deepEqual(report.oversized, []);
    const [proposal] = await proposals();
    assert.equal(proposal.messageShortened, true);
    const raw = await pmo.store.readRaw(proposal.intakeId);
    assert.equal(raw.intake.body.text.length, MAX_BODY_CHARS);

    const plain = await example("outlook-fyi.json");
    await drop("short.json", plain);
    await pmo.ingestor.scan();
    const others = (await proposals()).filter((p) => p.id !== proposal.id);
    assert.ok(others.every((p) => !p.messageShortened));
  });

  it("parks an unparsable file in rejected-files after repeated failed scans", async () => {
    await drop(
      "bad.json",
      '{ "schema": "pmo-intake/1", "source": "outlook", "subject": ',
    );
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
    assert.equal(log[0].promptVersion, 5);
    assert.ok(prompt.includes("Date hints (computed"));
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

  it("keeps a bottom-posted request for the model and marks the proposal", async () => {
    const intake = await example("outlook-task.json");
    intake.body.text =
      "Hi Alwin,\n\nOn Wed, 21 Oct 2026 at 16:40, Pat Sample wrote:\n> Status please\n\nCould you please send me the consolidated RAID log by Tuesday 27 October?\n\nThanks";
    await drop("a.json", intake);
    await scanAndStructure();
    const [proposal] = await proposals();
    assert.equal(proposal.replyBelowQuote, true);
    assert.ok(ai.calls[0].prompt.includes("consolidated RAID log"));
  });

  it("does not mark an ordinary top-posted message", async () => {
    await drop("a.json", await example("outlook-task.json"));
    await scanAndStructure();
    const [proposal] = await proposals();
    assert.notEqual(proposal.replyBelowQuote, true);
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
    await waitFor(async () => (await proposals())[0]?.status === "structuring");
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

  describe("marking a repeating to-do done offers the next one", () => {
    const approveWith = async (patch) => {
      const proposal = await readyProposal({ checkpointTemplate: "simple" });
      const approved = await approveProposal(pmo, proposal.id, {
        draft: { ...effectiveDraft(proposal), ...patch },
      });
      return approved.todo;
    };

    it("returns nextOccurrence { dueAt, title } on done, and creates nothing by itself", async () => {
      const todo = await approveWith({ recurrence: "weekly", dueAt: "2026-10-23" });
      const before = (await pmo.store.listAllTodos()).length;
      const done = await patchTodo(pmo, todo.id, { status: "done" });
      assert.equal(done.ok, true);
      assert.deepEqual(done.nextOccurrence, { dueAt: "2026-10-30", title: todo.title });
      assert.equal((await pmo.store.listAllTodos()).length, before, "never auto-created");
    });

    it("uses the configured time zone for 'today' when there is no due date", async () => {
      const todo = await approveWith({ recurrence: "daily", dueAt: null });
      const reminders = (await pmo.store.loadConfig()).reminders;
      const set = await updateConfig(pmo, {
        reminders: { ...reminders, timeZone: "America/Los_Angeles" },
      });
      assert.equal(set.ok, true);
      // 05:00Z is still the 22nd in Los Angeles.
      const done = await patchTodo(pmo, todo.id, { status: "done" });
      assert.equal(done.nextOccurrence.dueAt, "2026-10-23");
    });

    it("is null for a one-off, an unreadable recurrence, other edits and cancelling", async () => {
      const oneOff = await approveWith({ recurrence: null });
      assert.equal(
        (await patchTodo(pmo, oneOff.id, { status: "done" })).nextOccurrence,
        null,
      );
      const odd = await approveWith({ recurrence: "when the moon is full" });
      assert.equal(
        (await patchTodo(pmo, odd.id, { status: "done" })).nextOccurrence,
        null,
      );
      const weekly = await approveWith({ recurrence: "weekly", dueAt: "2026-10-23" });
      assert.equal(
        (await patchTodo(pmo, weekly.id, { title: "T" })).nextOccurrence,
        null,
      );
      assert.equal(
        (await patchTodo(pmo, weekly.id, { status: "cancelled" })).nextOccurrence,
        null,
      );
    });

    it("is not offered again when an already-done to-do is patched", async () => {
      const todo = await approveWith({ recurrence: "weekly", dueAt: "2026-10-23" });
      await patchTodo(pmo, todo.id, { status: "done" });
      const again = await patchTodo(pmo, todo.id, { status: "done" });
      assert.equal(again.nextOccurrence, null);
    });

    it("the offered date creates the next round through the ordinary create action", async () => {
      const todo = await approveWith({
        recurrence: "weekly",
        dueAt: "2026-10-23",
        tags: ["status"],
        requester: { name: "Pat Sample", email: "pat@deloitte.com" },
      });
      const done = await patchTodo(pmo, todo.id, { status: "done" });
      const created = await createManualTodo(pmo, {
        draft: nextTodoDraft(done.todo, done.nextOccurrence.dueAt),
      });
      assert.equal(created.ok, true);
      assert.equal(created.todo.dueAt, "2026-10-30");
      assert.equal(created.todo.status, "open");
      assert.deepEqual(created.todo.tags, ["status"]);
      assert.deepEqual(created.todo.requester, todo.requester);
      assert.ok(created.todo.checkpoints.every((c) => c.state === "pending"));
      assert.equal(created.todo.recurrence, "weekly");
    });
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
    const tenant = "0A1B2C3D-0000-4000-8000-123456789ABC";
    const next = (await updateConfig(pmo, { allowedTenantIds: [tenant] })).config;
    assert.deepEqual(next.blockedDomains, ["takeda.com", "other.example"]);
    assert.deepEqual(next.allowedTenantIds, [tenant.toLowerCase()]);
    assert.deepEqual(next.allowedSenderDomains, ["deloitte.com"]);
    assert.equal(
      (await updateConfig(pmo, { inboxDir: "C:\\elsewhere" })).config.inboxDir,
      initial.inboxDir,
      "the inbox path is not editable here",
    );
    assert.equal((await updateConfig(pmo, { blockedDomains: "x" })).ok, false);
  });

  it("refuses malformed emails and domains with a reason per entry, saving nothing", async () => {
    const before = await pmo.store.loadConfig();
    const result = await updateConfig(pmo, {
      allowedSenderDomains: ["deloitte.comdeloitte.com", "ok.com"],
      me: {
        names: ["Pat"],
        emails: ["alex", "a.morganalex.morgan@deloitte.com", "x@y.com"],
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /^Invalid config: /);
    assert.deepEqual(
      result.errors.map((e) => [e.field, e.index, e.value]),
      [
        ["allowedSenderDomains", 0, "deloitte.comdeloitte.com"],
        ["me.emails", 0, "alex"],
      ],
    );
    assert.equal(replyStatus(result), 400);
    assert.deepEqual(await pmo.store.loadConfig(), before);
  });

  it("normalises accepted entries (case, leading @, trailing dot, repeats)", async () => {
    const result = await updateConfig(pmo, {
      allowedSenderDomains: ["@Deloitte.com.", "deloitte.com", "us.deloitte.com", ""],
      me: { names: ["Pat"], emails: ["Pat@Deloitte.COM"] },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.config.allowedSenderDomains, [
      "deloitte.com",
      "us.deloitte.com",
    ]);
    assert.deepEqual(result.config.me.emails, ["pat@deloitte.com"]);
  });

  it("still loads a config saved with malformed values, and flags them", async () => {
    const saved = {
      ...(await pmo.store.loadConfig()),
      allowedSenderDomains: ["deloitte.comdeloitte.com", "deloitte.com"],
      me: { names: ["Alsaju"], emails: ["alex", "a.morganalex.morgan@deloitte.com"] },
    };
    await pmo.store.saveConfig(saved);
    const loaded = await pmo.store.loadConfig();
    assert.deepEqual(loaded.allowedSenderDomains, saved.allowedSenderDomains);
    assert.deepEqual(
      malformedConfigEntries(loaded).map((entry) => [entry.field, entry.value]),
      [
        ["allowedSenderDomains", "deloitte.comdeloitte.com"],
        ["emails", "alex"],
      ],
    );
    // An unrelated edit is not blocked by, and does not rewrite, the bad lists.
    const unrelated = await updateConfig(pmo, { retentionDays: 30 });
    assert.equal(unrelated.ok, true);
    assert.deepEqual(unrelated.config.allowedSenderDomains, saved.allowedSenderDomains);
  });

  it("falls back to the neutral defaults if config.json is damaged (setup not complete, so nothing is ingested)", async () => {
    await writeFile(path.join(dataDir, "config.json"), "{ broken");
    const config = await pmo.store.loadConfig();
    assert.equal(config.setupComplete, false);
    assert.deepEqual(config.blockedDomains, []);
    assert.deepEqual(config.allowedSenderDomains, []);
    assert.deepEqual(config.me, { names: [], emails: [] });
    assert.equal(config.inboxDir, "");
  });
});

describe("paste intake (POST /api/pmo/intake/manual)", () => {
  const paste = (patch = {}) => ({
    subject: "PMO weekly sync",
    from: "Jordan Sample <jordan.sample@deloitte.com>",
    body: "Please update the resourcing tracker before our call tomorrow.",
    origin: "teams",
    ...patch,
  });
  const files = () => readdir(inboxDir);

  it("drops one source:manual file into the same inbox, atomically, named like the other producers", async () => {
    clock = new Date("2026-10-24T10:11:12.000Z");
    const result = await submitManualIntake(pmo, paste());
    assert.equal(result.ok, true);
    assert.equal(result.duplicate, false);
    assert.equal(result.wouldFilter, null);
    assert.match(result.fileName, /^manual-20261024T101112Z-[0-9a-f]{8}\.json$/);
    assert.deepEqual(await files(), [result.fileName], "no .tmp file is left behind");

    const doc = JSON.parse(await readFile(path.join(inboxDir, result.fileName), "utf8"));
    assert.equal(doc.schema, "pmo-intake/1");
    assert.equal(doc.source, "manual");
    assert.equal(doc.producer, "manual-paste");
    assert.match(doc.sourceId, /^manual-[0-9a-f]{32}$/);
    assert.equal(doc.receivedAt, "2026-10-24T10:11:12.000Z");
    assert.deepEqual(doc.sender, {
      name: "Jordan Sample",
      address: "jordan.sample@deloitte.com",
    });
    assert.deepEqual(doc.context, { origin: "teams" });
    assert.equal(doc.body.text, paste().body);
  });

  it("flows through the ordinary ingest: queued, with an immutable snapshot, and Teams default-deny does not apply", async () => {
    // Teams is default-deny with an empty allowlist...
    assert.deepEqual((await pmo.store.loadConfig()).allowedTenantIds, []);
    const result = await submitManualIntake(pmo, paste());
    // ...yet the paste passes: the user vouches for it.
    const old = new Date(clock.getTime() - 60_000);
    await utimes(path.join(inboxDir, result.fileName), old, old);
    const report = await scanAndStructure();
    assert.equal(report.ingested, 1);
    assert.equal(report.filtered, 0);
    const [proposal] = await proposals();
    assert.equal(proposal.summary.source, "manual");
    assert.equal(proposal.status, "ready");
    const raw = await pmo.store.readRaw(proposal.intakeId);
    assert.equal(raw.intake.context.origin, "teams");
    assert.deepEqual(await files(), []);
  });

  it("still applies the blocked domains and terms, and says so up front", async () => {
    const age = async (name) => {
      const old = new Date(clock.getTime() - 60_000);
      await utimes(path.join(inboxDir, name), old, old);
    };
    await updateConfig(pmo, { blockedTerms: ["project falcon"] });

    const sender = await submitManualIntake(
      pmo,
      paste({ from: "Casey <casey@takeda.com>" }),
    );
    assert.match(sender.wouldFilter, /blocked domain \(takeda\.com\)/);
    const term = await submitManualIntake(pmo, paste({ body: "About Project Falcon." }));
    assert.match(term.wouldFilter, /blocked term/);
    const inText = await submitManualIntake(
      pmo,
      paste({ body: "From: Casey <casey@takeda.com>\nPlease send the plan." }),
    );
    assert.match(
      inText.wouldFilter,
      /Pasted text mentions an address on a blocked domain/,
    );
    for (const name of await files()) await age(name);

    const report = await pmo.ingestor.scan();
    assert.equal(report.filtered, 3);
    assert.equal(report.ingested, 0);
    assert.deepEqual((await pmo.store.listQuarantine()).map((q) => q.code).sort(), [
      "blocked-domain",
      "blocked-domain",
      "blocked-term",
    ]);
    assert.equal((await proposals()).length, 0);
  });

  it("recognises the same text again (whatever its case or spacing) as one item", async () => {
    const first = await submitManualIntake(pmo, paste());
    const old = new Date(clock.getTime() - 60_000);
    await utimes(path.join(inboxDir, first.fileName), old, old);
    await scanAndStructure();
    assert.equal((await proposals()).length, 1);

    const again = await submitManualIntake(
      pmo,
      paste({
        body: "  PLEASE update the   resourcing tracker before our call tomorrow.",
      }),
    );
    assert.equal(again.ok, true);
    assert.equal(again.duplicate, true);
    assert.equal(again.fileName, null);
    assert.deepEqual(await files(), [], "nothing was written for a duplicate");
    assert.equal((await proposals()).length, 1);

    const other = await submitManualIntake(pmo, paste({ body: "A different message." }));
    assert.equal(other.duplicate, false);
  });

  it("validates, caps the text, and never invents the inbox folder", async () => {
    for (const bad of [
      {},
      { body: "   " },
      { body: "x".repeat(100_001) },
      { body: "ok", subject: "s".repeat(301) },
      { body: "ok", link: "javascript:alert(1)" },
      { body: "ok", origin: "slack" },
      "not an object",
    ]) {
      const result = await submitManualIntake(pmo, bad);
      assert.equal(result.ok, false, JSON.stringify(bad).slice(0, 60));
      assert.ok(result.reason);
    }
    assert.deepEqual(await files(), []);

    await rm(inboxDir, { recursive: true, force: true });
    const missing = await submitManualIntake(pmo, paste());
    assert.equal(missing.ok, false);
    assert.match(missing.reason, /inbox folder was not found/);
    assert.equal(existsSync(inboxDir), false, "the folder was not created");
    await mkdir(inboxDir); // so afterEach can clean up
  });
});

describe("retention", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const setClock = (days) => {
    clock = new Date(t0.getTime() + days * DAY);
  };
  let t0;
  const intakeWith = async (id) => ({
    ...(await example("outlook-task.json")),
    sourceId: id,
  });
  /** Ingest + structure one message; returns its proposal. */
  async function ready(id) {
    await drop(`${id}.json`, await intakeWith(id));
    await scanAndStructure();
    for (const proposal of await proposals()) {
      const raw = await pmo.store.readRaw(proposal.intakeId);
      if (raw?.intake.sourceId === id) return proposal;
    }
    throw new Error(`no proposal for ${id}`);
  }
  const rawIds = async () => (await readdir(path.join(dataDir, "raw"))).sort();
  const lines = async (file) =>
    (await readFile(path.join(dataDir, "logs", file), "utf8"))
      .split("\n")
      .filter((l) => l.startsWith("{"))
      .map((l) => JSON.parse(l));

  beforeEach(() => {
    t0 = new Date("2026-06-01T10:00:00.000Z");
    clock = t0;
  });

  async function fourDecisions() {
    const open = await ready("open-1");
    const done = await ready("done-1");
    const rejected = await ready("rejected-1");
    const undecided = await ready("undecided-1");
    const toDraft = (p) => effectiveDraft(p);
    const o = await approveProposal(pmo, open.id, { draft: toDraft(open) });
    const d = await approveProposal(pmo, done.id, { draft: toDraft(done) });
    await patchTodo(pmo, d.todo.id, { status: "done" });
    await rejectProposal(pmo, rejected.id);
    return { open, done, rejected, undecided, openTodo: o.todo, doneTodo: d.todo };
  }

  it("deletes only the text of closed to-dos and rejected items, only after retentionDays, never an open to-do's", async () => {
    const { open, done, rejected, undecided } = await fourDecisions();
    assert.equal((await rawIds()).length, 4);

    // 80 days later: nothing is old enough yet.
    setClock(80);
    let report = await purgeExpired(pmo.store, { now: clock, retentionDays: 90 });
    assert.equal(report.rawDeleted, 0);
    assert.equal((await rawIds()).length, 4);

    // 100 days later: the closed to-do's and the rejected item's text go.
    setClock(100);
    report = await purgeExpired(pmo.store, { now: clock, retentionDays: 90 });
    assert.equal(report.rawDeleted, 2);
    assert.deepEqual(report.rawKept, { openTodo: 1, undecided: 1, unknown: 0 });
    assert.deepEqual(
      await rawIds(),
      [`${open.intakeId}.json`, `${undecided.intakeId}.json`].sort(),
    );
    assert.equal(await pmo.store.readRaw(done.intakeId), null);
    assert.equal(await pmo.store.readRaw(rejected.intakeId), null);

    // The records themselves stay while their message is still in the dedupe
    // index (only the text is removed; decided ones may have moved to archive/).
    // Past the retention window the decided ones go with their index entry.
    assert.equal((await pmo.store.listAllTodos()).length, 2);
    assert.equal(
      (await proposals()).length + (await pmo.store.listArchivedProposals()).length,
      2,
    );
    setClock(400);
    report = await purgeExpired(pmo.store, { now: clock, retentionDays: 90 });
    assert.equal(report.rawDeleted, 0);
    assert.equal((await rawIds()).length, 2);
    assert.ok(await pmo.store.readRaw(open.intakeId));
    assert.ok(await pmo.store.readRaw(undecided.intakeId));
  });

  it("keeps the text when a to-do is reopened, and counts retention from when it was closed", async () => {
    const { doneTodo, done } = await fourDecisions();
    setClock(60);
    await patchTodo(pmo, doneTodo.id, { status: "open" });
    setClock(100);
    let report = await purgeExpired(pmo.store, { now: clock, retentionDays: 90 });
    assert.ok(await pmo.store.readRaw(done.intakeId), "open again, so kept");
    assert.equal(report.rawDeleted, 1, "only the rejected one");

    await patchTodo(pmo, doneTodo.id, { status: "cancelled" });
    setClock(180); // 80 days after it was cancelled
    report = await purgeExpired(pmo.store, { now: clock, retentionDays: 90 });
    assert.ok(await pmo.store.readRaw(done.intakeId));
    setClock(200); // 100 days after
    report = await purgeExpired(pmo.store, { now: clock, retentionDays: 90 });
    assert.equal(await pmo.store.readRaw(done.intakeId), null);
    assert.equal(report.rawDeleted, 1);
  });

  it("drops log lines older than retentionDays and keeps the newer ones", async () => {
    await mkdir(path.join(dataDir, "logs"), { recursive: true });
    const at = (days) => new Date(t0.getTime() + days * DAY).toISOString();
    const row = (days, extra = {}) => JSON.stringify({ ts: at(days), ...extra });
    await writeFile(
      path.join(dataDir, "logs", "ingest.jsonl"),
      [
        row(-100, { n: 1 }),
        row(-95, { n: 2 }),
        row(-10, { n: 3 }),
        "not json at all",
        row(-1, { n: 4 }),
      ].join("\n") + "\n",
    );
    await writeFile(
      path.join(dataDir, "logs", "ai-calls.jsonl"),
      [row(-91, { n: 1 }), row(-5, { n: 2 })].join("\n") + "\n",
    );
    const report = await purgeExpired(pmo.store, { now: clock, retentionDays: 90 });
    assert.equal(report.logLinesDropped, 3);
    assert.deepEqual(
      (await lines("ingest.jsonl")).filter((l) => l.n).map((l) => l.n),
      [3, 4],
    );
    assert.equal(
      (await readFile(path.join(dataDir, "logs", "ingest.jsonl"), "utf8")).includes(
        "not json at all",
      ),
      true,
      "a line it cannot read is kept, not guessed at",
    );
    assert.deepEqual(
      (await lines("ai-calls.jsonl")).map((l) => l.n),
      [2],
    );
    // No temp files left in logs/.
    assert.deepEqual((await readdir(path.join(dataDir, "logs"))).sort(), [
      "ai-calls.jsonl",
      "ingest.jsonl",
    ]);
  });

  it("clears rejected files and quarantine records after 30 days, whatever retentionDays is larger", async () => {
    const stamp = (days) =>
      new Date(t0.getTime() + days * DAY).toISOString().replace(/[:.]/g, "-");
    const dir = path.join(dataDir, "rejected-files");
    for (const [days, name] of [
      [-40, "old"],
      [-10, "recent"],
    ]) {
      const base = `${stamp(days)}_${name}.json`;
      await writeFile(path.join(dir, base), "{ broken");
      await writeFile(path.join(dir, `${base}.reason.txt`), "not json\n");
    }
    const q = (id, days) => ({
      id,
      at: new Date(t0.getTime() + days * DAY).toISOString(),
      code: "blocked-domain",
      reason: "x",
      summary: {
        source: "outlook",
        subject: id,
        senderName: null,
        senderAddress: null,
        receivedAt: t0.toISOString(),
        link: null,
      },
      tenantId: null,
      chatId: null,
    });
    await pmo.store.writeQuarantine(q("in_0000000000000000aaaa", -40));
    await pmo.store.writeQuarantine(q("in_0000000000000000bbbb", -10));

    const report = await purgeExpired(pmo.store, { now: clock, retentionDays: 90 });
    assert.equal(report.rejectedFilesDeleted, 1);
    assert.equal(report.quarantineDeleted, 1);
    assert.deepEqual(
      (await readdir(dir)).sort(),
      [`${stamp(-10)}_recent.json`, `${stamp(-10)}_recent.json.reason.txt`].sort(),
      "the reason file goes with its file",
    );
    assert.deepEqual(
      (await pmo.store.listQuarantine()).map((r) => r.id),
      ["in_0000000000000000bbbb"],
    );

    // A short retention tightens the 30 days.
    const tight = await purgeExpired(pmo.store, { now: clock, retentionDays: 7 });
    assert.equal(tight.rejectedFilesDeleted, 1);
    assert.equal(tight.quarantineDeleted, 1);
    assert.deepEqual(await readdir(dir), []);
  });

  it("is idempotent, never touches the audit trail or the config, and prunes only expired dedupe entries", async () => {
    await fourDecisions();
    setClock(200);
    const auditBefore = await readFile(path.join(dataDir, "audit.jsonl"), "utf8");
    const seenBefore = JSON.parse(
      await readFile(path.join(dataDir, "state", "seen.json"), "utf8"),
    );
    const configBefore = await readFile(path.join(dataDir, "config.json"), "utf8");
    assert.equal(Object.keys(seenBefore).length, 4);

    const first = await purgeExpired(pmo.store, { now: clock, retentionDays: 90 });
    assert.ok(first.rawDeleted > 0 || first.logLinesDropped > 0);
    // The decided messages are forgotten with their archived records; the one
    // behind the open to-do and the undecided one are not.
    assert.equal(first.seenPruned, 2);
    assert.equal(first.archivedProposalsDeleted, 2);
    const second = await purgeExpired(pmo.store, { now: clock, retentionDays: 90 });
    assert.equal(second.rawDeleted, 0);
    assert.equal(second.logLinesDropped, 0);
    assert.equal(second.rejectedFilesDeleted, 0);
    assert.equal(second.quarantineDeleted, 0);
    assert.equal(second.seenPruned, 0);
    assert.equal(second.archivedProposalsDeleted, 0);
    assert.deepEqual(second.errors, []);

    assert.equal(await readFile(path.join(dataDir, "audit.jsonl"), "utf8"), auditBefore);
    assert.equal(await readFile(path.join(dataDir, "config.json"), "utf8"), configBefore);
    const seenAfter = JSON.parse(
      await readFile(path.join(dataDir, "state", "seen.json"), "utf8"),
    );
    assert.equal(Object.keys(seenAfter).length, 2);
    assert.ok(
      Object.keys(seenAfter).every((key) => key in seenBefore),
      "nothing was added",
    );
    // A message still behind an open to-do stays a duplicate; an expired one is new again.
    await drop("open-again.json", await intakeWith("open-1"));
    assert.equal((await pmo.ingestor.scan()).duplicates, 1);
    await drop("again.json", await intakeWith("rejected-1"));
    const rescan = await pmo.ingestor.scan();
    assert.equal(rescan.duplicates, 0);
    assert.equal(rescan.ingested, 1);
  });

  it("uses 90 days when the setting is missing, and is exposed through the config", async () => {
    assert.equal((await pmo.store.loadConfig()).retentionDays, 90);
    const result = await updateConfig(pmo, { retentionDays: 30 });
    assert.equal(result.config.retentionDays, 30);
    assert.equal((await pmo.store.loadConfig()).retentionDays, 30);
    assert.equal((await updateConfig(pmo, { retentionDays: 2 })).ok, false);
    assert.equal((await pmo.store.loadConfig()).retentionDays, 30);
    const report = await purgeExpired(pmo.store, { now: clock });
    assert.equal(
      report.retentionDays,
      90,
      "an unspecified value falls back to the default",
    );
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

describe("prompt v3: today, the app's clean-up, recurrence", () => {
  const readyFrom = async (patch) => {
    ai.handler = async () => aiOutput(patch);
    // A new conversation each time: a later message in the thread of an open
    // to-do would become an update card instead of a proposal.
    await drop(`${Math.random()}.json`, {
      ...(await example("outlook-task.json")),
      sourceId: String(Math.random()),
      thread: { conversationId: `conv-${Math.random()}`, parentId: null },
    });
    await scanAndStructure();
    const list = (await proposals()).filter((p) => p.status === "ready");
    return list[list.length - 1];
  };

  it("tells the model today's date and the message's age, from the worker's clock", async () => {
    clock = new Date("2026-11-04T05:00:00.000Z"); // 12 days after the example message
    await readyFrom({});
    const { prompt } = ai.calls[0];
    assert.match(prompt, /^Today: Wed 2026-11-04 /m);
    assert.match(prompt, /^Received: Thu 2026-10-22 \(13 days ago\)$/m);
  });

  it("keeps the model's answer as rawDraft and stores the cleaned one as draft, with adjustments", async () => {
    const proposal = await readyFrom({
      priority: "high",
      dueAt: "2026-10-20", // already past on Friday 23 October
      dueBasis: "explicit",
      waitingOn: "Alwin Saju",
      actionItems: [
        { text: "Leave comments.", owner: "Alwin Saju", dueAt: null },
        { text: "leave comments", owner: "Karthik Rao", dueAt: null },
      ],
      tags: [" a ", ""],
    });
    assert.equal(proposal.status, "ready");
    // The model's own answer, untouched.
    assert.equal(proposal.rawDraft.priority, "high");
    assert.equal(proposal.rawDraft.dueAt, "2026-10-20");
    assert.equal(proposal.rawDraft.waitingOn, "Alwin Saju");
    assert.equal(proposal.rawDraft.actionItems.length, 2);
    // What the review form starts from.
    assert.equal(proposal.draft.dueAt, null);
    assert.equal(proposal.draft.dueBasis, "none");
    assert.match(
      proposal.draft.description,
      /Stated deadline 2026-10-20 had already passed/,
    );
    assert.equal(proposal.draft.priority, "normal");
    assert.equal(proposal.draft.waitingOn, null);
    assert.equal(proposal.draft.actionItems.length, 1);
    assert.equal(proposal.draft.actionItems[0].owner, "Alwin Saju / Karthik Rao");
    assert.deepEqual(proposal.draft.tags, ["a"]);
    assert.equal(proposal.ai.adjustments.length, 4);
    assert.equal(effectiveDraft(proposal).dueAt, null);
  });

  it("a clean answer has an empty adjustments list and a draft equal to rawDraft", async () => {
    const proposal = await readyFrom({});
    assert.deepEqual(proposal.ai.adjustments, []);
    assert.deepEqual(proposal.draft, proposal.rawDraft);
    assert.equal(proposal.draft.dueAt, "2026-10-27");
  });

  it("neither the adjustments nor the draft reach the AI-call log", async () => {
    await readyFrom({ priority: "high", dueAt: "2026-10-20", dueBasis: "explicit" });
    const log = await readFile(path.join(dataDir, "logs", "ai-calls.jsonl"), "utf8");
    assert.ok(!/Priority lowered|had already passed|Send the RAID log|adjust/i.test(log));
    const audit = await readFile(path.join(dataDir, "audit.jsonl"), "utf8").catch(
      () => "",
    );
    assert.ok(!/Priority lowered|had already passed/.test(audit));
  });

  it("source scan: structure.ts logs only counts and metadata, never draft text or adjustments", async () => {
    const source = await readFile(path.join(here, "structure.ts"), "utf8");
    const blocks = source.match(/logAiCall\(\{[^}]*\}\)/g) ?? [];
    assert.ok(blocks.length >= 2);
    for (const block of blocks)
      assert.doesNotMatch(block, /adjust|draft|rawDraft|title|description|quote/i);
    assert.doesNotMatch(source, /console\.(log|info)\([^)]*(adjust|draft)/);
  });

  it("carries a recurrence from the model through the review form and approve into the to-do", async () => {
    const proposal = await readyFrom({
      recurrence: "weekly, before Tuesday",
      dueAt: null,
      dueBasis: "none",
    });
    assert.equal(proposal.draft.recurrence, "weekly, before Tuesday");
    assert.equal(effectiveDraft(proposal).recurrence, "weekly, before Tuesday");

    // Unedited: audited as not edited (recurrence is part of the snapshot).
    const result = await approveProposal(pmo, proposal.id, {
      draft: effectiveDraft(proposal),
    });
    assert.equal(result.ok, true);
    assert.equal(result.todo.recurrence, "weekly, before Tuesday");
    assert.equal(result.todo.dueAt, null);
    assert.equal(
      (await pmo.store.getTodo(result.todo.id)).recurrence,
      "weekly, before Tuesday",
    );
    const audit = (await readFile(path.join(dataDir, "audit.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.equal(audit.at(-1).edited, false);
  });

  it("an edited or cleared recurrence is what the to-do gets; blank means none", async () => {
    const a = await readyFrom({ recurrence: "weekly" });
    const edited = await approveProposal(pmo, a.id, {
      draft: { ...effectiveDraft(a), recurrence: "  every Monday  " },
    });
    assert.equal(edited.todo.recurrence, "every Monday");
    const b = await readyFrom({ recurrence: "weekly" });
    const cleared = await approveProposal(pmo, b.id, {
      draft: { ...effectiveDraft(b), recurrence: "   " },
    });
    assert.equal(cleared.todo.recurrence, null);
    const c = await readyFrom({});
    const none = await approveProposal(pmo, c.id, { draft: effectiveDraft(c) });
    assert.equal(none.todo.recurrence, null);
  });

  it("refuses an over-long recurrence in an approved draft", async () => {
    const proposal = await readyFrom({});
    const result = await approveProposal(pmo, proposal.id, {
      draft: { ...effectiveDraft(proposal), recurrence: "x".repeat(81) },
    });
    assert.equal(result.ok, false);
    assert.equal((await pmo.store.listTodos()).length, 0);
  });

  it("an old proposal and a draft saved without recurrence still approve (recurrence defaults to none)", async () => {
    const proposal = await readyFrom({});
    const legacyDraft = { ...effectiveDraft(proposal) };
    delete legacyDraft.recurrence;
    const result = await approveProposal(pmo, proposal.id, { draft: legacyDraft });
    assert.equal(result.ok, true);
    assert.equal(result.todo.recurrence, null);
  });

  it("the stub model reads a cadence as a recurrence and proposes no one-off date for it", async () => {
    const stub = await createPmo({
      dataDir,
      inboxDir,
      generator: createStubGenerator({ dataDir }),
      now: () => clock,
    });
    const base = await example("outlook-task.json");
    await drop("w.json", {
      ...base,
      sourceId: "weekly",
      body: {
        text: "Please update the slide every week before 2026-10-27.",
        format: "text",
      },
    });
    await stub.ingestor.scan();
    await stub.worker.kick();
    await stub.worker.idle();
    const [proposal] = await stub.store.listProposals();
    assert.equal(proposal.draft.recurrence, "every week");
    assert.equal(proposal.draft.dueAt, null);
  });
});
