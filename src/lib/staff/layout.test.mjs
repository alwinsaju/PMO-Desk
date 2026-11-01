import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DIRECTORY_COLUMNS,
  MAX_COLUMN_WIDTH,
  PANE_WIDTH,
  clampColumnWidth,
  clampPaneWidth,
  defaultColumnWidths,
  fitColumns,
  parseColumnWidths,
  parsePaneWidth,
  totalWidth,
  visibleColumns,
} from "./layout.ts";

describe("column widths", () => {
  it("clamps to each column's minimum and the shared maximum", () => {
    assert.equal(clampColumnWidth("level", 10), 70);
    assert.equal(clampColumnWidth("employee", 100), 170);
    assert.equal(clampColumnWidth("level", 99999), MAX_COLUMN_WIDTH);
    assert.equal(clampColumnWidth("level", 123.6), 124);
    assert.equal(clampColumnWidth("level", NaN), 150);
  });

  it("restores saved widths, ignoring damaged or unknown values", () => {
    assert.deepEqual(parseColumnWidths(null), defaultColumnWidths());
    assert.deepEqual(parseColumnWidths("not json"), defaultColumnWidths());
    assert.deepEqual(parseColumnWidths("[1]"), defaultColumnWidths());
    const saved = parseColumnWidths(
      JSON.stringify({ level: 200, op: "wide", team: 5, nope: 9 }),
    );
    assert.equal(saved.level, 200);
    assert.equal(saved.op, 150);
    assert.equal(saved.team, 70);
    assert.equal("nope" in saved, false);
  });

  it("totals the widths", () => {
    assert.equal(
      totalWidth(defaultColumnWidths()),
      DIRECTORY_COLUMNS.reduce((sum, c) => sum + c.width, 0),
    );
  });
});

describe("pane width", () => {
  it("keeps the pane within its limits and leaves the list some room", () => {
    assert.equal(clampPaneWidth(100), PANE_WIDTH.min);
    assert.equal(clampPaneWidth(5000), PANE_WIDTH.max);
    assert.equal(clampPaneWidth(500, 700), 380); // 700 - 320 room for the list
    assert.equal(clampPaneWidth(500, 400), PANE_WIDTH.min); // never below the minimum
    assert.equal(clampPaneWidth(NaN), PANE_WIDTH.default);
  });

  it("restores a saved width", () => {
    assert.equal(parsePaneWidth(null), PANE_WIDTH.default);
    assert.equal(parsePaneWidth("abc"), PANE_WIDTH.default);
    assert.equal(parsePaneWidth("420"), 420);
    assert.equal(parsePaneWidth("9999"), PANE_WIDTH.max);
  });
});

const person = (over = {}) => ({
  level: "",
  op: "",
  offering: "",
  team: "",
  location: "",
  rollOffDate: "",
  ...over,
});

describe("visible columns", () => {
  it("always shows the employee and hides columns that are empty for everyone", () => {
    assert.deepEqual(visibleColumns([]), ["employee"]);
    assert.deepEqual(
      visibleColumns([
        person({ level: "Analyst", team: "Ops" }),
        person({ level: " ", location: "Onshore" }),
      ]),
      ["employee", "level", "team", "location"],
    );
  });

  it("keeps a column when one person has a value", () => {
    const keys = visibleColumns([person(), person({ rollOffDate: "2026-12-01" })]);
    assert.deepEqual(keys, ["employee", "rolloff"]);
  });
});

describe("fitting columns to the room", () => {
  const widths = defaultColumnWidths();
  const all = DIRECTORY_COLUMNS.map((c) => c.key);
  const sum = (w, keys) => keys.reduce((n, k) => n + w[k], 0);

  it("leaves everything alone when it fits or the room is unknown", () => {
    assert.deepEqual(fitColumns(all, widths, 5000), { keys: all, widths });
    assert.deepEqual(fitColumns(all, widths, 0), { keys: all, widths });
  });

  it("shrinks columns towards their minimums so nothing scrolls sideways", () => {
    const keys = all.filter((k) => k !== "offering");
    const fit = fitColumns(keys, widths, 800);
    assert.deepEqual(fit.keys, keys);
    assert.ok(sum(fit.widths, keys) <= 800);
    for (const column of DIRECTORY_COLUMNS) {
      if (keys.includes(column.key)) assert.ok(fit.widths[column.key] >= column.min);
    }
  });

  it("drops the least important columns when even the minimums do not fit", () => {
    const fit = fitColumns(all, widths, 500);
    assert.equal(fit.keys[0], "employee");
    assert.ok(!fit.keys.includes("rolloff"));
    assert.ok(sum(fit.widths, fit.keys) <= 500);
    assert.deepEqual(fitColumns(all, widths, 100).keys, ["employee"]);
  });
});
