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

describe("parseQuickAdd with holidays", () => {
  // TODAY is Fri 30 Oct 2026; Mon 2 Nov and Tue 3 Nov are further days.
  const withHolidays = (text, ...days) =>
    parseQuickAdd(text, TODAY, { holidays: new Set(days) });

  it("with no holidays the answer is exactly as before (nothing, or an empty set)", () => {
    for (const text of [
      "Send deck to Priya Fri",
      "Book room next Monday",
      "Chase tomorrow",
    ]) {
      assert.deepEqual(parseQuickAdd(text, TODAY, {}), parse(text));
      assert.deepEqual(parseQuickAdd(text, TODAY, { holidays: new Set() }), parse(text));
      assert.deepEqual(parseQuickAdd(text, TODAY, undefined), parse(text));
    }
    assert.equal("movedFrom" in parse("Send deck to Priya Fri"), false);
  });

  it("a day that is a holiday moves to the next working day and says which", () => {
    assert.deepEqual(withHolidays("Send deck to Priya Fri", "2026-10-30"), {
      title: "Send deck to Priya",
      dueAt: "2026-11-02",
      movedFrom: "2026-10-30",
    });
  });

  it("a holiday run over the weekend moves past all of it", () => {
    assert.deepEqual(withHolidays("Send deck to Priya Fri", "2026-10-30", "2026-11-02"), {
      title: "Send deck to Priya",
      dueAt: "2026-11-03",
      movedFrom: "2026-10-30",
    });
    assert.deepEqual(withHolidays("Book room next Monday", "2026-11-02", "2026-11-03"), {
      title: "Book room",
      dueAt: "2026-11-04",
      movedFrom: "2026-11-02",
    });
  });

  it("works for tomorrow and for a written date, and keeps the connector handling", () => {
    assert.deepEqual(withHolidays("Chase invoice tomorrow", "2026-10-31"), {
      title: "Chase invoice",
      dueAt: "2026-11-02",
      movedFrom: "2026-10-31",
    });
    assert.deepEqual(withHolidays("Submit timesheet by 5 Nov", "2026-11-05"), {
      title: "Submit timesheet",
      dueAt: "2026-11-06",
      movedFrom: "2026-11-05",
    });
  });

  it("leaves a day that is not a holiday, and a phrase with no day, alone", () => {
    assert.deepEqual(withHolidays("Send deck to Priya Fri", "2026-11-02"), {
      title: "Send deck to Priya",
      dueAt: "2026-10-30",
    });
    assert.deepEqual(withHolidays("Plan for this week", "2026-10-30"), {
      title: "Plan for this week",
      dueAt: null,
    });
  });

  it("uses the work-days list when given one", () => {
    const six = { holidays: new Set(["2026-10-30"]), workDays: [1, 2, 3, 4, 5, 6] };
    assert.equal(parseQuickAdd("Send deck Fri", TODAY, six).dueAt, "2026-10-31");
  });

  it("crosses a year end and a leap day", () => {
    assert.deepEqual(
      parseQuickAdd("Close books 31 Dec", TODAY, {
        holidays: new Set(["2026-12-31", "2027-01-01"]),
      }),
      { title: "Close books", dueAt: "2027-01-04", movedFrom: "2026-12-31" },
    );
    assert.deepEqual(
      parseQuickAdd("File return 29 Feb", "2028-02-20", {
        holidays: new Set(["2028-02-29"]),
      }),
      { title: "File return", dueAt: "2028-03-01", movedFrom: "2028-02-29" },
    );
  });
});
