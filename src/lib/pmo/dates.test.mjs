// Run with `pnpm test`. Dates that do not exist (2026-02-30) are refused by a real
// round trip wherever a person's input is parsed, and a blank intake sourceId
// gets a stable derived id. Pure: no files, no clock.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { dedupeKey, deriveSourceId, todoIdForProposal } from "./dedupe.ts";
import { instantFromLocalInput } from "./due.ts";
import { isRealIsoDay, isRealIsoInstant } from "./time.ts";
import { TodoPatchSchema } from "./todoLogic.ts";
import { IntakeSchema, TodoDraftSchema } from "./types.ts";

const intake = (patch = {}) => ({
  schema: "pmo-intake/1",
  source: "outlook",
  sourceId: "AAMk-1",
  receivedAt: "2026-10-22T09:14:00+05:30",
  sender: { name: "Pat Sample", address: "pat.sample@deloitte.com" },
  subject: "Status pack",
  body: { text: "Please send the RAID log.", format: "text" },
  ...patch,
});

const draft = (patch = {}) => ({
  title: "Send the RAID log",
  description: "",
  owner: { name: "Me", email: null, isMe: true },
  requester: { name: "Pat", email: null },
  dueAt: "2026-10-27",
  priority: "normal",
  actionItems: [],
  checkpointTemplate: "deliverable",
  waitingOn: null,
  tags: [],
  ...patch,
});

describe("real calendar days", () => {
  it("accepts real days, including a leap day", () => {
    for (const day of ["2026-10-27", "2028-02-29", "2026-12-31", "2026-04-30"]) {
      assert.equal(isRealIsoDay(day), true, day);
    }
  });

  it("refuses days Date.parse would quietly roll into the next month", () => {
    for (const day of [
      "2026-02-30",
      "2026-02-29",
      "2026-04-31",
      "2026-13-01",
      "2026-00-10",
      "2026-10-00",
      "26-10-10",
    ]) {
      assert.equal(isRealIsoDay(day), false, day);
    }
    assert.ok(
      !Number.isNaN(Date.parse("2026-02-30")),
      "the premise: Date.parse accepts it",
    );
  });

  it("checks the day inside a date-time too", () => {
    assert.equal(isRealIsoInstant("2026-10-27T09:00:00Z"), true);
    assert.equal(isRealIsoInstant("2026-02-30T09:00:00Z"), false);
    assert.equal(isRealIsoInstant("2026-02-30 09:00"), false);
    assert.equal(isRealIsoInstant("not a date"), false);
  });
});

describe("dates a person submits", () => {
  it("a to-do draft with 2026-02-30 is refused with a clear message, a real day passes", () => {
    const bad = TodoDraftSchema.safeParse(draft({ dueAt: "2026-02-30" }));
    assert.equal(bad.success, false);
    assert.match(bad.error.issues[0].message, /real calendar date/);
    assert.equal(TodoDraftSchema.safeParse(draft({ dueAt: "2028-02-29" })).success, true);
    const item = draft({
      actionItems: [{ text: "x", owner: null, dueAt: "2026-04-31" }],
    });
    assert.equal(TodoDraftSchema.safeParse(item).success, false);
  });

  it("a patch with a day that does not exist is refused", () => {
    for (const patch of [
      { dueAt: "2026-02-30" },
      { addActionItems: [{ text: "x", dueAt: "2026-02-30" }] },
      { editActionItems: [{ id: "a", dueAt: "2026-02-30" }] },
      { snoozedUntil: "2026-02-30T09:00:00Z" },
      { waitingSince: "2026-02-30T09:00:00Z" },
    ]) {
      const parsed = TodoPatchSchema.safeParse(patch);
      assert.equal(parsed.success, false, JSON.stringify(patch));
      assert.match(parsed.error.issues[0].message, /real calendar/);
    }
    assert.equal(TodoPatchSchema.safeParse({ dueAt: "2026-03-02" }).success, true);
    assert.equal(TodoPatchSchema.safeParse({ dueAt: null }).success, true);
  });

  it("the snooze box does not turn 2026-02-30 into March", () => {
    assert.equal(instantFromLocalInput("2026-02-30T09:30", "Asia/Kolkata"), null);
    assert.ok(instantFromLocalInput("2026-03-02T09:30", "Asia/Kolkata"));
  });

  it("an intake received on a day that does not exist is refused", () => {
    assert.equal(IntakeSchema.safeParse(intake()).success, true);
    const bad = IntakeSchema.safeParse(intake({ receivedAt: "2026-02-30T09:14:00Z" }));
    assert.equal(bad.success, false);
    assert.match(bad.error.issues[0].message, /real calendar day/);
  });
});

