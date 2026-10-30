// Run with `pnpm test`. The PMO To-Do view logic added in v5.3.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyExtras,
  blockedState,
  boardColumns,
  bulkPatches,
  bulkSummary,
  bulkUndo,
  dependentsOf,
  dropPatch,
  escalationSuggestion,
  escalationText,
  extractActionItems,
  flagReason,
  handoffNote,
  matchReason,
  monthGrid,
  shiftMonth,
  similarTodos,
  tagRollup,
  weeklyPlan,
  wouldCycle,
} from "./pmoViews.ts";

const TODAY = "2026-10-30"; // Friday
const NOW = new Date("2026-10-30T04:30:00.000Z");
const prefs = { timeZone: "Asia/Kolkata", workDays: [1, 2, 3, 4, 5], chaserDays: 2 };

let n = 0;
const todo = (over = {}) => ({
  id: `t${++n}`,
  title: `Item ${n}`,
  description: "",
  owner: { name: null, email: null, isMe: true },
  requester: { name: null, email: null },
  dueAt: null,
  priority: "normal",
  actionItems: [],
  checkpoints: [],
  status: "open",
  waitingOn: null,
  waitingSince: null,
  chaserDays: null,
  tags: [],
  blockedBy: [],
  recurrence: null,
  reminders: { enabled: false, remindAt: null, snoozedUntil: null, lastRemindedAt: null },
  updatedAt: "2026-10-01T00:00:00.000Z",
  completedAt: null,
  ...over,
});

describe("bulk actions", () => {
  const a = todo({ id: "a", priority: "high", tags: ["x"] });
  const b = todo({ id: "b", status: "done" });
  const c = todo({ id: "c" });

  it("changes only the to-dos it would change", () => {
    assert.deepEqual(
      bulkPatches({ type: "done" }, [a, b, c]).map((p) => p.id),
      ["a", "c"],
    );
    assert.deepEqual(
      bulkPatches({ type: "priority", priority: "high" }, [a, c]).map((p) => p.id),
      ["c"],
    );
    assert.deepEqual(bulkPatches({ type: "tag", tag: "X" }, [a, c]), [
      { id: "c", patch: { tags: ["X"] } },
    ]);
    assert.deepEqual(
      bulkPatches({ type: "snooze", until: "2026-11-02T03:30:00.000Z" }, [b, c]),
      [{ id: "c", patch: { snoozedUntil: "2026-11-02T03:30:00.000Z" } }],
    );
  });

  it("can put each back as it was", () => {
    assert.deepEqual(bulkUndo({ type: "done" }, [a, b, c]), [
      { id: "a", patch: { status: "open" } },
      { id: "c", patch: { status: "open" } },
    ]);
    assert.deepEqual(bulkUndo({ type: "priority", priority: "low" }, [a]), [
      { id: "a", patch: { priority: "high" } },
    ]);
    assert.deepEqual(bulkUndo({ type: "tag", tag: "y" }, [a]), [
      { id: "a", patch: { tags: ["x"] } },
    ]);
  });

  it("says what it did", () => {
    assert.equal(bulkSummary({ type: "done" }, 1), "Marked 1 to-do done.");
    assert.equal(
      bulkSummary({ type: "tag", tag: " Atlas " }, 3),
      "Tagged 3 to-dos “Atlas”.",
    );
  });
});

describe("tags and filters", () => {
  const todos = [
    todo({ tags: ["Atlas"], dueAt: "2026-10-20" }),
    todo({ tags: ["atlas"], status: "done" }),
    todo({ tags: ["atlas", "ops"], title: "Rollout plan" }),
    todo({ tags: ["ops"], status: "cancelled" }),
  ];

  it("rolls up each tag", () => {
    const rows = tagRollup(todos, TODAY);
    assert.deepEqual(rows[0], {
      tag: "Atlas",
      open: 2,
      overdue: 1,
      done: 1,
      percent: 33,
    });
    assert.deepEqual(
      rows.map((r) => r.tag),
      ["Atlas", "ops"],
    );
  });

  it("filters by tag and by words anywhere in the text", () => {
    assert.equal(applyExtras(todos, { tag: "ATLAS", text: "" }).length, 3);
    assert.deepEqual(
      applyExtras(todos, { tag: null, text: "rollout plan" }).map((t) => t.title),
      ["Rollout plan"],
    );
    assert.equal(applyExtras(todos, { tag: "ops", text: "zzz" }).length, 0);
  });
});

