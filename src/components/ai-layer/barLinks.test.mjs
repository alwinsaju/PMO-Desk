import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { showMeFor } from "./barLinks.ts";

describe("showMeFor", () => {
  it("opens the PMO list on the matching filter", () => {
    assert.deepEqual(showMeFor({ kind: "pmo_status", topic: "overdue" })?.target, {
      app: "pmo-todo",
      filter: "overdue",
    });
    assert.equal(
      showMeFor({ kind: "pmo_status", topic: "chasers" })?.target.filter,
      "waiting",
    );
    assert.equal(
      showMeFor({ kind: "pmo_status", topic: "summary" })?.target.filter,
      "today",
    );
    assert.equal(showMeFor({ kind: "changes", since: "" })?.target.app, "pmo-todo");
  });

  it("opens Staff for people questions and Tasks for run questions", () => {
    for (const intent of [
      { kind: "whos_off", when: "today" },
      { kind: "person_back", name: "Ana" },
      { kind: "person_shift", name: "Ana", when: "" },
    ]) {
      assert.equal(showMeFor(intent)?.target.app, "staff");
    }
    assert.deepEqual(
      showMeFor({ kind: "run_info", taskId: "x", question: "ran" })?.target,
      {
        app: "tasks",
        taskId: "x",
      },
    );
  });

  it("offers nothing for commands that act, or no intent", () => {
    assert.equal(showMeFor(null), null);
    assert.equal(showMeFor({ kind: "create_todo", text: "x" }), null);
    assert.equal(showMeFor({ kind: "prepare_task", taskId: "x" }), null);
    assert.equal(showMeFor({ kind: "explain" }), null);
  });
});
