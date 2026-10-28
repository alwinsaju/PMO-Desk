import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  cycleContaining,
  cycleDates,
  cycleStartingIn,
  nextCycle,
  previousCycle,
  rotationSunday,
} from "./cycles.ts";
import { weekdayIndex } from "./dates.ts";
import { createEmployee } from "./employees.ts";
import {
  abbreviate,
  canonicalLocation,
  describeLocations,
  holidayAt,
  holidayList,
  locationChoices,
  locationHint,
  locationOf,
  observes,
} from "./holidays.ts";
import { defaultRosterConfig } from "./rosterCatalog.ts";
import { planRosterImport } from "./rosterImport.ts";
import { rosterConfigSchema } from "./schema.ts";
import {
  UNASSIGNED_ID,
  buildSections,
  dayCell,
  daySpan,
  holidayView,
  leaveView,
  matchGroup,
  resolveAssignment,
  makeAssignment,
  spanActiveAt,
  usuallyWorks,
  withGroup,
} from "./shifts.ts";

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
  role: "",
  ...over,
});
const holiday = (over = {}) => ({
  id: "evt_1",
  date: "2026-03-03",
  endDate: "2026-03-03",
  label: "Holi",
  kind: "holiday",
  ...over,
});

describe("roster cycles", () => {
  it("starts on the rotation Sunday, as the Tasks app's roster task does", () => {
    // 31 Jan 2026 is a Saturday: the first Sunday of February.
    assert.equal(rotationSunday(2026, 2), "2026-02-01");
    // 31 Mar 2026 is a Tuesday: the last Sunday of March.
    assert.equal(rotationSunday(2026, 4), "2026-03-29");
    // 30 Nov 2026 is a Monday.
    assert.equal(rotationSunday(2026, 12), "2026-11-29");
  });

  it("runs whole Sunday-Saturday weeks and tiles the calendar", () => {
    let cycle = cycleStartingIn(2026, 2);
    assert.equal(cycle.start, "2026-02-01");
    assert.equal(cycle.end, "2026-03-28");
    assert.equal(cycle.label, "Feb – Mar 2026");
    for (let i = 0; i < 12; i++) {
      assert.equal(weekdayIndex(cycle.start), 6, "starts on a Sunday");
      assert.equal(weekdayIndex(cycle.end), 5, "ends on a Saturday");
      assert.equal(cycleDates(cycle).length % 7, 0);
      const next = nextCycle(cycle);
      assert.equal(
        next.start,
        new Date(Date.parse(cycle.end) + 864e5).toISOString().slice(0, 10),
      );
      assert.equal(previousCycle(next).id, cycle.id);
      cycle = next;
    }
  });

  it("finds the cycle a day falls in, including a December cycle that runs into January", () => {
    assert.equal(cycleContaining("2026-02-10").id, "2026-02");
    assert.equal(cycleContaining("2026-03-28").id, "2026-02");
    assert.equal(cycleContaining("2026-03-29").id, "2026-04");
    const december = cycleContaining("2027-01-05");
    assert.equal(december.id, "2026-12");
    assert.equal(december.label, "Dec 2026 – Jan 2027");
    assert.equal(december.start, "2026-11-29");
    assert.equal(december.end, "2027-01-30");
  });
});

