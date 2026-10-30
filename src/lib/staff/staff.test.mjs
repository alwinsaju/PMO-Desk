import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { addDays, formatRange, isIsoDate, mondayOf, workingDays } from "./dates.ts";
import {
  applyProfile,
  createEmployee,
  employeeFromEmail,
  employeesToCsv,
  filterEmployees,
  isAwaitingProfile,
  nameFromEmail,
  newRosterPerson,
  parseDateCell,
  parseEmailList,
  parseRosterRows,
  planImport,
  rollOffStatus,
  settleProfileSync,
  sortEmployees,
  validateEmployee,
  NO_FILTER,
} from "./employees.ts";
import {
  createTimeOff,
  filterTimeOff,
  timeOffStats,
  validateTimeOff,
} from "./timeoff.ts";

const NOW = "2026-03-02T10:00:00.000Z";
const person = (over = {}) =>
  createEmployee({ deloitteEmail: "a@x.com", firstName: "Ann", ...over }, NOW);

describe("dates", () => {
  it("validates calendar dates", () => {
    assert.equal(isIsoDate("2026-02-28"), true);
    assert.equal(isIsoDate("2026-02-31"), false);
    assert.equal(isIsoDate("26-02-28"), false);
  });
  it("finds the Monday of a week, across a month end", () => {
    assert.equal(mondayOf("2026-03-01"), "2026-02-23"); // a Sunday
    assert.equal(mondayOf("2026-03-02"), "2026-03-02");
    assert.equal(addDays("2026-02-28", 2), "2026-03-02");
  });
  it("counts working days and formats ranges", () => {
    assert.equal(workingDays("2026-03-02", "2026-03-08"), 5);
    assert.equal(formatRange("2026-03-05", "2026-03-11"), "5 – 11 Mar 2026");
    assert.equal(formatRange("2026-03-30", "2026-04-02"), "30 Mar – 2 Apr 2026");
    assert.equal(formatRange("2026-03-05", "2026-03-05"), "5 Mar 2026");
    assert.equal(formatRange("2026-03-05", "2026-03-09"), "5 – 9 Mar 2026");
  });
});

describe("names", () => {
  it("derives a name from the email", () => {
    assert.deepEqual(nameFromEmail("jane.doe@deloitte.com"), {
      firstName: "Jane",
      lastName: "Doe",
    });
    assert.deepEqual(nameFromEmail("jane_van.doe2@deloitte.com"), {
      firstName: "Jane",
      lastName: "Van Doe",
    });
    assert.deepEqual(nameFromEmail("jsmith@deloitte.com"), {
      firstName: "Jsmith",
      lastName: "",
    });
  });
  it("adds by email as a pending profile", () => {
    const e = employeeFromEmail(" jane.doe@deloitte.com ", NOW);
    assert.equal(e.profileSync, "pending");
    assert.equal(e.deloitteEmail, "jane.doe@deloitte.com");
    assert.equal(e.firstName, "Jane");
  });
});

describe("parseEmailList", () => {
  it("splits pasted text and sorts new, known and invalid", () => {
    const batch = parseEmailList(
      "a@x.com, new1@x.com;\n<new2@x.com> bad  NEW1@x.com A@X.COM",
      [person()],
    );
    assert.deepEqual(batch.valid, ["new1@x.com", "new2@x.com"]);
    assert.deepEqual(batch.duplicates, ["a@x.com", "NEW1@x.com", "A@X.COM"]);
    assert.deepEqual(batch.invalid, ["bad"]);
  });
});

describe("validateEmployee", () => {
  it("requires a unique, valid Deloitte email", () => {
    const other = person({ id: "emp_aaaaaaaaaaaa" });
    assert.ok(validateEmployee(person({ deloitteEmail: "" }), []).deloitteEmail);
    assert.ok(validateEmployee(person({ deloitteEmail: "nope" }), []).deloitteEmail);
    assert.ok(
      validateEmployee(person({ deloitteEmail: "A@X.com" }), [other]).deloitteEmail,
    );
    assert.deepEqual(validateEmployee({ ...other }, [other]), {});
  });
  it("checks dates, milestone and the Takeda email", () => {
    const errors = validateEmployee(
      person({ rollOffDate: "2026-02-30", milestone: "27", takedaEmail: "x" }),
      [],
    );
    assert.ok(errors.rollOffDate && errors.milestone && errors.takedaEmail);
  });
});

