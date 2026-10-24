// Run with `pnpm test`. List grouping, ordering and formatting helpers behind
// the PMO To-Do window (pure functions, no React).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TODO_FILTERS,
  WHY_NO_BODY,
  countByFilter,
  filterTodos,
  sortTodosBy,
  filterByReason,
  formatDay,
  groupQueue,
  ownerLabel,
  reasonCounts,
  relativeTime,
  resendGuidance,
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

describe("Filtered tab helpers", () => {
  const record = (code, extra = {}) => ({
    id: `in_${code}`,
    code,
    reason: "r",
    tenantId: null,
    chatId: null,
    summary: {
      source: "outlook",
      subject: "s",
      senderName: null,
      senderAddress: null,
      receivedAt: "2026-10-22T09:00:00Z",
      link: null,
    },
    ...extra,
  });
  const config = { allowedTenantIds: [], allowedSenderDomains: ["deloitte.com"] };

  it("counts items per reason, known reasons first, and filters by one", () => {
    const records = [
      record("sender-domain-not-allowed"),
      record("blocked-domain"),
      record("sender-domain-not-allowed"),
      record("something-new"),
    ];
    assert.deepEqual(reasonCounts(records), [
      { code: "blocked-domain", label: "Blocked domain", count: 1 },
      { code: "sender-domain-not-allowed", label: "Sender domain not allowed", count: 2 },
      { code: "something-new", label: "something-new", count: 1 },
    ]);
    assert.equal(filterByReason(records, null).length, 4);
    assert.equal(filterByReason(records, "sender-domain-not-allowed").length, 2);
    assert.equal(filterByReason(records, "teams-not-allowlisted").length, 0);
  });

  it("offers a one-click allow where one exists, and never a way to get the text back", () => {
    const tenant = resendGuidance(
      record("tenant-not-allowed", {
        tenantId: "ABCD0000-0000-4000-8000-000000000000",
        summary: { ...record("x").summary, source: "teams" },
      }),
      config,
    );
    assert.equal(tenant.allowTenantId, "abcd0000-0000-4000-8000-000000000000");
    assert.match(tenant.steps, /run the Teams flow on the message again/);
    const allowed = resendGuidance(
      record("tenant-not-allowed", { tenantId: "abcd0000-0000-4000-8000-000000000000" }),
      { ...config, allowedTenantIds: ["abcd0000-0000-4000-8000-000000000000"] },
    );
    assert.equal(allowed.allowTenantId, null);
    assert.match(allowed.steps, /allowed now/);

    const domain = resendGuidance(
      record("sender-domain-not-allowed", {
        summary: {
          ...record("x").summary,
          senderAddress: "Pat <pat@partner.example.com>",
        },
      }),
      config,
    );
    assert.equal(domain.allowDomain, "partner.example.com");
    assert.match(domain.steps, /-IgnoreSeen/);
    const noAddress = resendGuidance(record("sender-domain-not-allowed"), config);
    assert.equal(noAddress.allowDomain, null);
    assert.match(noAddress.steps, /No sender address/);

    assert.equal(resendGuidance(record("blocked-domain"), config).allowDomain, null);
    assert.match(resendGuidance(record("blocked-term"), config).steps, /block list/);
    assert.match(
      resendGuidance(record("teams-not-allowlisted"), config).steps,
      /tenant ID/,
    );
    assert.match(WHY_NO_BODY, /thrown away when it is filtered/);
  });
});

describe("to-do filters and sorting", () => {
  const today = "2026-10-26";
  const now = new Date("2026-10-26T04:30:00Z"); // 10:00 IST
  let n = 0;
  const todo = (patch = {}) => ({
    id: `td_${++n}`,
    title: `t${n}`,
    status: "open",
    dueAt: null,
    priority: "normal",
    waitingOn: null,
    checkpoints: [],
    createdAt: `2026-10-${String(10 + n).padStart(2, "0")}T00:00:00Z`,
    reminders: {
      enabled: false,
      remindAt: null,
      snoozedUntil: null,
      lastRemindedAt: null,
    },
    ...patch,
  });
  const cp = (...states) => states.map((state, i) => ({ id: `c${i}`, state }));
  const ids = (list) => list.map((t) => t.title);

  const all = [
    todo({ title: "late", dueAt: "2026-10-20" }),
    todo({ title: "today", dueAt: "2026-10-26" }),
    todo({ title: "tomorrow", dueAt: "2026-10-27" }),
    todo({ title: "later", dueAt: "2026-11-05" }),
    todo({ title: "waiting", waitingOn: "Sam" }),
    todo({
      title: "snoozed",
      dueAt: "2026-10-20",
      reminders: {
        enabled: false,
        remindAt: null,
        snoozedUntil: "2026-10-27T03:30:00Z",
        lastRemindedAt: null,
      },
    }),
    todo({ title: "done", status: "done", dueAt: "2026-10-20" }),
    todo({ title: "cancelled", status: "cancelled", waitingOn: "Sam" }),
  ];

  it("offers open, overdue, due soon, waiting, snoozed and done", () => {
    assert.deepEqual(
      TODO_FILTERS.map((f) => f.id),
      ["open", "overdue", "due-soon", "waiting", "snoozed", "done"],
    );
  });

  it("filters by the same windows the dock badge uses", () => {
    const run = (filter) => ids(filterTodos(all, filter, today, now));
    assert.deepEqual(run("open"), [
      "late",
      "today",
      "tomorrow",
      "later",
      "waiting",
      "snoozed",
    ]);
    assert.deepEqual(run("overdue"), ["late", "snoozed"]);
    assert.deepEqual(run("due-soon"), ["today", "tomorrow"]);
    assert.deepEqual(run("waiting"), ["waiting"]); // a cancelled to-do is not waiting
    assert.deepEqual(run("snoozed"), ["snoozed"]);
    assert.deepEqual(run("done"), ["done", "cancelled"]);
  });

  it("stops listing a to-do as snoozed once the snooze has passed", () => {
    const later = new Date("2026-10-27T04:00:00Z");
    assert.deepEqual(ids(filterTodos(all, "snoozed", "2026-10-27", later)), []);
  });

  it("counts every filter", () => {
    assert.deepEqual(countByFilter(all, today, now), {
      open: 6,
      overdue: 2,
      "due-soon": 2,
      waiting: 1,
      snoozed: 1,
      done: 2,
    });
  });

  it("sorts by due date (default), priority, least progress and newest, ties by due order", () => {
    const list = [
      todo({
        title: "a",
        dueAt: "2026-10-30",
        priority: "low",
        checkpoints: cp("done", "done"),
      }),
      todo({
        title: "b",
        dueAt: "2026-10-28",
        priority: "high",
        checkpoints: cp("pending", "pending"),
      }),
      todo({
        title: "c",
        dueAt: "2026-10-29",
        priority: "high",
        checkpoints: cp("done", "pending"),
      }),
    ];
    assert.deepEqual(ids(sortTodosBy(list, "due", today)), ["b", "c", "a"]);
    assert.deepEqual(ids(sortTodosBy(list, "priority", today)), ["b", "c", "a"]);
    assert.deepEqual(ids(sortTodosBy(list, "progress", today)), ["b", "c", "a"]);
    const newest = sortTodosBy(list, "newest", today);
    assert.deepEqual(ids(newest), ["c", "b", "a"]);
    assert.deepEqual(ids(sortTodosBy([list[0], list[2]], "priority", today)), ["c", "a"]);
  });
});
