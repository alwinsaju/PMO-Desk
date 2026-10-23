// Run with `pnpm test`. List grouping, ordering and formatting helpers behind
// the PMO To-Do window (pure functions, no React).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatDay,
  groupQueue,
  ownerLabel,
  relativeTime,
  sortTodos,
  statusLabel,
} from "./queueView.ts";

const proposal = (id, status, extra = {}) => ({
  id,
  status,
  isActionable: status === "ready" ? true : null,
  summary: { receivedAt: `2026-10-2${id.slice(-1)}T09:00:00+05:30`, subject: id },
  ...extra,
});
const idle = { active: null, position: 0, total: 0, waiting: 0, paused: null };

describe("review queue grouping", () => {
  it("splits the queue by what the human needs to do, newest first", () => {
    const queue = [
      proposal("p1", "ready"),
      proposal("p2", "ready", { isActionable: false }),
      proposal("p3", "pending"),
      proposal("p4", "structuring"),
      proposal("p5", "failed"),
      proposal("p6", "ready"),
    ];
    const groups = groupQueue(queue);
    assert.deepEqual(
      groups.review.map((p) => p.id),
      ["p6", "p1"],
    );
    assert.deepEqual(
      groups.notTask.map((p) => p.id),
      ["p2"],
    );
    assert.deepEqual(
      groups.failed.map((p) => p.id),
      ["p5"],
    );
    // The model works oldest first, so that is how its queue is listed.
    assert.deepEqual(
      groups.processing.map((p) => p.id),
      ["p3", "p4"],
    );
  });
});

describe("status labels", () => {
  it("says 'structuring 2 of 5' while the model works through a batch", () => {
    const busy = { ...idle, active: "p4", position: 2, total: 5 };
    assert.equal(statusLabel(proposal("p4", "structuring"), busy), "structuring 2 of 5");
    assert.equal(
      statusLabel(proposal("p4", "structuring"), { ...busy, total: 1, position: 1 }),
      "structuring",
    );
    assert.equal(statusLabel(proposal("p3", "pending"), busy), "pending");
    assert.equal(
      statusLabel(proposal("p3", "pending"), {
        ...idle,
        paused: { code: "runtime-down" },
      }),
      "waiting for model",
    );
    assert.equal(
      statusLabel(proposal("p4", "structuring"), {
        ...idle,
        paused: { code: "runtime-down" },
      }),
      "waiting for model",
    );
    assert.equal(statusLabel(proposal("p1", "ready"), idle), "ready");
    assert.equal(
      statusLabel(proposal("p2", "ready", { isActionable: false }), idle),
      "probably not a task",
    );
    assert.equal(statusLabel(proposal("p5", "failed"), idle), "failed");
  });
});

describe("to-do ordering", () => {
  const todo = (id, extra) => ({
    id,
    status: "open",
    dueAt: null,
    priority: "normal",
    createdAt: `2026-10-0${id.slice(-1)}T00:00:00Z`,
    ...extra,
  });

  it("puts overdue first, then soonest due, then undated, with closed ones last", () => {
    const sorted = sortTodos(
      [
        todo("t1", { dueAt: "2026-10-30" }),
        todo("t2"),
        todo("t3", { dueAt: "2026-10-20" }),
        todo("t4", { dueAt: "2026-10-24" }),
        todo("t5", { status: "done", dueAt: "2026-10-01" }),
        todo("t6", { dueAt: "2026-10-24", priority: "high" }),
      ],
      "2026-10-23",
    );
    assert.deepEqual(
      sorted.map((t) => t.id),
      ["t3", "t6", "t4", "t1", "t2", "t5"],
    );
  });
});

describe("formatting", () => {
  it("names near days and abbreviates the rest", () => {
    assert.equal(formatDay("2026-10-23", "2026-10-23"), "Today");
    assert.equal(formatDay("2026-10-24", "2026-10-23"), "Tomorrow");
    assert.equal(formatDay("2026-10-22", "2026-10-23"), "Yesterday");
    assert.match(formatDay("2026-10-27", "2026-10-23"), /^Tue,? 27 Oct$/);
    assert.match(formatDay("2027-01-04", "2026-10-23"), /2027/);
  });

  it("gives relative times", () => {
    const now = Date.parse("2026-10-23T10:00:00Z");
    assert.equal(relativeTime("2026-10-23T09:59:40Z", now), "just now");
    assert.equal(relativeTime("2026-10-23T09:55:00Z", now), "5 min ago");
    assert.equal(relativeTime("2026-10-23T07:00:00Z", now), "3 h ago");
    assert.equal(relativeTime("2026-10-21T10:00:00Z", now), "2 d ago");
    assert.equal(relativeTime("garbage", now), "");
  });

  it("labels owners", () => {
    assert.equal(ownerLabel({ name: "Alwin Saju", email: null, isMe: true }), "Me");
    assert.equal(ownerLabel({ name: "Pat", email: null, isMe: false }), "Pat");
    assert.equal(ownerLabel({ name: null, email: "a@b.c", isMe: null }), "a@b.c");
    assert.equal(ownerLabel({ name: null, email: null, isMe: null }), "Unassigned");
  });
});
