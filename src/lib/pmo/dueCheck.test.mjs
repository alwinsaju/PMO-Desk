// Run with `pnpm test`. The deterministic due-date check against the quoted sentence.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkDueAgainstQuote, dayWords } from "./dueCheck.ts";

// Thursday 5 November 2026.
const TODAY = "2026-11-05";
const check = (quote, dueAt) => checkDueAgainstQuote(quote, dueAt, TODAY);

describe("weekday wording", () => {
  it("corrects 'by Friday' that the model put on Monday 9 Nov", () => {
    const result = check("Please chase Ana by Friday.", "2026-11-09");
    assert.equal(result.dueAt, "2026-11-06");
    assert.equal(result.changed, true);
    assert.match(result.note, /Mon 9 Nov 2026 to Fri 6 Nov 2026/);
  });

  it("leaves a correct weekday date alone", () => {
    assert.equal(check("Please send it by Monday", "2026-11-09"), null);
    assert.equal(check("done by Friday", "2026-11-06"), null);
  });

  it("'next Monday' accepts the first Monday and the one after", () => {
    assert.equal(check("Back to me next Monday", "2026-11-09"), null);
    assert.equal(check("Back to me next Monday", "2026-11-16"), null);
    assert.equal(check("Back to me next Monday", "2026-11-12").dueAt, "2026-11-09");
  });

  it("on the same weekday, today and a week on are both fair; anything else is fixed", () => {
    assert.equal(check("by Thursday", "2026-11-05"), null);
    assert.equal(check("by Thursday", "2026-11-12"), null);
    assert.equal(check("by Thursday", "2026-11-13").dueAt, "2026-11-12");
  });

  it("ignores recurring and past wording", () => {
    assert.equal(check("Every Friday please send the update", "2026-11-09"), null);
    assert.equal(check("Mondays are busy", "2026-11-12"), null);
    assert.equal(check("As discussed last Friday", "2026-11-12"), null);
  });

  it("two different days named: only flags, never picks", () => {
    const result = check("Draft by Friday, final on Monday", "2026-11-11");
    assert.equal(result.changed, false);
    assert.equal(result.dueAt, "2026-11-11");
    assert.match(result.note, /please check/);
    assert.equal(check("Draft by Friday, final on Monday", "2026-11-09"), null);
  });
});

describe("today, tomorrow, yesterday", () => {
  it("tomorrow and today override a conflicting date", () => {
    assert.equal(check("I need it tomorrow", "2026-11-09").dueAt, "2026-11-06");
    assert.equal(
      check("I need it by end of day today", "2026-11-09").dueAt,
      "2026-11-05",
    );
    assert.equal(
      check("needed the day after tomorrow", "2026-11-09").dueAt,
      "2026-11-07",
    );
  });

  it("'by yesterday' becomes yesterday, so the caller can treat it as passed", () => {
    assert.equal(check("I needed it by yesterday", "2026-11-05").dueAt, "2026-11-04");
  });

  it("'thanks for yesterday' is not a deadline", () => {
    assert.equal(check("Thanks for yesterday. Send it by Friday", "2026-11-06"), null);
    assert.equal(check("Thanks for yesterday", "2026-11-09"), null);
  });
});

describe("explicit dates", () => {
  it("reads day-first numeric dates and month names", () => {
    assert.equal(check("by 31/12/2026", "2026-12-30").dueAt, "2026-12-31");
    assert.equal(check("by 31 Dec 2026", "2026-12-30").dueAt, "2026-12-31");
    assert.equal(check("by December 31st, 2026", "2026-12-30").dueAt, "2026-12-31");
    assert.equal(check("by 2026-12-31", "2026-12-30").dueAt, "2026-12-31");
    assert.equal(check("by 31/12/2026", "2026-12-31"), null);
  });

  it("an ambiguous 03/04/2026 accepts both readings", () => {
    assert.equal(check("by 03/04/2026", "2026-04-03"), null);
    assert.equal(check("by 03/04/2026", "2026-03-04"), null);
  });

  it("a date that does not exist is ignored", () => {
    assert.equal(check("Q1 forecast by Feb 30", "2027-02-28"), null);
  });

  it("a date with no year means this year, or next if it has passed", () => {
    assert.equal(check("by 15 Dec", "2027-12-15"), null);
    assert.equal(check("by 15 Dec", "2026-12-14").dueAt, "2026-12-15");
    assert.equal(check("by 2 Jan", "2027-01-05").dueAt, "2027-01-02");
  });
});

describe("nothing to check", () => {
  it("no date, empty quote or unrecognised wording leaves the model alone", () => {
    assert.equal(check("Please send the plan", "2026-11-09"), null);
    assert.equal(check("", "2026-11-09"), null);
    assert.equal(check("by Friday", null), null);
    assert.equal(check("antes del viernes", "2026-11-06"), null);
  });

  it("dayWords is readable", () => {
    assert.equal(dayWords("2026-11-06"), "Fri 6 Nov 2026");
  });
});
