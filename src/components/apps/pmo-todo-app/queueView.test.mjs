// Run with `pnpm test`. List grouping, ordering and formatting helpers behind
// the PMO To-Do window (pure functions, no React).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TODO_FILTERS,
  WHY_NO_BODY,
  countByFilter,
  describeWaiting,
  filterTodos,
  sortTodosBy,
  filterByReason,
  formatDay,
  groupQueue,
  ownerLabel,
  reviewCount,
  reasonCounts,
  relativeTime,
  repeatsText,
  resendGuidance,
  sortTodos,
  rejectedRows,
  statusLabel,
  todoRowView,
  undoRejectText,
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
  const config = {
    allowedTenantIds: [],
    teamsChatAllowlist: [],
    allowedSenderDomains: ["deloitte.com"],
  };

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

    const odd = resendGuidance(
      record("sender-domain-not-allowed", {
        summary: { ...record("x").summary, senderAddress: "pat@bad_domain" },
      }),
      config,
    );
    assert.equal(odd.allowDomain, null);
    assert.match(odd.steps, /not a valid domain name/);
    const upper = resendGuidance(
      record("sender-domain-not-allowed", {
        summary: { ...record("x").summary, senderAddress: "pat@Partner.COM." },
      }),
      config,
    );
    assert.equal(upper.allowDomain, "partner.com");

    assert.equal(resendGuidance(record("blocked-domain"), config).allowDomain, null);
    assert.match(resendGuidance(record("blocked-term"), config).steps, /block list/);
    assert.match(
      resendGuidance(record("teams-not-allowlisted"), config).steps,
      /tenant ID/,
    );
    assert.match(WHY_NO_BODY, /thrown away when it is filtered/);
  });

  it("offers Allow this chat for a Teams item with a Conversation ID, next to Allow this tenant", () => {
    const conv = "19:7F3C1A2B4D5E4F60A1B2C3D4E5F60718@unq.gbl.spaces";
    const teamsSummary = { ...record("x").summary, source: "teams" };
    // No tenant on the message: only the chat can be allowed.
    const noTenant = resendGuidance(
      record("teams-not-allowlisted", { chatId: conv, summary: teamsSummary }),
      config,
    );
    assert.equal(noTenant.allowChatId, conv, "kept as sent; the filter ignores case");
    assert.equal(noTenant.allowTenantId, null);
    assert.match(noTenant.steps, /Allow this chat/);
    // Tenant present too: both buttons.
    const both = resendGuidance(
      record("tenant-not-allowed", {
        tenantId: "ABCD0000-0000-4000-8000-000000000000",
        chatId: conv,
        summary: teamsSummary,
      }),
      config,
    );
    assert.equal(both.allowTenantId, "abcd0000-0000-4000-8000-000000000000");
    assert.equal(both.allowChatId, conv);
    assert.match(both.steps, /run the Teams flow on the message again/);
    // Already allowed (any case): no button, and the steps say so.
    const done = resendGuidance(
      record("teams-not-allowlisted", { chatId: conv, summary: teamsSummary }),
      { ...config, teamsChatAllowlist: [conv.toLowerCase()] },
    );
    assert.equal(done.allowChatId, null);
    assert.match(done.steps, /chat is allowed now/);
    // No chat id at all: the old advice, and never a chat button.
    const none = resendGuidance(record("teams-not-allowlisted"), config);
    assert.equal(none.allowChatId, null);
    assert.match(none.steps, /tenant ID/);
    // Outlook reasons never offer a chat.
    assert.equal(
      resendGuidance(record("sender-domain-not-allowed"), config).allowChatId,
      null,
    );
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

  it("offers open, today, overdue, due soon, waiting, snoozed and done", () => {
    assert.deepEqual(
      TODO_FILTERS.map((f) => f.id),
      ["open", "today", "overdue", "due-soon", "waiting", "snoozed", "done"],
    );
  });

  it("'today' is what can be acted on now: due today or earlier and not snoozed", () => {
    const run = (filter) => ids(filterTodos(all, filter, today, now));
    assert.deepEqual(run("today"), ["late", "today"]);
    // A snooze that has passed brings the to-do back.
    const later = new Date("2026-10-27T04:00:00Z");
    assert.deepEqual(ids(filterTodos(all, "today", "2026-10-27", later)), [
      "late",
      "today",
      "tomorrow",
      "snoozed",
    ]);
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
      today: 2,
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

describe("update cards in the queue", () => {
  const update = (id, status, extra = {}) =>
    proposal(id, status, {
      update: { todoId: "td_1", todoTitle: "t", threadKey: "k", result: null },
      ...extra,
    });

  it("lists every update card in its own group, whatever its status, newest first", () => {
    const groups = groupQueue([
      proposal("p1", "ready"),
      update("p2", "ready"),
      update("p3", "pending"),
      update("p4", "failed"),
      update("p5", "ready", { isActionable: false }),
    ]);
    assert.deepEqual(
      groups.updates.map((p) => p.id),
      ["p5", "p4", "p3", "p2"],
    );
    // They are not also listed as new proposals.
    assert.deepEqual(
      groups.review.map((p) => p.id),
      ["p1"],
    );
    assert.deepEqual(groups.processing, []);
    assert.deepEqual(groups.failed, []);
    assert.deepEqual(groups.notTask, []);
  });

  it("counts a finished update card as waiting for a decision, even a 'nothing actionable' one", () => {
    assert.equal(
      reviewCount([
        proposal("p1", "ready"),
        proposal("p2", "ready", { isActionable: false }),
        update("p3", "ready"),
        update("p4", "ready", { isActionable: false }),
        update("p5", "pending"),
        proposal("p6", "failed"),
      ]),
      3,
    );
  });
});

describe("waiting on someone, for the row and the panel", () => {
  const prefs = { timeZone: "Asia/Kolkata", workDays: [1, 2, 3, 4, 5], chaserDays: 2 };
  const ist = (stamp) => new Date(`${stamp}:00+05:30`);
  const todo = (extra = {}) => ({
    status: "open",
    waitingOn: " Priya Nair ",
    waitingSince: ist("2026-10-19T12:00").toISOString(),
    updatedAt: ist("2026-10-23T12:00").toISOString(),
    chaserDays: null,
    ...extra,
  });

  it("says who, since when and for how long, and when a chaser is due", () => {
    const info = describeWaiting(todo(), ist("2026-10-23T10:00"), prefs, "2026-10-23");
    assert.equal(info.who, "Priya Nair");
    assert.equal(info.since, "since Mon 19 Oct");
    assert.equal(info.age, "4 days");
    assert.equal(info.chaseDue, true);
    assert.equal(info.everyDays, 2);
    assert.equal(info.customCadence, false);
    assert.equal(info.sinceDay, "2026-10-19");
  });

  it("uses plain words for today and yesterday, and the to-do's own cadence", () => {
    const today = describeWaiting(
      todo({ waitingSince: ist("2026-10-23T09:00").toISOString() }),
      ist("2026-10-23T10:00"),
      prefs,
      "2026-10-23",
    );
    assert.equal(today.since, "since today");
    assert.equal(today.age, "");
    assert.equal(today.chaseDue, false);
    const yesterday = describeWaiting(
      todo({ waitingSince: ist("2026-10-22T09:00").toISOString(), chaserDays: 5 }),
      ist("2026-10-23T10:00"),
      prefs,
      "2026-10-23",
    );
    assert.equal(yesterday.since, "since yesterday");
    assert.equal(yesterday.age, "1 day");
    assert.equal(yesterday.everyDays, 5);
    assert.equal(yesterday.customCadence, true);
  });

  it("is null when the to-do is not waiting or is closed", () => {
    const now = ist("2026-10-23T10:00");
    assert.equal(
      describeWaiting(todo({ waitingOn: null }), now, prefs, "2026-10-23"),
      null,
    );
    assert.equal(
      describeWaiting(todo({ waitingOn: "  " }), now, prefs, "2026-10-23"),
      null,
    );
    assert.equal(
      describeWaiting(todo({ status: "done" }), now, prefs, "2026-10-23"),
      null,
    );
  });
});

describe("the to-do row view", () => {
  const now = new Date("2026-10-26T04:30:00Z"); // 10:00 IST on 26 Oct
  const today = "2026-10-26";
  const cp = (state) => ({ id: state, label: state, kind: "step", state });
  const todo = (extra = {}) => ({
    status: "open",
    dueAt: null,
    checkpoints: [],
    reminders: {
      enabled: false,
      remindAt: null,
      snoozedUntil: null,
      lastRemindedAt: null,
    },
    ...extra,
  });

  it("shows exactly one headline, most urgent first", () => {
    assert.deepEqual(todoRowView(todo({ dueAt: "2026-10-20" }), today, now).headline, {
      tone: "strong",
      label: "Overdue",
    });
    assert.deepEqual(todoRowView(todo({ dueAt: "2026-10-26" }), today, now).headline, {
      tone: "outline",
      label: "Due soon",
    });
    assert.deepEqual(todoRowView(todo({ dueAt: "2026-10-27" }), today, now).headline, {
      tone: "outline",
      label: "Due soon",
    });
    assert.equal(todoRowView(todo({ dueAt: "2026-11-05" }), today, now).headline, null);
    assert.equal(todoRowView(todo(), today, now).headline, null);
  });

  it("a closed to-do shows how it closed, never as overdue", () => {
    const done = todoRowView(todo({ status: "done", dueAt: "2026-10-01" }), today, now);
    assert.deepEqual(done.headline, { tone: "outline", label: "Done" });
    assert.equal(done.overdue, false);
    assert.equal(
      todoRowView(todo({ status: "cancelled" }), today, now).headline.label,
      "Cancelled",
    );
  });

  it("describes the due date in words", () => {
    assert.equal(todoRowView(todo(), today, now).dueText, "No due date");
    assert.equal(
      todoRowView(todo({ dueAt: "2026-10-26" }), today, now).dueText,
      "Due Today",
    );
    assert.equal(
      todoRowView(todo({ dueAt: "2026-10-27" }), today, now).dueText,
      "Due Tomorrow",
    );
    assert.equal(
      todoRowView(todo({ dueAt: "2026-10-21" }), today, now).dueText,
      "Due Wed 21 Oct",
    );
  });

  it("derives stage, progress and the ready-to-close offer from the checkpoints", () => {
    const partial = todoRowView(
      todo({
        checkpoints: [
          { id: "a", label: "Draft", kind: "step", state: "done" },
          { id: "b", label: "Review", kind: "step", state: "pending" },
          { id: "c", label: "Send", kind: "step", state: "pending" },
          { id: "d", label: "Close", kind: "step", state: "skipped" },
        ],
      }),
      today,
      now,
    );
    assert.equal(partial.stage, "Review");
    assert.equal(partial.stageText, "Review");
    assert.deepEqual([partial.done, partial.total, partial.percent], [2, 4, 50]);
    assert.equal(partial.readyToClose, false);

    const finished = todoRowView(
      todo({ checkpoints: [cp("done"), cp("skipped")] }),
      today,
      now,
    );
    assert.equal(finished.readyToClose, true);
    assert.equal(finished.stageText, "All steps done");
    assert.equal(finished.percent, 100);

    const closed = todoRowView(
      todo({ status: "done", checkpoints: [cp("done")] }),
      today,
      now,
    );
    assert.equal(closed.readyToClose, false);
    assert.equal(closed.stageText, "Complete");

    const none = todoRowView(todo(), today, now);
    assert.deepEqual([none.total, none.percent, none.stageText], [0, 0, ""]);
  });

  it("knows a snooze that is still running", () => {
    const sleeping = todo({
      reminders: {
        enabled: false,
        remindAt: null,
        snoozedUntil: "2026-10-27T03:30:00Z",
        lastRemindedAt: null,
      },
    });
    assert.equal(todoRowView(sleeping, today, now).snoozed, true);
    assert.equal(
      todoRowView(sleeping, today, new Date("2026-10-28T00:00:00Z")).snoozed,
      false,
    );
    assert.equal(todoRowView({ ...sleeping, status: "done" }, today, now).snoozed, false);
  });
});

describe("repeats text", () => {
  it("is one plain 'Repeats: ...' line, or null for a one-off", () => {
    assert.equal(
      repeatsText("weekly, before Tuesday"),
      "Repeats: weekly, before Tuesday",
    );
    assert.equal(repeatsText("  every   Monday \n"), "Repeats: every Monday");
    assert.equal(repeatsText(null), null);
    assert.equal(repeatsText(undefined), null);
    assert.equal(repeatsText("   "), null);
  });
});

import { partLabel as partLabelUnderTest } from "./queueView.ts";
describe("split tasks", () => {
  it("labels a task split from a multi-task message, and nothing else", () => {
    assert.equal(partLabelUnderTest({ part: { index: 2, total: 3 } }), "Task 2 of 3");
    assert.equal(partLabelUnderTest({ part: null }), null);
    assert.equal(partLabelUnderTest({}), null);
  });
});

describe("rejected proposals (Restore / Undo)", () => {
  const rejected = (id, updatedAt, extra = {}) => ({
    ...proposal(id, "rejected"),
    updatedAt,
    draft: null,
    ...extra,
  });
  const now = Date.parse("2026-10-28T10:00:00Z");

  it("lists the newest rejection first with a relative time", () => {
    const rows = rejectedRows(
      [
        rejected("p1", "2026-10-28T09:00:00Z"),
        rejected("p2", "2026-10-28T09:55:00Z", { draft: { title: "Send the deck" } }),
      ],
      now,
    );
    assert.deepEqual(
      rows.map((r) => [r.id, r.title, r.when]),
      [
        ["p2", "Send the deck", "Rejected 5 min ago"],
        ["p1", "p1", "Rejected 1 h ago"],
      ],
    );
  });

  it("only gives a reason when the model said it was not a task", () => {
    const [plain, notTask] = rejectedRows(
      [
        rejected("p1", "2026-10-28T09:00:00Z"),
        rejected("p2", "2026-10-28T08:00:00Z", { isActionable: false }),
      ],
      now,
    );
    assert.equal(plain.reason, null);
    assert.match(notTask.reason, /not a task/);
  });

  it("does not mutate its input and handles an empty list", () => {
    assert.deepEqual(rejectedRows([], now), []);
    const input = [
      rejected("p1", "2026-10-28T08:00:00Z"),
      rejected("p2", "2026-10-28T09:00:00Z"),
    ];
    rejectedRows(input, now);
    assert.equal(input[0].id, "p1");
  });

  it("words the undo line, with or without a title", () => {
    assert.equal(undoRejectText("Send the deck"), 'Rejected "Send the deck".');
    assert.equal(undoRejectText("  "), "Rejected.");
  });
});
