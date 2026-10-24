// Run with `pnpm test`. The PATCH rules behind the to-do editor: checkpoints
// (add, rename, reorder, remove, skip, complete), action items with owner and
// due date, snooze, and the "offer done, never silently" rule. Pure.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_ACTION_ITEMS,
  MAX_CHECKPOINTS,
  TodoPatchSchema,
  allCheckpointsComplete,
  applyTodoPatch,
  buildTodo,
  checkpointProgress,
  deriveStage,
  emptyDraft,
  todoLimitProblem,
} from "./todoLogic.ts";

const NOW = "2026-10-26T04:30:00.000Z";
const LATER = "2026-10-26T06:00:00.000Z";

const base = () =>
  buildTodo(
    {
      ...emptyDraft("Fictional task"),
      checkpointTemplate: "followup",
      actionItems: [{ text: "Email Sam", owner: "Pat Example", dueAt: "2026-10-28" }],
    },
    {
      now: NOW,
      approvedBy: "tester",
      source: {
        intakeId: null,
        source: "manual",
        link: null,
        subject: "x",
        sender: null,
        receivedAt: null,
      },
    },
  );
const apply = (todo, patch, now = LATER) => {
  const parsed = TodoPatchSchema.parse(patch);
  return applyTodoPatch(todo, parsed, now);
};
const labels = (todo) => todo.checkpoints.map((c) => c.label);