describe("holidays by location", () => {
  it("names a place one way", () => {
    assert.equal(canonicalLocation("bangalore"), "Bengaluru");
    assert.equal(canonicalLocation(" GURUGRAM "), "Gurgaon");
    assert.equal(canonicalLocation("hyderabad"), "Hyderabad");
    assert.equal(canonicalLocation("Lisbon  Portugal"), "Lisbon Portugal");
    assert.equal(canonicalLocation(""), "");
    assert.equal(abbreviate("Hyderabad"), "HYD");
    assert.equal(abbreviate("Lisbon"), "LIS");
  });

  it("applies a holiday everywhere unless locations are listed", () => {
    assert.equal(observes(holiday(), "Chennai"), true);
    assert.equal(observes(holiday(), ""), true);
    const some = holiday({ locations: ["Hyderabad", "Pune"] });
    assert.equal(observes(some, "hyderabad"), true);
    assert.equal(observes(some, "Chennai"), false);
    assert.equal(observes(some, ""), false);
  });

  it("finds the holiday that applies to a person, ignoring swap days", () => {
    const events = [
      holiday({ id: "a", label: "Swap day", kind: "swap" }),
      holiday({ id: "b", label: "Ugadi", locations: ["Hyderabad"] }),
    ];
    assert.equal(holidayAt(events, "Hyderabad")?.label, "Ugadi");
    assert.equal(holidayAt(events, "Pune"), undefined);
    assert.equal(holidayAt(undefined, "Pune"), undefined);
  });

  it("describes where a holiday applies", () => {
    const choices = [
      "Bengaluru",
      "Chennai",
      "Gurgaon",
      "Hyderabad",
      "Kolkata",
      "Mumbai",
      "Pune",
      "Mexico",
      "US",
    ];
    assert.equal(describeLocations([], choices), "Every location");
    assert.equal(describeLocations(undefined, choices), "Every location");
    assert.equal(describeLocations(choices, choices), "Every location");
    assert.equal(
      describeLocations(
        ["Bengaluru", "Chennai", "Gurgaon", "Hyderabad", "Kolkata", "Mumbai", "Pune"],
        choices,
      ),
      "All India",
    );
    assert.equal(
      describeLocations(
        choices.filter((c) => c !== "Gurgaon" && c !== "Kolkata"),
        choices,
      ),
      "All except GUR, KOL",
    );
    assert.equal(describeLocations(["Hyderabad", "Pune"], choices), "HYD, PUN");
    assert.equal(describeLocations(["Gurgaon"], choices), "GUR");
    assert.equal(
      describeLocations(
        ["Chennai", "Gurgaon", "Hyderabad", "Kolkata", "Mumbai", "Pune"],
        choices,
      ),
      "All India except BLR",
    );
  });

  it("offers the usual locations plus every one in use", () => {
    const choices = locationChoices(
      [member(1, { city: "Lisbon" }), member(2, { city: "bangalore" })],
      [emp(1, { homeOffice: "Hyderabad" })],
      [holiday({ locations: ["Oslo"] })],
    );
    assert.ok(choices.includes("Lisbon"));
    assert.ok(choices.includes("Oslo"));
    assert.equal(choices.filter((c) => c === "Bengaluru").length, 1);
    assert.equal(choices[0], "Bengaluru");
  });

  it("puts a person at the roster's city, else the directory's office", () => {
    assert.equal(locationOf({ city: "pune" }, { homeOffice: "Chennai" }), "Pune");
    assert.equal(locationOf({ city: "" }, { homeOffice: "Chennai" }), "Chennai");
    assert.equal(locationOf(null, null), "");
  });

  it("lists holidays earliest first", () => {
    const list = holidayList([
      holiday({ id: "x", date: "2026-05-01", label: "May Day" }),
      holiday({ id: "y", kind: "note", date: "2026-01-01" }),
      holiday({ id: "z", date: "2026-03-03" }),
    ]);
    assert.deepEqual(
      list.map((e) => e.id),
      ["z", "x"],
    );
  });

  it("is saved with the roster: hidden teams and holiday locations", () => {
    const config = defaultRosterConfig();
    config.groups[0].hidden = true;
    config.events.push(holiday({ locations: ["Hyderabad", "Pune"] }));
    const parsed = rosterConfigSchema.safeParse(config);
    assert.equal(parsed.success, true);
    assert.equal(parsed.data.groups[0].hidden, true);
    assert.deepEqual(parsed.data.events[0].locations, ["Hyderabad", "Pune"]);
    config.events[0].locations = [""];
    assert.equal(rosterConfigSchema.safeParse(config).success, false);
  });
});

