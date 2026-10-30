import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  awayWindow,
  dueText,
  lastLine,
  openTodos,
  overdueChasers,
  reportStatuses,
} from "./summary.ts";

const prefs = { timeZone: "Asia/Kolkata", workDays: [1, 2, 3, 4, 5], chaserDays: 2 };
// Fri 30 Oct 2026, 10:00 in Kolkata.
const NOW = new Date("2026-10-30T04:30:00.000Z");
const TODAY = "2026-10-30";

let n = 0;
const todo = (over = {}) => ({
  id: `todo_${String(++n).padStart(8, "0")}`,
  title: `Item ${n}`,
  owner: { name: "Ana", email: null, isMe: true },
  status: "open",
  dueAt: null,
  priority: "normal",
  waitingOn: null,
  waitingSince: null,
  updatedAt: "2026-10-30T04:00:00.000Z",
  chaserDays: null,
  ...over,
});

describe("open to-dos", () => {
  const items = [
    todo({ title: "Late 5", dueAt: "2026-10-25" }),
    todo({ title: "Late 1", dueAt: "2026-10-29" }),
    todo({ title: "Today", dueAt: TODAY }),
    todo({ title: "Tomorrow", dueAt: "2026-10-31" }),
    todo({ title: "Next week", dueAt: "2026-11-05" }),
    todo({ title: "Undated" }),
    todo({ title: "Done", status: "done", dueAt: "2026-10-01" }),
    todo({ title: "Cancelled", status: "cancelled", dueAt: "2026-10-01" }),
  ];

  it("counts what is open, late, due today and tomorrow, and undated", () => {
    const out = openTodos(items, NOW, prefs);
    assert.deepEqual(
      [out.open, out.overdue, out.dueToday, out.dueTomorrow, out.noDueDate],
      [6, 2, 1, 1, 1],
    );
  });

  it("lists the urgent ones: latest first, then today, then tomorrow", () => {
    const out = openTodos(items, NOW, prefs);
    assert.deepEqual(
      out.urgent.map((r) => r.title),
      ["Late 5", "Late 1", "Today", "Tomorrow"],
    );
    assert.equal(out.urgent[0].daysLate, 5);
    assert.equal(out.urgent[2].daysLate, 0);
  });

  it("puts high priority first among equals, and caps the list", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      todo({ title: `T${i}`, dueAt: TODAY, priority: i === 7 ? "high" : "normal" }),
    );
    const out = openTodos(many, NOW, prefs, 3);
    assert.equal(out.urgent.length, 3);
    assert.equal(out.urgent[0].title, "T7");
  });

  it("names the owner or says Unassigned", () => {
    const out = openTodos(
      [todo({ dueAt: TODAY, owner: { name: null, email: null } })],
      NOW,
      prefs,
    );
    assert.equal(out.urgent[0].owner, "Unassigned");
  });

  it("counts who is waited on and who is due a chaser", () => {
    const out = openTodos(
      [
        todo({ waitingOn: "Sam", waitingSince: "2026-10-26T04:00:00.000Z" }),
        todo({ waitingOn: "Kim", waitingSince: "2026-10-30T03:00:00.000Z" }),
      ],
      NOW,
      prefs,
    );
    assert.deepEqual([out.waiting, out.chaseDue], [2, 1]);
  });

  it("uses the reminder time zone for today", () => {
    // 23:00 UTC on the 29th is already the 30th in Kolkata.
    const late = new Date("2026-10-29T23:00:00.000Z");
    assert.equal(openTodos([todo({ dueAt: TODAY })], late, prefs).dueToday, 1);
  });

  it("describes a due date", () => {
    assert.equal(dueText({ dueAt: null, daysLate: 0 }, TODAY), "No due date");
    assert.equal(
      dueText({ dueAt: "2026-10-28", daysLate: 2 }, TODAY),
      "Overdue by 2 days",
    );
    assert.equal(
      dueText({ dueAt: "2026-10-29", daysLate: 1 }, TODAY),
      "Overdue by 1 day",
    );
    assert.equal(dueText({ dueAt: TODAY, daysLate: 0 }, TODAY), "Due today");
    assert.equal(dueText({ dueAt: "2026-10-31", daysLate: 0 }, TODAY), "Due tomorrow");
    assert.equal(dueText({ dueAt: "2026-11-05", daysLate: 0 }, TODAY), "Due 5 Nov");
  });
});

describe("overdue chasers", () => {
  it("lists to-dos whose quiet days reached the cadence, longest first", () => {
    const rows = overdueChasers(
      [
        todo({
          title: "Quiet 4",
          waitingOn: "Sam",
          waitingSince: "2026-10-26T04:00:00.000Z",
        }),
        todo({
          title: "Quiet 2",
          waitingOn: "Kim",
          waitingSince: "2026-10-28T04:00:00.000Z",
        }),
        todo({
          title: "Fresh",
          waitingOn: "Lee",
          waitingSince: "2026-10-29T04:00:00.000Z",
        }),
        todo({ title: "Not waiting" }),
        todo({
          title: "Closed",
          status: "done",
          waitingOn: "Sam",
          waitingSince: "2026-10-01T04:00:00.000Z",
        }),
      ],
      NOW,
      prefs,
    );
    assert.deepEqual(
      rows.map((r) => [r.title, r.quietDays, r.overBy]),
      [
        ["Quiet 4", 4, 2],
        ["Quiet 2", 2, 0],
      ],
    );
    assert.equal(rows[0].waitingOn, "Sam");
  });

  it("honours a to-do's own cadence", () => {
    const rows = overdueChasers(
      [
        todo({
          waitingOn: "Sam",
          waitingSince: "2026-10-26T04:00:00.000Z",
          chaserDays: 10,
        }),
      ],
      NOW,
      prefs,
    );
    assert.equal(rows.length, 0);
  });
});

