import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createEmployee,
  distinctValues,
  employeesToCsv,
  filterEmployees,
  levelRank,
  NO_FILTER,
  parseBirthdayCell,
  parseRosterRows,
  sortEmployees,
  compareLevels,
} from "./employees.ts";
import { parseCsv } from "./csvRead.ts";
import { employeeTemplate } from "./importTemplates.ts";
import { cellSelector, moveInGrid, tabStop } from "./gridNav.ts";
import { ROW_HEIGHT, scrollTopToReveal, windowRange } from "./windowing.ts";
import { allSelected, selectionView, toggleAll } from "../ui/multiSelect.ts";
import { autoLinkMembers } from "./shifts.ts";
import { rowKeyAction } from "../../components/apps/rowNav.ts";

const make = (i, over = {}) =>
  createEmployee({
    id: `emp_${String(i).padStart(12, "0")}`,
    firstName: `First${i}`,
    lastName: `Last${(i * 7919) % 2000}`,
    deloitteEmail: `person${i}@deloitte.com`,
    level: ["Analyst", "Consultant", "Senior Consultant", "Manager", "Senior Manager"][
      i % 5
    ],
    team: `Team ${i % 17}`,
    location: i % 2 ? "Onshore" : "Offshore",
    skills: ["SQL", `skill${i % 40}`],
    rollOffDate: i % 3 ? "2026-12-31" : "",
    ...over,
  });

describe("windowing", () => {
  const base = {
    count: 2000,
    rowHeight: ROW_HEIGHT,
    viewportHeight: 520,
    overscan: 5,
    headerHeight: 37,
  };

  it("draws only the rows in view plus the overscan", () => {
    const top = windowRange({ ...base, scrollTop: 0 });
    assert.deepEqual([top.start, top.end], [0, 5 + Math.ceil((520 - 37) / 52)]);
    assert.equal(top.padTop, 0);
    assert.equal(top.padBottom, (2000 - top.end) * 52);
    const middle = windowRange({ ...base, scrollTop: 52 * 1000 + 37 });
    assert.equal(middle.start, 1000 - 5);
    assert.ok(middle.end - middle.start < 30);
    assert.equal(
      middle.padTop + (middle.end - middle.start) * 52 + middle.padBottom,
      2000 * 52,
    );
  });

  it("never goes past the list, and copes with an empty or tiny one", () => {
    const bottom = windowRange({ ...base, scrollTop: 2000 * 52 });
    assert.equal(bottom.end, 2000);
    assert.equal(bottom.padBottom, 0);
    assert.ok(bottom.start < 2000 && bottom.start >= 2000 - 25);
    assert.deepEqual(windowRange({ ...base, count: 0, scrollTop: 0 }), {
      start: 0,
      end: 0,
      padTop: 0,
      padBottom: 0,
    });
    const few = windowRange({ ...base, count: 3, scrollTop: 0 });
    assert.deepEqual([few.start, few.end, few.padBottom], [0, 3, 0]);
    assert.equal(windowRange({ ...base, scrollTop: -50 }).start, 0);
  });

  it("scrolls only as far as needed to reveal a row below the sticky header", () => {
    const view = { rowHeight: 52, viewportHeight: 520, headerHeight: 37 };
    assert.equal(scrollTopToReveal({ ...view, index: 3, scrollTop: 0 }), null);
    // row 20 would end at 37 + 21 * 52 = 1129; the viewport ends at 520
    assert.equal(scrollTopToReveal({ ...view, index: 20, scrollTop: 0 }), 1129 - 520);
    // row 10 starts at 520 and is under the header when scrolled to 600
    assert.equal(scrollTopToReveal({ ...view, index: 10, scrollTop: 600 }), 520);
    assert.equal(scrollTopToReveal({ ...view, index: 0, scrollTop: 600 }), 0);
  });

  it("keeps a keyboard walk inside the window: J/K/End/Home reach rows that are not drawn", () => {
    const key = (k) => ({ key: k });
    assert.deepEqual(rowKeyAction(key("j"), 5, 2000), { type: "move", index: 6 });
    assert.deepEqual(rowKeyAction(key("k"), 5, 2000), { type: "move", index: 4 });
    assert.deepEqual(rowKeyAction(key("ArrowDown"), 5, 2000), { type: "move", index: 6 });
    assert.deepEqual(rowKeyAction(key("End"), 5, 2000), { type: "move", index: 1999 });
    assert.deepEqual(rowKeyAction(key("Home"), 500, 2000), { type: "move", index: 0 });
    // moving to the far end brings that row into the window
    const to = scrollTopToReveal({
      index: 1999,
      rowHeight: 52,
      viewportHeight: 520,
      headerHeight: 37,
      scrollTop: 0,
    });
    const range = windowRange({ ...base, scrollTop: to });
    assert.ok(range.start <= 1999 && range.end === 2000);
  });
});

