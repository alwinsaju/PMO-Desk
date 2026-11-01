import assert from "node:assert/strict";
import { describe, it } from "node:test";
import readExcelFile from "read-excel-file/universal";

import { buildXlsx, crc32, excelSerial, safeSheetName, XLSX_MIME } from "./writeXlsx.ts";
import { employeeTemplate, rosterTemplate } from "../staff/importTemplates.ts";
import { parseRosterRows } from "../staff/employees.ts";
import { createEmployee } from "../staff/employees.ts";
import { makeAssignment } from "../staff/shifts.ts";
import {
  findRosterSheet,
  parseRosterSheet,
  planRosterImport,
} from "../staff/rosterImport.ts";
import { workbookRosterConfig } from "../staff/rosterCatalog.ts";
import { reviewTemplate } from "../../components/apps/tasks-app/reviewTemplate.ts";
import {
  findColumns,
  rowsFromSheets,
} from "../../components/apps/tasks-app/reviewImport.ts";

const read = async (sheets) =>
  readExcelFile(new Blob([buildXlsx(sheets)], { type: XLSX_MIME }));

describe("xlsx writer", () => {
  it("computes the standard CRC-32", () => {
    assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  });

  it("converts dates to Excel day numbers", () => {
    assert.equal(excelSerial("1970-01-01"), 25569);
    assert.equal(excelSerial("2026-11-02"), 46328);
    assert.equal(excelSerial("not a date"), null);
  });

  it("makes sheet names Excel accepts, and unique", () => {
    assert.equal(safeSheetName("a/b:c", new Set()), "a b c");
    assert.equal(safeSheetName("x".repeat(40), new Set()).length, 31);
    assert.equal(safeSheetName("Data", new Set(["data"])), "Data 2");
    assert.equal(safeSheetName("   ", new Set()), "Sheet");
  });

  it("writes text, numbers, dates and escapes markup", async () => {
    const sheets = await read([
      {
        name: "Data",
        rows: [['A & B <c> "q"', 42, { date: "2026-11-02" }], [], [null, "later"]],
        headerRows: [0],
        widths: [20],
        freeze: { rows: 1, cols: 1 },
      },
      { name: "Data", rows: [["second"]] },
    ]);
    assert.deepEqual(
      sheets.map((s) => s.sheet),
      ["Data", "Data 2"],
    );
    const [first] = sheets[0].data;
    assert.equal(first[0], 'A & B <c> "q"');
    assert.equal(first[1], 42);
    assert.ok(first[2] instanceof Date);
    assert.equal(first[2].toISOString().slice(0, 10), "2026-11-02");
    assert.equal(sheets[0].data[2][1], "later");
    assert.equal(sheets[1].data[0][0], "second");
  });

  it("refuses an empty workbook", () => {
    assert.throws(() => buildXlsx([]), /at least one sheet/);
  });
});

describe("staff roster template", () => {
  it("is read back by the importer, with no rows to import until it is filled in", async () => {
    const sheets = await read(employeeTemplate());
    const parsed = sheets.map((s) => parseRosterRows(s.data)).find((p) => p.headerFound);
    assert.ok(parsed, "the importer finds the heading row");
    assert.deepEqual(parsed.rows, []);
    assert.deepEqual(parsed.skipped, []);
    assert.equal(sheets[0].sheet, "Staff roster");
    // The help sheet is not mistaken for the data.
    assert.equal(parseRosterRows(sheets[1].data).headerFound, false);
  });

  it("imports a row with only an email filled in", async () => {
    const [sheet] = employeeTemplate();
    const rows = [...sheet.rows, ["", "", "", "only.email@example.com"]];
    const sheets = await read([{ ...sheet, rows }]);
    const parsed = parseRosterRows(sheets[0].data);
    assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.rows[0].employee.deloitteEmail, "only.email@example.com");
    assert.deepEqual(parsed.skipped, []);
  });

  it("accepts a sheet that has only the email column", () => {
    const parsed = parseRosterRows([["Deloitte Email- id"], ["a@x.com"]]);
    assert.equal(parsed.headerFound, true);
    assert.equal(parsed.rows.length, 1);
  });
});