describe("who is out: the window", () => {
  it("this week runs from today to Sunday; next week is Monday to Sunday", () => {
    assert.deepEqual(awayWindow("2026-10-30", "this-week"), {
      from: "2026-10-30",
      to: "2026-11-01",
    });
    assert.deepEqual(awayWindow("2026-10-30", "next-week"), {
      from: "2026-11-02",
      to: "2026-11-08",
    });
    assert.deepEqual(awayWindow("2026-11-02", "this-week"), {
      from: "2026-11-02",
      to: "2026-11-08",
    });
    assert.deepEqual(awayWindow("2026-11-01", "next-week"), {
      from: "2026-11-02",
      to: "2026-11-08",
    });
  });
});

describe("report status", () => {
  const task = (id, state, over = {}) => ({
    id,
    displayName: `Name ${id}`,
    state,
    error: null,
    ...over,
  });
  const run = (outcome, over = {}) => ({
    outcome,
    started_at: "2026-10-28T04:00:00.000Z",
    ended_at: "2026-10-28T04:10:00.000Z",
    error: null,
    ...over,
  });
  const status = (tasks, histories = {}, saved = null) =>
    reportStatuses({ tasks, histories, saved, now: NOW, timeZone: "Asia/Kolkata" });

  it("shows only the report tasks the engine knows, in a fixed order", () => {
    const rows = status([
      task("weekly-backlog-report", "resting"),
      task("shift-roster", "resting"),
      task("weekly-aging-report", "resting"),
    ]);
    assert.deepEqual(
      rows.map((r) => r.id),
      ["weekly-aging-report", "weekly-backlog-report"],
    );
    assert.equal(rows[0].name, "Name weekly-aging-report");
  });

  it("maps each state to what a person should do", () => {
    const states = [
      ["working", "info", "Running", false],
      ["finishing", "info", "Running", false],
      ["awaiting_review", "warning", "Needs your review", true],
      ["awaiting_send", "warning", "Ready to send", true],
      ["error", "danger", "Failed", true],
    ];
    for (const [state, tone, label, needsYou] of states) {
      const [row] = status([task("weekly-aging-report", state, { error: "Boom" })]);
      assert.deepEqual(
        [row.tone, row.status, row.needsYou],
        [tone, label, needsYou],
        state,
      );
    }
    assert.equal(
      status([task("weekly-aging-report", "error", { error: "Boom" })])[0].detail,
      "Boom",
    );
  });

  it("shows the error itself, not the start of a traceback", () => {
    const traceback =
      'Traceback (most recent call last):\n  File "x.py", line 3, in <module>\nFileNotFoundError: No raw export found in input/\n';
    const [failed] = status([task("weekly-aging-report", "error", { error: traceback })]);
    assert.equal(failed.detail, "FileNotFoundError: No raw export found in input/");
    const [idle] = status([task("weekly-aging-report", "resting")], {
      "weekly-aging-report": [run("failed", { error: traceback })],
    });
    assert.match(idle.detail, /: FileNotFoundError: No raw export found in input\/$/);
    assert.equal(lastLine("a".repeat(300), 10), `${"a".repeat(9)}…`);
    assert.equal(lastLine(""), "");
  });

  it("an idle task shows how its last run ended", () => {
    const histories = {
      "weekly-aging-report": [run("completed")],
      "weekly-backlog-report": [run("failed", { error: "No file" }), run("completed")],
      "monthly-report-deck": [],
    };
    const rows = status(
      [
        task("weekly-aging-report", "resting"),
        task("weekly-backlog-report", "resting"),
        task("monthly-report-deck", "resting"),
      ],
      histories,
    );
    assert.deepEqual(
      rows.map((r) => [r.status, r.tone]),
      [
        ["Completed", "success"],
        ["Last run failed", "danger"],
        ["Not run yet", "neutral"],
      ],
    );
    assert.equal(rows[0].detail, "Wed 28 Oct, 09:40");
    assert.match(rows[1].detail, /No file$/);
  });

  it("adds the PMO weekly report: up to date once last week is covered", () => {
    const saved = (endDay) => [
      {
        title: "W",
        period: {
          label: "Mon 19 Oct to Sun 25 Oct 2026",
          startDay: "2026-10-19",
          endDay,
        },
        savedAt: "2026-10-26T05:00:00.000Z",
        edited: false,
      },
    ];
    assert.deepEqual(
      status([], {}, saved("2026-10-25")).map((r) => [r.id, r.status, r.tone]),
      [["pmo-weekly-report", "Up to date", "success"]],
    );
    assert.equal(status([], {}, saved("2026-10-18"))[0].status, "Behind");
    assert.equal(status([], {}, [])[0].status, "None saved");
    assert.equal(status([], {}, null).length, 0);
  });

  it("with the engine unreachable, shows only what is known", () => {
    assert.deepEqual(
      status(null, {}, []).map((r) => r.id),
      ["pmo-weekly-report"],
    );
  });
});
