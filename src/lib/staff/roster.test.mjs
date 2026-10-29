import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { addMonths, formatMonth, monthDates, monthStart } from "./dates.ts";
import { createEmployee } from "./employees.ts";
import { workbookRosterConfig, workbookSchedules, STATUS_DEFS } from "./rosterCatalog.ts";
import { findRosterSheet, parseRosterSheet, planRosterImport } from "./rosterImport.ts";
import {
  UNASSIGNED_ID,
  assignmentId,
  autoLinkMembers,
  bandOf,
  buildSections,
  copyPreviousWeek,
  coverageOn,
  compactHours,
  fillWeek,
  formatDays,
  formatHours,
  hueOfShift,
  indexAssignments,
  interpretCell,
  leaveOn,
  makeAssignment,
  parseTimeRange,
  resolveAssignment,
  shortHours,
  shortLabel,
  suggestLinks,
} from "./shifts.ts";
import { createTimeOff } from "./timeoff.ts";

const NOW = "2026-03-02T10:00:00.000Z";
const emp = (n, over = {}) =>
  createEmployee(
    {
      id: `emp_00000000000${n}`,
      deloitteEmail: `p${n}@x.com`,
      firstName: `First${n}`,
      lastName: `Last${n}`,
      ...over,
    },
    NOW,
  );
const member = (n, over = {}) => ({
  id: `mem_00000000000${n}`,
  name: `Member ${n}`,
  employeeId: null,
  groupId: "l2",
  city: "Pune",
  role: "L2 DIS USI",
  ...over,
});
const sched = (id) => workbookSchedules().find((s) => s.id === id);

