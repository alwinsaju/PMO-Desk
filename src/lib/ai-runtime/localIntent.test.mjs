// Run with `pnpm test`. What the command bar recognises beyond who's-off questions.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveLocalIntent } from "./localIntent.ts";
import { resolvePmoIntent } from "./pmoIntent.ts";

const pmo = (text) => resolvePmoIntent(text);
const local = (text) => resolveLocalIntent(text);

describe("person and change questions (answered from the data)", () => {
  it("when is someone back", () => {
    assert.deepEqual(pmo("when is Ana back?"), { kind: "person_back", name: "Ana" });
    assert.deepEqual(pmo("When will Ana Rao return"), {
      kind: "person_back",
      name: "Ana Rao",
    });
    assert.deepEqual(pmo("is Ben back"), { kind: "person_back", name: "Ben" });
  });

  it("a person's shift, with an optional day", () => {
    assert.deepEqual(pmo("what's Ben's shift tomorrow?"), {
      kind: "person_shift",
      name: "Ben",
      when: "tomorrow",
    });
    assert.deepEqual(pmo("What shift is Ben on next Monday"), {
      kind: "person_shift",
      name: "Ben",
      when: "next Monday",
    });
    assert.deepEqual(pmo("what is Ana Rao's shift"), {
      kind: "person_shift",
      name: "Ana Rao",
      when: "",
    });
  });

  it("what changed since a time", () => {
    assert.deepEqual(pmo("what changed since yesterday?"), {
      kind: "changes",
      since: "yesterday",
    });
    assert.deepEqual(pmo("what's changed"), { kind: "changes", since: "" });
    assert.equal(pmo("what's new"), null);
  });

  it("does not take over the older questions", () => {
    assert.deepEqual(pmo("who's off next Monday?"), {
      kind: "whos_off",
      when: "next Monday",
    });
    assert.deepEqual(pmo("what's overdue?"), { kind: "pmo_status", topic: "overdue" });
  });
});

describe("commands done in the browser", () => {
  it("creates a to-do", () => {
    assert.deepEqual(local("remind me to send the invoice Friday"), {
      kind: "create_todo",
      text: "send the invoice Friday",
    });
    assert.deepEqual(local("add a to-do: book the room"), {
      kind: "create_todo",
      text: "book the room",
    });
    assert.deepEqual(local("new task call Sam tomorrow"), {
      kind: "create_todo",
      text: "call Sam tomorrow",
    });
  });

  it("snoozes, closes and chases", () => {
    assert.deepEqual(local("snooze the vendor invoice to Monday"), {
      kind: "todo_action",
      action: "snooze",
      query: "vendor invoice",
      until: "Monday",
    });
    assert.deepEqual(local("mark release plan done"), {
      kind: "todo_action",
      action: "done",
      query: "release plan",
      until: "",
    });
    assert.deepEqual(local("chase Sam on the release plan"), {
      kind: "todo_action",
      action: "chase",
      query: "release plan",
      until: "Sam",
    });
  });

  it("leaves window commands and older chase questions alone", () => {
    assert.equal(local("close the dashboard"), null);
    assert.equal(local("close this window"), null);
    assert.equal(local("close the browser window"), null);
    assert.equal(local("what do I need to chase?"), null);
  });

  it("asks about a task run", () => {
    assert.deepEqual(local("did the backlog report run this week?"), {
      kind: "run_info",
      taskId: "weekly-backlog-report",
      question: "ran",
    });
    assert.deepEqual(local("why did the aging report fail?"), {
      kind: "run_info",
      taskId: "weekly-aging-report",
      question: "failed",
    });
    assert.deepEqual(local("why did the last run fail?"), {
      kind: "run_info",
      taskId: null,
      question: "failed",
    });
  });

  it("explains the screen", () => {
    for (const text of [
      "explain this screen",
      "what am I looking at?",
      "What is this window",
    ]) {
      assert.deepEqual(local(text), { kind: "explain" }, text);
    }
  });

  it("returns nothing for ordinary text", () => {
    for (const text of ["", "hello there", "open notes", "who's off today?"]) {
      assert.equal(local(text), null, text);
    }
  });
});
