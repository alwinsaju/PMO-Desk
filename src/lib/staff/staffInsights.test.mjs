// Run with `pnpm test`. The Staff logic added in v5.5: capacity, leave, on call, holidays, people, checklists, exports.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { breachText, capacityOn, coverageGaps, leaveImpact } from "./capacity.ts";
import {
  checkSwap,
  leaveBalance,
  leaveDaysInYear,
  leaveReply,
  parseDateList,
  swapAssignments,
} from "./leave.ts";
import { onCallDays, planOnCall } from "./onCall.ts";
import { COUNTRIES, easterSunday, holidayEvents, holidaysFor } from "./holidayRules.ts";
import {
  endAlerts,
  endAlertText,
  greetingDraft,
  monthDay,
  orgChart,
  skillsMatrix,
  upcomingOccasions,
  whoCanCover,
} from "./people.ts";
import {
  isComplete,
  makeChecklist,
  newArrivals,
  progressOf,
  sanitizeChecklists,
  toggleItem,
} from "./checklists.ts";
import { buildIcs, rosterRows, timeOffIcs, timeOffRows, toCsv } from "./exportFiles.ts";
import { findPerson, profileLines } from "./profileCard.ts";
import { sanitizeStaffPrefs } from "./staffPrefs.ts";

const emp = (id, first, over = {}) => ({
  id,
  firstName: first,
  lastName: "Test",
  deloitteEmail: `${first.toLowerCase()}@x.com`,
  rollOffDate: "",
  contractEndDate: "",
  staffitStartDate: "",
  staffitEndDate: "",
  birthday: "",
  skills: [],
  clientManager: "",
  team: "",
  location: "",
  homeOffice: "",
  ...over,
});

const schedules = [
  {
    id: "s1",
    name: "S",
    shifts: [{ id: "day", label: "Day", start: "09:00", end: "17:00", days: [] }],
  },
];
const groups = [{ id: "g1", name: "Support", scheduleId: "s1" }];
const members = [
  {
    id: "mem_00000001",
    name: "Ann",
    employeeId: "e1",
    groupId: "g1",
    city: "",
    role: "",
  },
  {
    id: "mem_00000002",
    name: "Bob",
    employeeId: "e2",
    groupId: "g1",
    city: "",
    role: "",
  },
];
const shift = (memberId, date) => ({
  id: `${memberId}|${date}`,
  memberId,
  date,
  ref: "s1:day",
});
const DAY = "2026-11-03";
const input = (timeOff = []) => ({
  employees: [emp("e1", "Ann"), emp("e2", "Bob")],
  members,
  groups,
  schedules,
  assignments: [shift("mem_00000001", DAY), shift("mem_00000002", DAY)],
  timeOff,
});
const leave = (employeeId, status = "approved") => ({
  id: "to_1",
  employeeId,
  type: "pto",
  startDate: DAY,
  endDate: DAY,
  status,
});

describe("capacity", () => {
  it("counts people working and on approved leave per team", () => {
    const [g] = capacityOn(DAY, input([leave("e1")]));
    assert.equal(g.working, 1);
    assert.equal(g.onLeave, 1);
    assert.deepEqual(g.byShift, [{ label: "Day", count: 1 }]);
    assert.equal(capacityOn(DAY, input([leave("e1", "pending")]))[0].working, 2);
  });
  it("finds gaps only where the team is scheduled", () => {
    const gaps = coverageGaps("2026-11-02", 3, input([leave("e1")]), { g1: 2 });
    assert.deepEqual(
      gaps.map((g) => [g.day, g.have, g.need]),
      [[DAY, 1, 2]],
    );
    assert.deepEqual(coverageGaps("2026-11-02", 3, input(), { g1: 2 }), []);
  });
  it("warns when approving a request would break the minimum", () => {
    const req = { employeeId: "e1", startDate: DAY, endDate: DAY };
    const b = leaveImpact(req, input(), { g1: 2 });
    assert.equal(b.length, 1);
    assert.equal(b[0].after, 1);
    assert.match(breachText(b), /below its minimum of 2/);
    assert.deepEqual(leaveImpact(req, input(), { g1: 1 }), []);
    assert.deepEqual(leaveImpact(req, input(), {}), []);
  });
});