describe("shift roster template", () => {
  const config = {
    ...workbookRosterConfig(),
    members: [
      {
        id: "mem_000000000001",
        name: "Jane Doe",
        employeeId: null,
        groupId: "l2",
        city: "Pune",
        role: "Support",
      },
    ],
  };

  it("is read back by the importer with the people already in it", async () => {
    const sheets = await read(rosterTemplate({ config, today: "2026-11-04" }));
    const sheet = findRosterSheet(sheets);
    assert.ok(sheet, "the grid is found by its Resource heading");
    const parsed = parseRosterSheet(sheet.data);
    assert.ok(parsed);
    assert.equal(parsed.startDate, "2026-01-01");
    assert.equal(parsed.endDate, "2026-12-31");
    assert.deepEqual(
      parsed.members.map((m) => [m.name, m.city, m.role, m.section, m.cells.length]),
      [["Jane Doe", "Pune", "Support", "L2", 0]],
    );
  });

  it("holds the shifts, holidays and people that are on the roster, and importing it back changes nothing", async () => {
    const shifts = [
      makeAssignment("mem_000000000001", "2026-02-10", "main:shift-1"),
      makeAssignment("mem_000000000001", "2026-02-11", "status:pto"),
      makeAssignment("mem_000000000001", "2026-12-24", "main:ns", { swap: true }),
      makeAssignment("mem_000000000001", "2026-06-01", "custom", {
        text: "IST 6:00PM-3:00AM",
      }),
    ];
    const withEvents = {
      ...config,
      events: [
        {
          id: "e1",
          date: "2026-01-26",
          endDate: "2026-01-26",
          label: "Republic Day",
          kind: "holiday",
        },
      ],
    };
    const sheet = findRosterSheet(
      await read(rosterTemplate({ config: withEvents, today: "2026-11-04", shifts })),
    );
    const parsed = parseRosterSheet(sheet.data);
    assert.equal(parsed.members[0].cells.length, 4);
    assert.deepEqual(parsed.banners, [{ date: "2026-01-26", label: "Republic Day" }]);

    const plan = planRosterImport(parsed, withEvents, [], shifts);
    assert.equal(plan.upsert.length, 0);
    assert.equal(plan.stats.assignmentsUnchanged, 4);
    assert.equal(plan.stats.membersUnchanged, 1);
    assert.equal(plan.stats.membersAdded + plan.stats.membersUpdated, 0);
    assert.equal(plan.stats.events, 0);
    assert.equal(plan.warnings.length, 0);
  });

  it("applies only the additions and changes made to a downloaded copy", async () => {
    const shifts = [makeAssignment("mem_000000000001", "2026-02-10", "main:shift-1")];
    const sheet = findRosterSheet(
      await read(rosterTemplate({ config, today: "2026-11-04", shifts })),
    );
    const rows = sheet.data.map((r) => [...r]);
    const personRow = rows.find((r) => r[1] === "Jane Doe");
    const col = (iso) =>
      4 +
      (Date.UTC(2026, +iso.slice(5, 7) - 1, +iso.slice(8)) - Date.UTC(2026, 0, 1)) /
        86400000;
    personRow[col("2026-02-10")] = "Shift-2";
    personRow[col("2026-02-11")] = "PTO";
    const l2 = rows.findIndex((r) => r[0] === "L2");
    rows.splice(l2 + 2, 0, [
      "",
      "New Person",
      "Pune",
      "Support",
      ...Array(col("2026-02-12") - 4).fill(null),
      "Shift-1",
    ]);
    const plan = planRosterImport(parseRosterSheet(rows), config, [], shifts);
    assert.deepEqual(plan.upsert.map((a) => [a.date, a.ref]).sort(), [
      ["2026-02-10", "main:shift-2"],
      ["2026-02-11", "status:pto"],
      ["2026-02-12", "main:shift-1"],
    ]);
    assert.equal(plan.stats.membersAdded, 1);
    assert.equal(plan.stats.assignmentsChanged, 1);
    assert.equal(plan.stats.assignmentsAdded, 2);
  });

  it("covers the whole year, a leap year too, and stretches to hold shifts outside it", async () => {
    const days = async (today, shifts = []) => {
      const parsed = parseRosterSheet(
        findRosterSheet(await read(rosterTemplate({ config, today, shifts }))).data,
      );
      return [parsed.startDate, parsed.endDate];
    };
    assert.deepEqual(await days("2028-05-05"), ["2028-01-01", "2028-12-31"]);
    assert.deepEqual(
      await days("2026-11-04", [
        makeAssignment("mem_000000000001", "2027-01-15", "main:shift-1"),
      ]),
      ["2026-01-01", "2027-01-15"],
    );
  });

  it("lists directory people under their team, and leaves out those with no team", async () => {
    const person = (n, team) =>
      createEmployee(
        {
          id: `emp_00000000000${n}`,
          deloitteEmail: `p${n}@x.com`,
          firstName: n === 1 ? "Dee" : "Eve",
          lastName: "Lane",
          team,
          homeOffice: "Chennai",
        },
        "2026-03-02T10:00:00.000Z",
      );
    const sheet = findRosterSheet(
      await read(
        rosterTemplate({
          config,
          today: "2026-11-04",
          employees: [person(1, "L2"), person(2, "")],
        }),
      ),
    );
    const parsed = parseRosterSheet(sheet.data);
    const names = parsed.members.map((m) => [m.name, m.section, m.city]);
    assert.ok(names.some((n) => n.join() === "Dee Lane,L2,Chennai"));
    assert.ok(!names.some(([name]) => name.startsWith("Eve")));
  });

  it("does not count a team that only the directory names as a change until someone is saved in it", async () => {
    const dee = createEmployee(
      {
        id: "emp_000000000009",
        deloitteEmail: "dee@x.com",
        firstName: "Dee",
        lastName: "Lane",
        team: "Brand New",
      },
      "2026-03-02T10:00:00.000Z",
    );
    const sheet = findRosterSheet(
      await read(rosterTemplate({ config, today: "2026-11-04", employees: [dee] })),
    );
    const idle = planRosterImport(parseRosterSheet(sheet.data), config, [dee], []);
    assert.equal(idle.stats.groupsAdded, 0);
    assert.equal(idle.config.members.length, 1);
    assert.equal(idle.upsert.length, 0);

    const rows = sheet.data.map((r) => [...r]);
    rows.find((r) => r[1] === "Dee Lane")[4] = "Shift-1";
    const busy = planRosterImport(parseRosterSheet(rows), config, [dee], []);
    assert.equal(busy.stats.groupsAdded, 1);
    assert.equal(busy.stats.membersAdded, 1);
    assert.equal(busy.config.members.at(-1).employeeId, dee.id);
  });
  it("starts with a team to type into when there is no roster yet", async () => {
    const empty = { schedules: config.schedules, groups: [], members: [] };
    const sheets = await read(
      rosterTemplate({ config: empty, today: "2026-11-02", days: 7 }),
    );
    const rows = findRosterSheet(sheets).data;
    assert.equal(rows[3][0], "Team 1");
    assert.equal(parseRosterSheet(rows).members.length, 0);
  });

  it("explains the shift names of every schedule", async () => {
    const sheets = await read(rosterTemplate({ config, today: "2026-11-02" }));
    const help = sheets[1].data.flat().filter((c) => typeof c === "string");
    assert.ok(help.includes("Shift-1"));
    assert.ok(help.includes("PTO"));
    assert.ok(!findRosterSheet([sheets[1]]));
  });
});

