// Run with `pnpm test`. Deterministic handling of several tasks in one message
// (splitTasks.ts) and the model-answer schema, with mocked model output only.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { asTaskList, isNearDuplicate, selectTasks } from "./splitTasks.ts";
import { AiModelTasksSchema, AiStructuredSchema, MAX_TASKS_PER_MESSAGE } from "./types.ts";
import { siblingProposalId } from "./dedupe.ts";
import { isSafeId } from "./server/paths.ts";

const task = (patch = {}) =>
  AiStructuredSchema.parse({
    isActionable: true,
    title: "Send the weekly report to Rahul",
    description: "",
    owner: { name: null, email: null, isMe: null },
    requester: { name: null, email: null },
    dueAt: null,
    dueBasis: "none",
    priority: "normal",
    actionItems: [],
    checkpointTemplate: "simple",
    waitingOn: null,
    quote: "send the weekly report",
    ...patch,
  });
const pick = (list) => selectTasks(list, (t) => t);

describe("asTaskList", () => {
  it("wraps a single task and passes a list through", () => {
    const one = task();
    assert.deepEqual(asTaskList(one), [one]);
    assert.deepEqual(asTaskList([one, one]), [one, one]);
  });
});

describe("selectTasks", () => {
  const report = task();
  const room = task({ title: "Book the room for Thursday's review", quote: "book the room" });
  const chase = task({ title: "Chase Dev about the invoice", quote: "chase Dev" });

  it("keeps independent tasks in the model's order", () => {
    const { kept, notes } = pick([report, room, chase]);
    assert.deepEqual(
      kept.map((t) => t.title),
      [report.title, room.title, chase.title],
    );
    assert.deepEqual(notes, []);
  });

  it("keeps a single task untouched, even a non-actionable one", () => {
    assert.equal(pick([task({ isActionable: false })]).kept.length, 1);
  });

  it("drops non-actionable extras but keeps one 'not a task' entry when none is actionable", () => {
    const fyi = task({ isActionable: false, title: "Thanks for the update" });
    const r = pick([report, fyi]);
    assert.equal(r.kept.length, 1);
    assert.match(r.notes[0], /need no action/);
    const none = pick([fyi, task({ isActionable: false, title: "Newsletter" })]);
    assert.deepEqual(
      none.kept.map((t) => t.title),
      [fyi.title],
    );
  });

  it("leads with an actionable task when the first entry is an FYI", () => {
    const fyi = task({ isActionable: false, title: "Thanks" });
    assert.equal(pick([fyi, report]).kept[0].title, report.title);
  });

  it("merges near-identical tasks", () => {
    const dup = task({ title: "Send weekly report to Rahul" });
    const r = pick([report, dup, room]);
    assert.deepEqual(
      r.kept.map((t) => t.title),
      [report.title, room.title],
    );
    assert.match(r.notes.join(" "), /near-identical/);
    assert.equal(isNearDuplicate(report, room), false);
  });

  it("folds a task that is only a step already listed under an earlier task", () => {
    const deck = task({
      title: "Prepare steering committee deck",
      actionItems: [
        { text: "Update the budget slide", owner: null, dueAt: null },
        { text: "Send it to Anna for sign-off", owner: null, dueAt: null },
      ],
    });
    const step = task({ title: "Update the budget slide", quote: "update the budget slide" });
    const r = pick([deck, step]);
    assert.equal(r.kept.length, 1);
    assert.match(r.notes.join(" "), /sub-step/);
  });

  it("caps the number of tasks", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      task({ title: `Distinct errand number${i} for contact${i}`, quote: `q${i}` }),
    );
    const r = pick(many);
    assert.equal(r.kept.length, MAX_TASKS_PER_MESSAGE);
    assert.match(r.notes.join(" "), /Kept the first 5 of 9/);
  });
});

describe("AiModelTasksSchema", () => {
  const lean = (patch = {}) => ({
    isActionable: true,
    title: "Do a thing",
    description: "",
    owner: { name: null, email: null, isMe: null },
    requester: { name: null, email: null },
    recurrence: null,
    dueAt: null,
    dueBasis: "none",
    priority: "normal",
    actionItems: [],
    checkpointTemplate: "simple",
    waitingOn: null,
    quote: "x",
    ...patch,
  });

  it("accepts one or several tasks and rejects an empty list or a bare object", () => {
    assert.equal(AiModelTasksSchema.safeParse({ tasks: [lean()] }).success, true);
    const three = AiModelTasksSchema.parse({ tasks: [lean(), lean(), lean()] });
    assert.equal(three.tasks.length, 3);
    assert.equal(AiModelTasksSchema.safeParse({ tasks: [] }).success, false);
    assert.equal(AiModelTasksSchema.safeParse(lean()).success, false);
  });

  it("caps an over-eager answer", () => {
    const r = AiModelTasksSchema.parse({ tasks: Array.from({ length: 12 }, () => lean()) });
    assert.equal(r.tasks.length, MAX_TASKS_PER_MESSAGE + 2);
  });
});

describe("siblingProposalId", () => {
  it("is deterministic, distinct per index and a safe record id", () => {
    const a = siblingProposalId("pr_0123456789abcdef0123", 2);
    assert.equal(a, siblingProposalId("pr_0123456789abcdef0123", 2));
    assert.notEqual(a, siblingProposalId("pr_0123456789abcdef0123", 3));
    assert.equal(isSafeId(a), true);
  });
});
