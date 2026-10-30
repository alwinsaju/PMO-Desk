import assert from "node:assert/strict";
import { describe, it } from "node:test";
import readExcelFile from "read-excel-file/universal";

import { buildXlsx, crc32, excelSerial, safeSheetName, XLSX_MIME } from "./writeXlsx.ts";
import { employeeTemplate, rosterTemplate } from "../staff/importTemplates.ts";
import { parseRosterRows } from "../staff/employees.ts";
import { findRosterSheet, parseRosterSheet } from "../staff/rosterImport.ts";
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
    assert.equal(parsed.startDate, "2026-11-02");
    assert.equal(parsed.endDate, "2026-11-29");
    assert.deepEqual(
      parsed.members.map((m) => [m.name, m.city, m.role, m.section, m.cells.length]),
      [["Jane Doe", "Pune", "Support", "L2", 0]],
    );
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