describe("what a person's day shows", () => {
  const schedules = defaultRosterConfig().schedules;
  const entry = (ref, extra) =>
    resolveAssignment(makeAssignment("m", "2026-03-03", ref, extra), schedules);
  const pto = { type: "pto", label: "PTO" };

  it("shows approved Time off instead of a planned shift", () => {
    const { cell, covered } = dayCell(entry("main:shift-3"), pto, null, true);
    assert.equal(cell.short, "PTO");
    assert.equal(cell.source, "leave");
    assert.equal(cell.working, false);
    assert.match(covered, /Shift-3/);
  });

  it("keeps holidays, days off and on-call as entered when leave overlaps", () => {
    for (const ref of ["status:holiday", "status:off", "status:on-call"]) {
      const { cell, covered } = dayCell(entry(ref), pto, null, true);
      assert.equal(cell.source, "entry");
      assert.equal(covered, "");
    }
  });

  it("shows leave where nothing is entered only on a day the person would work", () => {
    assert.equal(dayCell(null, pto, null, true).cell.source, "leave");
    assert.equal(dayCell(null, pto, null, false).cell, null);
  });

  it("maps each kind of leave to its own code", () => {
    assert.equal(leaveView("sick", "Sick leave").short, "SL");
    assert.equal(leaveView("comp-off", "Comp off").short, "COMP");
    assert.equal(leaveView("pto", "PTO").short, "PTO");
    assert.equal(leaveView("sick", "x"), leaveView("sick", "y")); // cached: stable for memoised cells
  });

  it("shows HOL on a holiday of the person's location when nothing else is entered", () => {
    const { cell } = dayCell(null, null, "Holi", true);
    assert.equal(cell.short, "HOL");
    assert.equal(cell.source, "holiday");
    assert.equal(cell.label, "Holi");
    assert.equal(cell.hue, "hol");
    assert.equal(cell.working, false);
    assert.equal(holidayView("Holi"), holidayView("Holi"));
    // A weekly off is not a holiday.
    assert.equal(dayCell(null, null, "Holi", false).cell, null);
    // Working the holiday is allowed: the shift stays.
    assert.equal(dayCell(entry("main:shift-1"), null, "Holi", true).cell.short, "S1");
    // Leave wins over the holiday.
    assert.equal(dayCell(null, pto, "Holi", true).cell.short, "PTO");
    assert.equal(dayCell(null, null, null, true).cell, null);
  });

  it("reads a person's usual working days from their own entries", () => {
    const index = new Map(
      [
        "2026-03-02",
        "2026-03-09",
        "2026-03-10",
        "2026-03-11",
        "2026-03-12",
        "2026-03-13",
        "2026-03-23",
      ].map((d) => {
        const a = makeAssignment("m", d, "main:shift-1");
        return [a.id, a];
      }),
    );
    // Mondays are worked: 16 Mar has Mondays a week either side.
    assert.equal(usuallyWorks(index, "m", "2026-03-16"), true);
    // Saturday 14 Mar: nothing on Saturdays, but there are entries nearby, so a weekly off.
    assert.equal(usuallyWorks(index, "m", "2026-03-14"), false);
    // Someone with no entries at all: unknown.
    assert.equal(usuallyWorks(index, "other", "2026-03-16"), null);
    const off = makeAssignment("m", "2026-04-06", "status:off");
    const offIndex = new Map([[off.id, off]]);
    assert.equal(usuallyWorks(offIndex, "m", "2026-04-13"), false); // a marked day off is not worked
  });
});

