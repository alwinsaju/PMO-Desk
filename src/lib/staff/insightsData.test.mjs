import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  balanceBar,
  capacityHeatmap,
  distribution,
  donutArcs,
  holidayMonth,
  tagWeight,
} from "./insightsData.ts";
import { overlappingLeave, pendingLeaveOn } from "./timeoffView.ts";

const emp = (over = {}) => ({
  firstName: "A",
  lastName: "B",
  deloitteEmail: "a@x.com",
  level: "",
  location: "",
  team: "",
  op: "",
  offering: "",
  ...over,
});

describe("capacityHeatmap", () => {
  const schedules = [
    {
      id: "s1",
      name: "S",
      shifts: [{ id: "day", label: "Day", start: "09:00", end: "17:00", days: [] }],
    },
  ];
  const groups = [
    { id: "g1", name: "Support", scheduleId: "s1" },
    { id: "g2", name: "Hidden", scheduleId: "s1", hidden: true },
    { id: "g3", name: "Ops", scheduleId: "s1" },
  ];
  const member = (n, groupId, employeeId) => ({
    id: `mem_0000000${n}`,
    name: `M${n}`,
    employeeId,
    groupId,
    city: "",
    role: "",
  });
  const members = [
    member(1, "g1", "e1"),
    member(2, "g1", "e2"),
    member(3, "g1", "e3"),
    member(4, "g3", "e4"),
  ];
  const shift = (m, date) => ({
    id: `mem_0000000${m}|${date}`,
    memberId: `mem_0000000${m}`,
    date,
    ref: "s1:day",
  });
  const input = (assignments, timeOff = []) => ({
    employees: [],
    members,
    groups,
    schedules,
    assignments,
    timeOff,
  });
  const MON = "2026-11-02";
  const TUE = "2026-11-03";

  it("has a row per visible team and a cell per day, in order", () => {
    const map = capacityHeatmap(MON, 3, input([]), {});
    assert.deepEqual(
      map.rows.map((r) => r.name),
      ["Support", "Ops"],
    );
    assert.deepEqual(map.days, [MON, TUE, "2026-11-04"]);
    assert.ok(map.rows.every((r) => r.cells.length === 3));
  });

  it("leaves days nobody is scheduled empty, and scales the rest to the busiest day", () => {
    const rows = capacityHeatmap(
      MON,
      3,
      input([shift(1, MON), shift(2, MON), shift(3, MON), shift(1, TUE)]),
      {},
    ).rows;
    const [support] = rows;
    assert.deepEqual(
      support.cells.map((c) => [c.working, c.level]),
      [
        [3, 4],
        [1, 2],
        [0, 0],
      ],
    );
  });

  it("counts approved leave apart and flags days under the team's minimum", () => {
    const leave = {
      id: "to_1",
      employeeId: "e1",
      type: "pto",
      startDate: MON,
      endDate: MON,
      status: "approved",
    };
    const [support] = capacityHeatmap(
      MON,
      2,
      input([shift(1, MON), shift(2, MON), shift(1, TUE), shift(2, TUE)], [leave]),
      { g1: 2 },
    ).rows;
    assert.equal(support.need, 2);
    assert.deepEqual(
      support.cells.map((c) => [c.working, c.onLeave, c.short]),
      [
        [1, 1, true],
        [2, 0, false],
      ],
    );
  });

  it("shows a day where everyone is away as the lowest level, not empty", () => {
    const leave = {
      id: "to_1",
      employeeId: "e4",
      type: "pto",
      startDate: MON,
      endDate: MON,
      status: "approved",
    };
    const ops = capacityHeatmap(MON, 2, input([shift(4, MON), shift(4, TUE)], [leave]), {
      g3: 1,
    }).rows[1];
    assert.deepEqual(
      ops.cells.map((c) => [c.working, c.level, c.short]),
      [
        [0, 1, true],
        [1, 4, false],
      ],
    );
  });

  it("is empty for no days", () => {
    assert.deepEqual(
      capacityHeatmap(MON, 0, input([]), {}).rows.map((r) => r.cells.length),
      [0, 0],
    );
  });
});

describe("distribution", () => {
  const people = [
    emp({ level: "Senior" }),
    emp({ level: "Senior" }),
    emp({ level: "Analyst" }),
    emp({ level: " " }),
    emp({ level: "Manager" }),
  ];

  it("counts by value, biggest first, with the unset ones last", () => {
    const slices = distribution(people, "level");
    assert.deepEqual(
      slices.map((s) => [s.label, s.count]),
      [
        ["Senior", 2],
        ["Analyst", 1],
        ["Manager", 1],
        ["Not set", 1],
      ],
    );
    assert.equal(slices[0].share, 0.4);
    assert.equal(
      slices.reduce((n, s) => n + s.share, 0),
      1,
    );
  });

  it("merges the smallest groups beyond a limit into Other", () => {
    const slices = distribution(people, "level", 3);
    assert.deepEqual(
      slices.map((s) => [s.label, s.count]),
      [
        ["Senior", 2],
        ["Analyst", 1],
        ["Other (2)", 2],
      ],
    );
  });

  it("is empty for nobody", () => {
    assert.deepEqual(distribution([], "team"), []);
  });
});

