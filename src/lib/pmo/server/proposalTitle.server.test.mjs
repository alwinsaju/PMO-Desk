// Run with `pnpm test`. A proposal's title and its "AI could not structure this"
// marker, end to end through the structuring worker and the approve gate (QA-11).
// Throwaway temp directories, the stub model and a fake model; nothing touches
// Ollama or the real data directory.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { approveProposal } from "./actions.ts";
import { SETUP, SUBJECT, fakeModel, proposalKit } from "./proposalKit.mjs";
import { effectiveDraft } from "../todoLogic.ts";
import { ProposalSchema } from "../types.ts";

const kit = proposalKit();
beforeEach(kit.setup);
afterEach(kit.teardown);

describe("the stub is a realistic test double", () => {
  it("titles a proposal with the subject, not the greeting, and it is fine", async () => {
    const pmo = await kit.open(kit.stub(), SETUP);
    const proposal = await kit.structure(pmo);
    assert.equal(proposal.status, "ready");
    assert.equal(proposal.draft.title, SUBJECT);
    assert.equal(proposal.structuring, "ok");
    assert.doesNotMatch(proposal.draft.description, /^Hi\b/);
    assert.match(proposal.draft.description, /Could you please send me/);
    assert.equal(proposal.quoteVerified, true);
  });

  it("strips RE:/[External] from the subject and, with no usable subject, uses the first sentence", async () => {
    const pmo = await kit.open(kit.stub(), SETUP);
    const reply = await kit.structure(pmo, { subject: "RE: [External] Budget sign-off" });
    assert.equal(reply.draft.title, "Budget sign-off");
    const none = await kit.structure(pmo, { subject: "Hi," });
    assert.match(none.draft.title, /^Could you please send me the consolidated RAID log/);
    assert.ok(none.draft.title.length <= 80);
    assert.equal(none.structuring, "ok");
  });
});

describe("a model that cannot title the message", () => {
  it("gets the subject as its title and is marked as a fallback", async () => {
    const pmo = await kit.open(
      fakeModel({ title: "Hi Alwin,", description: "Hi," }),
      SETUP,
    );
    const proposal = await kit.structure(pmo);
    assert.equal(proposal.status, "ready");
    assert.equal(proposal.rawDraft.title, "Hi Alwin,");
    assert.equal(proposal.draft.title, SUBJECT);
    assert.equal(proposal.structuring, "fallback");
    assert.match(proposal.ai.adjustments.join(" "), /subject line/);
    assert.doesNotMatch(proposal.draft.description, /^Hi\b/);
    assert.equal(effectiveDraft(proposal).title, SUBJECT);
  });

  it("is also caught when the title is only the sender's name", async () => {
    const pmo = await kit.open(fakeModel({ title: "Pat Sample" }), SETUP);
    const proposal = await kit.structure(pmo);
    assert.equal(proposal.draft.title, SUBJECT);
    assert.equal(proposal.structuring, "fallback");
  });

  it("keeps a real model title, and the proposal is fine", async () => {
    const pmo = await kit.open(fakeModel({}), SETUP);
    const proposal = await kit.structure(pmo);
    assert.equal(proposal.draft.title, "Send the RAID log");
    assert.equal(proposal.structuring, "ok");
    assert.deepEqual(proposal.ai.adjustments, []);
  });

  it("can still be approved, with the fallback title", async () => {
    const pmo = await kit.open(fakeModel({ title: "Bonjour," }), SETUP);
    const proposal = await kit.structure(pmo);
    const done = await approveProposal(pmo, proposal.id, {
      draft: effectiveDraft(proposal),
    });
    assert.equal(done.ok, true);
    assert.equal(done.todo.title, SUBJECT);
  });
});

describe("the stored marker", () => {
  it("a proposal from before the marker existed still loads, as fine", async () => {
    const pmo = await kit.open(fakeModel({}), SETUP);
    const proposal = await kit.structure(pmo);
    const { structuring: _dropped, ...legacy } = proposal;
    const parsed = ProposalSchema.safeParse(legacy);
    assert.equal(parsed.success, true);
    assert.equal(parsed.data.structuring, undefined);
    await pmo.store.putProposal(parsed.data);
    const loaded = await pmo.store.getProposal(proposal.id);
    assert.equal(loaded.status, "ready");
    assert.equal(loaded.structuring, undefined);
  });

  it("an unknown value is rejected rather than trusted", () => {
    assert.equal(ProposalSchema.shape.structuring.safeParse("broken").success, false);
  });
});
