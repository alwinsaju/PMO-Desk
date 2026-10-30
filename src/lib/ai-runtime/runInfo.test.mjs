import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runInfoReply } from "./runInfo.ts";

const NOW = new Date("2026-10-30T04:30:00.000Z"); // Fri 30 Oct 2026
const TZ = "Asia/Kolkata";
const tasks = [
  { id: "weekly-backlog-report", displayName: "Backlog Report" },
  { id: "weekly-aging-report", displayName: "Aging Report" },
];
const run = (over = {}) => ({
  outcome: "completed",
  started_at: "2026-10-28T05:00:00.000Z",
  ended_at: "2026-10-28T05:10:00.000Z",
  error: null,
  ...over,
});
const reply = (intent, histories, data = { tasks }) =>
  runInfoReply(intent, { tasks: data.tasks, histories }, NOW, TZ);

describe("runInfoReply: did it run", () => {
  it("lists this week's runs", () => {
    const text = reply(
      { taskId: "weekly-backlog-report", question: "ran" },
      { "weekly-backlog-report": [run()] },
    );
    assert.match(text, /^Yes, Backlog Report ran once this week:/);
    assert.match(text, /completed/);
  });

  it("says no, with the last run, when nothing ran this week", () => {
    const old = run({
      started_at: "2026-10-20T05:00:00.000Z",
      ended_at: "2026-10-20T05:10:00.000Z",
    });
    const text = reply(
      { taskId: "weekly-backlog-report", question: "ran" },
      { "weekly-backlog-report": [old] },
    );
    assert.match(
      text,
      /^No, Backlog Report has not run this week \(Mon 26 Oct 2026 to Sun 1 Nov 2026\)\. Its last run was/,
    );
    assert.match(
      reply({ taskId: "weekly-backlog-report", question: "ran" }, {}),
      /no runs on record/,
    );
  });

  it("needs a task, and an engine that is up", () => {
    assert.match(reply({ taskId: null, question: "ran" }, {}), /Which task\?/);
    assert.match(
      reply({ taskId: "weekly-backlog-report", question: "ran" }, {}, { tasks: null }),
      /isn't running/,
    );
  });
});

describe("runInfoReply: why did it fail", () => {
  const failed = run({
    outcome: "failed",
    error:
      "Traceback (most recent call last):\n  File x\nFileNotFoundError: No raw export found in input/",
  });

  it("shows the error itself for a named task", () => {
    const text = reply(
      { taskId: "weekly-aging-report", question: "failed" },
      { "weekly-aging-report": [failed] },
    );
    assert.match(text, /^Aging Report's last run failed \(/);
    assert.match(text, /FileNotFoundError: No raw export found in input\/\./);
  });

  it("finds the most recent failure when no task is named", () => {
    const newer = run({
      outcome: "failed",
      error: "Boom",
      ended_at: "2026-10-29T05:10:00.000Z",
      started_at: "2026-10-29T05:00:00.000Z",
    });
    const text = reply(
      { taskId: null, question: "failed" },
      { "weekly-aging-report": [failed], "weekly-backlog-report": [newer] },
    );
    assert.match(text, /^Backlog Report's last run failed/);
  });

  it("says when the last run was fine or nothing failed", () => {
    assert.match(
      reply(
        { taskId: "weekly-aging-report", question: "failed" },
        { "weekly-aging-report": [run()] },
      ),
      /last run completed fine/,
    );
    assert.equal(
      reply({ taskId: null, question: "failed" }, { "weekly-aging-report": [run()] }),
      "None of the report tasks failed on their last run.",
    );
  });
});