describe("a 2,000-person directory is fast in the pure code", () => {
  const people = Array.from({ length: 2000 }, (_, i) => make(i));
  const within = (label, limitMs, run) => {
    const started = performance.now();
    const result = run();
    const took = performance.now() - started;
    assert.ok(
      took < limitMs,
      `${label} took ${took.toFixed(0)} ms (limit ${limitMs} ms)`,
    );
    return result;
  };

  it("filters, sorts and windows within a frame or two", () => {
    const found = within("search", 150, () =>
      filterEmployees(people, { ...NO_FILTER, query: "skill7 onshore" }),
    );
    assert.ok(found.length >= 0);
    for (const key of [
      "name",
      "level",
      "op",
      "offering",
      "team",
      "location",
      "rolloff",
      "recent",
    ]) {
      within(`sort by ${key}`, 250, () => sortEmployees(people, key));
    }
    within("window", 5, () => {
      for (let i = 0; i < 1000; i++)
        windowRange({
          count: 2000,
          rowHeight: 52,
          scrollTop: i * 40,
          viewportHeight: 700,
          overscan: 10,
          headerHeight: 37,
        });
    });
  });

  it("selects everyone and builds the bulk bar's view quickly", () => {
    const ids = people.map((p) => p.id);
    const ticked = within("select all", 50, () => toggleAll(new Set(), ids));
    assert.equal(ticked.size, 2000);
    assert.equal(
      within("all selected?", 50, () => allSelected(ticked, ids)),
      true,
    );
    const view = within("selection view", 100, () => selectionView(people, ids, ticked));
    assert.equal(view.visible.length, 2000);
    assert.equal(view.hidden, 0);
  });

  it("links a thousand roster names to the directory quickly", () => {
    const word = (n) =>
      String.fromCharCode(97 + (n % 26)) + (n >= 26 ? word(Math.floor(n / 26) - 1) : "");
    const named = people.map((p, i) => ({
      ...p,
      firstName: `Fn${word(i)}`,
      lastName: `Ln${word(i * 3)}`,
    }));
    const members = named.slice(0, 1000).map((p, i) => ({
      id: `mem_${i}`,
      name: `${p.lastName}, ${p.firstName}`,
      employeeId: null,
      groupId: "g",
      city: "",
      role: "",
    }));
    const linked = within("auto-link", 500, () => autoLinkMembers(members, named));
    assert.equal(linked.length, 1000);
  });
});

