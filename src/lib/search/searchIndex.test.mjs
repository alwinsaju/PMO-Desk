// Run with `pnpm test`. The global search ranking and the item builders.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEmployee } from "../staff/employees.ts";
import { createTimeOff } from "../staff/timeoff.ts";
import {
  appItems,
  noteItems,
  personItems,
  searchItems,
  templateItems,
  timeOffItems,
  todoItems,
} from "./searchIndex.ts";

const NOW = "2026-10-30T04:30:00.000Z";
const ana = createEmployee(
  {
    id: "emp_000000000001",
    firstName: "Ana",
    lastName: "Rao",
    deloitteEmail: "ana@x.com",
    offering: "Cyber",
  },
  NOW,
);
const todos = [
  {
    id: "t1",
    title: "Release plan v2",
    description: "Check the rollback section",
    status: "open",
    dueAt: "2026-11-05",
    waitingOn: null,
    tags: ["launch"],
    owner: { name: "Ana" },
  },
  {
    id: "t2",
    title: "Vendor invoice",
    description: "",
    status: "open",
    dueAt: null,
    waitingOn: "Sam",
    tags: [],
    owner: { name: null },
  },
];
const items = [
  ...appItems([
    { id: "tasks", title: "Tasks" },
    { id: "notes", title: "Notes" },
  ]),
  ...todoItems(todos),
  ...noteItems([{ id: "n1", title: "Release notes", content: "ship on Friday" }]),
  ...templateItems([
    { id: "tpl_1", name: "Chaser", kind: "email", subject: "Following up", body: "Hi" },
  ]),
  ...personItems([ana]),
  ...timeOffItems(
    [
      createTimeOff(
        {
          employeeId: ana.id,
          startDate: "2026-11-02",
          endDate: "2026-11-03",
          status: "approved",
        },
        NOW,
      ),
    ],
    [ana],
  ),
];
const titles = (query, limit) => searchItems(items, query, limit).map((i) => i.title);

describe("searchItems", () => {
  it("lists the apps before anything is typed", () => {
    assert.deepEqual(titles(""), ["Tasks", "Notes"]);
  });

  it("matches every word, across titles and the text behind them", () => {
    assert.deepEqual(titles("release plan"), ["Release plan v2"]);
    assert.ok(
      titles("rollback").includes("Release plan v2"),
      "matched through the description",
    );
    assert.deepEqual(titles("release zzz"), []);
  });

  it("ranks a title start above a word inside the text, and finds people and time off", () => {
    const found = titles("release");
    assert.equal(found[0], "Release plan v2");
    assert.ok(found.includes("Release notes"));
    assert.ok(titles("ana").some((t) => t === "Ana Rao"));
    assert.ok(titles("ana pto").some((t) => t.startsWith("Ana Rao: PTO")));
  });

  it("returns where each result goes and respects the limit", () => {
    const todo = searchItems(items, "vendor")[0];
    assert.deepEqual(todo.target, { app: "pmo-todo", todoId: "t2" });
    assert.match(todo.subtitle, /waiting on Sam/);
    assert.equal(searchItems(items, "e", 2).length, 2);
  });

  it("ignores case and punctuation", () => {
    assert.deepEqual(titles("  RELEASE-plan!! "), ["Release plan v2"]);
  });
});

describe("noteItems", () => {
  it("points a note result at that note", () => {
    const note = searchItems(items, "release notes").find((i) => i.kind === "note");
    assert.deepEqual(note.target, { app: "notes", noteId: "n1" });
    assert.equal(note.id, "note:n1");
  });

  it("keeps the note id for a note with no title", () => {
    const [untitled] = noteItems([{ id: "n9", title: "", content: "" }]);
    assert.equal(untitled.title, "Untitled note");
    assert.deepEqual(untitled.target, { app: "notes", noteId: "n9" });
  });
});