describe("M365 profile", () => {
  it("only overwrites with non-empty values and marks the person synced", () => {
    const pending = employeeFromEmail("jane.doe@deloitte.com", NOW);
    const next = applyProfile(
      { ...pending, level: "Senior" },
      {
        email: "jane.doe@deloitte.com",
        firstName: "Jane",
        lastName: "",
        level: "",
        op: "DF&O IN BEN",
        offering: "Ignored",
        phone: "123",
      },
      "later",
    );
    assert.equal(next.level, "Senior");
    assert.equal(next.lastName, "Doe");
    assert.equal(next.op, "DF&O IN BEN");
    assert.equal(next.offering, "");
    assert.equal(next.profileSync, "synced");
    assert.equal(next.updatedAt, "later");
  });

  it("waits for the profile until it arrives, whatever has been typed in", () => {
    const pending = employeeFromEmail("jane.doe@deloitte.com", NOW);
    assert.equal(isAwaitingProfile(pending), true);
    assert.equal(isAwaitingProfile({ ...pending, op: "DF&O IN BEN" }), true);
    assert.equal(isAwaitingProfile({ ...pending, photoVersion: 5 }), true);
    assert.equal(isAwaitingProfile({ ...pending, profileSync: "synced" }), false);
    assert.equal(isAwaitingProfile({ ...pending, profileSync: "manual" }), false);
  });

  it("a person entered by hand starts out waiting, but sample-style people do not", () => {
    const typed = newRosterPerson({ deloitteEmail: "x@x.com", level: "Senior" }, NOW);
    assert.equal(typed.profileSync, "pending");
    assert.equal(typed.level, "Senior");
    assert.equal(isAwaitingProfile(typed), true);
    assert.equal(createEmployee({ deloitteEmail: "y@x.com" }, NOW).profileSync, "manual");
  });

  it("keeps a stale edit from bringing 'waiting' back or blanking a synced profile", () => {
    const synced = {
      ...employeeFromEmail("jane.doe@deloitte.com", NOW),
      op: "DF&O IN BEN",
      level: "Senior",
      profileSync: "synced",
    };
    const stale = { ...employeeFromEmail("jane.doe@deloitte.com", NOW), team: "Run" };
    const saved = settleProfileSync(stale, synced);
    assert.equal(saved.profileSync, "synced");
    assert.equal(saved.op, "DF&O IN BEN");
    assert.equal(saved.level, "Senior");
    assert.equal(saved.team, "Run");
  });

  it("keeps waiting when the profile is filled in by hand", () => {
    const pending = employeeFromEmail("jane.doe@deloitte.com", NOW);
    assert.equal(
      settleProfileSync({ ...pending, team: "Run" }, pending).profileSync,
      "pending",
    );
    assert.equal(
      settleProfileSync({ ...pending, level: "Senior" }, pending).profileSync,
      "pending",
    );
    assert.equal(settleProfileSync(pending).profileSync, "pending");
    assert.equal(
      settleProfileSync({ ...pending, profileSync: "manual" }, pending).profileSync,
      "manual",
    );
  });
});

describe("parseDateCell", () => {
  it("reads Dates, serials, ISO and day-first text", () => {
    assert.equal(parseDateCell(new Date(Date.UTC(2026, 2, 5))), "2026-03-05");
    assert.equal(parseDateCell(46083), "2026-03-02");
    assert.equal(parseDateCell("2026-03-05"), "2026-03-05");
    assert.equal(parseDateCell("05/03/2026"), "2026-03-05");
    assert.equal(parseDateCell("5 Mar 2026"), "2026-03-05");
    assert.equal(parseDateCell("31/02/2026"), "");
    assert.equal(parseDateCell("soon"), "");
  });
});

