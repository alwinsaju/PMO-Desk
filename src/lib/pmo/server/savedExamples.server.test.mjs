// Run with `pnpm test`. The saved-examples library end to end (ai-6): the file in
// the data folder, saving from a proposal, the cap, the switch, a damaged file,
// and the structuring worker's prompt, with and without the switch. Throwaway
// temp directories and a fake model that records what it was sent; nothing
// touches Ollama or the real data directory.
import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  listSavedExamples,
  removeSavedExample,
  saveProposalExample,
  setSavedExamplesSwitch,
} from "./exampleActions.ts";
import { SETUP, fakeModel, proposalKit } from "./proposalKit.mjs";
import {
  deleteExample,
  examplesForPrompt,
  loadSavedExamples,
  saveExample,
  savedExamplesFile,
  setExamplesEnabled,
} from "./savedExamples.ts";
import { MAX_SAVED_EXAMPLES } from "../savedExamples.ts";
import { buildSystemPrompt } from "../structurePrompt.ts";
import { effectiveDraft } from "../todoLogic.ts";

const kit = proposalKit();
beforeEach(kit.setup);
afterEach(kit.teardown);

/** A fake model that keeps every request it receives. */
function recordingModel() {
  const inner = fakeModel({});
  const requests = [];
  return {
    requests,
    model: inner.model,
    generate: async (request) => {
      requests.push(request);
      return inner.generate(request);
    },
  };
}

const readLog = (name) =>
  readFile(path.join(kit.dataDir, ...name.split("/")), "utf8").catch(() => "");

const draftOf = (patch = {}) => ({
  title: "Send the RAID log",
  description: "Pat needs it.",
  owner: { name: "Alex Morgan", email: null, isMe: true },
  requester: { name: null, email: null },
  dueAt: null,
  priority: "normal",
  actionItems: [],
  checkpointTemplate: "simple",
  waitingOn: null,
  tags: [],
  recurrence: null,
  ...patch,
});

describe("the library file", () => {
  it("starts empty with the switch off, and reading never creates the file", async () => {
    const pmo = await kit.open(kit.stub(), SETUP);
    const listed = await listSavedExamples(pmo);
    assert.deepEqual(
      { enabled: listed.enabled, examples: listed.examples, max: listed.max },
      { enabled: false, examples: [], max: MAX_SAVED_EXAMPLES },
    );
    await assert.rejects(readFile(savedExamplesFile(kit.dataDir)), { code: "ENOENT" });
  });

  it("saves, lists and deletes through one atomic file in the data folder", async () => {
    const pmo = await kit.open(kit.stub(), SETUP);
    const a = await saveExample(pmo.store, {
      subject: "One",
      message: "Please send the RAID log to Pat",
      draft: draftOf(),
      now: new Date("2026-10-23T05:00:00Z"),
    });
    assert.equal(a.ok, true);
    assert.equal(a.count, 1);
    assert.equal(
      savedExamplesFile(kit.dataDir),
      path.join(kit.dataDir, "state", "saved-examples.json"),
    );
    const onDisk = JSON.parse(await readFile(savedExamplesFile(kit.dataDir), "utf8"));
    assert.equal(onDisk.version, 1);
    assert.equal(onDisk.enabled, false);
    assert.equal(onDisk.examples[0].title, "Send the RAID log");
    // The temp file of the atomic write is gone.
    const left = await readdir(path.join(kit.dataDir, "state"));
    assert.ok(!left.some((name) => name.endsWith(".tmp")), left.join(", "));

    const gone = await removeSavedExample(pmo, a.example.id);
    assert.equal(gone.ok, true);
    assert.deepEqual(gone.examples, []);
    const again = await removeSavedExample(pmo, a.example.id);
    assert.equal(again.ok, false);
  });

  it("holds at most 20: the 21st is refused and the file is unchanged", async () => {
    const pmo = await kit.open(kit.stub(), SETUP);
    for (let i = 1; i <= MAX_SAVED_EXAMPLES; i++) {
      const saved = await saveExample(pmo.store, {
        subject: `S${i}`,
        message: `Unique message ${i} about topic${i}`,
        draft: draftOf({ title: `Task ${i}` }),
        now: new Date(Date.UTC(2026, 9, 1, 0, i)),
      });
      assert.equal(saved.ok, true, `save ${i}`);
    }
    const before = await readFile(savedExamplesFile(kit.dataDir), "utf8");
    const over = await saveExample(pmo.store, {
      subject: "Over",
      message: "A twenty-first message about something new",
      draft: draftOf(),
      now: new Date("2026-10-30T00:00:00Z"),
    });
    assert.equal(over.ok, false);
    assert.match(over.reason, /20 saved examples/);
    assert.equal(await readFile(savedExamplesFile(kit.dataDir), "utf8"), before);
  });

  it("concurrent saves under the shared lock all land", async () => {
    const pmo = await kit.open(kit.stub(), SETUP);
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        saveExample(pmo.store, {
          subject: `S${i}`,
          message: `Concurrent message ${i} about subject${i}`,
          draft: draftOf({ title: `Task ${i}` }),
          now: new Date(Date.UTC(2026, 9, 1, 0, i)),
        }),
      ),
    );
    assert.ok(results.every((r) => r.ok));
    assert.equal((await loadSavedExamples(kit.dataDir)).examples.length, 8);
  });

  it("turns the switch on and off and keeps the examples", async () => {
    const pmo = await kit.open(kit.stub(), SETUP);
    await saveExample(pmo.store, {
      subject: "",
      message: "Please send the RAID log",
      draft: draftOf(),
      now: new Date(),
    });
    const on = await setSavedExamplesSwitch(pmo, { enabled: true });
    assert.equal(on.enabled, true);
    assert.equal(on.examples.length, 1);
    assert.equal((await loadSavedExamples(kit.dataDir)).enabled, true);
    const bad = await setSavedExamplesSwitch(pmo, { enabled: "yes" });
    assert.equal(bad.ok, false);
    const off = await setExamplesEnabled(pmo.store, false);
    assert.equal(off.file.enabled, false);
    assert.equal((await deleteExample(pmo.store, "ex_00000000")).ok, false);
  });
});

