// Run with `pnpm test`. Who "me" is on a proposal (ownerDefault.ts and its use in
// sanitizeDraft.ts): the names given at setup, never the Windows account (QA-12).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultOwnerToMe, isConfiguredIdentity, isMe } from "./ownerDefault.ts";
import { sanitizeDraft } from "./sanitizeDraft.ts";
import { AiStructuredSchema } from "./types.ts";

const SETUP = { names: ["Alex Morgan", "Alex"], emails: ["alex.morgan@example.com"] };
const NOW = "2026-10-25T12:00:00+05:30";

const draftOf = (patch = {}) =>
  AiStructuredSchema.parse({
    isActionable: true,
    title: "Send the plan",
    description: "Rohan needs it.",
    owner: { name: null, email: null, isMe: true },
    requester: { name: "Rohan Mehta", email: null },
    dueAt: null,
    dueBasis: "none",
    priority: "normal",
    actionItems: [],
    checkpointTemplate: "simple",
    waitingOn: null,
    quote: "q",
    ...patch,
  });

describe("identity matching", () => {
  it("matches the configured names and addresses, ignoring case and spacing", () => {
    assert.equal(isConfiguredIdentity("alex  morgan", SETUP), true);
    assert.equal(isConfiguredIdentity("ALEX.MORGAN@example.com", SETUP), true);
    assert.equal(isConfiguredIdentity("Rohan", SETUP), false);
    assert.equal(isConfiguredIdentity("", SETUP), false);
    assert.equal(isConfiguredIdentity(null, SETUP), false);
    assert.equal(isConfiguredIdentity("me", SETUP), false);
  });

  it("also takes the word 'me' as the user", () => {
    assert.equal(isMe("Me", SETUP), true);
    assert.equal(isMe("Alex", SETUP), true);
    assert.equal(isMe("Rohan", SETUP), false);
    assert.equal(isMe("me", { names: [], emails: [] }), true);
  });
});

describe("defaultOwnerToMe", () => {
  it("returns somebody else's owner as the very same object", () => {
    const owner = { name: "Rohan Mehta", email: null, isMe: false };
    const result = defaultOwnerToMe(owner, SETUP);
    assert.equal(result.owner, owner);
    assert.equal(result.replaced, false);
  });

  it("ignores blank configured entries", () => {
    const { owner } = defaultOwnerToMe(
      { name: null, email: null, isMe: true },
      { names: ["  ", "Alex Morgan"], emails: [""] },
    );
    assert.deepEqual(owner, { name: "Alex Morgan", email: null, isMe: true });
  });

  it("replaces another person's address when the draft is mine and an address is configured", () => {
    const result = defaultOwnerToMe(
      { name: "Alex", email: "somebody.else@example.com", isMe: true },
      SETUP,
    );
    assert.equal(result.owner.name, "Alex");
    assert.equal(result.owner.email, "alex.morgan@example.com");
    assert.equal(result.replaced, true);
  });
});

describe("(e) a draft that is mine carries the names given at setup (QA-12)", () => {
  const go = (owner, me = SETUP) =>
    sanitizeDraft(draftOf({ owner }), { now: NOW, text: "x", me });

  it("fills a blank 'mine' owner with the first configured name and address", () => {
    const { draft, adjustments } = go({ name: null, email: null, isMe: true });
    assert.deepEqual(draft.owner, {
      name: "Alex Morgan",
      email: "alex.morgan@example.com",
      isMe: true,
    });
    assert.deepEqual(adjustments, []);
  });

  it("replaces a name the model (or a stub) made up, and tells the reviewer", () => {
    const { draft, adjustments } = go({
      name: "Alwin Saju",
      email: "alsaju@deloitte.com",
      isMe: true,
    });
    assert.equal(draft.owner.name, "Alex Morgan");
    assert.equal(draft.owner.email, "alex.morgan@example.com");
    assert.equal(draft.owner.isMe, true);
    assert.equal(adjustments.length, 1);
    assert.match(adjustments[0], /Alex Morgan/);
  });

  it("replaces the literal 'me' silently", () => {
    const { draft, adjustments } = go({ name: "me", email: null, isMe: true });
    assert.equal(draft.owner.name, "Alex Morgan");
    assert.deepEqual(adjustments, []);
  });

  it("keeps a name that is already one of mine, alias included", () => {
    assert.equal(go({ name: "Alex", email: null, isMe: true }).draft.owner.name, "Alex");
    assert.equal(
      go({ name: "ALEX MORGAN", email: null, isMe: true }).draft.owner.name,
      "ALEX MORGAN",
    );
    assert.equal(
      go({ name: "Alex", email: "alex.morgan@example.com", isMe: true }).adjustments
        .length,
      0,
    );
  });

  it("treats an owner who matches my name or address as mine", () => {
    const byName = go({ name: "Alex", email: null, isMe: false }).draft.owner;
    assert.deepEqual(byName, {
      name: "Alex",
      email: "alex.morgan@example.com",
      isMe: true,
    });
    const byEmail = go({ name: null, email: "Alex.Morgan@example.com", isMe: null }).draft
      .owner;
    assert.equal(byEmail.isMe, true);
    assert.equal(byEmail.name, "Alex Morgan");
  });

  it("does not touch somebody else's draft", () => {
    for (const owner of [
      { name: "Rohan Mehta", email: "rohan@x.example", isMe: false },
      { name: "Rohan Mehta", email: null, isMe: null },
      { name: null, email: null, isMe: null },
    ]) {
      const { draft, adjustments } = go(owner);
      assert.deepEqual(draft.owner, owner);
      assert.deepEqual(adjustments, []);
    }
  });

  it("with nothing configured, leaves the model's owner as it is (never the OS account)", () => {
    const none = { names: [], emails: [] };
    assert.deepEqual(go({ name: null, email: null, isMe: true }, none).draft.owner, {
      name: null,
      email: null,
      isMe: true,
    });
    assert.equal(
      go({ name: "Somebody", email: null, isMe: true }, none).draft.owner.name,
      "Somebody",
    );
  });

  it("with only an address configured, fills just the address", () => {
    const { draft } = go(
      { name: null, email: null, isMe: true },
      { names: [], emails: ["alex.morgan@example.com"] },
    );
    assert.deepEqual(draft.owner, {
      name: null,
      email: "alex.morgan@example.com",
      isMe: true,
    });
  });

  it("still clears 'waiting on' judged against the owner the model named", () => {
    const { draft } = go({ name: "Pat Sample", email: null, isMe: true });
    assert.equal(draft.owner.name, "Alex Morgan");
    const waiting = sanitizeDraft(
      draftOf({
        owner: { name: "Pat Sample", email: null, isMe: true },
        waitingOn: "Pat Sample",
      }),
      { now: NOW, text: "x", me: SETUP },
    );
    assert.equal(waiting.draft.waitingOn, null);
  });
});