describe("board", () => {
  const mk = {
    open: todo({ title: "B", dueAt: "2026-11-05" }),
    first: todo({ title: "A", dueAt: "2026-11-01" }),
    waiting: todo({ waitingOn: "Sam" }),
    snoozed: todo({
      reminders: {
        enabled: false,
        remindAt: null,
        snoozedUntil: "2026-11-02T03:30:00.000Z",
        lastRemindedAt: null,
      },
    }),
    done: todo({ status: "done", completedAt: "2026-10-29T00:00:00.000Z" }),
    cancelled: todo({ status: "cancelled" }),
  };

  it("sorts to-dos into columns, by due date, and leaves cancelled out", () => {
    const cols = boardColumns(Object.values(mk), NOW);
    assert.deepEqual(
      cols.todo.map((t) => t.title),
      ["A", "B"],
    );
    assert.equal(cols.waiting.length, 1);
    assert.equal(cols.snoozed.length, 1);
    assert.equal(cols.done.length, 1);
  });

  it("works out what a drop does", () => {
    assert.deepEqual(dropPatch(mk.open, "done", NOW), { patch: { status: "done" } });
    assert.deepEqual(dropPatch(mk.waiting, "todo", NOW), { patch: { waitingOn: null } });
    assert.deepEqual(dropPatch(mk.snoozed, "todo", NOW), {
      patch: { snoozedUntil: null },
    });
    assert.deepEqual(dropPatch(mk.done, "todo", NOW), { patch: { status: "open" } });
    assert.equal(dropPatch(mk.open, "todo", NOW), null);
    assert.match(dropPatch(mk.open, "waiting", NOW).reason, /who you are waiting on/);
    assert.match(dropPatch(mk.open, "snoozed", NOW).reason, /Snooze/);
  });
});

describe("calendar", () => {
  it("lays a month out in Monday-first weeks with to-dos on their due day", () => {
    const due = todo({ title: "Report", dueAt: "2026-10-30" });
    const grid = monthGrid(2026, 10, [
      due,
      todo({ dueAt: "2026-11-02" }),
      todo({ dueAt: "2026-10-30", status: "done" }),
    ]);
    assert.equal(grid[0][0].day, "2026-09-28");
    assert.equal(grid[0][0].inMonth, false);
    const cell = grid.flat().find((c) => c.day === "2026-10-30");
    assert.deepEqual(
      cell.todos.map((t) => t.title),
      ["Report"],
    );
    assert.ok(grid.length >= 5 && grid.length <= 6);
    assert.ok(grid.flat().every((c) => c.day.length === 10));
  });

  it("moves between months across a year end", () => {
    assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
    assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
  });
});

describe("dependencies", () => {
  const a = todo({ id: "A", title: "Design", dueAt: "2026-11-10" });
  const b = todo({ id: "B", title: "Build", dueAt: "2026-11-05", blockedBy: ["A"] });
  const c = todo({ id: "C", blockedBy: ["B"] });

  it("lists open blockers and flags a date that cannot hold", () => {
    const state = blockedState(b, [a, b, c], TODAY);
    assert.deepEqual(
      state.blockers.map((t) => t.id),
      ["A"],
    );
    assert.equal(state.atRisk, true, "the blocker is due after the blocked to-do");
    assert.equal(
      blockedState(b, [{ ...a, status: "done" }, b], TODAY).blockers.length,
      0,
    );
    assert.equal(blockedState(c, [a, b, c], TODAY).atRisk, false);
  });

  it("finds what waits for a to-do and refuses a loop", () => {
    assert.deepEqual(
      dependentsOf(a, [a, b, c]).map((t) => t.id),
      ["B"],
    );
    assert.equal(wouldCycle("A", "C", [a, b, c]), true);
    assert.equal(wouldCycle("A", "A", [a]), true);
    assert.equal(wouldCycle("C", "A", [a, b, c]), false);
  });
});

describe("look-alikes", () => {
  it("finds an open to-do with the same words", () => {
    const todos = [
      todo({ title: "Send release plan to Priya" }),
      todo({ title: "Book the room" }),
      todo({ title: "Old release plan", status: "done" }),
    ];
    assert.deepEqual(
      similarTodos("Release plan for Priya", todos).map((t) => t.title),
      ["Send release plan to Priya"],
    );
    assert.deepEqual(similarTodos("the and for", todos), []);
  });
});