describe("a damaged file", () => {
  for (const [name, content] of [
    ["empty", ""],
    ["not JSON", "{ nope"],
    ["wrong shape", '["a", 1]'],
    ["bad entries", '{"enabled": true, "examples": [1, null, {"id": "x"}]}'],
  ]) {
    it(`${name} reads as an empty library and never throws`, async () => {
      await mkdir(path.join(kit.dataDir, "state"), { recursive: true });
      await writeFile(savedExamplesFile(kit.dataDir), content);
      const file = await loadSavedExamples(kit.dataDir);
      assert.deepEqual(file.examples, []);
      assert.deepEqual(await examplesForPrompt(kit.dataDir, "send the RAID log"), []);
    });
  }

  it("is moved to corrupt/ (never deleted) when the next save replaces it", async () => {
    const pmo = await kit.open(kit.stub(), SETUP);
    await mkdir(path.join(kit.dataDir, "state"), { recursive: true });
    await writeFile(savedExamplesFile(kit.dataDir), "{ nope");
    const saved = await saveExample(pmo.store, {
      subject: "",
      message: "Please send the RAID log",
      draft: draftOf(),
      now: new Date(),
    });
    assert.equal(saved.ok, true);
    const kept = await readdir(path.join(kit.dataDir, "corrupt", "saved-examples"));
    assert.equal(kept.length, 1);
    assert.equal((await loadSavedExamples(kit.dataDir)).examples.length, 1);
  });
});

describe("saving from the review queue", () => {
  it("stores the message the model read and the draft as reviewed", async () => {
    const pmo = await kit.open(kit.stub(), SETUP);
    const proposal = await kit.structure(pmo);
    const edited = { ...effectiveDraft(proposal), title: "My own wording" };
    const saved = await saveProposalExample(pmo, proposal.id, { draft: edited });
    assert.equal(saved.ok, true);
    assert.equal(saved.count, 1);
    const [one] = (await loadSavedExamples(kit.dataDir)).examples;
    assert.equal(one.title, "My own wording");
    assert.match(one.message, /RAID log/i);
    assert.equal(one.subject.length > 0, true);
    // Saving creates no to-do and leaves the proposal as it was.
    assert.equal((await pmo.store.listTodos()).length, 0);
    assert.equal((await pmo.store.getProposal(proposal.id)).status, "ready");
  });

  it("refuses an invalid draft, an unknown item and an item still being structured", async () => {
    const pmo = await kit.open(kit.stub(), SETUP);
    const proposal = await kit.structure(pmo);
    const good = effectiveDraft(proposal);
    assert.equal((await saveProposalExample(pmo, proposal.id, {})).ok, false);
    assert.equal(
      (await saveProposalExample(pmo, proposal.id, { draft: { ...good, title: "" } })).ok,
      false,
    );
    assert.equal(
      (await saveProposalExample(pmo, "pr_00000000", { draft: good })).ok,
      false,
    );
    assert.equal((await saveProposalExample(pmo, "../x", { draft: good })).ok, false);
    await pmo.store.putProposal({ ...proposal, status: "pending" });
    assert.equal(
      (await saveProposalExample(pmo, proposal.id, { draft: good })).ok,
      false,
    );
    assert.equal((await loadSavedExamples(kit.dataDir)).examples.length, 0);
  });

  it("saving the same message again replaces the example instead of adding a copy", async () => {
    const pmo = await kit.open(kit.stub(), SETUP);
    const proposal = await kit.structure(pmo);
    const good = effectiveDraft(proposal);
    await saveProposalExample(pmo, proposal.id, { draft: good });
    const second = await saveProposalExample(pmo, proposal.id, {
      draft: { ...good, title: "Second wording" },
    });
    assert.equal(second.replaced, true);
    const { examples } = await loadSavedExamples(kit.dataDir);
    assert.equal(examples.length, 1);
    assert.equal(examples[0].title, "Second wording");
  });
});