describe("times", () => {
  it("reads hour ranges, choosing the reading closest to a nine-hour shift", () => {
    assert.deepEqual(parseTimeRange("11AM-8PM"), { start: "11:00", end: "20:00" });
    assert.deepEqual(parseTimeRange("IST 6:00PM-3:00AM"), {
      start: "18:00",
      end: "03:00",
    });
    assert.deepEqual(parseTimeRange("IST 6:00-3:00AM"), { start: "18:00", end: "03:00" });
    assert.deepEqual(parseTimeRange("12PM-9PM"), { start: "12:00", end: "21:00" });
    assert.deepEqual(parseTimeRange("2:00 PM - 11:00 PM"), {
      start: "14:00",
      end: "23:00",
    });
    assert.deepEqual(parseTimeRange("Shift Swap 7PM-4AM"), {
      start: "19:00",
      end: "04:00",
    });
    assert.deepEqual(parseTimeRange("9-18"), { start: "09:00", end: "18:00" });
    assert.equal(parseTimeRange("Comp off"), null);
    assert.equal(parseTimeRange("99AM-3PM"), null);
  });

  it("formats hours, days and labels", () => {
    assert.equal(formatHours("08:00", "17:00"), "8:00 AM – 5:00 PM");
    assert.equal(formatHours("00:30", "12:00"), "12:30 AM – 12:00 PM");
    assert.equal(compactHours("08:00", "17:00"), "8 AM – 5 PM");
    assert.equal(compactHours("16:30", "01:30"), "4:30 PM – 1:30 AM");
    assert.equal(compactHours("10:00", "19:00"), "10 AM – 7 PM");
    assert.equal(shortHours("16:30", "01:30"), "4:30p–1:30a");
    assert.equal(formatDays([0, 1, 2, 3, 4]), "Mon–Fri");
    assert.equal(formatDays([2, 3, 4, 5, 6]), "Wed–Sun");
    assert.equal(formatDays([5, 6]), "Sat, Sun");
    assert.equal(formatDays([0, 2]), "Mon, Wed");
    assert.equal(formatDays([]), "");
    assert.equal(shortLabel("Shift-3"), "S3");
    assert.equal(shortLabel("US-CST"), "CST");
    assert.equal(shortLabel("Weekend (W)"), "W");
    assert.equal(shortLabel("NS"), "NS");
  });

  it("colours a shift by its name, the way the workbook does, in every team", () => {
    const hue = (ref, extra) =>
      resolveAssignment(
        makeAssignment("m", "2026-03-02", ref, extra),
        workbookSchedules(),
      ).hue;
    assert.equal(hue("main:shift-1"), "s1");
    assert.equal(hue("main:shift-2"), "s2");
    assert.equal(hue("main:shift-3"), "s3");
    assert.equal(hue("main:shift-4"), "s4");
    assert.equal(hue("main:shift-5"), "s5");
    assert.equal(hue("main:ns"), "ns");
    assert.equal(hue("main:us-cst"), "cst");
    assert.equal(hue("main:us-pst"), "pst");
    // The same name has the same colour although the hours differ per team.
    assert.equal(hue("device-support:shift-3"), hue("main:shift-3"));
    assert.equal(hue("lab:weekend"), "wk");
    // Day types and custom hours have their own colours; a swapped day is orange.
    assert.equal(hue("status:holiday"), "hol");
    assert.equal(hue("status:pto"), "leave");
    assert.equal(hue("status:temp-pto"), "temp");
    assert.equal(hue("status:comp"), "comp");
    assert.equal(hue("status:on-call"), "oc");
    assert.equal(hue("custom", { text: "11AM-8PM" }), "custom");
    assert.equal(hue("main:shift-3", { swap: true }), "swap");
    const main = resolveAssignment(
      makeAssignment("m", "2026-03-02", "main:shift-3"),
      workbookSchedules(),
    );
    const device = resolveAssignment(
      makeAssignment("m", "2026-03-02", "device-support:shift-3"),
      workbookSchedules(),
    );
    assert.notEqual(main.hours, device.hours); // Shift-3 is 9 PM - 6 AM there
    assert.deepEqual(device.range, { start: "21:00", end: "06:00" });
  });

  it("colours a shift with an unusual name by when it starts", () => {
    assert.equal(bandOf("08:00"), "day");
    assert.equal(bandOf("14:00"), "afternoon");
    assert.equal(bandOf("16:30"), "evening");
    assert.equal(bandOf("21:00"), "night");
    assert.equal(bandOf("02:00"), "night");
    assert.equal(hueOfShift({ id: "x", label: "Early", start: "06:00" }), "s1");
    assert.equal(hueOfShift({ id: "x", label: "Late", start: "22:00" }), "ns");
  });

  it("works with calendar months", () => {
    assert.equal(monthStart("2026-03-17"), "2026-03-01");
    assert.equal(addMonths("2026-01-01", -1), "2025-12-01");
    assert.equal(addMonths("2026-11-20", 3), "2027-02-01");
    assert.equal(monthDates("2026-02-10").length, 28);
    assert.equal(monthDates("2028-02-10").length, 29);
    assert.equal(formatMonth("2026-03-01"), "March 2026");
  });
});

describe("the same shift name in different teams' schedules", () => {
  it("means the hours of the team it belongs to", () => {
    const schedules = workbookSchedules();
    const view = (ref) =>
      resolveAssignment(makeAssignment("m", "2026-03-02", ref), schedules);
    assert.equal(view("main:shift-1").hours, "8:00 AM – 5:00 PM");
    assert.equal(view("device-support:shift-1").hours, "4:30 PM – 1:30 AM");
    assert.equal(view("lns-2:shift-1").hours, "4:30 PM – 1:30 AM");
    assert.equal(view("lab:shift-1").hours, "2:00 PM – 11:00 PM");
    assert.equal(view("lab:shift-1").schedule, "Lab");
    assert.equal(view("main:shift-2").days, "Wed–Sun");
  });

  it("shows a deleted shift as unknown instead of failing", () => {
    const cell = resolveAssignment(
      makeAssignment("m", "2026-03-02", "main:gone"),
      workbookSchedules(),
    );
    assert.equal(cell.kind, "unknown");
    assert.equal(cell.label, "gone");
  });

  it("has day types shared by every team, with one holiday code for every location", () => {
    assert.deepEqual(
      STATUS_DEFS.map((s) => s.id),
      ["holiday", "pto", "temp-pto", "comp", "on-call", "sick", "off"],
    );
    const holiday = resolveAssignment(
      makeAssignment("m", "2026-01-26", "status:holiday"),
      [],
    );
    assert.equal(holiday.short, "HOL");
    assert.equal(holiday.dashed, true);
    assert.equal(holiday.working, false);
    assert.equal(
      resolveAssignment(makeAssignment("m", "d", "status:on-call"), []).working,
      true,
    );
  });
});