describe("donutArcs", () => {
  it("lays the slices end to end around the ring", () => {
    assert.deepEqual(donutArcs([{ share: 0.5 }, { share: 0.25 }, { share: 0.25 }]), [
      { length: 50, offset: 0 },
      { length: 25, offset: 50 },
      { length: 25, offset: 75 },
    ]);
    assert.deepEqual(donutArcs([]), []);
  });
});

describe("balanceBar", () => {
  it("splits the allowance into used and waiting", () => {
    assert.deepEqual(balanceBar({ allowance: 20, used: 5, pending: 5, remaining: 15 }), {
      usedPct: 25,
      pendingPct: 25,
      over: false,
    });
  });
  it("never draws past the bar and flags overdrawn leave", () => {
    assert.deepEqual(balanceBar({ allowance: 10, used: 12, pending: 3, remaining: -2 }), {
      usedPct: 100,
      pendingPct: 0,
      over: true,
    });
    assert.equal(
      balanceBar({ allowance: 10, used: 8, pending: 5, remaining: 2 }).pendingPct,
      20,
    );
  });
  it("copes with no allowance", () => {
    assert.deepEqual(balanceBar({ allowance: 0, used: 0, pending: 0, remaining: 0 }), {
      usedPct: 0,
      pendingPct: 0,
      over: false,
    });
  });
});

describe("holidayMonth", () => {
  const holiday = (date, label, endDate = date) => ({
    id: label,
    date,
    endDate,
    label,
    kind: "holiday",
  });
  it("pads to whole Monday-first weeks and files holidays on their days", () => {
    const weeks = holidayMonth(
      "2026-11-15",
      [holiday("2026-11-01", "Sun day"), holiday("2026-11-10", "Diwali", "2026-11-11")],
      [
        holiday("2026-11-26", "Thanksgiving"),
        { ...holiday("2026-11-03", "Note"), kind: "note" },
      ],
    );
    assert.ok(weeks.every((w) => w.length === 7));
    const days = weeks.flat().filter(Boolean);
    assert.equal(days.length, 30);
    assert.equal(
      weeks[0].slice(0, 6).every((d) => d === null),
      true,
    );
    const on = (date) => days.find((d) => d.date === date);
    assert.deepEqual(on("2026-11-01").saved, ["Sun day"]);
    assert.deepEqual(on("2026-11-11").saved, ["Diwali"]);
    assert.deepEqual(on("2026-11-26").planned, ["Thanksgiving"]);
    assert.deepEqual(on("2026-11-03"), { date: "2026-11-03", saved: [], planned: [] });
  });
});

describe("tagWeight", () => {
  it("grows with the count and stays in 1-4", () => {
    assert.deepEqual(
      [1, 3, 6, 9, 10].map((n) => tagWeight(n, 1, 10)),
      [1, 1, 3, 4, 4],
    );
    assert.equal(tagWeight(5, 5, 5), 2);
  });
});

describe("overlappingLeave", () => {
  const req = (id, employeeId, startDate, endDate, status = "approved") => ({
    id,
    employeeId,
    startDate,
    endDate,
    status,
    type: "pto",
  });
  const people = new Map([
    ["e1", emp({ firstName: "Ann" })],
    ["e2", emp({ firstName: "Bob" })],
    ["e3", emp({ firstName: "Cy" })],
  ]);
  const mine = req("a", "e1", "2026-11-10", "2026-11-14", "pending");

  it("lists other people's leave on the same days, clipped to the request", () => {
    const all = [
      mine,
      req("b", "e2", "2026-11-12", "2026-11-20"),
      req("c", "e3", "2026-11-05", "2026-11-10", "pending"),
    ];
    assert.deepEqual(
      overlappingLeave(mine, all, people).map((p) => [p.name, p.status, p.start, p.end]),
      [
        ["Cy B", "pending", "2026-11-10", "2026-11-10"],
        ["Bob B", "approved", "2026-11-12", "2026-11-14"],
      ],
    );
  });

  it("ignores the person's own leave, rejected leave, other dates and unknown people", () => {
    const all = [
      mine,
      req("own", "e1", "2026-11-11", "2026-11-12"),
      req("no", "e2", "2026-11-11", "2026-11-12", "rejected"),
      req("later", "e2", "2026-11-15", "2026-11-16"),
      req("ghost", "e9", "2026-11-11", "2026-11-12"),
    ];
    assert.deepEqual(overlappingLeave(mine, all, people), []);
  });
});

describe("pendingLeaveOn", () => {
  const list = [
    {
      id: "a",
      employeeId: "e1",
      startDate: "2026-11-10",
      endDate: "2026-11-12",
      status: "pending",
    },
    {
      id: "b",
      employeeId: "e2",
      startDate: "2026-11-10",
      endDate: "2026-11-12",
      status: "approved",
    },
  ];
  it("finds waiting leave on a day, for that person only", () => {
    assert.equal(pendingLeaveOn(list, "e1", "2026-11-12")?.id, "a");
    assert.equal(pendingLeaveOn(list, "e1", "2026-11-13"), undefined);
    assert.equal(pendingLeaveOn(list, "e2", "2026-11-11"), undefined);
  });
});
