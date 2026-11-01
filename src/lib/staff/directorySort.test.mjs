import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createEmployee,
  defaultSortDir,
  sortEmployees,
  toggleSort,
} from "./employees.ts";

const make = (first, over = {}) =>
  createEmployee(
    { deloitteEmail: `${first.toLowerCase()}@x.com`, firstName: first, ...over },
    "2026-03-02T10:00:00.000Z",
  );
const names = (list) => list.map((e) => e.firstName);

describe("directory sorting", () => {
  const list = [
    make("Cy", { level: "Senior 10", team: "B", location: "Onshore" }),
    make("Al", { level: "Senior 2", team: "A", location: "Offshore" }),
    make("Bo", { level: "", team: "", location: "" }),
    make("Di", { level: "Analyst", team: "C", location: "Onshore" }),
  ];

  it("sorts ascending by default and descending when asked", () => {
    assert.deepEqual(names(sortEmployees(list, "name")), ["Al", "Bo", "Cy", "Di"]);
    assert.deepEqual(names(sortEmployees(list, "name", "desc")), [
      "Di",
      "Cy",
      "Bo",
      "Al",
    ]);
  });

  it("orders numbers inside text naturally", () => {
    assert.deepEqual(names(sortEmployees(list, "level")), ["Di", "Al", "Cy", "Bo"]);
  });

  it("keeps people with an empty value last in both directions", () => {
    assert.equal(names(sortEmployees(list, "team", "asc")).at(-1), "Bo");
    assert.equal(names(sortEmployees(list, "team", "desc")).at(-1), "Bo");
    assert.deepEqual(names(sortEmployees(list, "team", "desc")), [
      "Di",
      "Cy",
      "Al",
      "Bo",
    ]);
  });

  it("breaks ties by name whatever the direction", () => {
    assert.deepEqual(names(sortEmployees(list, "location")), ["Al", "Cy", "Di", "Bo"]);
    assert.deepEqual(names(sortEmployees(list, "location", "desc")), [
      "Cy",
      "Di",
      "Al",
      "Bo",
    ]);
  });

  it("lists the newest first for 'recent' unless flipped", () => {
    const a = make("Old", { createdAt: "2026-01-01" });
    const b = make("New", { createdAt: "2026-02-01" });
    assert.equal(defaultSortDir("recent"), "desc");
    assert.deepEqual(names(sortEmployees([a, b], "recent")), ["New", "Old"]);
    assert.deepEqual(names(sortEmployees([a, b], "recent", "asc")), ["Old", "New"]);
  });

  it("does not change the list it is given", () => {
    const before = names(list);
    sortEmployees(list, "team", "desc");
    assert.deepEqual(names(list), before);
  });
});

describe("toggleSort", () => {
  it("flips the direction of the sorted column", () => {
    assert.deepEqual(toggleSort({ key: "name", dir: "asc" }, "name"), {
      key: "name",
      dir: "desc",
    });
    assert.deepEqual(toggleSort({ key: "name", dir: "desc" }, "name"), {
      key: "name",
      dir: "asc",
    });
  });
  it("starts another column in its own direction", () => {
    assert.deepEqual(toggleSort({ key: "name", dir: "desc" }, "team"), {
      key: "team",
      dir: "asc",
    });
    assert.deepEqual(toggleSort({ key: "name", dir: "asc" }, "recent"), {
      key: "recent",
      dir: "desc",
    });
  });
});