describe("interpretCell (the way the workbook writes it)", () => {
  const main = sched("main");
  const lns = sched("lns-2");
  const ref = (text, schedule = main) => interpretCell(text, schedule)?.ref;

  it("reads shifts in any spelling, against the team's own schedule", () => {
    assert.equal(ref("Shift-3"), "main:shift-3");
    assert.equal(ref("shift-3"), "main:shift-3");
    assert.equal(ref("Shift 3"), "main:shift-3");
    assert.equal(ref("US-PST"), "main:us-pst");
    assert.equal(ref("NS"), "main:ns");
    assert.equal(ref("Shift-2", lns), "lns-2:shift-2");
  });

  it("falls back to typed hours when the team has no such shift", () => {
    assert.deepEqual(interpretCell("Shift-5", lns), {
      ref: "custom",
      text: "Shift-5",
      loose: true,
    });
    assert.deepEqual(interpretCell("11AM-8PM", main), {
      ref: "custom",
      text: "11AM-8PM",
      loose: false,
    });
  });

  it("recognises hours that are exactly one of the team's shifts", () => {
    assert.equal(ref("12PM-9PM", lns), "lns-2:shift-2");
    assert.equal(ref("2PM - 11PM", main), "main:shift-3");
  });

  it("finds a shift the team lacks when only one set of hours has that name", () => {
    const lab = sched("lab");
    const all = workbookSchedules();
    assert.equal(interpretCell("NS", lab, all)?.ref, "main:ns"); // main and integration-hub share the hours
    assert.equal(interpretCell("US-CST", lab, all)?.ref, "main:us-cst");
    // Shift-3 means different hours in several schedules: not guessed.
    assert.equal(interpretCell("Shift-5", lns, all)?.ref, "main:shift-5");
    assert.equal(interpretCell("Weekend", lns, all)?.ref, "lab:weekend");
    assert.equal(interpretCell("Shift-9", lns, all)?.ref, "custom");
  });

  it("reads the day types", () => {
    for (const [text, id] of [
      ["HOL", "holiday"],
      ["P", "pto"],
      ["p", "pto"],
      ["PTO", "pto"],
      ["T", "temp-pto"],
      ["COMP", "comp"],
      ["Comp Off", "comp"],
      ["comp off", "comp"],
      ["OC", "on-call"],
      ["On-call", "on-call"],
      ["ON-call", "on-call"],
      ["On call", "on-call"],
      ["SL", "sick"],
    ]) {
      assert.equal(ref(text), `status:${id}`, text);
    }
  });

  it("treats a swap as a flag on the shift, not a shift of its own", () => {
    assert.deepEqual(interpretCell("Shift Swap\nNS", main), {
      ref: "main:ns",
      swap: true,
    });
    assert.deepEqual(interpretCell("Shift swap (NS)", main), {
      ref: "main:ns",
      swap: true,
    });
    assert.deepEqual(interpretCell("Shift Swap(2:00PM - 11:00PM)", main), {
      ref: "main:shift-3",
      swap: true,
    });
    assert.deepEqual(interpretCell("Shift Swap (OFF)", main), {
      ref: "status:off",
      swap: true,
    });
    assert.deepEqual(interpretCell("Shift Swap 7PM-4AM", main), {
      ref: "main:ns",
      swap: true,
    });
    assert.deepEqual(interpretCell("Shift-swap", main), {
      ref: "custom",
      text: "Shift swap",
      swap: true,
      loose: true,
    });
  });

  it("ignores empty cells", () => {
    assert.equal(interpretCell("   ", main), null);
  });
});

