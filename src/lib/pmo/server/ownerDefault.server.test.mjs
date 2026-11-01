// Run with `pnpm test`. Who owns a proposal that is mine, end to end through the
// structuring worker and the approve gate (QA-12): the names given at setup, never
// the Windows account. Throwaway temp directories, the stub model and a fake
// model; nothing touches Ollama or the real data directory.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { approveProposal, updateConfig } from "./actions.ts";
import { SETUP, fakeModel, proposalKit } from "./proposalKit.mjs";
import { osUser } from "./store.ts";
import { effectiveDraft } from "../todoLogic.ts";

const kit = proposalKit();
beforeEach(kit.setup);
afterEach(kit.teardown);

const approve = (pmo, proposal) =>
  approveProposal(pmo, proposal.id, { draft: effectiveDraft(proposal) });

describe("a proposal that is mine", () => {
  it("defaults to the name and address given at setup, not the Windows account", async () => {
    const pmo = await kit.open(kit.stub(), SETUP);
    const proposal = await kit.structure(pmo);
    assert.deepEqual(proposal.draft.owner, {
      name: "Alex Morgan",
      email: "alex.morgan@example.com",
      isMe: true,
    });
    assert.notEqual(proposal.draft.owner.name, osUser());
    assert.deepEqual(effectiveDraft(proposal).owner, proposal.draft.owner);
  });

  it("follows a change of the configured name for the next message", async () => {
    const pmo = await kit.open(kit.stub(), SETUP);
    await kit.structure(pmo);
    const saved = await updateConfig(pmo, {
      me: { names: ["Sam Lee"], emails: ["sam.lee@example.com"] },
    });
    assert.equal(saved.ok, true);
    const proposal = await kit.structure(pmo);
    assert.equal(proposal.draft.owner.name, "Sam Lee");
    assert.equal(proposal.draft.owner.email, "sam.lee@example.com");
  });

  it("overrides a name the model made up and tells the reviewer", async () => {
    const pmo = await kit.open(
      fakeModel({
        owner: { name: "Alwin Saju", email: "alsaju@deloitte.com", isMe: true },
      }),
      SETUP,
    );
    const proposal = await kit.structure(pmo);
    assert.equal(proposal.rawDraft.owner.name, "Alwin Saju");
    assert.equal(proposal.draft.owner.name, "Alex Morgan");
    assert.equal(proposal.draft.owner.email, "alex.morgan@example.com");
    assert.match(proposal.ai.adjustments.join(" "), /Alex Morgan/);
  });

  it("leaves somebody else's proposal with that person", async () => {
    const pmo = await kit.open(
      fakeModel({ owner: { name: "Priya Raman", email: null, isMe: false } }),
      SETUP,
    );
    const proposal = await kit.structure(pmo);
    assert.deepEqual(proposal.draft.owner, {
      name: "Priya Raman",
      email: null,
      isMe: false,
    });
  });

  it("with no name configured stays 'me' without a name: the OS account is never put there", async () => {
    const pmo = await kit.open(kit.stub(), { names: [], emails: [] });
    const proposal = await kit.structure(pmo);
    assert.deepEqual(proposal.draft.owner, { name: null, email: null, isMe: true });
    const done = await approve(pmo, proposal);
    assert.equal(done.ok, true);
    assert.deepEqual(done.todo.owner, { name: null, email: null, isMe: true });
  });
});

describe("who pressed Approve", () => {
  it("an approved to-do is owned by the configured name, while approvedBy and the audit actor stay the OS user", async () => {
    const pmo = await kit.open(kit.stub(), SETUP);
    const proposal = await kit.structure(pmo);
    const done = await approve(pmo, proposal);
    assert.equal(done.todo.owner.name, "Alex Morgan");
    assert.equal(done.todo.approvedBy, osUser());
    const approved = (await readFile(path.join(kit.dataDir, "audit.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .find((entry) => entry.action === "approve");
    assert.equal(approved.user, osUser());
  });
});
