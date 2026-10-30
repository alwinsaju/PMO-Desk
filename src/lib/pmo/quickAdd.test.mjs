// Run with `pnpm test`. Quick-add: a title with an optional day at the end.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_QUICK_ADD_LENGTH, parseQuickAdd } from "./quickAdd.ts";

const TODAY = "2026-10-30"; // a Friday
const parse = (text) => parseQuickAdd(text, TODAY);

describe("parseQuickAdd", () => {
  it("reads a day at the end as the due date", () => {
    assert.deepEqual(parse("Send deck to Priya Fri"), {
      title: "Send deck to Priya",
      dueAt: "2026-10-30",
    });
    assert.deepEqual(parse("Chase invoice tomorrow"), {
      title: "Chase invoice",
      dueAt: "2026-10-31",
    });
    assert.deepEqual(parse("Book room next Monday"), {
      title: "Book room",
      dueAt: "2026-11-02",
    });
    assert.deepEqual(parse("Submit timesheet 5 Nov"), {
      title: "Submit timesheet",
      dueAt: "2026-11-05",
    });
  });

  it("takes the connector word with the date", () => {
    assert.deepEqual(parse("Send the report by Monday"), {
      title: "Send the report",
      dueAt: "2026-11-02",
    });
    assert.deepEqual(parse("Review plan due on tomorrow"), {
      title: "Review plan",
      dueAt: "2026-10-31",
    });
  });

  it("trims trailing punctuation around the date", () => {
    assert.deepEqual(parse("Call Sam, tomorrow."), {
      title: "Call Sam",
      dueAt: "2026-10-31",
    });
  });

  it("leaves the text as the title when there is no day", () => {
    assert.deepEqual(parse("Send deck to Priya"), {
      title: "Send deck to Priya",
      dueAt: null,
    });
  });

  it("does not treat a period or a bare date as the whole to-do", () => {
    assert.deepEqual(parse("tomorrow"), { title: "tomorrow", dueAt: null });
    assert.deepEqual(parse("Plan for this week"), {
      title: "Plan for this week",
      dueAt: null,
    });
  });

  it("returns nothing for empty input and caps a very long one", () => {
    assert.equal(parse("   "), null);
    const long = parse(`${"word ".repeat(100)}Friday`);
    assert.ok(long.title.length <= MAX_QUICK_ADD_LENGTH);
  });
});