describe("rows and sections", () => {
  const config = {
    ...workbookRosterConfig(),
    members: [
      member(1, { name: "Doe, Jane", employeeId: emp(1).id }),
      member(2, { name: "Not Yet In Directory" }),
      member(3, { groupId: "lab", name: "Lab Person" }),
      member(4, { name: "Excluded One", employeeId: emp(2).id }),
    ],
  };
  const employees = [
    emp(1),
    emp(2, { excludeFromShiftRoster: true }),
    emp(3, { firstName: "Waiting", lastName: "Wanda" }),
    emp(4, { excludeFromShiftRoster: true }),
  ];

  it("takes linked people from the directory, hides excluded ones, and lists the unplaced last", () => {
    const { sections, excluded, total } = buildSections(config, employees);
    const names = (id) => sections.find((s) => s.id === id)?.rows.map((r) => r.name);
    assert.deepEqual(names("l2"), ["First1 Last1", "Not Yet In Directory"]);
    assert.deepEqual(names("lab"), ["Lab Person"]);
    assert.deepEqual(names(UNASSIGNED_ID), ["Waiting Wanda"]);
    assert.equal(excluded, 2);
    assert.equal(total, 4);
    assert.equal(sections.at(-1).group, null);
    assert.equal(sections.at(-1).rows[0].member, null);
  });

  it("each section knows its team's schedule", () => {
    const { sections } = buildSections(config, employees);
    assert.equal(sections.find((s) => s.id === "lab").schedule.name, "Lab");
    assert.equal(sections.find((s) => s.id === "l2").schedule.name, "Main");
  });

  it("filters by search and team, dropping empty teams", () => {
    assert.equal(buildSections(config, employees).sections.length >= 3, true);
    const byTeam = buildSections(config, employees, { groupId: "lab" });
    assert.deepEqual(
      byTeam.sections.map((s) => s.id),
      ["lab"],
    );
    assert.deepEqual(
      buildSections(config, employees, { groupId: "Lab" }).sections.map((s) => s.id),
      ["lab"],
    );
    const byText = buildSections(config, employees, { query: "wanda" });
    assert.deepEqual(
      byText.sections.map((s) => s.id),
      [UNASSIGNED_ID],
    );
    assert.equal(buildSections(config, employees, { query: "nobody" }).total, 0);
    // The workbook's name, the city and the role are searchable for unlinked people.
    assert.equal(buildSections(config, employees, { query: "yet pune" }).total, 1);
  });

  it("an excluded profile is out of the roster but its linked entry keeps its shifts", () => {
    const { sections } = buildSections(config, employees);
    assert.ok(
      !sections.flatMap((s) => s.rows).some((r) => r.member?.id === "mem_000000000004"),
    );
    assert.ok(config.members.some((m) => m.id === "mem_000000000004"));
  });

  it("does not show a directory person twice when they are linked", () => {
    const { sections } = buildSections(config, [emp(1)]);
    assert.equal(
      sections.flatMap((s) => s.rows).filter((r) => r.employee?.id === emp(1).id).length,
      1,
    );
  });
});