describe("parseRosterRows", () => {
  const header = [
    "First Name",
    "Last Name",
    "Full Name",
    "Milestone",
    "Deloitte Email- id",
    "Roll-off date",
    "Campus",
    "Location",
    "Home office",
    "Level",
    "Offering",
    "OP",
    "Team",
    "Phone No",
    "Skills",
    "Deloitte Person ID",
    "Takeda Email ID",
    "Staffit Start Date",
    "STAFFIT End Date",
    "Contract End Date",
    "Network ID",
    "Workday ID",
    "Gender ( The column should be hidden)",
    "Client Manager",
  ];
  const row = (cells) => header.map((h) => cells[h] ?? null);

  it("maps the template's columns", () => {
    const result = parseRosterRows([
      header,
      row({
        "First Name": "Jane",
        "Last Name": "Doe",
        "Deloitte Email- id": "jane@deloitte.com",
        Campus: "Yes",
        Location: "offshore",
        Skills: "SQL; Python, sql",
        "Roll-off date": "05/03/2026",
        Milestone: 2027,
        "Client Manager": "Sam",
        "Gender ( The column should be hidden)": "F",
      }),
    ]);
    assert.equal(result.headerFound, true);
    assert.deepEqual(result.skipped, []);
    const e = result.rows[0].employee;
    assert.equal(e.firstName, "Jane");
    assert.equal(e.campus, true);
    assert.equal(e.location, "Offshore");
    assert.deepEqual(e.skills, ["SQL", "Python"]);
    assert.equal(e.rollOffDate, "2026-03-05");
    assert.equal(e.milestone, "2027");
    assert.equal(e.clientManager, "Sam");
    assert.equal(e.gender, "F");
  });

  it("splits a lone Full Name and skips rows without a usable email", () => {
    const result = parseRosterRows([
      header,
      row({ "Full Name": "Ann Lee Smith", "Deloitte Email- id": "ann@deloitte.com" }),
      row({ "First Name": "No", "Last Name": "Email" }),
      row({ "First Name": "Template", "Deloitte Email- id": "email@deloitte.com" }),
      row({}),
    ]);
    assert.equal(result.rows[0].employee.lastName, "Lee Smith");
    assert.equal(result.skipped.length, 2);
    assert.equal(result.skipped[0].row, 3);
  });

  it("reports a sheet with no header", () => {
    assert.equal(
      parseRosterRows([
        ["a", "b"],
        [1, 2],
      ]).headerFound,
      false,
    );
  });
});

describe("planImport", () => {
  it("updates matches by email and adds the rest", () => {
    const existing = [
      person({ id: "emp_aaaaaaaaaaaa", level: "Analyst", photoVersion: 5 }),
    ];
    const plan = planImport(
      existing,
      [
        { row: 2, employee: { deloitteEmail: "A@X.com", team: "Core" } },
        { row: 3, employee: { deloitteEmail: "new.person@x.com" } },
        { row: 4, employee: { deloitteEmail: "new.person@x.com", team: "Dup" } },
      ],
      NOW,
    );
    assert.equal(plan.updated, 1);
    assert.equal(plan.added, 1);
    assert.equal(plan.upserts.length, 2);
    assert.equal(plan.upserts[0].level, "Analyst");
    assert.equal(plan.upserts[0].team, "Core");
    assert.equal(plan.upserts[0].photoVersion, 5);
    assert.equal(plan.upserts[1].firstName, "New");
    assert.equal(plan.upserts[1].team, "Dup");
  });

  it("looks new and hand-entered people up in M365, and leaves a received profile alone", () => {
    const existing = [
      person({ id: "emp_aaaaaaaaaaaa", profileSync: "manual" }),
      person({ id: "emp_bbbbbbbbbbbb", deloitteEmail: "s@x.com", profileSync: "synced" }),
      person({
        id: "emp_cccccccccccc",
        deloitteEmail: "p@x.com",
        profileSync: "pending",
      }),
    ];
    const plan = planImport(
      existing,
      [
        { row: 2, employee: { deloitteEmail: "a@x.com", team: "Core" } },
        { row: 3, employee: { deloitteEmail: "s@x.com", team: "Core" } },
        { row: 4, employee: { deloitteEmail: "p@x.com", team: "Core" } },
        { row: 5, employee: { deloitteEmail: "n@x.com", level: "Senior" } },
      ],
      NOW,
    );
    assert.deepEqual(
      plan.upserts.map((e) => e.profileSync),
      ["pending", "synced", "pending", "pending"],
    );
    assert.equal(
      plan.upserts[3].level,
      "Senior",
      "typed values are kept until the profile arrives",
    );
  });
});

describe("employeesToCsv", () => {
  it("exports the template columns without gender, and defuses formulas", () => {
    const csv = employeesToCsv([
      person({ lastName: "Lee", gender: "F", team: "=1+1", skills: ["SQL", "Py"] }),
    ]);
    const [head, body] = csv.split("\r\n");
    assert.ok(
      head.startsWith("First Name,Last Name,Full Name,Milestone,Deloitte Email- id"),
    );
    assert.ok(!head.includes("Gender"));
    assert.ok(body.includes("Ann Lee"));
    assert.ok(body.includes("'=1+1"));
    assert.ok(body.includes('"SQL, Py"'));
  });
});

