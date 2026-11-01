import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { dueChip, priorityTone, sourceChip, statusChip } from "./chipLogic.ts";

const NOW = new Date(2026, 9, 30, 15, 30);

describe("dueChip", () => {
  it("is red when overdue, amber today and neutral later", () => {
    assert.deepEqual(dueChip("2026-10-28", NOW), { variant: "danger", label: "2d late" });
    assert.deepEqual(dueChip("2026-10-30", NOW), {
      variant: "warning",
      label: "Due today",
    });
    assert.deepEqual(dueChip("2026-10-31", NOW), {
      variant: "neutral",
      label: "Due tomorrow",
    });
    assert.deepEqual(dueChip("2026-12-01", NOW), {
      variant: "neutral",
      label: "Due 1 Dec 2026",
    });
  });

  it("is a quiet outline when there is no date", () => {
    assert.deepEqual(dueChip(null, NOW), { variant: "outline", label: "No due date" });
  });

  it("does not shout about finished work", () => {
    assert.deepEqual(dueChip("2026-10-20", NOW, { done: true }), {
      variant: "neutral",
      label: "20 Oct 2026",
    });
  });
});

describe("statusChip", () => {
  it("maps known statuses to a tone and a tidy label", () => {
    assert.deepEqual(statusChip("done"), { variant: "success", label: "Done" });
    assert.deepEqual(statusChip("Completed"), { variant: "success", label: "Done" });
    assert.deepEqual(statusChip("running"), {
      variant: "accent",
      label: "Running",
      dot: true,
    });
    assert.deepEqual(statusChip("waiting"), { variant: "warning", label: "Waiting" });
    assert.deepEqual(statusChip("needs-you"), { variant: "warning", label: "Needs you" });
    assert.deepEqual(statusChip("failed"), { variant: "danger", label: "Failed" });
    assert.deepEqual(statusChip("snoozed"), { variant: "neutral", label: "Snoozed" });
    assert.deepEqual(statusChip("pending"), { variant: "warning", label: "Pending" });
    assert.deepEqual(statusChip("approved"), { variant: "success", label: "Approved" });
    assert.deepEqual(statusChip("declined"), { variant: "danger", label: "Declined" });
  });

  it("normalizes case, spaces, dashes and underscores", () => {
    assert.equal(statusChip("IN PROGRESS").label, "Running");
    assert.equal(statusChip("in_progress").variant, "accent");
  });

  it("falls back to a neutral chip with a readable label", () => {
    assert.deepEqual(statusChip("on_hold"), { variant: "neutral", label: "On hold" });
    assert.deepEqual(statusChip(""), { variant: "neutral", label: "Unknown" });
    assert.deepEqual(statusChip(null), { variant: "neutral", label: "Unknown" });
  });
});

describe("priorityTone", () => {
  it("maps priorities to a tone and an accessible name", () => {
    assert.deepEqual(priorityTone("urgent"), { tone: "red", label: "Urgent priority" });
    assert.deepEqual(priorityTone("High"), { tone: "red", label: "High priority" });
    assert.deepEqual(priorityTone("medium"), { tone: "amber", label: "Medium priority" });
    assert.deepEqual(priorityTone("normal"), { tone: "amber", label: "Medium priority" });
    assert.deepEqual(priorityTone("low"), { tone: "muted", label: "Low priority" });
  });

  it("has no stripe for unknown or missing priority", () => {
    assert.equal(priorityTone(undefined), null);
    assert.equal(priorityTone("whatever"), null);
  });
});

describe("sourceChip", () => {
  it("names Outlook, Teams and Manual", () => {
    assert.deepEqual(sourceChip("outlook"), { variant: "info", label: "Outlook" });
    assert.deepEqual(sourceChip("email"), { variant: "info", label: "Outlook" });
    assert.deepEqual(sourceChip("TEAMS"), { variant: "accent", label: "Teams" });
    assert.deepEqual(sourceChip("manual"), { variant: "neutral", label: "Manual" });
  });

  it("treats anything else as manual", () => {
    assert.deepEqual(sourceChip(undefined), { variant: "neutral", label: "Manual" });
    assert.deepEqual(sourceChip("fax"), { variant: "neutral", label: "Manual" });
  });
});
