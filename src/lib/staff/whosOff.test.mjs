import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createEmployee } from "./employees.ts";
import { createTimeOff } from "./timeoff.ts";
import { makeAssignment } from "./shifts.ts";
import { peopleAway, whosOff } from "./whosOff.ts";

const NOW = "2026-10-30T00:00:00.000Z";
const person = (n, over = {}) =>
  createEmployee(
    {
      id: `emp_0000000000${n}`,
      firstName: `P${n}`,
      lastName: "Test",
      deloitteEmail: `p${n}@x.com`,
      ...over,
    },
    NOW,
  );
const ana = person(1, { firstName: "Ana", lastName: "Rao" });
const ben = person(2, { firstName: "Ben", lastName: "Cho" });
const cy = person(3, { firstName: "Cy", lastName: "Dee" });
const leave = (employee, startDate, endDate, over = {}) =>
  createTimeOff(
    { employeeId: employee.id, startDate, endDate, status: "approved", ...over },
    NOW,
  );
const member = (n, employeeId = null, name = `Member ${n}`) => ({
  id: `mem_00000000000${n}`,
  name,
  employeeId,
});
const day = (m, date, status) => makeAssignment(m.id, date, `status:${status}`);

// Mon 2 Nov 2026 .. Sun 8 Nov 2026
const base = {
  from: "2026-11-02",
  to: "2026-11-08",
  employees: [ana, ben, cy],
  timeOff: [],
  shifts: [],
  members: [],
};

describe("time off", () => {
  it("lists approved leave that touches the range, clipped to it", () => {
    const out = whosOff({
      ...base,
      timeOff: [
        leave(ana, "2026-10-28", "2026-11-03"),
        leave(ben, "2026-11-06", "2026-11-20"),
        leave(cy, "2026-11-09", "2026-11-10"),
      ],
    });
    assert.deepEqual(
      out.entries.map((e) => [e.name, e.start, e.end, e.label, e.source]),
      [
        ["Ana Rao", "2026-11-02", "2026-11-03", "PTO", "time-off"],
        ["Ben Cho", "2026-11-06", "2026-11-08", "PTO", "time-off"],
      ],
    );
  });

  it("leaves out a request that covers only a weekend, keeps one that touches a weekday", () => {
    const out = whosOff({
      ...base,
      timeOff: [
        leave(ana, "2026-11-07", "2026-11-08"),
        leave(ben, "2026-11-06", "2026-11-08"),
      ],
    });
    assert.deepEqual(
      out.entries.map((e) => [e.name, e.start, e.end]),
      [["Ben Cho", "2026-11-06", "2026-11-08"]],
    );
    // Asked about the weekend only, a longer leave that runs through it still shows.
    const weekend = whosOff({
      ...base,
      from: "2026-11-07",
      timeOff: [leave(ben, "2026-11-06", "2026-11-09")],
    });
    assert.deepEqual(peopleAway(weekend), ["Ben Cho"]);
  });

  it("leaves out pending and rejected requests, unless pending is asked for", () => {
    const timeOff = [
      leave(ana, "2026-11-02", "2026-11-02", { status: "pending" }),
      leave(ben, "2026-11-02", "2026-11-02", { status: "rejected" }),
    ];
    assert.equal(whosOff({ ...base, timeOff }).entries.length, 0);
    const withPending = whosOff({ ...base, timeOff, includePending: true });
    assert.deepEqual(
      withPending.entries.map((e) => [e.name, e.pending]),
      [["Ana Rao", true]],
    );
  });

  it("ignores leave of someone who is not on the roster any more", () => {
    const gone = createTimeOff(
      {
        employeeId: "emp_deadbeef0001",
        startDate: "2026-11-02",
        endDate: "2026-11-02",
        status: "approved",
      },
      NOW,
    );
    assert.equal(whosOff({ ...base, timeOff: [gone] }).entries.length, 0);
  });

  it("names the leave type", () => {
    const out = whosOff({
      ...base,
      timeOff: [leave(ana, "2026-11-02", "2026-11-02", { type: "sick" })],
    });
    assert.equal(out.entries[0].label, "Sick leave");
  });
});