describe("checkpoint editing", () => {
  it("adds a checkpoint at the end, or at a position, as a pending step", () => {
    const todo = base();
    const end = apply(todo, { addCheckpoints: [{ label: "Escalate" }] }).todo;
    assert.deepEqual(labels(end), [
      "Acknowledged",
      "Waiting on others",
      "Resolved",
      "Escalate",
    ]);
    assert.equal(end.checkpoints[3].state, "pending");
    assert.equal(end.checkpoints[3].kind, "step");
    assert.match(end.checkpoints[3].id, /^cp_/);

    const mid = apply(todo, {
      addCheckpoints: [{ label: "Sign-off", kind: "approval", at: 1 }],
    }).todo;
    assert.deepEqual(labels(mid), [
      "Acknowledged",
      "Sign-off",
      "Waiting on others",
      "Resolved",
    ]);
    assert.equal(mid.checkpoints[1].kind, "approval");
    // A position past the end just appends.
    assert.equal(
      apply(todo, { addCheckpoints: [{ label: "Z", at: 99 }] }).todo.checkpoints[3].label,
      "Z",
    );
  });

  it("renames and removes checkpoints", () => {
    const todo = base();
    const [a, b, c] = todo.checkpoints;
    const renamed = apply(todo, {
      renameCheckpoints: [{ id: b.id, label: "Chased Sam" }],
    }).todo;
    assert.deepEqual(labels(renamed), ["Acknowledged", "Chased Sam", "Resolved"]);
    assert.equal(renamed.checkpoints[1].id, b.id);

    const removed = apply(todo, { removeCheckpointIds: [a.id, "cp_unknown"] }).todo;
    assert.deepEqual(
      removed.checkpoints.map((x) => x.id),
      [b.id, c.id],
    );
  });

  it("reorders with a full id list; ids left out follow in their old order; unknown ids are ignored", () => {
    const todo = base();
    const [a, b, c] = todo.checkpoints;
    assert.deepEqual(
      apply(todo, { checkpointOrder: [c.id, a.id, b.id] }).todo.checkpoints.map(
        (x) => x.id,
      ),
      [c.id, a.id, b.id],
    );
    assert.deepEqual(
      apply(todo, { checkpointOrder: [c.id, "cp_nope"] }).todo.checkpoints.map(
        (x) => x.id,
      ),
      [c.id, a.id, b.id],
    );
    assert.deepEqual(
      apply(todo, { checkpointOrder: [b.id, b.id, a.id] }).todo.checkpoints.map(
        (x) => x.id,
      ),
      [b.id, a.id, c.id],
    );
  });

  it("completes and skips checkpoints, and the stage and progress are derived", () => {
    const todo = base();
    const [a, b, c] = todo.checkpoints;
    assert.equal(deriveStage(todo), "Acknowledged");
    const step = apply(todo, {
      checkpoints: [
        { id: a.id, state: "done" },
        { id: b.id, state: "skipped" },
      ],
    }).todo;
    assert.equal(deriveStage(step), "Resolved");
    assert.deepEqual(checkpointProgress(step), { done: 2, total: 3 });
    assert.equal(step.checkpoints[0].doneAt, LATER);
    assert.equal("stage" in step, false); // never stored
    // Reordering moves the derived stage without touching any state.
    const moved = apply(step, { checkpointOrder: [c.id, a.id, b.id] }).todo;
    assert.equal(deriveStage(moved), "Resolved");
    // Re-opening one clears its timestamp.
    const reopened = apply(step, { checkpoints: [{ id: a.id, state: "pending" }] }).todo;
    assert.equal(reopened.checkpoints[0].doneAt, null);
    assert.equal(deriveStage(reopened), "Acknowledged");
  });

  it("offers done when the last checkpoint completes, never closing the to-do, and withdraws the offer when one is added", () => {
    const todo = base();
    const all = apply(todo, {
      checkpoints: todo.checkpoints.map((c) => ({ id: c.id, state: "done" })),
    });
    assert.equal(all.offerDone, true);
    assert.equal(all.todo.status, "open");
    assert.equal(all.todo.completedAt, null);

    const added = apply(all.todo, { addCheckpoints: [{ label: "One more" }] });
    assert.equal(added.offerDone, false);
    assert.equal(allCheckpointsComplete(all.todo), true);

    // Removing the last pending checkpoint can also complete the set.
    const [a, b, c] = todo.checkpoints;
    const rest = apply(todo, {
      checkpoints: [
        { id: a.id, state: "done" },
        { id: b.id, state: "done" },
      ],
    }).todo;
    assert.equal(apply(rest, { removeCheckpointIds: [c.id] }).offerDone, true);
    // No checkpoints at all is not "complete".
    assert.equal(
      apply(todo, { removeCheckpointIds: todo.checkpoints.map((x) => x.id) }).offerDone,
      false,
    );
  });

  it("records edits for the audit log, and plain progress separately", () => {
    const todo = base();
    assert.deepEqual(apply(todo, { addCheckpoints: [{ label: "x" }] }).kinds, ["edit"]);
    assert.deepEqual(
      apply(todo, { checkpoints: [{ id: todo.checkpoints[0].id, state: "done" }] }).kinds,
      ["progress"],
    );
    assert.deepEqual(
      apply(todo, { checkpointOrder: todo.checkpoints.map((c) => c.id).reverse() }).kinds,
      ["edit"],
    );
  });

  it("rejects an empty label and overlong lists", () => {
    assert.equal(
      TodoPatchSchema.safeParse({ addCheckpoints: [{ label: "   " }] }).success,
      false,
    );
    assert.equal(
      TodoPatchSchema.safeParse({ renameCheckpoints: [{ id: "x", label: "" }] }).success,
      false,
    );
    assert.equal(
      TodoPatchSchema.safeParse({ addCheckpoints: [{ label: "x".repeat(81) }] }).success,
      false,
    );
    const todo = base();
    const many = {
      ...todo,
      checkpoints: Array.from({ length: MAX_CHECKPOINTS + 1 }, (_, i) => ({
        id: `cp_${i}`,
        label: "x",
        kind: "step",
        state: "pending",
      })),
    };
    assert.match(todoLimitProblem(many), /checkpoints/);
    const items = {
      ...todo,
      actionItems: Array.from({ length: MAX_ACTION_ITEMS + 1 }, (_, i) => ({
        id: `ai_${i}`,
        text: "x",
        done: false,
      })),
    };
    assert.match(todoLimitProblem(items), /action items/);
    assert.equal(todoLimitProblem(todo), null);
  });
});

