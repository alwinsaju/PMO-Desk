// Run with `pnpm test`. Plans for the command bar's to-do commands.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchTodo, planLocalIntent } from "./barActions.ts";

const todos = [
  { id: "t1", title: "Release plan v2", status: "open", waitingOn: null },
  { id: "t2", title: "Vendor invoice March", status: "open", waitingOn: "Sam" },
  { id: "t3", title: "Vendor contract renewal", status: "open", waitingOn: null },
  { id: "t4", title: "Old thing", status: "done", waitingOn: null },
];
const ctx = {
  todos,
  today: "2026-10-30", // Friday
  now: new Date("2026-10-30T04:30:00.000Z"),
  prefs: { timeZone: "Asia/Kolkata", workStart: "09:00" },
};
const plan = (intent) => planLocalIntent(intent, ctx);

describe("matchTodo", () => {
  it("finds one open to-do by some of its words", () => {
    assert.equal(matchTodo(todos, "release plan").todo.id, "t1");
    assert.equal(matchTodo(todos, "the Vendor invoice").todo.id, "t2");
  });

  it("prefers an exact title and ignores closed to-dos", () => {
    assert.equal(matchTodo(todos, "release plan v2").todo.id, "t1");
    assert.equal(matchTodo(todos, "old thing").kind, "none");
  });

  it("reports several matches and none", () => {
    const many = matchTodo(todos, "vendor");
    assert.equal(many.kind, "many");
    assert.equal(many.todos.length, 2);
    assert.equal(matchTodo(todos, "zzz").kind, "none");
    assert.equal(matchTodo(todos, "  ").kind, "none");
  });
});

describe("planLocalIntent", () => {
  it("plans a new to-do with its due day", () => {
    const p = plan({ kind: "create_todo", text: "send the invoice Monday" });
    assert.equal(p.type, "do");
    assert.equal(p.confirmKey, "create_todo");
    assert.deepEqual(p.effect, {
      op: "create",
      title: "send the invoice",
      dueAt: "2026-11-02",
    });
    assert.match(p.detail, /Due Mon 2 Nov 2026/);
  });

  it("plans closing a to-do, asking first", () => {
    const p = plan({
      kind: "todo_action",
      action: "done",
      query: "release plan",
      until: "",
    });
    assert.equal(p.confirmKey, "todo_done");
    assert.deepEqual(p.effect, { op: "patch", todoId: "t1", patch: { status: "done" } });
  });

  it("plans a snooze to a named day at the start of the working day", () => {
    const p = plan({
      kind: "todo_action",
      action: "snooze",
      query: "vendor invoice",
      until: "Monday",
    });
    assert.equal(p.confirmKey, "todo_snooze");
    assert.equal(p.effect.todoId, "t2");
    // Mon 2 Nov 09:00 in Kolkata = 03:30 UTC.
    assert.equal(p.effect.patch.snoozedUntil, "2026-11-02T03:30:00.000Z");
  });

  it("snoozes to tomorrow when no day is given, and refuses today or a bad day", () => {
    const tomorrow = plan({
      kind: "todo_action",
      action: "snooze",
      query: "release plan",
      until: "",
    });
    assert.equal(tomorrow.effect.patch.snoozedUntil, "2026-10-31T03:30:00.000Z");
    const today = plan({
      kind: "todo_action",
      action: "snooze",
      query: "release plan",
      until: "today",
    });
    assert.equal(today.type, "say");
    const bad = plan({
      kind: "todo_action",
      action: "snooze",
      query: "release plan",
      until: "blue moon",
    });
    assert.match(bad.text, /couldn't tell which day "blue moon"/);
  });

  it("opens a chaser without asking, since it only opens a draft", () => {
    const p = plan({
      kind: "todo_action",
      action: "chase",
      query: "vendor invoice",
      until: "Sam",
    });
    assert.equal(p.confirmKey, null);
    assert.deepEqual(p.effect, { op: "chaser", todoId: "t2" });
  });

  it("says so when nothing or several to-dos match", () => {
    assert.match(
      plan({ kind: "todo_action", action: "done", query: "zzz", until: "" }).text,
      /couldn't find an open to-do matching "zzz"/,
    );
    const many = plan({
      kind: "todo_action",
      action: "done",
      query: "vendor",
      until: "",
    });
    assert.match(many.text, /More than one open to-do matches "vendor"/);
    assert.match(many.text, /• Vendor invoice March/);
  });
});
