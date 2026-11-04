// Run with `pnpm test`. The Dashboard logic added in v5.6: today list, workload, aging, sign-off pipeline,
// report health, week over week, briefing and layouts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  agingBuckets,
  briefingDue,
  briefingText,
  needsYouTotal,
  reportHealth,
  signoffPipeline,
  todayList,
  weekOverWeek,
  workloadByOwner,
} from "./insights.ts";
import {
  DEFAULT_LAYOUT,
  WIDGET_IDS,
  moveWidget,
  sanitizeLayout,
  sanitizeSavedLayouts,
  saveLayout,
  toggleHidden,
  toggleWide,
  visibleWidgets,
} from "./layout.ts";

const prefs = { timeZone: "Asia/Kolkata", workDays: [1, 2, 3, 4, 5], chaserDays: 2 };
const TODAY = "2026-10-30"; // a Friday
const NOW = new Date("2026-10-30T10:00:00+05:30");

const todo = (over = {}) => ({
  id: "t1",
  title: "A",
  status: "open",
  owner: { name: "Pat", email: null, isMe: true },
  dueAt: null,
  priority: "normal",
  checkpoints: [],
  chaserDays: null,
  createdAt: "2026-10-20T04:00:00Z",
  approvedAt: "2026-10-20T04:00:00Z",
  completedAt: null,
  ...over,
});

const awaiting = (requestedAt) => ({
  id: "c1",
  label: "Sign-off",
  kind: "approval",
  state: "pending",
  signoff: {
    approver: "Priya Nair",
    requestedAt,
    requestedBy: "me",
    waitingMarked: null,
    outcome: "pending",
    conditions: "",
    conditionsConfirmedAt: null,
    conditionsConfirmedBy: null,
    stamp: null,
    previous: [],
  },
});

describe("today list", () => {
  const base = {
    todos: [],
    today: TODAY,
    now: NOW,
    prefs,
    pendingLeave: 0,
    reviewCount: 0,
    tasksNeedingYou: [],
    awayToday: [],
  };
  it("merges everything and puts the urgent first", () => {
    const items = todayList({
      ...base,
      todos: [
        todo({ id: "a", title: "Today one", dueAt: TODAY }),
        todo({ id: "b", title: "Late one", dueAt: "2026-10-27" }),
      ],
      pendingLeave: 2,
      reviewCount: 1,
      tasksNeedingYou: ["Aging Report"],
      awayToday: ["Ann", "Bob"],
    });
    assert.deepEqual(
      items.map((i) => i.kind),
      ["overdue", "task", "leave", "due-today", "review", "away"],
    );
    assert.match(items[0].text, /Overdue 3 day\(s\): Late one/);
    assert.equal(items[2].appId, "staff");
  });
  it("adds a chase for a quiet sign-off and honours the limit", () => {
    const quiet = todo({
      id: "s",
      title: "Deck",
      checkpoints: [awaiting("2026-10-20T04:00:00Z")],
    });
    const items = todayList({ ...base, todos: [quiet] });
    assert.equal(items[0].kind, "signoff");
    assert.match(items[0].text, /Priya Nair/);
    assert.equal(
      todayList({ ...base, awayToday: ["a"], pendingLeave: 1, reviewCount: 1 }, 2).length,
      2,
    );
  });
  it("is empty when nothing needs you", () => {
    assert.deepEqual(todayList(base), []);
  });
});

describe("workload and aging", () => {
  const list = [
    todo({ id: "1", owner: { name: "Pat" }, dueAt: "2026-10-28" }),
    todo({ id: "2", owner: { name: "Pat" }, dueAt: "2026-11-01" }),
    todo({ id: "3", owner: { name: "Sam" } }),
    todo({ id: "4", owner: { name: "Sam" }, status: "done" }),
    todo({ id: "5", owner: { name: null, email: null } }),
  ];
  it("counts open to-dos per owner with late and due-soon", () => {
    assert.deepEqual(workloadByOwner(list, TODAY), [
      { owner: "Pat", open: 2, dueSoon: 1, overdue: 1 },
      { owner: "Sam", open: 1, dueSoon: 0, overdue: 0 },
      { owner: "Unassigned", open: 1, dueSoon: 0, overdue: 0 },
    ]);
  });
  it("buckets by age since approval", () => {
    const now = new Date("2026-10-30T12:00:00Z");
    const aged = [
      todo({ id: "a", approvedAt: "2026-10-30T01:00:00Z" }),
      todo({ id: "b", approvedAt: "2026-10-27T01:00:00Z" }),
      todo({ id: "c", approvedAt: "2026-09-01T01:00:00Z" }),
      todo({ id: "d", approvedAt: "2026-09-01T01:00:00Z", status: "done" }),
    ];
    const b = agingBuckets(aged, now);
    assert.deepEqual(
      b.map((x) => x.count),
      [1, 1, 0, 0, 0, 1],
    );
    assert.equal(b[5].label, "Over 30 days");
  });
});

describe("sign-off pipeline", () => {
  it("counts awaiting and overdue sign-offs", () => {
    const p = signoffPipeline(
      [
        todo({
          id: "a",
          title: "Old ask",
          checkpoints: [awaiting("2026-10-20T04:00:00Z")],
        }),
        todo({
          id: "b",
          title: "New ask",
          checkpoints: [awaiting("2026-10-30T03:00:00Z")],
        }),
        todo({ id: "c", checkpoints: [] }),
      ],
      NOW,
      prefs,
    );
    assert.equal(p.awaiting, 2);
    assert.equal(p.overdue, 1);
    assert.equal(p.rows[0].title, "Old ask");
  });
});