describe("leave", () => {
  it("counts working days inside a year, minus holidays", () => {
    const r = { startDate: "2026-12-28", endDate: "2027-01-05" };
    assert.equal(leaveDaysInYear(r, 2026), 4); // Mon 28 - Thu 31
    assert.equal(leaveDaysInYear(r, 2027, new Set(["2027-01-01"])), 2); // Mon 4, Tue 5 (Fri 1 is a holiday)
  });
  it("totals PTO per person", () => {
    const reqs = [
      {
        employeeId: "e1",
        type: "pto",
        status: "approved",
        startDate: "2026-03-02",
        endDate: "2026-03-04",
      },
      {
        employeeId: "e1",
        type: "pto",
        status: "pending",
        startDate: "2026-04-06",
        endDate: "2026-04-06",
      },
      {
        employeeId: "e1",
        type: "sick",
        status: "approved",
        startDate: "2026-05-04",
        endDate: "2026-05-04",
      },
      {
        employeeId: "e2",
        type: "pto",
        status: "approved",
        startDate: "2026-03-02",
        endDate: "2026-03-02",
      },
    ];
    assert.deepEqual(leaveBalance("e1", reqs, 2026, 20), {
      allowance: 20,
      used: 3,
      pending: 1,
      remaining: 17,
    });
  });
  it("writes a reply for either decision", () => {
    const r = { startDate: "2026-11-05", endDate: "2026-11-07", type: "pto" };
    assert.match(leaveReply(r, "Ann", "approved", "Pat").body, /is approved/);
    const no = leaveReply(r, "Ann", "rejected", "Pat", "Release week.");
    assert.match(no.subject, /not approved/);
    assert.match(no.body, /Release week\./);
  });
  it("reads pasted date lists", () => {
    const today = "2026-10-30";
    const p = parseDateList(
      "5–7 Nov, 12 Nov; Nov 20 and 2026-12-01 to 2026-12-03, banana",
      today,
    );
    assert.deepEqual(p.ranges, [
      { start: "2026-11-05", end: "2026-11-07" },
      { start: "2026-11-12", end: "2026-11-12" },
      { start: "2026-11-20", end: "2026-11-20" },
      { start: "2026-12-01", end: "2026-12-03" },
    ]);
    assert.deepEqual(p.unreadable, ["banana"]);
    assert.deepEqual(parseDateList("2 Jan", today).ranges, [
      { start: "2027-01-02", end: "2027-01-02" },
    ]);
    assert.deepEqual(parseDateList("30 Dec - 2 Jan", "2026-12-20").ranges, [
      { start: "2026-12-30", end: "2027-01-02" },
    ]);
    assert.equal(parseDateList("31 Feb", today).unreadable.length, 1);
  });
  it("checks and applies a swap", () => {
    const a = {
      id: "mem_00000001|2026-11-03",
      memberA: "mem_00000001",
      memberB: "mem_00000002",
      dateA: "2026-11-03",
      dateB: "2026-11-04",
      reason: "Dentist",
    };
    const list = [
      {
        id: "mem_00000001|2026-11-03",
        memberId: "mem_00000001",
        date: "2026-11-03",
        ref: "s1:day",
      },
      {
        id: "mem_00000002|2026-11-04",
        memberId: "mem_00000002",
        date: "2026-11-04",
        ref: "status:off",
      },
    ];
    assert.equal(checkSwap(a, list).ok, true);
    assert.equal(checkSwap(a, []).ok, false);
    const [x, y] = swapAssignments(a, list);
    assert.equal(x.ref, "status:off");
    assert.equal(y.ref, "s1:day");
    assert.equal(x.swap, true);
    assert.equal(x.note, "Dentist");
    assert.equal(
      checkSwap({ ...a, dateB: "2026-11-03", memberB: "mem_00000001" }, list).ok,
      false,
    );
  });
});

describe("on call", () => {
  it("lists weekend days plus extras", () => {
    assert.deepEqual(
      onCallDays("2026-10-30", "2026-11-09", ["2026-11-04", "2025-01-01"]),
      ["2026-10-31", "2026-11-01", "2026-11-04", "2026-11-07", "2026-11-08"],
    );
  });
  it("shares turns fairly, respects leave and rests between days", () => {
    const people = [
      { id: "a", name: "Ann" },
      { id: "b", name: "Bob", unavailable: new Set(["2026-11-07"]) },
      { id: "c", name: "Cy", history: 3 },
    ];
    const days = ["2026-10-31", "2026-11-01", "2026-11-07", "2026-11-08"];
    const plan = planOnCall(days, people);
    assert.equal(plan.days.find((d) => d.day === "2026-11-07").candidateId !== "b", true);
    assert.equal(plan.days[0].candidateId === plan.days[1].candidateId, false);
    assert.deepEqual(plan.uncovered, []);
    assert.equal(plan.counts.c, 3);
    assert.deepEqual(planOnCall(["2026-11-07"], [people[1]]).uncovered, ["2026-11-07"]);
  });
});