describe("the shift roster's leave days", () => {
  it("joins consecutive days into one entry, across a weekend", () => {
    const m = member(1, ana.id);
    const out = whosOff({
      ...base,
      from: "2026-11-02",
      to: "2026-11-13",
      members: [m],
      shifts: ["2026-11-05", "2026-11-06", "2026-11-09", "2026-11-12"].map((d) =>
        day(m, d, "pto"),
      ),
    });
    assert.deepEqual(
      out.entries.map((e) => [e.name, e.start, e.end, e.label, e.source]),
      [
        ["Ana Rao", "2026-11-05", "2026-11-09", "PTO", "roster"],
        ["Ana Rao", "2026-11-12", "2026-11-12", "PTO", "roster"],
      ],
    );
  });

  it("counts PTO, temp PTO, comp off and sick leave, not holidays, weekly offs or on-call", () => {
    const m = member(1, null, "Roster Only");
    const out = whosOff({
      ...base,
      members: [m],
      shifts: [
        day(m, "2026-11-02", "pto"),
        day(m, "2026-11-03", "holiday"),
        day(m, "2026-11-04", "off"),
        day(m, "2026-11-05", "on-call"),
        day(m, "2026-11-06", "sick"),
        makeAssignment(m.id, "2026-11-07", "main:shift-1"),
      ],
    });
    assert.deepEqual(
      out.entries.map((e) => [e.start, e.label]),
      [
        ["2026-11-02", "PTO"],
        ["2026-11-06", "Sick leave"],
      ],
    );
    assert.equal(out.entries[0].name, "Roster Only");
    assert.equal(out.entries[0].employeeId, null);
  });

  it("uses the directory name of a linked member", () => {
    const m = member(1, ben.id, "B. Cho (roster spelling)");
    const out = whosOff({
      ...base,
      members: [m],
      shifts: [day(m, "2026-11-02", "comp")],
    });
    assert.equal(out.entries[0].name, "Ben Cho");
    assert.equal(out.entries[0].label, "Comp off");
  });

  it("does not list a day twice when the person's time off covers it", () => {
    const m = member(1, ana.id);
    const out = whosOff({
      ...base,
      timeOff: [leave(ana, "2026-11-02", "2026-11-03")],
      members: [m],
      shifts: [
        day(m, "2026-11-02", "pto"),
        day(m, "2026-11-03", "pto"),
        day(m, "2026-11-05", "pto"),
      ],
    });
    assert.deepEqual(
      out.entries.map((e) => [e.source, e.start, e.end]),
      [
        ["time-off", "2026-11-02", "2026-11-03"],
        ["roster", "2026-11-05", "2026-11-05"],
      ],
    );
  });

  it("ignores days outside the range and members that are not on the roster", () => {
    const m = member(1);
    const out = whosOff({
      ...base,
      members: [m],
      shifts: [
        day(m, "2026-11-01", "pto"),
        day(m, "2026-11-09", "pto"),
        day(member(9), "2026-11-03", "pto"),
      ],
    });
    assert.equal(out.entries.length, 0);
  });
});

describe("the answer", () => {
  it("is sorted by first day then name, and lists each person once", () => {
    const out = whosOff({
      ...base,
      timeOff: [
        leave(cy, "2026-11-03", "2026-11-03"),
        leave(ben, "2026-11-02", "2026-11-02"),
        leave(ana, "2026-11-02", "2026-11-04"),
      ],
    });
    assert.deepEqual(
      out.entries.map((e) => e.name),
      ["Ana Rao", "Ben Cho", "Cy Dee"],
    );
    assert.deepEqual(peopleAway({ entries: [...out.entries, ...out.entries] }), [
      "Ana Rao",
      "Ben Cho",
      "Cy Dee",
    ]);
  });

  it("lists the holidays in the range", () => {
    const events = [
      {
        id: "e1",
        date: "2026-11-05",
        endDate: "2026-11-05",
        label: "Diwali",
        kind: "holiday",
        locations: ["Pune"],
      },
      {
        id: "e2",
        date: "2026-11-05",
        endDate: "2026-11-05",
        label: "Team day",
        kind: "note",
      },
      {
        id: "e3",
        date: "2026-12-25",
        endDate: "2026-12-25",
        label: "Christmas",
        kind: "holiday",
      },
    ];
    assert.deepEqual(
      whosOff({ ...base, events }).holidays.map((h) => h.label),
      ["Diwali"],
    );
  });

  it("answers nothing for a bad or oversized range", () => {
    assert.equal(whosOff({ ...base, from: "nope" }).entries.length, 0);
    assert.equal(
      whosOff({ ...base, from: "2026-11-08", to: "2026-11-02" }).entries.length,
      0,
    );
    assert.equal(
      whosOff({
        ...base,
        from: "2026-01-01",
        to: "2026-12-31",
        timeOff: [leave(ana, "2026-02-01", "2026-02-01")],
      }).entries.length,
      0,
    );
  });
});
