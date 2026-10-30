// Run with `pnpm test`. Choosing an exported workbook for the Tasks app.
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  MAX_BYTES,
  cleanExtensions,
  isSafeName,
  newestMatching,
} = require("./export-picker.cjs");

const file = (name, mtimeMs, size = 100) => ({ name, mtimeMs, size, isFile: true });

describe("isSafeName", () => {
  it("accepts a plain workbook name", () => {
    assert.equal(isSafeName("incident (19).xlsx", [".xlsx"]), true);
    assert.equal(isSafeName("INCIDENT.XLSX", [".xlsx"]), true);
  });
  it("refuses paths, lock files, hidden files and other types", () => {
    for (const name of [
      "..\\x.xlsx",
      "a/b.xlsx",
      "~$incident.xlsx",
      ".hidden.xlsx",
      "x.exe",
      "",
      "x",
    ]) {
      assert.equal(isSafeName(name, [".xlsx"]), false, name);
    }
    assert.equal(isSafeName("x.xlsx", []), false);
    assert.equal(isSafeName(42, [".xlsx"]), false);
  });
});

describe("cleanExtensions", () => {
  it("keeps only dotted alphanumeric extensions", () => {
    assert.deepEqual(cleanExtensions([".XLSX", "xlsx", ".a/b", 3]), [".xlsx"]);
    assert.deepEqual(cleanExtensions("nope"), []);
  });
});

describe("newestMatching", () => {
  it("returns the most recently changed workbook", () => {
    const got = newestMatching(
      [
        file("incident (18).xlsx", 100),
        file("incident (19).xlsx", 300),
        file("notes.docx", 900),
      ],
      { extensions: [".xlsx"] },
    );
    assert.equal(got.name, "incident (19).xlsx");
  });
  it("honours the name prefix, skips lock files, folders and huge files", () => {
    const entries = [
      file("incident (1).xlsx", 100),
      file("roster.xlsx", 500),
      file("~$incident (2).xlsx", 800),
      { name: "incident-dir.xlsx", mtimeMs: 900, size: 1, isFile: false },
      file("incident big.xlsx", 700, MAX_BYTES + 1),
    ];
    assert.equal(
      newestMatching(entries, { extensions: [".xlsx"], prefix: "Incident" }).name,
      "incident (1).xlsx",
    );
  });
  it("returns null when nothing matches", () => {
    assert.equal(newestMatching([file("a.txt", 1)], { extensions: [".xlsx"] }), null);
    assert.equal(newestMatching([], {}), null);
  });
});