describe("holiday rules", () => {
  it("computes Easter", () => {
    assert.equal(easterSunday(2026), "2026-04-05");
    assert.equal(easterSunday(2027), "2027-03-28");
  });
  it("builds US and UK dates by rule", () => {
    const us = Object.fromEntries(holidaysFor("us", 2026).map((h) => [h.label, h.date]));
    assert.equal(us["Memorial Day"], "2026-05-25");
    assert.equal(us["Thanksgiving"], "2026-11-26");
    assert.equal(us["Independence Day"], "2026-07-03"); // 4 July is a Saturday
    const uk = Object.fromEntries(holidaysFor("uk", 2026).map((h) => [h.label, h.date]));
    assert.equal(uk["Good Friday"], "2026-04-03");
    assert.equal(uk["Easter Monday"], "2026-04-06");
    assert.equal(uk["Spring bank holiday"], "2026-05-25");
    assert.equal(uk["Boxing Day"], "2026-12-28");
    assert.equal(uk["Christmas Day"], "2026-12-25");
  });
  it("adds only what is missing, for the country's locations", () => {
    let n = 0;
    const existing = [
      {
        id: "x",
        date: "2026-01-26",
        endDate: "2026-01-26",
        label: "Republic Day",
        kind: "holiday",
      },
    ];
    const events = holidayEvents("in", 2026, existing, () => `ev${++n}`);
    assert.equal(
      events.some((e) => e.label === "Republic Day"),
      false,
    );
    assert.equal(events.length, 3);
    assert.deepEqual(events[0].locations, ["India"]);
    assert.equal(COUNTRIES.length, 3);
  });
});

describe("people", () => {
  const today = "2026-10-30";
  it("raises end alerts in 7, 14 and 30 day bands", () => {
    const list = [
      emp("a", "Ann", { rollOffDate: "2026-11-02" }),
      emp("b", "Bob", { contractEndDate: "2026-11-12" }),
      emp("c", "Cy", { staffitEndDate: "2026-11-25" }),
      emp("d", "Di", { rollOffDate: "2026-12-30" }),
      emp("e", "Ed", { rollOffDate: "2026-10-01" }),
    ];
    const alerts = endAlerts(list, today);
    assert.deepEqual(
      alerts.map((a) => [a.employee.id, a.band]),
      [
        ["a", 7],
        ["b", 14],
        ["c", 30],
      ],
    );
    assert.match(endAlertText(alerts[0]), /roll-off in 3 days/);
  });
  it("finds birthdays and anniversaries", () => {
    const list = [
      emp("a", "Ann", { birthday: "11-02" }),
      emp("b", "Bob", { staffitStartDate: "2023-11-05" }),
      emp("c", "Cy", { birthday: "03-01" }),
      emp("d", "Di", { staffitStartDate: "2026-11-01" }),
    ];
    const o = upcomingOccasions(list, today, 14);
    assert.deepEqual(
      o.map((x) => [x.employee.id, x.kind, x.years]),
      [
        ["a", "birthday", 0],
        ["b", "anniversary", 3],
      ],
    );
    assert.deepEqual(monthDay("1990-02-29"), [2, 29]);
    assert.equal(monthDay("13-01"), null);
    assert.match(greetingDraft(o[1], "Pat").subject, /3 years/);
  });
  it("builds a skills matrix and finds cover", () => {
    const list = [
      emp("a", "Ann", { skills: ["SQL", "Python"] }),
      emp("b", "Bob", { skills: ["sql"] }),
      emp("c", "Cy", { skills: [] }),
    ];
    const m = skillsMatrix(list);
    assert.equal(m.skills[0].count, 2);
    assert.equal(m.rows.length, 2);
    const cover = whoCanCover("sq", list, new Set(["a"]));
    assert.deepEqual(
      cover.available.map((e) => e.id),
      ["b"],
    );
    assert.deepEqual(
      cover.away.map((e) => e.id),
      ["a"],
    );
    assert.deepEqual(whoCanCover("", list, new Set()), { available: [], away: [] });
  });
  it("groups an org chart by client manager and team", () => {
    const list = [
      emp("a", "Ann", { clientManager: "Kim", team: "Support" }),
      emp("b", "Bob", { clientManager: "Kim", team: "Ops" }),
      emp("c", "Cy", { clientManager: "Lee", team: "Ops" }),
      emp("d", "Di"),
    ];
    const chart = orgChart(list);
    assert.deepEqual(
      chart.map((n) => [n.manager, n.count]),
      [
        ["Kim", 2],
        ["Lee", 1],
        ["No client manager", 1],
      ],
    );
    assert.deepEqual(
      chart[0].teams.map((t) => t.team),
      ["Ops", "Support"],
    );
  });
});