describe("where a workbook banner says a holiday applies", () => {
  it("reads the locations from the label", () => {
    assert.deepEqual(locationHint("KOL HOL"), ["Kolkata"]);
    assert.deepEqual(locationHint("MEX HOL"), ["Mexico"]);
    assert.deepEqual(locationHint("Telangana Formation Day - HYD Only"), ["Hyderabad"]);
    assert.deepEqual(locationHint("Ugadi (Blr,Hyd,Pun)"), [
      "Bengaluru",
      "Hyderabad",
      "Pune",
    ]);
    assert.deepEqual(locationHint("Tamil New Year/Ambedkar Jayanti - CHE & GUR Only"), [
      "Chennai",
      "Gurgaon",
    ]);
    assert.deepEqual(locationHint("Holi (Only Gur)"), ["Gurgaon"]);
  });

  it("reads 'except' as every India location but those named", () => {
    assert.deepEqual(locationHint("Holi (Except Gur)"), [
      "Bengaluru",
      "Chennai",
      "Hyderabad",
      "Kolkata",
      "Mumbai",
      "Pune",
    ]);
    assert.equal(
      locationHint("Dussehra (For all except BLR)").includes("Bengaluru"),
      false,
    );
  });

  it("says nothing when the label names no location", () => {
    assert.equal(locationHint("Republic Day"), undefined);
    assert.equal(locationHint("HOL - Labor day"), undefined);
    assert.equal(locationHint("Guru Nanak Jayanti"), undefined);
  });

  it("is applied to holidays when the workbook is imported, not to swap days", () => {
    const parsed = {
      startDate: "2026-03-01",
      endDate: "2026-03-31",
      members: [],
      banners: [
        { date: "2026-03-03", label: "Holi (Except Gur)" },
        { date: "2026-03-04", label: "Shift Swap" },
        { date: "2026-03-05", label: "Republic Day" },
      ],
    };
    const { config } = planRosterImport(parsed, defaultRosterConfig(), []);
    const [holi, swap, plain] = config.events;
    assert.equal(holi.kind, "holiday");
    assert.equal(holi.locations.includes("Gurgaon"), false);
    assert.equal(holi.locations.includes("Hyderabad"), true);
    assert.equal(swap.kind, "swap");
    assert.equal(swap.locations, undefined);
    assert.equal(plain.locations, undefined);
    assert.equal(rosterConfigSchema.safeParse(config).success, true);
  });
});

