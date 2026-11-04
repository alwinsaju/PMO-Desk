// Run with `pnpm test`. Dashboard charts (workload bars, health chips, sparklines, week series) and drag reordering.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TODAY_APP_LABEL,
  TODAY_TONE,
  dailyCounts,
  deltaText,
  healthChips,
  polylinePoints,
  runningTotal,
  sparkPoints,
  weekMetrics,
  workloadBars,
} from "./charts.ts";
import { DEFAULT_LAYOUT, dropIndex, moveWidgetTo, visibleWidgets } from "./layout.ts";

describe("Today rows", () => {
  it("has a tone and an app name for every kind and app", () => {
    for (const kind of [
      "overdue",
      "task",
      "leave",
      "signoff",
      "due-today",
      "review",
      "away",
      "contract-late",
      "contract-soon",
    ]) {
      assert.ok(TODAY_TONE[kind], kind);
    }
    assert.equal(TODAY_APP_LABEL.vendors, "Vendor and contract tracker");
    assert.equal(TODAY_APP_LABEL["pmo-todo"], "PMO To-Do");
    assert.equal(TODAY_APP_LABEL.staff, "Staff");
  });
});

describe("workloadBars", () => {
  const rows = [
    { owner: "Pat", open: 8, dueSoon: 2, overdue: 3 },
    { owner: "Sam", open: 4, dueSoon: 0, overdue: 0 },
  ];

  it("scales to the busiest person and splits late, soon and the rest", () => {
    const [pat, sam] = workloadBars(rows);
    assert.equal(pat.percent, 100);
    assert.equal(pat.overduePct, 37.5);
    assert.equal(pat.soonPct, 25);
    assert.equal(pat.otherPct, 37.5);
    assert.equal(sam.percent, 50);
    assert.equal(pat.label, "8 open, 3 late");
    assert.equal(sam.label, "4 open");
  });

  it("limits the list and copes with nothing", () => {
    assert.equal(workloadBars(rows, 1).length, 1);
    assert.deepEqual(workloadBars([]), []);
  });
});

describe("healthChips", () => {
  it("colours by reliability and turns a failing report red", () => {
    const chips = healthChips({
      score: 70,
      tasks: [
        { id: "a", name: "A", percent: 100, failing: false },
        { id: "b", name: "B", percent: 60, failing: false },
        { id: "c", name: "C", percent: 20, failing: false },
        { id: "d", name: "D", percent: null, failing: false },
        { id: "e", name: "E", percent: 90, failing: true },
      ],
    });
    assert.deepEqual(
      chips.map((c) => [c.text, c.tone]),
      [
        ["100%", "success"],
        ["60%", "warning"],
        ["20%", "danger"],
        ["No runs", "neutral"],
        ["90%", "danger"],
      ],
    );
  });
});

describe("sparkPoints", () => {
  it("puts the lowest value at the bottom and the top value at the top", () => {
    const pts = sparkPoints([0, 2, 4], { width: 104, height: 24, pad: 2 });
    assert.deepEqual(pts, [
      { x: 2, y: 22 },
      { x: 52, y: 12 },
      { x: 102, y: 2 },
    ]);
  });

  it("shares a scale and spreads over fixed slots", () => {
    const pts = sparkPoints([1, 1], { width: 102, height: 22, pad: 1, max: 2, slots: 3 });
    assert.deepEqual(pts, [
      { x: 1, y: 11 },
      { x: 51, y: 11 },
    ]);
  });

  it("keeps an all-zero line flat in the middle and handles one point", () => {
    assert.deepEqual(
      sparkPoints([0, 0], { width: 12, height: 12, pad: 2 }).map((p) => p.y),
      [6, 6],
    );
    assert.equal(sparkPoints([3], { width: 20, height: 10, pad: 0 }).length, 1);
    assert.deepEqual(sparkPoints([], { width: 20, height: 10 }), []);
  });

  it("writes the polyline attribute", () => {
    assert.equal(
      polylinePoints([
        { x: 1, y: 2 },
        { x: 3, y: 4.5 },
      ]),
      "1,2 3,4.5",
    );
  });
});