describe("review import template", () => {
  const incident = (over) => ({
    number: "INC1",
    short_description: "Laptop slow",
    resolution_notes: null,
    category: "Hardware",
    subcategory: "Laptop",
    state: "Resolved",
    assignment_group: "L2",
    assigned_to: null,
    current_subcategory2: null,
    review_reasons: ["Blank"],
    resolved_subcategory2: null,
    ...over,
  });

  it("lists the queue with Subcategory2 empty, and is read back by the importer", async () => {
    const sheets = await read(
      reviewTemplate(
        [incident({}), incident({ number: "INC2", resolved_subcategory2: "Other" })],
        ["Hardware Issue", "Other"],
      ),
    );
    assert.equal(sheets[0].sheet, "Review Needed");
    assert.ok(findColumns(sheets[0].data[0]));
    assert.deepEqual(
      rowsFromSheets(sheets).map((r) => [r.number, r.value]),
      [
        ["INC1", ""],
        ["INC2", "Other"],
      ],
    );
    assert.deepEqual(
      sheets[1].data.slice(0, 3).map((r) => r[0]),
      ["Allowed Subcategory2 values", "Hardware Issue", "Other"],
    );
  });

  it("still works for an empty queue", async () => {
    const sheets = await read(reviewTemplate([], []));
    assert.deepEqual(rowsFromSheets(sheets), []);
  });
});