describe("teams come from the directory", () => {
  const base = defaultRosterConfig();
  const names = (result, id) =>
    result.sections.find((s) => s.id === id)?.rows.map((r) => r.name);

  it("lists a directory person under the team named on their profile", () => {
    const employees = [emp(1, { team: "L2" }), emp(2, { team: "Lab" })];
    const result = buildSections(base, employees);
    assert.deepEqual(names(result, "l2"), ["First1 Last1"]);
    assert.deepEqual(names(result, "lab"), ["First2 Last2"]);
    assert.equal(result.sections.find((s) => s.id === "l2").virtual, false);
  });

  it("creates a team the first time a profile names it, after the stored ones", () => {
    const employees = [
      emp(1, { team: "Zeta" }),
      emp(2, { team: "Alpha Team" }),
      emp(3, { team: "L2" }),
    ];
    const result = buildSections(base, employees);
    const created = result.sections.filter((s) => s.virtual);
    assert.deepEqual(
      created.map((s) => [s.id, s.group.name]),
      [
        ["alpha-team", "Alpha Team"],
        ["zeta", "Zeta"],
      ],
    );
    assert.equal(created[0].group.scheduleId, base.schedules[0].id);
    assert.equal(created[0].schedule.id, base.schedules[0].id);
    const ids = result.sections.map((s) => s.id);
    assert.ok(ids.indexOf("l2") < ids.indexOf("alpha-team"));
    assert.equal(result.teams.find((t) => t.id === "zeta").virtual, true);
  });

  it("matches a stored team by name or alias, in any spelling", () => {
    assert.equal(matchGroup(base.groups, "device   SUPPORT")?.id, "device-support");
    assert.equal(matchGroup(base.groups, "Device Support L3")?.id, "device-support");
    assert.equal(matchGroup(base.groups, "L N S 2.0")?.id, "lns-2");
    assert.equal(matchGroup(base.groups, "Nobody"), undefined);
    assert.equal(matchGroup(base.groups, "  "), undefined);
  });

  it("moves a linked roster entry to the directory's team and leaves unlinked ones alone", () => {
    const config = {
      ...base,
      members: [
        member(1, { employeeId: emp(1).id, groupId: "l2" }),
        member(2, { name: "Workbook Only", groupId: "l2" }),
      ],
    };
    const result = buildSections(config, [emp(1, { team: "Lab" })]);
    assert.deepEqual(names(result, "lab"), ["First1 Last1"]);
    assert.deepEqual(names(result, "l2"), ["Workbook Only"]);
  });

  it("keeps the roster team of a linked person whose profile names no team", () => {
    const config = {
      ...base,
      members: [member(1, { employeeId: emp(1).id, groupId: "dep" })],
    };
    const result = buildSections(config, [emp(1, { team: "" })]);
    assert.deepEqual(names(result, "dep"), ["First1 Last1"]);
  });

  it("lists people whose profile names no team last", () => {
    const result = buildSections(base, [emp(1, { team: "" })]);
    assert.equal(result.sections.at(-1).id, UNASSIGNED_ID);
    assert.equal(result.sections.at(-1).group, null);
  });

  it("hides a team, keeps counting it in the teams list, and can show it again", () => {
    const config = {
      ...base,
      groups: base.groups.map((g) => (g.id === "lab" ? { ...g, hidden: true } : g)),
    };
    const employees = [emp(1, { team: "Lab" }), emp(2, { team: "L2" })];
    const hidden = buildSections(config, employees);
    assert.equal(
      hidden.sections.some((s) => s.id === "lab"),
      false,
    );
    assert.equal(hidden.teams.find((t) => t.id === "lab").hidden, true);
    assert.equal(hidden.teams.find((t) => t.id === "lab").count, 1);
    assert.equal(hidden.hiddenPeople, 1);
    assert.equal(hidden.total, 1);
    const all = buildSections(config, employees, { showHidden: true });
    assert.equal(
      all.sections.some((s) => s.id === "lab"),
      true,
    );
  });

  it("drops empty teams from the roster but still lists them as teams", () => {
    const result = buildSections(base, [emp(1, { team: "L2" })]);
    assert.deepEqual(
      result.sections.map((s) => s.id),
      ["l2"],
    );
    assert.equal(result.teams.length, base.groups.length);
  });

  it("gives each person a location for holidays", () => {
    const result = buildSections(base, [emp(1, { team: "L2", homeOffice: "bangalore" })]);
    assert.equal(result.sections[0].rows[0].location, "Bengaluru");
  });

  it("adds a directory-only team to the roster once, when it is first needed", () => {
    const [created] = buildSections(base, [emp(1, { team: "Alpha" })]).sections;
    const saved = withGroup(base, created.group);
    assert.equal(saved.groups.at(-1).id, "alpha");
    assert.equal(withGroup(saved, created.group), saved);
    assert.equal(
      buildSections(saved, [emp(1, { team: "Alpha" })]).sections[0].virtual,
      false,
    );
  });
});

describe("a shift on the 24-hour day (Today view)", () => {
  it("is one stretch for a daytime shift", () => {
    assert.deepEqual(daySpan({ start: "08:00", end: "17:00" }, "today"), {
      from: 480,
      to: 1020,
      open: false,
    });
    assert.equal(daySpan({ start: "08:00", end: "17:00" }, "yesterday"), null);
  });

  it("is cut at midnight for an overnight shift, with its tail on the next day", () => {
    assert.deepEqual(daySpan({ start: "21:00", end: "06:00" }, "today"), {
      from: 1260,
      to: 1440,
      open: true,
    });
    assert.deepEqual(daySpan({ start: "21:00", end: "06:00" }, "yesterday"), {
      from: 0,
      to: 360,
      open: true,
    });
  });

  it("knows whether the shift is running at a given minute", () => {
    const span = daySpan({ start: "08:00", end: "17:00" }, "today");
    assert.equal(spanActiveAt(span, 479), false);
    assert.equal(spanActiveAt(span, 480), true);
    assert.equal(spanActiveAt(span, 1019), true);
    assert.equal(spanActiveAt(span, 1020), false);
  });
});
