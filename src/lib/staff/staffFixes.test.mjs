import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";

import { autoLinkMembers, planFillWeek } from "./shifts.ts";
import {
  employeesToCsv,
  nameFromEmail,
  parseEmailList,
  parseRosterRows,
  planImport,
  validateEmployee,
  createEmployee,
} from "./employees.ts";
import {
  LIMITS,
  checkEmployeeFields,
  emailProblem,
  isValidBirthday,
  isValidEmail,
} from "./fieldRules.ts";
import { coverageGaps, breachText, leaveImpact } from "./capacity.ts";
import { holidayDays, onCallDays } from "./onCall.ts";
import { rosterRows, timeOffRows, toCsv } from "./exportFiles.ts";
import { employeeErrorOnly, firstClash, validateTimeOff } from "./timeoff.ts";
import { plainIssue } from "./validationText.ts";
import { employeeChangesSchema } from "./schema.ts";

describe("email and field rules match the server", () => {
  const serverEmail = z.email();
  const samples = [
    "a@b.c",
    "x@y.z",
    "a@b.co",
    "jane.doe@deloitte.com",
    "b>x</b>@evil.com",
    "jürgen@x.com",
    "a b@c.com",
    "a..b@c.com",
    ".a@b.com",
    "a@-b.com",
    "a@b_c.com",
    "o'neil+tag@x.org",
    "",
    "no-at.com",
  ];
  it("accepts and refuses exactly what zod's email check does", () => {
    for (const s of samples) {
      assert.equal(isValidEmail(s), serverEmail.safeParse(s).success, s);
    }
  });
  it("refuses an over-long address and says why in plain words", () => {
    const long = `${"a".repeat(250)}@x.com`;
    assert.equal(isValidEmail(long), false);
    assert.match(emailProblem(long), /too long/);
    assert.match(emailProblem("a@b.c"), /Not a valid email address/);
    assert.equal(emailProblem("jane@x.com"), null);
  });
  it("checks birthdays as real days (29 Feb is allowed without a year)", () => {
    for (const ok of ["", "03-14", "02-29", "1990-03-14"])
      assert.ok(isValidBirthday(ok), ok);
    for (const bad of ["02-31", "13-45", "1990-02-30", "3-14", "march"]) {
      assert.equal(isValidBirthday(bad), false, bad);
    }
  });
  it("flags over-long fields per field", () => {
    const problems = checkEmployeeFields({
      firstName: "x".repeat(LIMITS.firstName + 1),
      phone: "1".repeat(41),
      milestone: "20x7",
      birthday: "02-31",
      skills: ["ok", "s".repeat(61)],
    });
    assert.deepEqual(Object.keys(problems).sort(), [
      "birthday",
      "firstName",
      "milestone",
      "phone",
      "skills",
    ]);
    assert.match(problems.firstName, /First name is too long \(80 characters at most\)/);
  });
  it("agrees with the server schema on a full employee", () => {
    const base = createEmployee({ deloitteEmail: "a@x.com", firstName: "A" });
    const server = (over) =>
      employeeChangesSchema.safeParse({ upsert: [{ ...base, ...over }] }).success;
    for (const over of [
      { firstName: "x".repeat(81) },
      { birthday: "02-31" },
      { takedaEmail: "nope" },
      { skills: Array(61).fill("s") },
      { milestone: "20" },
    ]) {
      const client = Object.keys(validateEmployee({ ...base, ...over }, [])).length === 0;
      assert.equal(client, server(over), JSON.stringify(over));
      assert.equal(server(over), false);
    }
    assert.equal(server({ birthday: "03-14", firstName: "x".repeat(80) }), true);
    assert.deepEqual(validateEmployee(base, []), {});
  });
  it("gives chips a stricter check than before (a@b.c, markup, non-ASCII)", () => {
    const batch = parseEmailList(
      "a@b.c b>x</b>@evil.com jürgen@x.com good@x.com <wrapped@x.com>",
      [],
    );
    assert.deepEqual(batch.valid, ["good@x.com", "wrapped@x.com"]);
    assert.equal(batch.invalid.length, 3);
  });
  it("keeps names derived from an email within the server limits", () => {
    const { firstName, lastName } = nameFromEmail(
      `${"a".repeat(120)}.${"b".repeat(120)}@x.com`,
    );
    assert.ok(firstName.length <= LIMITS.firstName);
    assert.ok(lastName.length <= LIMITS.lastName);
  });
});