describe("counting, copying and filling", () => {
  const m1 = member(1);
  const m2 = member(2, { employeeId: emp(2).id });
  const schedules = workbookSchedules();
  const rows = [
    { key: "1", member: m1, employee: null, name: "A", subtitle: "" },
    { key: "2", member: m2, employee: emp(2), name: "B", subtitle: "" },
  ];

  it("counts working days, not days off, holidays or approved leave", () => {
    const index = indexAssignments([
      makeAssignment(m1.id, "2026-03-10", "main:shift-1"),
      makeAssignment(m2.id, "2026-03-10", "main:shift-3"),
      makeAssignment(m1.id, "2026-03-11", "status:holiday"),
      makeAssignment(m2.id, "2026-03-11", "status:on-call"),
    ]);
    const leave = [
      createTimeOff(
        {
          employeeId: emp(2).id,
          startDate: "2026-03-10",
          endDate: "2026-03-10",
          status: "approved",
        },
        NOW,
      ),
    ];
    assert.equal(coverageOn("2026-03-10", rows, index, schedules, []), 2);
    assert.equal(coverageOn("2026-03-10", rows, index, schedules, leave), 1);
    assert.equal(coverageOn("2026-03-11", rows, index, schedules, []), 1); // on-call counts, holiday does not
    assert.equal(coverageOn("2026-03-12", rows, index, schedules, []), 0);
  });

  it("finds approved leave only", () => {
    const approved = createTimeOff(
      {
        employeeId: emp(2).id,
        startDate: "2026-03-10",
        endDate: "2026-03-11",
        status: "approved",
      },
      NOW,
    );
    assert.ok(leaveOn([approved], emp(2).id, "2026-03-11"));
    assert.equal(leaveOn([approved], emp(2).id, "2026-03-12"), undefined);
    assert.equal(
      leaveOn([{ ...approved, status: "pending" }], emp(2).id, "2026-03-10"),
      undefined,
    );
  });

  it("copies last week into empty days only, keeping typed hours but not swap flags", () => {
    const list = [
      makeAssignment(m1.id, "2026-03-02", "main:shift-1", { swap: true, note: "x" }),
      makeAssignment(m1.id, "2026-03-03", "custom", { text: "11AM-8PM" }),
      makeAssignment(m2.id, "2026-03-03", "main:ns"),
      makeAssignment(m2.id, "2026-03-10", "main:shift-4"), // already set in the target week
    ];
    const copies = copyPreviousWeek(list, "2026-03-09", [m1.id, m2.id]);
    assert.deepEqual(
      copies.map((c) => [c.id, c.ref, c.text, c.swap]).sort(),
      [
        [`${m1.id}|2026-03-09`, "main:shift-1", undefined, undefined],
        [`${m1.id}|2026-03-10`, "custom", "11AM-8PM", undefined],
      ].sort(),
    );
  });

  it("fills a week on the shift's usual days", () => {
    const wedSun = schedules[0].shifts.find((s) => s.id === "shift-2");
    const filled = fillWeek("2026-03-02", m1.id, "main", wedSun);
    assert.deepEqual(
      filled.map((a) => a.date),
      ["2026-03-04", "2026-03-05", "2026-03-06", "2026-03-07", "2026-03-08"],
    );
    assert.ok(filled.every((a) => a.ref === "main:shift-2"));
    assert.equal(filled[0].id, assignmentId(m1.id, "2026-03-04"));
  });
});

describe("matching roster entries to the directory", () => {
  const employees = [
    emp(1, { firstName: "Jane", lastName: "Doe" }),
    emp(2, { firstName: "Ravi", lastName: "Kumar" }),
    emp(3, { firstName: "Ravi", lastName: "Kumar", deloitteEmail: "ravi2@x.com" }),
  ];

  it("matches the same words in any order, ignoring commas and case", () => {
    assert.equal(suggestLinks("Doe, Jane", employees, new Set()).length, 1);
    assert.equal(suggestLinks("jane   DOE", employees, new Set()).length, 1);
    assert.equal(suggestLinks("Jane", employees, new Set()).length, 0);
    assert.equal(
      suggestLinks("Doe, Jane", employees, new Set([employees[0].id])).length,
      0,
    );
  });

  it("links only unambiguous matches", () => {
    const members = [
      member(1, { name: "Doe, Jane" }),
      member(2, { name: "Kumar Ravi" }),
      member(3, { name: "Someone Else" }),
      member(4, { name: "Jane Doe" }), // second claim on the same profile
    ];
    const changed = autoLinkMembers(members, employees);
    assert.deepEqual(
      changed.map((m) => [m.id, m.employeeId]),
      [["mem_000000000001", employees[0].id]],
    );
  });
});

// ---------------------------------------------------------------------------
// The workbook
// ---------------------------------------------------------------------------

