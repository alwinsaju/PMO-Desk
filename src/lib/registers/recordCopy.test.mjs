import assert from "node:assert/strict";
import test from "node:test";
import { prepStart, recordAlert } from "./alerts.ts";
import { registerById } from "./defs.ts";
import { duplicateValues } from "./duplicate.ts";
import { recordText } from "./recordText.ts";
import { sanitizeRecord } from "./records.ts";

const raid = registerById("raid");
const governance = registerById("governance");
const record = {
  id: "rg_abcdef012345",
  createdAt: "2026-10-01T09:00:00.000Z",
  updatedAt: "2026-10-20T09:00:00.000Z",
  todoId: "td_0123456789abcdef",
  values: {
    kind: "Risk",
    title: "Vendor delivery slips",
    project: "Atlas",
    description: "Line one\nLine two",
    owner: "Priya Shah",
    status: "Open",
    impact: "High",
    likelihood: "Medium",
    raisedOn: "2026-10-01",
    dueDate: "2026-11-01",
    mitigation: "",
  },
};

test("duplicateValues: copies field values only and marks the title", () => {
  const copy = duplicateValues(raid, record);
  assert.equal(copy.title, "Vendor delivery slips (copy)");
  assert.equal(copy.owner, "Priya Shah");
  assert.equal(copy.dueDate, "2026-11-01");
  for (const key of ["id", "createdAt", "updatedAt", "todoId"]) {
    assert.equal(key in copy, false, `${key} must not be copied`);
  }
  assert.equal(record.values.title, "Vendor delivery slips");
});

test("duplicateValues: never carries a todoId into the saved copy", () => {
  const input = { values: duplicateValues(raid, record) };
  const saved = sanitizeRecord(raid, input, "2026-11-04T00:00:00.000Z");
  assert.equal(saved.ok, true);
  assert.equal(saved.record.todoId, undefined);
  assert.notEqual(saved.record.id, record.id);
  assert.equal(saved.record.createdAt, "2026-11-04T00:00:00.000Z");
});

test("duplicateValues: a copied governance event still alerts to start prep", () => {
  const event = {
    id: "rg_000000000001",
    createdAt: "",
    updatedAt: "",
    values: {
      title: "Steering committee",
      date: "2026-11-20",
      prepDays: 30,
      status: "Planned",
    },
    todoId: "td_0123456789abcdef",
  };
  const ctx = { today: "2026-11-04", config: {} };
  assert.ok(prepStart(event) <= ctx.today);
  assert.notEqual(recordAlert(governance, event, ctx)?.text, "Time to start prep");
  const copy = {
    id: "rg_000000000099",
    createdAt: "",
    updatedAt: "",
    values: duplicateValues(governance, event),
  };
  assert.equal(recordAlert(governance, copy, ctx)?.text, "Time to start prep");
});

test("duplicateValues: long titles stay within the text limit; minutes count resets", () => {
  const long = duplicateValues(raid, { values: { title: "x".repeat(200) } });
  assert.equal(long.title.length, 200);
  assert.ok(long.title.endsWith(" (copy)"));
  const minutes = registerById("minutes");
  const copy = duplicateValues(minutes, {
    values: { title: "Weekly", date: "2026-11-03", actions: 4, notes: "n" },
  });
  assert.equal(copy.actions, 0);
  assert.equal(copy.notes, "n");
});

test("duplicateValues: array values are cloned, not shared", () => {
  const def = {
    ...raid,
    fields: [...raid.fields, { key: "tags", label: "Tags", type: "tags" }],
  };
  const source = { values: { title: "T", tags: ["a", "b"] } };
  const copy = duplicateValues(def, source);
  copy.tags.push("c");
  assert.deepEqual(source.values.tags, ["a", "b"]);
});

test("recordText: heading, labelled lines, dates spelled out, blanks left out", () => {
  const { subject, text } = recordText(raid, record, "Late by 3 days");
  assert.equal(subject, "RAID log: Vendor delivery slips");
  const lines = text.split("\n");
  assert.equal(lines[0], "RAID log: Vendor delivery slips");
  assert.ok(lines.includes("Type: Risk"));
  assert.ok(lines.includes("Owner: Priya Shah"));
  assert.ok(lines.includes("Review or resolve by: 1 Nov 2026"));
  assert.ok(lines.includes("Description:"));
  assert.ok(lines.includes("  Line one"));
  assert.ok(lines.includes("  Line two"));
  assert.ok(!text.includes("Mitigation"), "an empty field is left out");
  assert.ok(!lines.includes("Title: Vendor delivery slips"), "the title is the heading");
  assert.equal(lines.at(-1), "Needs attention: Late by 3 days");
});

test("recordText: no attention line without an alert; untitled record", () => {
  const { text } = recordText(raid, { ...record, values: { kind: "Issue" } });
  assert.ok(text.startsWith("RAID log: (untitled)"));
  assert.ok(!text.includes("Needs attention"));
});

test("duplicateValues: the raised-on date is reset to today, other dates stay", () => {
  const copy = duplicateValues(raid, record, "2026-11-05");
  assert.equal(copy.raisedOn, "2026-11-05");
  assert.equal(copy.dueDate, "2026-11-01");
  assert.equal(record.values.raisedOn, "2026-10-01", "the original is not changed");
  // The copy is not already "Open 35 days" (the original, with no review date, is).
  const ctx = { today: "2026-11-05", config: {} };
  const noReview = (values) => ({ values: { ...values, dueDate: "" } });
  assert.equal(recordAlert(raid, noReview(record.values), ctx)?.text, "Open 35 days");
  assert.equal(recordAlert(raid, noReview(copy), ctx), null);
});

test("duplicateValues: SLA received and lesson date reset; due, target and meeting dates do not", () => {
  const sla = registerById("sla");
  const slaCopy = duplicateValues(
    sla,
    { values: { title: "T", received: "2026-10-01", resolvedOn: "2026-10-03" } },
    "2026-11-05",
  );
  assert.equal(slaCopy.received, "2026-11-05");
  assert.equal(slaCopy.resolvedOn, "2026-10-03");
  const lessons = registerById("lessons");
  assert.equal(
    duplicateValues(
      lessons,
      { values: { project: "P", date: "2026-01-02" } },
      "2026-11-05",
    ).date,
    "2026-11-05",
  );
  const changes = registerById("changes");
  assert.equal(
    duplicateValues(
      changes,
      { values: { title: "C", targetDate: "2026-12-01" } },
      "2026-11-05",
    ).targetDate,
    "2026-12-01",
  );
  const minutes = registerById("minutes");
  assert.equal(
    duplicateValues(minutes, { values: { title: "M", date: "2026-10-10" } }, "2026-11-05")
      .date,
    "2026-10-10",
  );
});

test("duplicateValues: without a today it uses the machine's local date", () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const local = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const copy = duplicateValues(raid, record);
  assert.equal(copy.raisedOn, local);
});