describe("blank sourceId", () => {
  it("is accepted when empty, spaces or null, but the key must be present", () => {
    for (const sourceId of ["", "   ", null]) {
      const parsed = IntakeSchema.safeParse(intake({ sourceId }));
      assert.equal(parsed.success, true, String(sourceId));
      assert.equal(parsed.data.sourceId, "");
    }
    const { sourceId: _omitted, ...without } = intake();
    assert.equal(IntakeSchema.safeParse(without).success, false);
    assert.equal(
      IntakeSchema.parse(intake({ sourceId: "  AAMk-1 " })).sourceId,
      "AAMk-1",
    );
  });

  it("derives a stable sha256-based id from sender, subject, receivedAt and the body", () => {
    const base = IntakeSchema.parse(intake({ sourceId: "" }));
    const id = deriveSourceId(base);
    assert.match(id, /^derived-[0-9a-f]{32}$/);
    assert.equal(deriveSourceId({ ...base }), id, "stable");
    assert.equal(
      deriveSourceId({
        ...base,
        body: { ...base.body, text: "  PLEASE send   the RAID log. " },
      }),
      id,
      "case and spacing do not matter",
    );
    const sha = createHash("sha256")
      .update(
        `outlook|pat.sample@deloitte.com|status pack|2026-10-22T09:14:00+05:30|please send the raid log.`,
      )
      .digest("hex");
    assert.equal(id, `derived-${sha.slice(0, 32)}`);
    for (const change of [
      { subject: "Other subject" },
      { receivedAt: "2026-10-23T09:14:00+05:30" },
      { sender: { name: "Someone", address: "someone@deloitte.com" } },
      { body: { text: "Different body", format: "text" } },
    ]) {
      assert.notEqual(deriveSourceId({ ...base, ...change }), id, JSON.stringify(change));
    }
  });

  it("the dedupe key of a blank sourceId equals the key of its derived id", () => {
    const base = IntakeSchema.parse(intake({ sourceId: "" }));
    assert.equal(dedupeKey(base), dedupeKey({ ...base, sourceId: deriveSourceId(base) }));
    assert.notEqual(dedupeKey(base), dedupeKey({ ...base, sourceId: "AAMk-1" }));
  });

  it("the JSON schema and the contract agree with the validator", () => {
    const root = new URL("../../../pmo-intake/", import.meta.url);
    const schema = JSON.parse(
      readFileSync(new URL("intake.v1.schema.json", root), "utf8"),
    );
    assert.ok(schema.required.includes("sourceId"), "the key is still required");
    assert.ok([].concat(schema.properties.sourceId.type).includes("null"));
    assert.equal(schema.properties.sourceId.minLength, undefined);
    const contract = readFileSync(new URL("PMO-INTAKE-CONTRACT.md", root), "utf8");
    assert.match(contract, /sourceId` is blank/);
    assert.match(contract, /sender \| subject \| receivedAt/);
  });
});

describe("todoIdForProposal", () => {
  it("is deterministic, distinct per proposal and a safe td_ id", () => {
    assert.equal(todoIdForProposal("pr_a"), todoIdForProposal("pr_a"));
    assert.notEqual(todoIdForProposal("pr_a"), todoIdForProposal("pr_b"));
    assert.match(todoIdForProposal("pr_a"), /^td_[0-9a-f]{20}$/);
  });
});