describe("why flagged", () => {
  it("says the most useful reason", () => {
    const all = [];
    assert.equal(
      flagReason(todo({ dueAt: "2026-10-27" }), all, TODAY, NOW, prefs),
      "Overdue by 3 days",
    );
    assert.equal(flagReason(todo({ dueAt: TODAY }), all, TODAY, NOW, prefs), "Due today");
    const waiting = todo({ waitingOn: "Sam", waitingSince: "2026-10-26T04:00:00.000Z" });
    assert.match(
      flagReason(waiting, all, TODAY, NOW, prefs),
      /^Chaser due: \d+ quiet working days?$/,
    );
    assert.equal(flagReason(todo(), all, TODAY, NOW, prefs), null);
    assert.equal(
      flagReason(todo({ status: "done", dueAt: "2026-10-01" }), all, TODAY, NOW, prefs),
      null,
    );
    const blocker = todo({ id: "BL", title: "Design", dueAt: "2026-11-30" });
    assert.match(
      flagReason(todo({ blockedBy: ["BL"] }), [blocker], TODAY, NOW, prefs),
      /^Blocked by Design/,
    );
  });
});

describe("weekly plan", () => {
  it("ranks overdue and due-today first, with reasons, and leaves out snoozed and blocked-low items", () => {
    const late = todo({ title: "Late", dueAt: "2026-10-27" });
    const today = todo({ title: "Today", dueAt: TODAY, priority: "high" });
    const later = todo({ title: "Later", dueAt: "2026-11-20" });
    const snoozed = todo({
      title: "Snoozed",
      dueAt: TODAY,
      reminders: {
        enabled: false,
        remindAt: null,
        snoozedUntil: "2026-11-02T03:30:00.000Z",
        lastRemindedAt: null,
      },
    });
    const plan = weeklyPlan([later, snoozed, today, late], TODAY, NOW, prefs);
    assert.deepEqual(
      plan.map((p) => p.todo.title),
      ["Late", "Today"],
    );
    assert.ok(plan[0].reasons[0].startsWith("overdue by 3 days"));
    assert.ok(plan[1].reasons.includes("high priority"));
  });
});

describe("escalation and hand-off", () => {
  it("suggests escalating after the third chaser round", () => {
    const old = todo({ waitingOn: "Sam", waitingSince: "2026-10-12T04:00:00.000Z" });
    assert.match(
      escalationSuggestion(old, NOW, prefs),
      /Sam has been quiet for \d+ working days/,
    );
    const fresh = todo({ waitingOn: "Sam", waitingSince: "2026-10-28T04:00:00.000Z" });
    assert.equal(escalationSuggestion(fresh, NOW, prefs), null);
    assert.equal(escalationSuggestion(todo(), NOW, prefs), null);
  });

  it("writes the escalation and the hand-off note from the to-do", () => {
    const t = todo({ title: "Vendor invoice", waitingOn: "Sam", dueAt: "2026-11-05" });
    const e = escalationText(t, "Pat");
    assert.equal(e.subject, "Escalation: Vendor invoice");
    assert.match(e.body, /waiting on Sam\. It is due 2026-11-05/);
    const note = handoffNote(
      {
        ...t,
        description: "Check the rollback.",
        actionItems: [
          { text: "Call Sam", done: false },
          { text: "Done thing", done: true },
        ],
        checkpoints: [{ label: "Review", state: "pending" }],
      },
      "Ben",
      "Pat",
    );
    assert.match(note, /^Hi Ben,/);
    assert.match(note, /Where it is: Review/);
    assert.match(note, /- Call Sam/);
    assert.doesNotMatch(note, /Done thing/);
    assert.match(note, /Pat$/);
  });
});

describe("extractActionItems", () => {
  const notes = [
    "Weekly sync, 29 Oct",
    "Attendees: Priya, Ben",
    "Action: Priya to send the deck Friday",
    "- [ ] Book the review room",
    "Ben will update the RAID log by 5 Nov",
    "@Sam: chase the vendor invoice",
    "We talked about the budget.",
    "Action: Book the review room",
  ].join("\n");

  it("reads labelled lines, checkboxes, names and mentions with owners and days", () => {
    const items = extractActionItems(notes, TODAY);
    assert.deepEqual(
      items.map((i) => i.title),
      [
        "send the deck",
        "Book the review room",
        "update the RAID log",
        "chase the vendor invoice",
      ],
    );
    assert.equal(items[0].owner, "Priya");
    assert.equal(items[0].dueAt, "2026-10-30");
    assert.equal(items[2].owner, "Ben");
    assert.equal(items[2].dueAt, "2026-11-05");
    assert.equal(items[3].owner, "Sam");
    assert.equal(items[1].owner, null);
  });

  it("ignores ordinary sentences and drops repeats", () => {
    assert.deepEqual(
      extractActionItems("We talked about the budget.\nThanks all.", TODAY),
      [],
    );
  });
});

describe("matchReason", () => {
  it("names the kind of conversation", () => {
    assert.match(matchReason("outlook|m|c"), /Outlook/);
    assert.match(matchReason("teams|conv|t|c"), /Teams/);
    assert.match(matchReason(null), /same conversation/);
  });
});