describe("action item editing", () => {
  it("adds items with an optional owner and due date", () => {
    const todo = base();
    const next = apply(todo, {
      addActionItems: [
        { text: "Plain" },
        { text: "Owned", owner: "  Lee Example ", dueAt: "2026-11-02" },
        { text: "Blank owner", owner: "   " },
      ],
    }).todo;
    const [seed, plain, owned, blank] = next.actionItems;
    assert.equal(seed.owner, "Pat Example");
    assert.deepEqual([plain.owner, plain.dueAt], [null, null]);
    assert.deepEqual([owned.owner, owned.dueAt], ["Lee Example", "2026-11-02"]);
    assert.equal(blank.owner, null);
  });

  it("edits text, owner and due date independently, and clears them with null or blank", () => {
    const todo = base();
    const id = todo.actionItems[0].id;
    const retitled = apply(todo, { editActionItems: [{ id, text: "Email Sam today" }] })
      .todo.actionItems[0];
    assert.deepEqual(
      [retitled.text, retitled.owner, retitled.dueAt],
      ["Email Sam today", "Pat Example", "2026-10-28"],
    );
    const moved = apply(todo, {
      editActionItems: [{ id, dueAt: "2026-11-30", owner: "Lee" }],
    }).todo.actionItems[0];
    assert.deepEqual(
      [moved.text, moved.owner, moved.dueAt],
      ["Email Sam", "Lee", "2026-11-30"],
    );
    const cleared = apply(todo, { editActionItems: [{ id, dueAt: null, owner: "" }] })
      .todo.actionItems[0];
    assert.deepEqual([cleared.owner, cleared.dueAt], [null, null]);
    assert.equal(
      apply(todo, { editActionItems: [{ id: "ai_unknown", text: "x" }] }).todo
        .actionItems[0].text,
      "Email Sam",
    );
    assert.deepEqual(apply(todo, { editActionItems: [{ id, text: "x" }] }).kinds, [
      "edit",
    ]);
  });

  it("toggles and removes items, and rejects bad dates and empty text", () => {
    const todo = base();
    const id = todo.actionItems[0].id;
    assert.equal(
      apply(todo, { actionItems: [{ id, done: true }] }).todo.actionItems[0].done,
      true,
    );
    assert.deepEqual(apply(todo, { removeActionItemIds: [id] }).todo.actionItems, []);
    assert.equal(
      TodoPatchSchema.safeParse({ addActionItems: [{ text: "x", dueAt: "soon" }] })
        .success,
      false,
    );
    assert.equal(
      TodoPatchSchema.safeParse({ editActionItems: [{ id, text: "  " }] }).success,
      false,
    );
  });
});

describe("snooze and due date", () => {
  it("sets and clears snoozedUntil without counting as an update", () => {
    const todo = base();
    const until = "2026-10-27T03:30:00.000Z";
    const snoozed = apply(todo, { snoozedUntil: until });
    assert.equal(snoozed.todo.reminders.snoozedUntil, until);
    assert.deepEqual(snoozed.kinds, ["snooze"]);
    assert.equal(snoozed.todo.updatedAt, todo.updatedAt);
    const woken = apply(snoozed.todo, { snoozedUntil: null });
    assert.equal(woken.todo.reminders.snoozedUntil, null);
    assert.equal(woken.todo.updatedAt, todo.updatedAt);
    // Snooze plus a real edit does count.
    assert.equal(
      apply(todo, { snoozedUntil: until, title: "New" }).todo.updatedAt,
      LATER,
    );
    assert.equal(TodoPatchSchema.safeParse({ snoozedUntil: "later" }).success, false);
  });

  it("edits and clears the due date", () => {
    const todo = base();
    assert.equal(apply(todo, { dueAt: "2026-11-03" }).todo.dueAt, "2026-11-03");
    assert.equal(
      apply({ ...todo, dueAt: "2026-11-03" }, { dueAt: null }).todo.dueAt,
      null,
    );
    assert.equal(TodoPatchSchema.safeParse({ dueAt: "03/11/2026" }).success, false);
  });
});