describe("report health", () => {
  const run = (outcome, day) => ({
    outcome,
    started_at: `2026-10-${day}T01:00:00Z`,
    ended_at: `2026-10-${day}T01:05:00Z`,
    error: null,
  });
  it("scores recent reliability and penalises a failing report", () => {
    const rows = [
      {
        id: "a",
        name: "Aging",
        tone: "success",
        status: "Completed",
        detail: "",
        needsYou: false,
      },
      {
        id: "b",
        name: "Backlog",
        tone: "danger",
        status: "Failed",
        detail: "",
        needsYou: true,
      },
      { id: "c", name: "New", tone: "neutral", status: "", detail: "", needsYou: false },
    ];
    const h = reportHealth(rows, {
      a: [
        run("completed", "01"),
        run("completed", "08"),
        run("failed", "15"),
        run("completed", "22"),
      ],
      b: [run("completed", "01"), run("failed", "08")],
    });
    assert.equal(h.tasks[0].percent, 75);
    assert.equal(h.tasks[1].percent, 30);
    assert.equal(h.tasks[2].percent, null);
    assert.equal(h.score, 53);
    assert.equal(reportHealth([], {}).score, null);
  });
});

describe("week over week", () => {
  it("compares this Monday-Sunday with the one before", () => {
    const w = weekOverWeek({
      todos: [
        todo({ id: "1", approvedAt: "2026-10-27T04:00:00Z" }),
        todo({
          id: "2",
          approvedAt: "2026-10-28T04:00:00Z",
          status: "done",
          completedAt: "2026-10-29T04:00:00Z",
        }),
        todo({ id: "3", approvedAt: "2026-10-21T04:00:00Z" }),
      ],
      runs: [
        {
          outcome: "completed",
          started_at: "",
          ended_at: "2026-10-28T04:00:00Z",
          error: null,
        },
        {
          outcome: "failed",
          started_at: "",
          ended_at: "2026-10-20T04:00:00Z",
          error: null,
        },
      ],
      leave: [
        { startDate: "2026-10-29", status: "approved" },
        { startDate: "2026-10-29", status: "pending" },
      ],
      today: TODAY,
      timeZone: "Asia/Kolkata",
    });
    assert.equal(w.thisWeek.created, 2);
    assert.equal(w.lastWeek.created, 1);
    assert.equal(w.thisWeek.closed, 1);
    assert.equal(w.thisWeek.runsCompleted, 1);
    assert.equal(w.lastWeek.runsFailed, 1);
    assert.equal(w.thisWeek.leaveRequests, 1);
    assert.match(w.lines[0], /\+1 vs last week/);
  });
});

describe("briefing and badges", () => {
  it("words a briefing", () => {
    assert.match(briefingText([]), /Nothing needs you/);
    const t = briefingText([{ kind: "task", text: "A needs you", appId: "tasks" }]);
    assert.match(t, /1 thing for today/);
    assert.match(t, /• A needs you/);
  });
  it("is due once a day after its time", () => {
    const s = { enabled: true, time: "08:30", lastDay: "2026-10-29" };
    assert.equal(briefingDue(s, new Date(2026, 9, 30, 8, 0), TODAY), false);
    assert.equal(briefingDue(s, new Date(2026, 9, 30, 9, 0), TODAY), true);
    assert.equal(
      briefingDue({ ...s, lastDay: TODAY }, new Date(2026, 9, 30, 9, 0), TODAY),
      false,
    );
    assert.equal(
      briefingDue({ ...s, enabled: false }, new Date(2026, 9, 30, 9, 0), TODAY),
      false,
    );
  });
  it("adds the needs-you counts", () => {
    assert.equal(needsYouTotal({ pmo: 2, leave: 1, tasks: 3 }), 6);
    assert.equal(needsYouTotal({ pmo: 2, leave: 1, tasks: 3, registers: 4 }), 10);
  });
});

describe("layouts", () => {
  it("starts with the original cards visible and the new ones hidden", () => {
    const v = visibleWidgets(DEFAULT_LAYOUT);
    assert.deepEqual(v, ["today", "todos", "chasers", "reports", "staff", "away"]);
  });
  it("moves, hides and widens cards", () => {
    let l = moveWidget(DEFAULT_LAYOUT, "todos", -1);
    assert.deepEqual(visibleWidgets(l).slice(0, 2), ["todos", "today"]);
    assert.equal(moveWidget(l, "todos", -1), l);
    l = toggleHidden(l, "away");
    assert.equal(visibleWidgets(l).includes("away"), false);
    l = toggleHidden(l, "workload");
    assert.equal(visibleWidgets(l).includes("workload"), true);
    assert.equal(toggleWide(l, "today").wide.includes("today"), false);
  });
  it("repairs stored layouts and keeps named ones", () => {
    const l = sanitizeLayout({ order: ["week", "nope", "week"], hidden: "x" });
    assert.equal(l.order[0], "week");
    assert.equal(l.order.length, WIDGET_IDS.length);
    // "x" is not a list so nothing the person hid survives; only the cards that start hidden when new.
    assert.deepEqual(l.hidden, ["rag", "scorecard"]);
    let saved = saveLayout([], "Focus", DEFAULT_LAYOUT);
    saved = saveLayout(saved, "focus", toggleHidden(DEFAULT_LAYOUT, "todos"));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].layout.hidden.includes("todos"), true);
    assert.deepEqual(saveLayout(saved, "  ", DEFAULT_LAYOUT), saved);
    assert.equal(
      sanitizeSavedLayouts([{ name: "A", layout: {} }, 5, { name: "" }]).length,
      1,
    );
  });
});