describe("plain wording of server validation problems", () => {
  const ask = (upsert) => {
    const body = { upsert };
    const parsed = employeeChangesSchema.safeParse(body);
    assert.equal(parsed.success, false);
    return plainIssue(parsed.error, body);
  };
  const base = createEmployee({ deloitteEmail: "a@x.com", firstName: "A" });
  it("covers email, length, count and choice problems", () => {
    assert.equal(
      ask([{ ...base, deloitteEmail: "a@b.c" }]),
      'Deloitte email "a@b.c" is not a valid email address.',
    );
    assert.equal(
      ask([{ ...base, level: "L".repeat(61) }]),
      "a@x.com: Level is too long (at most 60 characters).",
    );
    assert.equal(
      ask([{ ...base, location: "Mars" }]),
      "a@x.com: Location is not one of the allowed choices.",
    );
    assert.equal(
      ask([{ ...base, skills: Array(61).fill("s") }]),
      "a@x.com: There are too many skills (at most 60).",
    );
  });
  it("falls back to 'Entry N' when the row has no name", () => {
    assert.match(ask([{ ...base }, { id: 5 }]), /^Entry 2: /);
  });
});

describe("import preview matches the server and reports what it drops", () => {
  const header = [
    "First Name",
    "Last Name",
    "Deloitte Email- id",
    "Roll-off date",
    "Milestone",
    "Takeda Email ID",
  ];
  it("skips rows the server would refuse, with a plain reason", () => {
    const result = parseRosterRows([
      header,
      ["J".repeat(100), "X", "long@x.com", "", "", ""],
      ["Jürgen", "K", "jürgen@x.com", "", "", ""],
      ["Ok", "Fine", "ok@x.com", "", "20x7", ""],
      ["Ok", "Fine", "ok2@x.com", "", "", "bad"],
      ["Good", "Row", "good@x.com", "", "2027", ""],
    ]);
    assert.deepEqual(
      result.rows.map((r) => r.employee.deloitteEmail),
      ["good@x.com"],
    );
    assert.deepEqual(
      result.skipped.map((s) => s.row),
      [2, 3, 4, 5],
    );
    assert.match(result.skipped[0].reason, /First name is too long/);
    assert.equal(result.skipped[1].reason, "Not a valid Deloitte email");
    assert.equal(result.skipped[2].reason, "Use a four-digit year.");
  });
  it("reports duplicate rows and dates that were left out", () => {
    const result = parseRosterRows([
      header,
      ["A", "One", "dup@x.com", "30/02/2026", "", ""],
      ["A", "Two", "DUP@x.com", "", "", ""],
    ]);
    assert.equal(result.rows.length, 2);
    assert.match(
      result.notes[0].reason,
      /Roll-off date "30\/02\/2026" is not a valid date/,
    );
    assert.equal(result.notes[0].row, 2);
    assert.match(result.notes[1].reason, /Same email as row 2/);
    const plan = planImport([], result.rows, "2026-03-02T00:00:00Z");
    assert.equal(plan.upserts.length, 1);
    assert.equal(plan.added, 1);
  });
  it("produces only people the server accepts", () => {
    const rows = [header];
    for (let i = 0; i < 50; i++)
      rows.push([`F${i}`, "L", `p${i}@x.com`, "2026-05-01", "2027", ""]);
    const { rows: ok } = parseRosterRows(rows);
    const plan = planImport([], ok);
    assert.equal(employeeChangesSchema.safeParse({ upsert: plan.upserts }).success, true);
  });
});

