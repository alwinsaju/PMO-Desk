// Run with `pnpm test`. The update plan: what an approved "update to existing
// to-do" would change (diff), which changes are ticked by default, the merged
// patch and how it lands on the to-do (history, waiting clock). Pure.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AiUpdateSchema } from "./types.ts";
import {
  appendHistory,
  applyTodoPatch,
  buildTodo,
  emptyDraft,
  historyEntry,
  TodoPatchSchema,
} from "./todoLogic.ts";
import {
  defaultInclude,
  describeApplied,
  patchFromChanges,
  planUpdate,
} from "./updateLogic.ts";

const NOW = "2026-10-26T04:30:00.000Z";

const todoWith = (patch = {}) => ({
  ...buildTodo(
    {
      ...emptyDraft("Send the RAID log"),
      description: "Pat needs it for the pre-read.",
      dueAt: "2026-10-30",
      waitingOn: "Jordan Sample",
      actionItems: [{ text: "Export the log", owner: null, dueAt: null }],
    },
    {
      now: "2026-10-22T04:30:00.000Z",
      approvedBy: "tester",
      source: {
        intakeId: "in_aaaaaaaaaaaaaaaa",
        source: "outlook",
        link: null,
        subject: "RAID log",
        sender: "Pat Sample",
        receivedAt: null,
        threadKey: "outlook|m|c",
      },
    },
  ),
  ...patch,
});

const ai = (patch = {}) =>
  AiUpdateSchema.parse({
    reason: "r",
    kind: "reply",
    summary: "Jordan sent the figures.",
    clearsWaiting: true,
    newDueAt: null,
    newActionItems: [],
    note: null,
    quote: "q",
    ...patch,
  });

const ctx = (sender = { name: "Jordan Sample", address: "jordan.sample@deloitte.com" }) => ({
  sender,
  receivedAt: "2026-10-26T03:00:00.000Z",
});

describe("planUpdate", () => {
  it("proposes clearing waiting, ticked by default, when a reply comes from the person waited on", () => {
    const plan = planUpdate(todoWith(), ai(), ctx());
    assert.equal(plan.replyFrom, "Jordan Sample");
    assert.equal(plan.kind, "reply");
    const [waiting] = plan.changes;
    assert.equal(waiting.id, "waiting");
    assert.equal(waiting.before, "Jordan Sample");
    assert.equal(waiting.defaultOn, true);
    assert.match(waiting.hint, /Looks like a reply from Jordan Sample: clear waiting\?/);
    assert.deepEqual(defaultInclude(plan.changes), ["waiting"]);
  });

  it("does not tick 'clear waiting' when the sender is someone else, but still offers it", () => {
    const plan = planUpdate(
      todoWith(),
      ai(),
      ctx({ name: "Pat Sample", address: "pat.sample@deloitte.com" }),
    );
    assert.equal(plan.replyFrom, null);
    const waiting = plan.changes.find((c) => c.id === "waiting");
    assert.equal(waiting.defaultOn, false);
    assert.match(waiting.hint, /not obviously Jordan Sample/);
  });

  it("suggests clearing waiting on a matching sender even when the model did not flag it, unticked", () => {
    const plan = planUpdate(
      todoWith(),
      ai({ kind: "new-info", clearsWaiting: false, note: "Still gathering the rest." }),
      ctx(),
    );
    const waiting = plan.changes.find((c) => c.id === "waiting");
    assert.equal(waiting.defaultOn, false);
    assert.match(waiting.hint, /Looks like a reply from/);
  });

  it("offers nothing about waiting when the to-do is not waiting", () => {
    const plan = planUpdate(todoWith({ waitingOn: null }), ai(), ctx());
    assert.equal(plan.changes.find((c) => c.id === "waiting"), undefined);
    assert.equal(plan.replyFrom, null);
    assert.equal(plan.kind, "nothing", "no change survives, so it is just a linked message");
  });

  it("shows a due-date change as before -> after, and drops one that is not a change", () => {
    const plan = planUpdate(
      todoWith(),
      ai({ kind: "due-change", clearsWaiting: false, newDueAt: "2026-11-03" }),
      ctx(),
    );
    const due = plan.changes.find((c) => c.id === "due");
    assert.equal(due.before, "Fri, 30 Oct 2026");
    assert.equal(due.after, "Tue, 3 Nov 2026");
    assert.deepEqual(due.patch, { dueAt: "2026-11-03" });
    const same = planUpdate(
      todoWith(),
      ai({ kind: "due-change", clearsWaiting: false, newDueAt: "2026-10-30" }),
      ctx({ name: "Someone Else" }),
    );
    assert.equal(same.changes.find((c) => c.id === "due"), undefined);
  });

  it("adds new action items but not ones the to-do already has", () => {
    const plan = planUpdate(
      todoWith({ waitingOn: null }),
      ai({
        kind: "new-action",
        clearsWaiting: false,
        newActionItems: [
          { text: "Export the log.", owner: null, dueAt: null },
          { text: "Confirm milestone M4", owner: "Pat Sample", dueAt: "2026-11-02" },
          { text: "confirm milestone m4", owner: null, dueAt: null },
        ],
      }),
      ctx(),
    );
    const actions = plan.changes.filter((c) => c.kind === "action");
    assert.equal(actions.length, 1, "duplicates of existing and of each other are dropped");
    assert.match(actions[0].after, /Confirm milestone M4 \(Pat Sample, due Mon, 2 Nov 2026\)/);
    assert.deepEqual(actions[0].patch.addActionItems, [
      { text: "Confirm milestone M4", owner: "Pat Sample", dueAt: "2026-11-02" },
    ]);
  });

  it("appends a dated note to the description", () => {
    const plan = planUpdate(
      todoWith({ waitingOn: null }),
      ai({ kind: "new-info", clearsWaiting: false, note: "Figures are still draft." }),
      ctx(),
    );
    const note = plan.changes.find((c) => c.id === "note");
    assert.match(note.after, /^Update Mon, 26 Oct 2026: Figures are still draft\.$/);
    assert.equal(
      note.patch.description,
      "Pat needs it for the pre-read.\n\nUpdate Mon, 26 Oct 2026: Figures are still draft.",
    );
  });

  it("proposes nothing for an unrelated message, and labels an empty plan 'nothing'", () => {
    const unrelated = planUpdate(
      todoWith(),
      ai({ kind: "unrelated", note: "x", newDueAt: "2026-11-09" }),
      ctx(),
    );
    assert.deepEqual(unrelated.changes, []);
    assert.equal(unrelated.kind, "unrelated");
    const nothing = planUpdate(
      todoWith({ waitingOn: null }),
      ai({ kind: "nothing", clearsWaiting: false }),
      ctx(),
    );
    assert.equal(nothing.kind, "nothing");
  });

  it("ignores a note the model attached to a 'nothing' answer", () => {
    const plan = planUpdate(
      todoWith({ waitingOn: null }),
      ai({ kind: "nothing", clearsWaiting: false, note: "Priya acknowledged the request." }),
      ctx(),
    );
    assert.deepEqual(plan.changes, []);
    assert.equal(plan.kind, "nothing");
  });
});