describe("week series", () => {
  it("counts per weekday and keeps running totals", () => {
    const counts = dailyCounts(
      ["2026-10-26", "2026-10-26", "2026-10-28", null, "2026-11-02"],
      "2026-10-26",
    );
    assert.deepEqual(counts, [2, 0, 1, 0, 0, 0, 0]);
    assert.deepEqual(runningTotal(counts), [2, 2, 3, 3, 3, 3, 3]);
  });

  const input = {
    todos: [
      {
        status: "done",
        approvedAt: "2026-10-19T05:00:00Z",
        createdAt: "",
        completedAt: "2026-10-27T05:00:00Z",
      },
      {
        status: "open",
        approvedAt: "2026-10-28T05:00:00Z",
        createdAt: "",
        completedAt: null,
      },
      {
        status: "open",
        approvedAt: "2026-10-21T05:00:00Z",
        createdAt: "",
        completedAt: null,
      },
    ],
    runs: [{ outcome: "completed", ended_at: "2026-10-29T05:00:00Z" }],
    leave: [{ startDate: "2026-10-30", status: "approved" }],
    today: "2026-10-28",
    timeZone: "Asia/Kolkata",
  };

  it("builds each metric: this week up to today, last week in full", () => {
    const metrics = weekMetrics(input);
    const approved = metrics.find((m) => m.key === "approved");
    assert.deepEqual(approved.thisSeries, [0, 0, 1]);
    assert.deepEqual(approved.lastSeries, [1, 1, 2, 2, 2, 2, 2]);
    assert.equal(approved.delta, -1);
    const closed = metrics.find((m) => m.key === "closed");
    assert.deepEqual(closed.thisSeries, [0, 1, 1]);
    assert.equal(closed.delta, 1);
  });

  it("does not count days after today", () => {
    const metrics = weekMetrics(input);
    assert.equal(metrics.find((m) => m.key === "reports").thisWeek, 0);
    assert.equal(metrics.find((m) => m.key === "leave").thisWeek, 0);
  });

  it("words a change", () => {
    assert.equal(deltaText(0), "same as last week");
    assert.equal(deltaText(2), "+2 vs last week");
    assert.equal(deltaText(-1), "\u22121 vs last week");
  });
});

describe("dragging cards to reorder", () => {
  const layout = {
    order: ["today", "todos", "chasers", "reports"],
    hidden: ["todos"],
    wide: [],
  };

  it("moves among the visible cards and leaves hidden ones in their slots", () => {
    assert.deepEqual(visibleWidgets(layout), ["today", "chasers", "reports"]);
    const moved = moveWidgetTo(layout, "reports", 0);
    assert.deepEqual(moved.order, ["reports", "todos", "today", "chasers"]);
    assert.deepEqual(visibleWidgets(moved), ["reports", "today", "chasers"]);
  });

  it("clamps the index, ignores a no-op and a hidden or unknown card", () => {
    assert.equal(moveWidgetTo(layout, "today", 0), layout);
    assert.deepEqual(moveWidgetTo(layout, "today", 99).order, [
      "chasers",
      "todos",
      "reports",
      "today",
    ]);
    assert.equal(moveWidgetTo(layout, "todos", 0), layout);
    assert.equal(moveWidgetTo(DEFAULT_LAYOUT, "nope", 0), DEFAULT_LAYOUT);
  });

  it("finds the drop position from the other rows' middles", () => {
    assert.equal(dropIndex([10, 30, 50], 5), 0);
    assert.equal(dropIndex([10, 30, 50], 35), 2);
    assert.equal(dropIndex([10, 30, 50], 500), 3);
    assert.equal(dropIndex([], 5), 0);
  });
});