const D0 = new Date(Date.UTC(2026, 0, 2)); // a Friday, like the real sheet
/** Rows shaped like the real "PDT Operate" sheet, with a few days. */
function sheet() {
  const days = 6;
  const pad = (cells) => [
    ...cells,
    ...Array(Math.max(0, 4 + days - cells.length)).fill(null),
  ];
  const dateRow = pad(["", null, null, null]);
  for (let i = 0; i < days; i++) dateRow[4 + i] = new Date(D0.getTime() + i * 86400000);
  return [
    ["Shift-1", "8:00 AM – 5:00 PM (Mon–Fri)", "COMP", "Comp off"],
    ["Shift-2", "8:00 AM – 5:00 PM (Wed–Sun)", "OC", "On-call / holiday support"],
    [null, null, null, "Holiday – all locations"],
    ["Colors apply automatically based on the text you type."],
    pad([
      "Resource",
      null,
      null,
      null,
      "Lean Shift",
      null,
      null,
      null,
      "Republic Day",
      "Shift-Swap",
    ]),
    dateRow,
    pad(["", null, null, null, "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"]),
    pad(["#", "L2", "Loc", "Team"]),
    pad([
      1,
      "Jane Doe",
      "Hyderabad",
      "L2 DIS USI",
      "Shift-1",
      null,
      null,
      "shift-1",
      "HOL",
      "Shift Swap\nNS",
    ]),
    pad([
      2,
      "Ravi Kumar",
      "Pune",
      "L2 DIS USI",
      "P",
      "IST 6:00PM-3:00AM",
      null,
      "Shift-3",
      "COMP",
      "On call",
    ]),
    pad(["DEP", null, null, "Team"]),
    pad([
      3,
      "Sai Krishna, Pataballa",
      "Hyderabad",
      "DEP USI",
      "NS",
      null,
      null,
      "x".repeat(60),
    ]),
    pad(["Shift-1", "4:30 PM - 1:30 AM (M-F)"]),
    pad([null, "7:30 PM - 4:30 AM (M-F)"]),
    pad(["Device Support"]),
    pad([
      4,
      "Naga Kumar",
      "Hyderabad",
      "Device Support",
      "Shift-3",
      null,
      "ON-call",
      "Shift-1",
    ]),
    pad(["Device Support L3"]),
    pad([5, "Nitin verma", "Pune", "Device Support L3", "Shift-3"]),
    pad(["L N S 2.0"]),
    pad([6, "Kiran M", "Bengaluru", "LNS 2.0", "Shift-2", "12PM-9PM"]),
    pad(["Governance"]),
    pad([7, "Sreela P", "US", "Governance", "mystery"]),
  ];
}