describe("CSV exports are guarded against formulas", () => {
  it("guards every cell of the generic writer, including tab and CR starts", () => {
    const csv = toCsv([["=cmd|' /c calc'!A0", "+1", "-1", "@x", "\tcell", "plain"]]);
    assert.equal(csv, `\uFEFF'=cmd|' /c calc'!A0,'+1,'-1,'@x,'\tcell,plain\r\n`);
  });
  it("guards time-off names and reasons, and counts working days", () => {
    const emp = { id: "e1", firstName: "=HYPERLINK", lastName: "x" };
    const rows = timeOffRows(
      [
        {
          id: "to_1",
          employeeId: "e1",
          type: "pto",
          startDate: "2026-11-05",
          endDate: "2026-11-07",
          reason: '=HYPERLINK("http://evil","x")',
          status: "approved",
        },
      ],
      [emp],
    );
    assert.equal(rows[0][4], "Working days");
    assert.equal(rows[1][4], "2");
    const csv = toCsv(rows);
    assert.match(csv, /'=HYPERLINK x/);
    assert.ok(csv.includes(`"'=HYPERLINK(""http://evil"",""x"")"`));
  });
  it("guards roster names", () => {
    const rows = rosterRows({
      from: "2026-11-02",
      days: 1,
      config: {
        schedules: [],
        groups: [{ id: "g", name: "+Team", scheduleId: "s" }],
        members: [
          {
            id: "mem_00000001",
            name: "=evil()",
            employeeId: null,
            groupId: "g",
            city: "",
            role: "",
          },
        ],
        events: [],
      },
      employees: [],
      assignments: [],
      timeOff: [],
    });
    const csv = toCsv(rows);
    assert.match(csv, /'\+Team,'=evil\(\)/);
  });
  it("guards the directory CSV but keeps phone numbers readable", () => {
    const csv = employeesToCsv([
      createEmployee({
        deloitteEmail: "a@x.com",
        firstName: "=A",
        phone: "+91 98765 43210",
        team: "\tTab",
        level: "+cmd|x",
      }),
    ]);
    assert.match(csv, /'=A/);
    assert.match(csv, /,\+91 98765 43210,/);
    assert.match(csv, /'\tTab/);
    assert.match(csv, /'\+cmd\|x/);
  });
});

describe("time off rules", () => {
  const req = (id, employeeId, start, end, status = "pending") => ({
    id,
    employeeId,
    type: "pto",
    startDate: start,
    endDate: end,
    reason: "",
    status,
    createdAt: "",
    decidedAt: "",
  });
  it("keeps only the employee error when dates come from a pasted list (empty object when fine)", () => {
    assert.deepEqual(employeeErrorOnly({}), {});
    assert.deepEqual(employeeErrorOnly({ startDate: "x", endDate: "y" }), {});
    assert.deepEqual(
      employeeErrorOnly({ employeeId: "Choose an employee.", endDate: "y" }),
      {
        employeeId: "Choose an employee.",
      },
    );
    const draft = req("to_00000001", "e1", "2026-03-05", "2026-03-04");
    const found = validateTimeOff(draft, [], new Set(["e1"]));
    assert.equal(Object.keys(found).length > 0, true);
    assert.equal(Object.keys(employeeErrorOnly(found)).length, 0);
  });
  it("finds the first request that lands on days already taken", () => {
    const current = [req("to_00000001", "e1", "2026-03-05", "2026-03-07")];
    assert.equal(
      firstClash([req("to_00000002", "e1", "2026-03-07", "2026-03-08")], current)?.other
        .id,
      "to_00000001",
    );
    assert.equal(
      firstClash([req("to_00000002", "e2", "2026-03-07", "2026-03-08")], current),
      undefined,
    );
    assert.equal(
      firstClash(
        [req("to_00000002", "e1", "2026-03-07", "2026-03-08", "rejected")],
        current,
      ),
      undefined,
    );
    // the same request with a new decision, or a removed one, is not a clash
    assert.equal(firstClash([{ ...current[0], status: "approved" }], current), undefined);
    assert.equal(
      firstClash([req("to_00000002", "e1", "2026-03-06", "2026-03-06")], current, [
        "to_00000001",
      ]),
      undefined,
    );
    // two new ones in the same save clash with each other
    assert.ok(
      firstClash(
        [
          req("to_00000003", "e3", "2026-03-01", "2026-03-02"),
          req("to_00000004", "e3", "2026-03-02", "2026-03-03"),
        ],
        [],
      ),
    );
    // moving a request away from its old days frees them for a later one in the same save
    assert.equal(
      firstClash(
        [
          req("to_00000001", "e1", "2026-04-01", "2026-04-02"),
          req("to_00000009", "e1", "2026-03-05", "2026-03-06"),
        ],
        current,
      ),
      undefined,
    );
  });
});

describe("on call, coverage and fill the week", () => {
  const events = [
    { kind: "holiday", date: "2026-11-12", endDate: "2026-11-13" },
    { kind: "note", date: "2026-11-20", endDate: "2026-11-20" },
    { kind: "holiday", date: "2026-10-30", endDate: "2026-11-02" },
  ];
  it("counts every day of a multi-day holiday, within the range", () => {
    assert.deepEqual(holidayDays(events, "2026-11-05", "2026-11-30"), [
      "2026-11-12",
      "2026-11-13",
    ]);
    assert.deepEqual(holidayDays(events, "2026-11-01", "2026-11-30"), [
      "2026-11-01",
      "2026-11-02",
      "2026-11-12",
      "2026-11-13",
    ]);
    const base = onCallDays("2026-11-05", "2026-12-30");
    const days = onCallDays(
      "2026-11-05",
      "2026-12-30",
      holidayDays(events, "2026-11-05", "2026-12-30"),
    );
    assert.equal(days.length, base.length + 2);
    assert.ok(days.includes("2026-11-12") && days.includes("2026-11-13"));
  });

  const schedules = [
    {
      id: "s1",
      name: "S",
      shifts: [
        { id: "day", label: "Day", start: "09:00", end: "17:00", days: [0, 1, 2, 3, 4] },
      ],
    },
  ];
  const input = (extraShifts = []) => ({
    employees: [],
    members: [
      {
        id: "mem_00000001",
        name: "Ann",
        employeeId: null,
        groupId: "g1",
        city: "",
        role: "",
      },
    ],
    groups: [{ id: "g1", name: "Alpha", scheduleId: "s1" }],
    schedules,
    assignments: [
      {
        id: "mem_00000001|2026-11-14",
        memberId: "mem_00000001",
        date: "2026-11-14",
        ref: "s1:day",
      },
      {
        id: "mem_00000001|2026-11-12",
        memberId: "mem_00000001",
        date: "2026-11-12",
        ref: "s1:day",
      },
      ...extraShifts,
    ],
    timeOff: [],
  });
  it("does not flag a weekend when the team has no weekend shift, but still flags weekdays", () => {
    const gaps = coverageGaps("2026-11-12", 4, input(), { g1: 10 });
    assert.deepEqual(
      gaps.map((g) => g.day),
      ["2026-11-12"],
    );
  });
  it("still checks weekends for a team that works them", () => {
    const weekend = input();
    weekend.schedules = [
      { ...schedules[0], shifts: [{ ...schedules[0].shifts[0], days: [0, 5, 6] }] },
    ];
    assert.deepEqual(
      coverageGaps("2026-11-14", 1, weekend, { g1: 10 }).map((g) => g.day),
      ["2026-11-14"],
    );
  });
  it("writes breach dates as '12 Nov 2026'", () => {
    const a = input();
    const breaches = leaveImpact(
      { employeeId: "e1", startDate: "2026-11-12", endDate: "2026-11-12" },
      { ...a, members: [{ ...a.members[0], employeeId: "e1" }] },
      { g1: 2 },
    );
    assert.match(breachText(breaches), /on 12 Nov 2026,/);
  });

  const def = schedules[0].shifts[0];
  it("fill the week reports the days it would replace, and how to undo it", () => {
    const index = new Map([
      [
        "mem_00000001|2026-11-09",
        {
          id: "mem_00000001|2026-11-09",
          memberId: "mem_00000001",
          date: "2026-11-09",
          ref: "s1:day",
        },
      ],
      [
        "mem_00000001|2026-11-10",
        {
          id: "mem_00000001|2026-11-10",
          memberId: "mem_00000001",
          date: "2026-11-10",
          ref: "status:holiday",
        },
      ],
      [
        "mem_00000001|2026-11-11",
        {
          id: "mem_00000001|2026-11-11",
          memberId: "mem_00000001",
          date: "2026-11-11",
          ref: "status:pto",
          swap: true,
        },
      ],
    ]);
    const plan = planFillWeek(index, "2026-11-09", "mem_00000001", "s1", def);
    assert.equal(plan.fills.length, 5);
    assert.deepEqual(
      plan.replaced.map((a) => a.date),
      ["2026-11-10", "2026-11-11"],
    );
    assert.deepEqual(
      plan.undo.upsert.map((a) => a.ref),
      ["status:holiday", "status:pto"],
    );
    assert.deepEqual(plan.undo.remove, [
      "mem_00000001|2026-11-12",
      "mem_00000001|2026-11-13",
    ]);
    const empty = planFillWeek(new Map(), "2026-11-09", "mem_00000001", "s1", def);
    assert.equal(empty.replaced.length, 0);
  });
});

describe("linking roster names to the directory", () => {
  it("links unique name matches in any order, and never two members to one person", () => {
    const employees = [
      { id: "e1", firstName: "Jane", lastName: "Doe", deloitteEmail: "j@x.com" },
      { id: "e2", firstName: "Tom", lastName: "Twin", deloitteEmail: "t@x.com" },
      { id: "e3", firstName: "Tom", lastName: "Twin", deloitteEmail: "t2@x.com" },
      { id: "e4", firstName: "Sam", lastName: "Solo", deloitteEmail: "s@x.com" },
    ];
    const member = (id, name, employeeId = null) => ({
      id,
      name,
      employeeId,
      groupId: "g",
      city: "",
      role: "",
    });
    const changed = autoLinkMembers(
      [
        member("m1", "Doe, Jane"),
        member("m2", "Tom Twin"),
        member("m3", "Sam Solo"),
        member("m4", "Solo Sam"),
        member("m5", "Jane Doe", "e1"),
      ],
      employees,
    );
    assert.deepEqual(
      changed.map((m) => [m.id, m.employeeId]),
      [["m3", "e4"]],
    );
  });
  it("stays fast with a thousand unlinked names", () => {
    const employees = Array.from({ length: 1500 }, (_, i) => ({
      id: `e${i}`,
      firstName: `First${String.fromCharCode(97 + (i % 26))}${i}`,
      lastName: "Person",
      deloitteEmail: `p${i}@x.com`,
    }));
    const members = Array.from({ length: 1500 }, (_, i) => ({
      id: `m${i}`,
      name: `Person, First${String.fromCharCode(97 + (i % 26))}${i}`,
      employeeId: null,
      groupId: "g",
      city: "",
      role: "",
    }));
    const started = Date.now();
    autoLinkMembers(members, employees);
    assert.ok(Date.now() - started < 1500, "linking 1500 names took too long");
  });
});