describe("patchFromChanges and applying it", () => {
  const big = () =>
    planUpdate(
      todoWith(),
      ai({
        kind: "reply",
        newDueAt: "2026-11-03",
        note: "Figures attached.",
        newActionItems: [{ text: "Review the figures", owner: null, dueAt: null }],
      }),
      ctx(),
    );

  it("merges only the ticked changes", () => {
    const plan = big();
    assert.equal(plan.changes.length, 4);
    const all = patchFromChanges(plan.changes, new Set(plan.changes.map((c) => c.id)));
    assert.equal(all.waitingOn, null);
    assert.equal(all.dueAt, "2026-11-03");
    assert.equal(all.addActionItems.length, 1);
    assert.match(all.description, /Figures attached\./);
    const some = patchFromChanges(plan.changes, new Set(["due"]));
    assert.deepEqual(some, { dueAt: "2026-11-03" });
    assert.deepEqual(patchFromChanges(plan.changes, new Set()), {});
  });

  it("lands on the to-do: waiting cleared with its clock, items added, history written", () => {
    const todo = todoWith();
    const plan = big();
    const patch = TodoPatchSchema.parse(
      patchFromChanges(plan.changes, new Set(defaultInclude(plan.changes))),
    );
    const message = historyEntry("message", "Jordan sent the figures.", NOW, {
      intakeId: "in_bbbbbbbbbbbbbbbb",
      from: "Jordan Sample",
    });
    const { todo: next } = applyTodoPatch(
      { ...todo, history: appendHistory(todo.history, message) },
      patch,
      NOW,
    );
    assert.equal(next.waitingOn, null);
    assert.equal(next.waitingSince, null);
    assert.equal(next.dueAt, "2026-11-03");
    assert.equal(next.actionItems.length, 2);
    const kinds = next.history.map((h) => h.kind);
    assert.deepEqual(kinds.slice(0, 2), ["created", "waiting"]);
    assert.ok(kinds.includes("message") && kinds.includes("due"));
    assert.equal(
      next.history.find((h) => h.kind === "message").intakeId,
      "in_bbbbbbbbbbbbbbbb",
    );
    assert.equal(todo.waitingOn, "Jordan Sample", "the input to-do is not mutated");
  });

  it("describes what was applied and what was skipped for the timeline", () => {
    const plan = big();
    const applied = plan.changes.filter((c) => ["waiting", "due"].includes(c.id));
    const text = describeApplied("Jordan sent the figures.", applied, 2);
    assert.match(text, /Jordan sent the figures\. Applied: cleared waiting; due date now Tue, 3 Nov 2026\./);
    assert.match(text, /2 suggested changes skipped/);
    assert.match(describeApplied("", [], 0), /Linked, no changes applied\./);
  });
});
