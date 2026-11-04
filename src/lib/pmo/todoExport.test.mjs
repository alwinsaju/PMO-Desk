// Run with `pnpm test`. Exporting the PMO to-do list to CSV and Excel.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildXlsx } from "../xlsx/writeXlsx.ts";
import {
  TODO_EXPORT_HEADERS,
  csvSafeCell,
  exportScopeText,
  localDay,
  todoExportFilename,
  todoExportRow,
  todosToCsv,
  todosToSheets,
} from "./todoExport.ts";

const todo = (over = {}) => ({
  title: "Send the plan",
  status: "open",
  owner: { name: "Asha Rao", email: "asha@x.com", isMe: false },
  requester: { name: "Ben Cole", email: "ben@x.com" },
  dueAt: "2026-11-10",
  priority: "high",
  tags: ["alpha", "beta"],
  createdAt: "2026-11-01T12:00:00.000Z",
  completedAt: null,
  ...over,
});

describe("rows", () => {
  it("has the nine columns in order", () => {
    assert.deepEqual(
      [...TODO_EXPORT_HEADERS].map((h) => h.toLowerCase()),
      [
        "title",
        "status",
        "owner",
        "requester",
        "due",
        "priority",
        "tags",
        "created",
        "completed",
      ],
    );
    assert.equal(todoExportRow(todo()).length, TODO_EXPORT_HEADERS.length);
  });

  it("writes readable values", () => {
    assert.deepEqual(todoExportRow(todo()), [
      "Send the plan",
      "Open",
      "Asha Rao",
      "Ben Cole",
      "2026-11-10",
      "High",
      "alpha; beta",
      "2026-11-01",
      "",
    ]);
  });

  it("handles missing people, a done to-do and my own to-dos", () => {
    const row = todoExportRow(
      todo({
        status: "done",
        owner: { name: null, email: null, isMe: true },
        requester: { name: null, email: "ben@x.com" },
        dueAt: null,
        tags: [],
        completedAt: "2026-11-03T12:00:00.000Z",
      }),
    );
    assert.deepEqual(row.slice(1, 5), ["Done", "Me", "ben@x.com", ""]);
    assert.equal(row[6], "");
    assert.equal(row[8], "2026-11-03");
  });

  it("gives an empty day for a missing or unreadable time", () => {
    assert.equal(localDay(null), "");
    assert.equal(localDay("not a date"), "");
  });
});

describe("CSV formula injection", () => {
  it("prefixes cells that start with = + - @ tab or carriage return", () => {
    for (const bad of ["=1+1", "+1", "-2", "@SUM(A1)", "\tx", "\rx"]) {
      assert.equal(csvSafeCell(bad), `'${bad}`, JSON.stringify(bad));
    }
  });

  it("leaves ordinary text alone, including a symbol that is not first", () => {
    for (const ok of ["Send the plan", "a=b", "2026-11-10", "", "Me"]) {
      assert.equal(csvSafeCell(ok), ok);
    }
  });

  it("guards every cell of the exported CSV", () => {
    const csv = todosToCsv([
      todo({
        title: '=HYPERLINK("http://evil","click")',
        owner: { name: "+cmd|' /C calc'!A0", email: null, isMe: false },
        requester: { name: "@x", email: null },
        tags: ["-1"],
      }),
    ]);
    const lines = csv.replace(/^﻿/, "").split("\r\n");
    assert.equal(
      lines[0],
      "Title,Status,Owner,Requester,Due,Priority,Tags,Created,Completed",
    );
    assert.ok(lines[1].startsWith(`"'=HYPERLINK(""http://evil"",""click"")",`), lines[1]);
    assert.ok(lines[1].includes(`'+cmd|' /C calc'!A0`), lines[1]);
    assert.ok(lines[1].includes(",'@x,"), lines[1]);
    assert.ok(lines[1].includes(",'-1,"), lines[1]);
  });
});

describe("CSV", () => {
  it("starts with a BOM, quotes commas and quotes, and has a header plus one row each", () => {
    const csv = todosToCsv([
      todo({ title: 'Say "hi", then go' }),
      todo({ title: "Two" }),
    ]);
    assert.ok(csv.startsWith("﻿Title,"));
    assert.ok(csv.includes('"Say ""hi"", then go"'));
    assert.equal(csv.trim().split("\r\n").length, 3);
  });

  it("is only the header for an empty list", () => {
    assert.equal(todosToCsv([]).trim().split("\r\n").length, 1);
  });
});

describe("Excel", () => {
  it("makes one To-dos sheet with a frozen header and one row per to-do", () => {
    const [sheet] = todosToSheets([todo(), todo({ title: "Two" })]);
    assert.equal(sheet.name, "To-dos");
    assert.equal(sheet.rows.length, 3);
    assert.deepEqual(sheet.headerRows, [0]);
    assert.deepEqual(sheet.freeze, { rows: 1 });
    assert.equal(sheet.widths.length, TODO_EXPORT_HEADERS.length);
  });

  it("builds a workbook that holds a formula-looking title as text, never a formula", () => {
    const bytes = buildXlsx(todosToSheets([todo({ title: "=1+1" })]));
    assert.equal(bytes[0], 0x50); // "PK"
    const text = Buffer.from(bytes).toString("utf8");
    assert.ok(text.includes('<t xml:space="preserve">=1+1</t>'), "stored as a string");
    assert.ok(!text.includes("<f>"), "no formula element");
  });
});

describe("names and wording", () => {
  it("names the file by scope, day and type", () => {
    assert.equal(
      todoExportFilename("filtered", "csv", "2026-11-05"),
      "pmo-todos-filtered-2026-11-05.csv",
    );
    assert.equal(
      todoExportFilename("all", "xlsx", "2026-11-05"),
      "pmo-todos-all-2026-11-05.xlsx",
    );
  });

  it("says which scope an export covers", () => {
    assert.match(exportScopeText("filtered", 12), /12 to-dos in the current list/);
    assert.match(exportScopeText("filtered", 1), /1 to-do in the current list/);
    assert.match(
      exportScopeText("all", 40),
      /all 40 to-dos, including done and cancelled/,
    );
  });
});