describe("roster grid keyboard movement", () => {
  const rows = [true, true, false, true]; // the third person has no team yet: no cells
  const move = (pos, key, extra = {}) => moveInGrid(pos, { key, ...extra }, rows, 7);

  it("moves one cell with the arrows, stopping at the edges", () => {
    assert.deepEqual(move({ row: 0, col: 3 }, "ArrowRight"), { row: 0, col: 4 });
    assert.deepEqual(move({ row: 0, col: 3 }, "ArrowLeft"), { row: 0, col: 2 });
    assert.equal(move({ row: 0, col: 0 }, "ArrowLeft"), null);
    assert.equal(move({ row: 0, col: 6 }, "ArrowRight"), null);
    assert.equal(move({ row: 0, col: 2 }, "ArrowUp"), null);
    assert.deepEqual(move({ row: 0, col: 2 }, "ArrowDown"), { row: 1, col: 2 });
  });

  it("skips rows that have no cells", () => {
    assert.deepEqual(move({ row: 1, col: 2 }, "ArrowDown"), { row: 3, col: 2 });
    assert.deepEqual(move({ row: 3, col: 2 }, "ArrowUp"), { row: 1, col: 2 });
    assert.equal(move({ row: 3, col: 2 }, "ArrowDown"), null);
  });

  it("Home and End go to the ends of the row; with Ctrl, of the grid", () => {
    assert.deepEqual(move({ row: 1, col: 3 }, "Home"), { row: 1, col: 0 });
    assert.deepEqual(move({ row: 1, col: 3 }, "End"), { row: 1, col: 6 });
    assert.deepEqual(move({ row: 1, col: 3 }, "Home", { ctrlKey: true }), {
      row: 0,
      col: 0,
    });
    assert.deepEqual(move({ row: 1, col: 3 }, "End", { ctrlKey: true }), {
      row: 3,
      col: 6,
    });
    assert.equal(move({ row: 1, col: 0 }, "Home"), null);
  });

  it("pages by five people, never past the ends, and ignores other keys", () => {
    const many = Array.from({ length: 20 }, () => true);
    assert.deepEqual(moveInGrid({ row: 2, col: 1 }, { key: "PageDown" }, many, 7), {
      row: 7,
      col: 1,
    });
    assert.deepEqual(moveInGrid({ row: 17, col: 1 }, { key: "PageDown" }, many, 7), {
      row: 19,
      col: 1,
    });
    assert.deepEqual(moveInGrid({ row: 3, col: 1 }, { key: "PageUp" }, many, 7), {
      row: 0,
      col: 1,
    });
    for (const key of ["Enter", " ", "a", "Tab", "Escape"])
      assert.equal(move({ row: 0, col: 0 }, key), null);
    assert.equal(move({ row: 0, col: 1 }, "ArrowRight", { altKey: true }), null);
    assert.equal(
      moveInGrid({ row: 0, col: 0 }, { key: "ArrowDown" }, [false, false], 7),
      null,
    );
  });

  it("keeps one tab stop: the remembered cell while it exists, else the first cell", () => {
    const keys = [null, "mem_1", "mem_2"];
    const days = ["2026-11-02", "2026-11-03"];
    assert.deepEqual(tabStop(null, keys, days), { rowKey: "mem_1", date: "2026-11-02" });
    assert.deepEqual(tabStop({ rowKey: "mem_2", date: "2026-11-03" }, keys, days), {
      rowKey: "mem_2",
      date: "2026-11-03",
    });
    assert.deepEqual(tabStop({ rowKey: "gone", date: "2026-11-03" }, keys, days), {
      rowKey: "mem_1",
      date: "2026-11-02",
    });
    assert.deepEqual(tabStop({ rowKey: "mem_2", date: "2027-01-01" }, keys, days), {
      rowKey: "mem_1",
      date: "2026-11-02",
    });
    assert.equal(tabStop(null, [null], days), null);
    assert.equal(tabStop(null, keys, []), null);
  });

  it("builds a selector that is safe for odd keys", () => {
    assert.equal(
      cellSelector("emp:emp_1", "2026-11-02"),
      '[data-roster-cell][data-row-key="emp:emp_1"][data-date="2026-11-02"]',
    );
    assert.equal(
      cellSelector('a"b\\c', "d"),
      '[data-roster-cell][data-row-key="a\\"b\\\\c"][data-date="d"]',
    );
  });
});