describe("directory view", () => {
  const list = [
    person({
      id: "emp_000000000001",
      firstName: "Zed",
      level: "Senior",
      location: "Onshore",
      offering: "Tax",
      rollOffDate: "2026-06-01",
      createdAt: "2026-01-01",
    }),
    person({
      id: "emp_000000000002",
      deloitteEmail: "b@x.com",
      firstName: "Amy",
      level: "Analyst",
      location: "Offshore",
      offering: "Audit",
      skills: ["Alteryx"],
      createdAt: "2026-02-01",
    }),
  ];
  it("filters by text, skills and facets", () => {
    assert.equal(filterEmployees(list, { ...NO_FILTER, query: "alteryx" }).length, 1);
    assert.equal(
      filterEmployees(list, { ...NO_FILTER, location: "Onshore" })[0].firstName,
      "Zed",
    );
    assert.equal(
      filterEmployees(list, { ...NO_FILTER, offering: "Audit", level: "Analyst" }).length,
      1,
    );
    assert.equal(filterEmployees(list, { ...NO_FILTER, query: "amy zed" }).length, 0);
  });
  it("sorts by name, level, roll-off and recency", () => {
    assert.deepEqual(
      sortEmployees(list, "name").map((e) => e.firstName),
      ["Amy", "Zed"],
    );
    assert.deepEqual(
      sortEmployees(list, "level").map((e) => e.firstName),
      ["Amy", "Zed"],
    );
    assert.deepEqual(
      sortEmployees(list, "rolloff").map((e) => e.firstName),
      ["Zed", "Amy"],
    );
    assert.deepEqual(
      sortEmployees(list, "recent").map((e) => e.firstName),
      ["Amy", "Zed"],
    );
  });
  it("classifies roll-off dates", () => {
    assert.deepEqual(rollOffStatus("", "2026-03-02"), { kind: "none", days: 0 });
    assert.equal(rollOffStatus("2026-03-01", "2026-03-02").kind, "past");
    assert.equal(rollOffStatus("2026-03-20", "2026-03-02").kind, "soon");
    assert.equal(rollOffStatus("2026-08-20", "2026-03-02").kind, "later");
  });
});

describe("time off", () => {
  const ids = new Set(["emp_000000000001"]);
  const base = createTimeOff(
    {
      employeeId: "emp_000000000001",
      startDate: "2026-03-10",
      endDate: "2026-03-12",
      status: "approved",
    },
    NOW,
  );

  it("validates people, dates and overlaps", () => {
    const draft = { ...base, id: "to_other0000000" };
    assert.ok(validateTimeOff({ ...draft, employeeId: "nope" }, [], ids).employeeId);
    assert.ok(validateTimeOff({ ...draft, endDate: "2026-03-01" }, [], ids).endDate);
    assert.ok(
      validateTimeOff(
        { ...draft, startDate: "2026-03-12", endDate: "2026-03-13" },
        [base],
        ids,
      ).startDate,
    );
    assert.deepEqual(
      validateTimeOff(
        { ...draft, startDate: "2026-03-13", endDate: "2026-03-13" },
        [base],
        ids,
      ),
      {},
    );
    assert.deepEqual(validateTimeOff({ ...base }, [base], ids), {});
    const rejected = { ...base, status: "rejected" };
    assert.deepEqual(validateTimeOff({ ...draft }, [rejected], ids), {});
  });

  it("summarises and filters", () => {
    const requests = [
      base,
      createTimeOff(
        {
          employeeId: "emp_000000000001",
          type: "sick",
          startDate: "2026-04-01",
          endDate: "2026-04-01",
        },
        NOW,
      ),
    ];
    const stats = timeOffStats(requests, "2026-03-11");
    assert.equal(stats.approved, 1);
    assert.equal(stats.pending, 1);
    assert.equal(stats.awayToday, 1);
    assert.equal(stats.byType.find((t) => t.type === "sick").count, 1);
    const people = new Map([
      ["emp_000000000001", person({ id: "emp_000000000001", firstName: "Ann" })],
    ]);
    assert.equal(
      filterTimeOff(requests, people, { status: "pending", query: "" }).length,
      1,
    );
    assert.equal(
      filterTimeOff(requests, people, { status: "", query: "ann sick" }).length,
      1,
    );
    assert.equal(filterTimeOff(requests, people, { status: "", query: "bob" }).length, 0);
    assert.equal(
      filterTimeOff(requests, people, { status: "", query: "" })[0].startDate,
      "2026-04-01",
    );
  });
});