describe("checklists", () => {
  it("makes, ticks and completes a checklist", () => {
    let n = 0;
    let list = makeChecklist(
      "onboarding",
      emp("a", "Ann"),
      "2026-10-30T00:00:00Z",
      () => `c${++n}`,
    );
    assert.equal(list.name, "Ann Test");
    assert.equal(progressOf(list).total, 6);
    for (const item of list.items) list = toggleItem(list, item.id);
    assert.equal(isComplete(list), true);
    list = toggleItem(list, "i0");
    assert.equal(progressOf(list).done, 5);
  });
  it("starts checklists only for people who arrive after the first look", () => {
    const people = [emp("a", "Ann"), emp("b", "Bob")];
    assert.deepEqual(newArrivals([], people), { arrivals: [], seen: ["a", "b"] });
    const next = newArrivals(["a"], people);
    assert.deepEqual(
      next.arrivals.map((e) => e.id),
      ["b"],
    );
    assert.deepEqual(next.seen.sort(), ["a", "b"]);
  });
  it("drops malformed stored checklists", () => {
    assert.equal(
      sanitizeChecklists([
        { id: "x" },
        null,
        {
          id: "1",
          employeeId: "a",
          kind: "onboarding",
          items: [{ id: "i", text: "t", done: true }, 5],
        },
      ]).length,
      1,
    );
  });
});

describe("exports", () => {
  it("quotes CSV cells and adds a BOM", () => {
    const csv = toCsv([
      ["a", 'b,"c"'],
      ["d", "e"],
    ]);
    assert.equal(csv, '\uFEFFa,"b,""c"""\r\nd,e\r\n');
  });
  it("writes the roster grid with leave over shifts", () => {
    const rows = rosterRows({
      from: "2026-11-02",
      days: 3,
      config: { schedules, groups, members, events: [] },
      employees: [emp("e1", "Ann"), emp("e2", "Bob")],
      assignments: [shift("mem_00000001", DAY), shift("mem_00000002", DAY)],
      timeOff: [leave("e1")],
    });
    assert.deepEqual(rows[0], ["Team", "Name", "2026-11-02", "2026-11-03", "2026-11-04"]);
    assert.equal(rows[1][3], "PTO");
    assert.match(rows[2][3], /^Day/);
    assert.equal(rows[2][2], "");
  });
  it("lists time off and builds an all-day calendar", () => {
    const reqs = [
      {
        id: "to_1",
        employeeId: "e1",
        type: "pto",
        startDate: "2026-11-05",
        endDate: "2026-11-06",
        reason: "Trip, fun",
        status: "approved",
      },
      {
        id: "to_2",
        employeeId: "e1",
        type: "pto",
        startDate: "2026-11-09",
        endDate: "2026-11-09",
        reason: "",
        status: "pending",
      },
    ];
    const rows = timeOffRows(reqs, [emp("e1", "Ann")]);
    assert.deepEqual(rows[1].slice(2, 5), ["2026-11-05", "2026-11-06", "2"]);
    const ics = timeOffIcs(reqs, [emp("e1", "Ann")], "20261030T000000Z");
    assert.match(ics, /DTSTART;VALUE=DATE:20261105/);
    assert.match(ics, /DTEND;VALUE=DATE:20261107/);
    assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 1);
    assert.match(ics, /DESCRIPTION:Trip\\, fun/);
    assert.match(buildIcs("x", [], "s"), /^BEGIN:VCALENDAR/);
  });
});

describe("profile card and staff settings", () => {
  const people = [
    emp("a", "Ann"),
    emp("b", "Bob"),
    { ...emp("c", "Ann"), id: "c", lastName: "Test" },
  ];
  it("finds a person by id, or by an unambiguous name in either order", () => {
    assert.equal(findPerson(people, "x", "b").id, "b");
    assert.equal(findPerson(people, "Bob Test").id, "b");
    assert.equal(findPerson(people, "Test, Bob").id, "b");
    assert.equal(findPerson(people, "Ann Test"), null); // two people share it
    assert.equal(findPerson(people, "Nobody"), null);
    assert.equal(findPerson(people, "bob@x.com").id, "b");
  });
  it("lists contact lines only for what is filled in", () => {
    const lines = profileLines({
      ...emp("a", "Ann"),
      phone: "123",
      skills: ["SQL"],
      homeOffice: "Pune",
      location: "Offshore",
    });
    assert.deepEqual(lines, ["ann@x.com", "123", "Pune, Offshore", "Skills: SQL"]);
  });
  it("repairs stored settings", () => {
    const p = sanitizeStaffPrefs({
      coverage: { g1: 2, g2: -1, g3: "x" },
      ptoAllowance: 9999,
      swaps: [{ id: 1 }],
      colourBlindSafe: "yes",
    });
    assert.deepEqual(p.coverage, { g1: 2 });
    assert.equal(p.ptoAllowance, 20);
    assert.deepEqual(p.swaps, []);
    assert.equal(p.colourBlindSafe, false);
    assert.equal(sanitizeStaffPrefs(null).ptoAllowance, 20);
  });
});