describe("birthday in the Directory export and import", () => {
  it("reads a birthday cell as MM-DD (or a typed full date), and refuses impossible days", () => {
    assert.equal(parseBirthdayCell("03-14"), "03-14");
    assert.equal(parseBirthdayCell("02-29"), "02-29");
    assert.equal(parseBirthdayCell("1990-03-14"), "1990-03-14");
    assert.equal(parseBirthdayCell("14 Mar"), "03-14");
    assert.equal(parseBirthdayCell("7-Dec"), "12-07");
    assert.equal(parseBirthdayCell("14 March 1990"), "03-14");
    assert.equal(parseBirthdayCell("14/03/1990"), "03-14");
    assert.equal(parseBirthdayCell(new Date(Date.UTC(1990, 2, 14))), "03-14");
    assert.equal(parseBirthdayCell(32946), "03-14"); // an Excel serial
    for (const bad of ["02-31", "13-45", "31 Feb", "soon", "1990-02-30"]) {
      assert.equal(parseBirthdayCell(bad), "", bad);
    }
    assert.equal(parseBirthdayCell(""), "");
    assert.equal(parseBirthdayCell(null), "");
  });

  it("the blank template has a Birthday column, and the importer reads it", () => {
    const [sheet] = employeeTemplate();
    const head = sheet.rows[0];
    assert.ok(head.includes("Birthday"));
    const row = head.map((h) =>
      h === "Deloitte Email- id" ? "b@x.com" : h === "Birthday" ? "03-14" : "",
    );
    const parsed = parseRosterRows([head, row]);
    assert.equal(parsed.rows[0].employee.birthday, "03-14");
    assert.deepEqual(parsed.notes, []);
    const help = employeeTemplate()[1].rows.find((r) => r[0] === "Birthday column");
    assert.match(help[1], /Month and day/);
  });

  it("reports a birthday that is not a real day, and still imports the person", () => {
    const parsed = parseRosterRows([
      ["Deloitte Email- id", "Birthday"],
      ["a@x.com", "02-31"],
    ]);
    assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.rows[0].employee.birthday, undefined);
    assert.match(
      parsed.notes[0].reason,
      /Birthday "02-31" is not a valid date and was left blank/,
    );
  });

  it("survives a CSV export and import, including awkward cells", () => {
    const people = [
      createEmployee({
        deloitteEmail: "ann@x.com",
        firstName: "=Ann",
        lastName: 'O"Neil, Jr',
        birthday: "03-14",
        phone: "+91 98765 43210",
        skills: ["SQL", "Py"],
        level: "Senior Consultant",
        team: "Core\nTeam",
        campus: true,
        rollOffDate: "2026-12-31",
      }),
      createEmployee({
        deloitteEmail: "bob@x.com",
        firstName: "Bob",
        birthday: "1990-07-01",
      }),
      createEmployee({ deloitteEmail: "cy@x.com", firstName: "Cy" }),
    ];
    const csv = employeesToCsv(people);
    assert.match(
      csv.split("\r\n")[0],
      /Client Manager,Birthday,Exclude from shift roster$/,
    );
    const parsed = parseRosterRows(parseCsv("\uFEFF" + csv));
    assert.deepEqual(parsed.skipped, []);
    const [ann, bob, cy] = parsed.rows.map((r) => r.employee);
    assert.equal(ann.firstName, "=Ann");
    assert.equal(ann.lastName, 'O"Neil, Jr');
    assert.equal(ann.birthday, "03-14");
    assert.equal(ann.phone, "+91 98765 43210");
    assert.deepEqual(ann.skills, ["SQL", "Py"]);
    assert.equal(ann.team, "Core\nTeam");
    assert.equal(ann.campus, true);
    assert.equal(ann.rollOffDate, "2026-12-31");
    assert.equal(bob.birthday, "1990-07-01");
    assert.equal(cy.birthday, undefined);
  });
});

describe("reading CSV", () => {
  it("handles quotes, line breaks inside cells, CRLF, CR, a missing final newline and a BOM", () => {
    assert.deepEqual(parseCsv('\uFEFFa,b\r\n"x,1","he said ""hi"""\r\n"two\nlines",z'), [
      ["a", "b"],
      ["x,1", 'he said "hi"'],
      ["two\nlines", "z"],
    ]);
    assert.deepEqual(parseCsv("a,b\rc,d\n"), [
      ["a", "b"],
      ["c", "d"],
    ]);
    assert.deepEqual(parseCsv(""), []);
    assert.deepEqual(parseCsv("a,,\n"), [["a", "", ""]]);
  });
  it("reads a semicolon-separated file and takes the formula guard off", () => {
    assert.deepEqual(parseCsv("a;b\n'=1+1;'-5;'plain;x"), [
      ["a", "b"],
      ["=1+1", "-5", "'plain", "x"],
    ]);
  });
});

describe("levels sort by seniority", () => {
  it("ranks a typical ladder and puts unknown levels after it", () => {
    assert.ok(levelRank("Analyst") < levelRank("Consultant"));
    assert.ok(levelRank("Senior Consultant 2") < levelRank("Manager"));
    assert.equal(levelRank("Senior Consultant 2"), levelRank("Senior Consultant"));
    assert.ok(levelRank("Partner") < levelRank("Wizard"));
    assert.ok(compareLevels("Senior Manager", "Manager") > 0);
    assert.ok(compareLevels("Wizard 2", "Wizard 10") < 0);
  });
  it("sorts the Directory and the filter menu by seniority", () => {
    const people = [
      "Manager",
      "Analyst",
      "Senior Manager",
      "Consultant",
      "Senior Consultant",
      "",
    ].map((level, i) => make(i, { level, firstName: `P${i}` }));
    assert.deepEqual(
      sortEmployees(people, "level").map((p) => p.level),
      ["Analyst", "Consultant", "Senior Consultant", "Manager", "Senior Manager", ""],
    );
    assert.deepEqual(
      sortEmployees(people, "level", "desc").map((p) => p.level),
      ["Senior Manager", "Manager", "Senior Consultant", "Consultant", "Analyst", ""],
    );
    assert.deepEqual(distinctValues(people, "level"), [
      "Analyst",
      "Consultant",
      "Senior Consultant",
      "Manager",
      "Senior Manager",
    ]);
  });
});
