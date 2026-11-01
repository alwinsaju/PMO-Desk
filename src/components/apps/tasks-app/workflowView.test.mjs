import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  lastRunInfo,
  latestRun,
  relativeTime,
  stepperItems,
  stepperSummary,
  workflowIcon,
} from "./workflowView.ts";

const NOW = new Date("2026-06-10T12:00:00Z");
const run = (over = {}) => ({
  run_id: "r1",
  task_id: "t",
  task_name: "T",
  started_at: "2026-06-10T09:00:00Z",
  ended_at: "2026-06-10T09:04:00Z",
  outcome: "completed",
  current_step_at_end: null,
  error: null,
  steps_completed: ["a", "b", "c"],
  ...over,
});
const task = (over = {}) => ({
  id: "t",
  displayName: "T",
  state: "resting",
  error: null,
  currentStep: null,
  steps: [
    { id: "a", type: "python" },
    { id: "b", type: "review" },
    { id: "c", type: "python" },
  ],
  notifications: [],
  ...over,
});

describe("workflowIcon", () => {
  it("guesses from the id and name, with a generic fallback", () => {
    assert.equal(
      workflowIcon({ id: "deployment-dep-weekend-mailer", displayName: "X" }),
      "mail",
    );
    assert.equal(
      workflowIcon({ id: "shift-roster", displayName: "Shift roster" }),
      "roster",
    );
    assert.equal(
      workflowIcon({ id: "weekly-aging-report", displayName: "Aging" }),
      "incident",
    );
    assert.equal(
      workflowIcon({ id: "monthly-report-deck", displayName: "Deck" }),
      "report",
    );
    assert.equal(workflowIcon({ id: "zzz", displayName: "Zzz" }), "workflow");
  });
});

describe("relativeTime", () => {
  const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();
  it("reads naturally", () => {
    assert.equal(relativeTime(ago(20_000), NOW), "just now");
    assert.equal(relativeTime(ago(5 * 60_000), NOW), "5 min ago");
    assert.equal(relativeTime(ago(3 * 3_600_000), NOW), "3 h ago");
    assert.equal(relativeTime(ago(30 * 3_600_000), NOW), "yesterday");
    assert.equal(relativeTime(ago(4 * 86_400_000), NOW), "4 d ago");
    assert.equal(relativeTime("nope", NOW), "");
  });
  it("falls back to a date after two weeks", () => {
    assert.match(relativeTime(ago(30 * 86_400_000), NOW), /May/);
  });
});

describe("lastRunInfo", () => {
  it("says so when never run", () => {
    assert.deepEqual(lastRunInfo([], NOW), { tone: "neutral", text: "Not run yet" });
  });
  it("uses the newest run, with its duration when it completed", () => {
    const older = run({
      run_id: "old",
      ended_at: "2026-06-01T09:00:00Z",
      outcome: "failed",
    });
    assert.equal(latestRun([older, run()]).run_id, "r1");
    assert.deepEqual(lastRunInfo([older, run()], NOW), {
      tone: "success",
      text: "Completed 2 h ago · 4 min",
    });
  });
  it("marks a failure without a duration", () => {
    assert.deepEqual(lastRunInfo([run({ outcome: "failed" })], NOW), {
      tone: "danger",
      text: "Failed 2 h ago",
    });
  });
});

describe("stepperItems", () => {
  const statuses = (items) => items.map((i) => i.status);
  it("follows the live position while a run is going", () => {
    const t = task({ state: "working", currentStep: "b" });
    assert.deepEqual(statuses(stepperItems(t, null)), ["done", "gate", "pending"]);
  });
  it("shows the last run when idle", () => {
    assert.deepEqual(statuses(stepperItems(task(), run())), ["done", "done", "done"]);
    const failed = run({
      outcome: "failed",
      steps_completed: ["a"],
      current_step_at_end: "b",
    });
    assert.deepEqual(statuses(stepperItems(task(), failed)), [
      "done",
      "failed",
      "pending",
    ]);
  });
  it("is all pending when idle and never run", () => {
    assert.deepEqual(statuses(stepperItems(task(), null)), [
      "pending",
      "pending",
      "pending",
    ]);
  });
  it("labels steps and counts the finished ones", () => {
    const items = stepperItems(task(), run({ steps_completed: ["a"] }));
    assert.equal(items[0].label, "A");
    assert.equal(stepperSummary(items), "1 of 3 steps done");
  });
});