describe("reading the workbook", () => {
  it("finds the roster sheet by its Resource heading", () => {
    const other = { sheet: "Notes", data: [["Name", "Date"]] };
    const roster = { sheet: "PDT Operate", data: sheet() };
    assert.equal(findRosterSheet([other, roster]), roster);
    assert.equal(findRosterSheet([other]), null);
    assert.equal(parseRosterSheet([["nothing"]]), null);
  });

  it("reads people under their team headings, skipping the legend lines", () => {
    const parsed = parseRosterSheet(sheet());
    assert.equal(parsed.startDate, "2026-01-02");
    assert.equal(parsed.endDate, "2026-01-07");
    assert.deepEqual(
      parsed.members.map((m) => [m.name, m.section, m.city, m.role]),
      [
        ["Jane Doe", "L2", "Hyderabad", "L2 DIS USI"],
        ["Ravi Kumar", "L2", "Pune", "L2 DIS USI"],
        ["Sai Krishna, Pataballa", "DEP", "Hyderabad", "DEP USI"],
        ["Naga Kumar", "Device Support", "Hyderabad", "Device Support"],
        ["Nitin verma", "Device Support L3", "Pune", "Device Support L3"],
        ["Kiran M", "L N S 2.0", "Bengaluru", "LNS 2.0"],
        ["Sreela P", "Governance", "US", "Governance"],
      ],
    );
    assert.deepEqual(parsed.banners, [
      { date: "2026-01-02", label: "Lean Shift" },
      { date: "2026-01-06", label: "Republic Day" },
      { date: "2026-01-07", label: "Shift-Swap" },
    ]);
  });

  it("plans the import: teams by alias, each team's own schedule, directory matches", () => {
    const plan = planRosterImport(parseRosterSheet(sheet()), workbookRosterConfig(), [
      emp(1, { firstName: "Jane", lastName: "Doe" }),
    ]);
    const { members } = plan.config;
    const group = (name) => members.find((m) => m.name === name).groupId;
    assert.equal(group("Jane Doe"), "l2");
    assert.equal(group("Nitin verma"), "device-support"); // Device Support L3 belongs to Device Support
    assert.equal(group("Kiran M"), "lns-2");
    assert.equal(group("Sreela P"), "integration-hub");
    assert.equal(members.find((m) => m.name === "Jane Doe").employeeId, emp(1).id);
    assert.equal(members.find((m) => m.name === "Ravi Kumar").employeeId, null);
    assert.equal(plan.stats.membersAdded, 7);
    assert.equal(plan.stats.membersLinked, 1);

    const byKey = Object.fromEntries(
      plan.upsert.map((a) => {
        const m = members.find((x) => x.id === a.memberId);
        return [`${m.name}|${a.date}`, a];
      }),
    );
    // Shift-3 of a Device Support person is that team's Shift-3, not the main one.
    assert.equal(byKey["Naga Kumar|2026-01-02"].ref, "device-support:shift-3");
    assert.equal(byKey["Naga Kumar|2026-01-04"].ref, "status:on-call");
    assert.equal(byKey["Nitin verma|2026-01-02"].ref, "device-support:shift-3");
    assert.equal(byKey["Jane Doe|2026-01-02"].ref, "main:shift-1");
    assert.equal(byKey["Jane Doe|2026-01-05"].ref, "main:shift-1");
    assert.equal(byKey["Jane Doe|2026-01-06"].ref, "status:holiday");
    assert.deepEqual(
      [byKey["Jane Doe|2026-01-07"].ref, byKey["Jane Doe|2026-01-07"].swap],
      ["main:ns", true],
    );
    assert.equal(byKey["Ravi Kumar|2026-01-02"].ref, "status:pto");
    assert.equal(byKey["Ravi Kumar|2026-01-03"].ref, "custom");
    assert.equal(byKey["Ravi Kumar|2026-01-03"].text, "IST 6:00PM-3:00AM");
    assert.equal(byKey["Ravi Kumar|2026-01-05"].ref, "main:shift-3");
    assert.equal(byKey["Kiran M|2026-01-03"].ref, "lns-2:shift-2"); // 12PM-9PM is that team's Shift-2
    assert.equal(byKey["Sreela P|2026-01-02"].ref, "custom");
  });

  it("keeps unreadable entries visible instead of dropping them silently", () => {
    const plan = planRosterImport(parseRosterSheet(sheet()), workbookRosterConfig(), []);
    const reasons = plan.warnings.map((w) => [w.text, w.reason]);
    assert.ok(reasons.some(([t, r]) => t === "mystery" && /kept as typed/.test(r)));
    assert.ok(reasons.some(([, r]) => /Too long/.test(r)));
    assert.equal(
      plan.upsert.some((a) => a.text?.startsWith("xxxx")),
      false,
    );
  });

  it("turns the banner row into events: holidays, swap days, notes", () => {
    const plan = planRosterImport(parseRosterSheet(sheet()), workbookRosterConfig(), []);
    const kinds = Object.fromEntries(plan.config.events.map((e) => [e.label, e.kind]));
    assert.deepEqual(kinds, {
      "Lean Shift": "note",
      "Republic Day": "holiday",
      "Shift-Swap": "swap",
    });
    // The last banner runs to the end of the sheet (the winter disconnect at year end).
    const last = plan.config.events.find((e) => e.label === "Shift-Swap");
    assert.equal(last.endDate, "2026-01-07");
    assert.equal(
      plan.config.events.find((e) => e.label === "Republic Day").endDate,
      "2026-01-06",
    );
  });

  it("importing again updates the same people instead of adding them twice", () => {
    const first = planRosterImport(parseRosterSheet(sheet()), workbookRosterConfig(), []);
    const second = planRosterImport(parseRosterSheet(sheet()), first.config, []);
    assert.equal(second.config.members.length, 7);
    assert.equal(second.stats.membersAdded, 0);
    assert.equal(second.stats.membersUpdated, 7);
    assert.equal(second.config.events.length, 3);
    assert.deepEqual(
      second.upsert.map((a) => a.id).sort(),
      first.upsert.map((a) => a.id).sort(),
    );
  });

  it("adds a team the defaults do not know, on the main schedule", () => {
    const rows = sheet();
    rows.push(
      ["New Team", null, null, null],
      [8, "Zed Zed", "Pune", "New Team", "Shift-1"],
    );
    const plan = planRosterImport(parseRosterSheet(rows), workbookRosterConfig(), []);
    const group = plan.config.groups.find((g) => g.name === "New Team");
    assert.equal(group.scheduleId, "main");
    assert.equal(plan.stats.groupsAdded, 1);
  });
});
