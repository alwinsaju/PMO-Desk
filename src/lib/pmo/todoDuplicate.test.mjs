import assert from "node:assert/strict";
import test from "node:test";
import { duplicateTodoDraft } from "./todoDuplicate.ts";
import { TodoDraftSchema } from "./types.ts";

const todo = {
  id: "td_0123456789abcdef",
  title: "Send the deck",
  description: "For the steering committee",
  owner: { name: "Priya Shah", email: "p@example.com", isMe: false },
  requester: { name: "Sam", email: null },
  dueAt: "2026-11-10",
  priority: "high",
  actionItems: [
    { id: "ai_1", text: "Draft", done: true, owner: "Priya Shah", dueAt: "2026-11-08" },
    { id: "ai_2", text: "Review", done: false, owner: null, dueAt: null },
  ],
  checkpoints: [{ id: "cp_1", label: "Anything", done: true }],
  status: "done",
  waitingOn: "Sam",
  waitingSince: "2026-11-01T00:00:00.000Z",
  tags: ["raid"],
  blockedBy: ["td_other"],
  recurrence: "weekly",
  source: { source: "manual", intakeId: "in_1", sender: "x", subject: "s" },
  reminders: {
    enabled: true,
    remindAt: null,
    snoozedUntil: "2026-12-01",
    lastRemindedAt: null,
  },
  createdAt: "2026-10-01T00:00:00.000Z",
  approvedAt: "2026-10-01T00:00:00.000Z",
  approvedBy: "me",
  updatedAt: "2026-10-02T00:00:00.000Z",
  completedAt: "2026-10-03T00:00:00.000Z",
  history: [{ id: "h" }],
};

test("duplicateTodoDraft: keeps the content, marks the title, drops the original's life", () => {
  const draft = duplicateTodoDraft(todo);
  assert.equal(draft.title, "Send the deck (copy)");
  assert.equal(draft.description, todo.description);
  assert.equal(draft.dueAt, "2026-11-10");
  assert.equal(draft.priority, "high");
  assert.deepEqual(draft.tags, ["raid"]);
  assert.equal(draft.waitingOn, null);
  assert.deepEqual(
    draft.actionItems.map((i) => [i.text, i.owner, i.dueAt]),
    [
      ["Draft", "Priya Shah", "2026-11-08"],
      ["Review", null, null],
    ],
  );
  for (const key of [
    "id",
    "createdAt",
    "approvedAt",
    "approvedBy",
    "updatedAt",
    "completedAt",
    "history",
    "source",
    "status",
    "reminders",
    "blockedBy",
    "waitingSince",
    "checkpoints",
  ]) {
    assert.equal(key in draft, false, `${key} must not be copied`);
  }
});

test("duplicateTodoDraft: the draft is accepted by the create schema", () => {
  assert.equal(TodoDraftSchema.safeParse(duplicateTodoDraft(todo)).success, true);
  const none = duplicateTodoDraft({ ...todo, dueAt: null, title: "x".repeat(200) });
  assert.equal(none.dueAt, null);
  assert.equal(none.title.length, 200);
  assert.equal(TodoDraftSchema.safeParse(none).success, true);
});

test("duplicateTodoDraft: does not change the original", () => {
  const before = JSON.stringify(todo);
  duplicateTodoDraft(todo).owner.name = "Changed";
  assert.equal(JSON.stringify(todo), before);
});