describe("the structuring prompt the worker sends", () => {
  it("is exactly today's prompt with no examples, or with the switch off", async () => {
    const model = recordingModel();
    const pmo = await kit.open(model, SETUP);
    const config = await pmo.store.loadConfig();
    const baseline = buildSystemPrompt(config.me, config.reminders.timeZone);

    const first = await kit.structure(pmo);
    assert.equal(model.requests[0].system, baseline, "no examples saved");

    await saveProposalExample(pmo, first.id, { draft: effectiveDraft(first) });
    await kit.structure(pmo);
    assert.equal(model.requests[1].system, baseline, "switch off: saved but not used");
    assert.ok(!model.requests[1].system.includes("Saved examples"));
  });

  it("includes the matching saved example when the switch is on, and says so only by count in the log", async () => {
    const model = recordingModel();
    const pmo = await kit.open(model, SETUP);
    const config = await pmo.store.loadConfig();
    const baseline = buildSystemPrompt(config.me, config.reminders.timeZone);

    const first = await kit.structure(pmo);
    const mine = {
      ...effectiveDraft(first),
      title: "Chase Pat for the consolidated RAID log",
    };
    await saveProposalExample(pmo, first.id, { draft: mine });
    await setSavedExamplesSwitch(pmo, { enabled: true });

    await kit.structure(pmo);
    const system = model.requests[1].system;
    assert.notEqual(system, baseline);
    assert.match(system, /Saved examples \(/);
    assert.match(system, /E1\. ".*" -> task "Chase Pat for the consolidated RAID log"/);
    assert.ok(system.length - baseline.length < 2100, "the block stays small");

    // The user prompt is untouched: it still holds only the new message.
    assert.ok(!model.requests[1].prompt.includes("Saved examples"));

    // The logs record that examples were used, as a count, and never their text.
    const calls = (await readLog("logs/ai-calls.jsonl"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(calls[0].savedExamples, undefined);
    assert.equal(calls[1].savedExamples, 1);
    assert.equal(calls[1].promptVersion, 5);
    const [saved] = (await loadSavedExamples(kit.dataDir)).examples;
    const needles = [saved.message.slice(0, 30), "Chase Pat for the consolidated"];
    const logs = [
      await readLog("logs/ai-calls.jsonl"),
      await readLog("logs/ingest.jsonl"),
      await readLog("audit.jsonl"),
    ].join("\n");
    for (const needle of needles) assert.ok(!logs.includes(needle), needle);
  });

  it("an unrelated message gets no example even with the switch on", async () => {
    const model = recordingModel();
    const pmo = await kit.open(model, SETUP);
    const config = await pmo.store.loadConfig();
    const first = await kit.structure(pmo);
    await saveProposalExample(pmo, first.id, { draft: effectiveDraft(first) });
    await setSavedExamplesSwitch(pmo, { enabled: true });
    await kit.structure(pmo, {
      subject: "Lunch",
      body: { format: "text", text: "Fancy pizza on Thursday? Meet downstairs at noon." },
    });
    assert.equal(
      model.requests[1].system,
      buildSystemPrompt(config.me, config.reminders.timeZone),
    );
  });

  it("a damaged examples file never stops structuring", async () => {
    const model = recordingModel();
    const pmo = await kit.open(model, SETUP);
    await mkdir(path.join(kit.dataDir, "state"), { recursive: true });
    await writeFile(savedExamplesFile(kit.dataDir), "{ nope");
    const proposal = await kit.structure(pmo);
    assert.equal(proposal.status, "ready");
    assert.ok(!model.requests[0].system.includes("Saved examples"));
  });
});
