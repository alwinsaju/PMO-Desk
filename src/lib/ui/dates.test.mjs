import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  daysUntil,
  dueUrgency,
  formatDate,
  formatDateTime,
  formatDue,
  parseDate,
} from "./dates.ts";

// Local time on purpose: the helpers compare calendar days the user sees.
const NOW = new Date(2026, 9, 30, 15, 30); // 30 Oct 2026, 15:30

describe("parseDate", () => {
  it("reads a date-only string as a local calendar day", () => {
    const d = parseDate("2026-10-30");
    assert.equal(d?.getFullYear(), 2026);
    assert.equal(d?.getMonth(), 9);
    assert.equal(d?.getDate(), 30);
    assert.equal(d?.getHours(), 0);
  });

  it("accepts Date, timestamp and ISO date-time input", () => {
    assert.equal(parseDate(NOW)?.getTime(), NOW.getTime());
    assert.equal(parseDate(NOW.getTime())?.getTime(), NOW.getTime());
    assert.equal(parseDate(NOW.toISOString())?.getTime(), NOW.getTime());
  });

  it("returns null for empty or invalid input", () => {
    assert.equal(parseDate(null), null);
    assert.equal(parseDate(undefined), null);
    assert.equal(parseDate(""), null);
    assert.equal(parseDate("soon"), null);
    assert.equal(parseDate("2026-02-31"), null);
    assert.equal(parseDate(new Date("nope")), null);
  });
});

describe("formatDate / formatDateTime", () => {
  it('uses one format: "30 Oct 2026"', () => {
    assert.equal(formatDate("2026-10-30"), "30 Oct 2026");
    assert.equal(formatDate(new Date(2026, 0, 5)), "5 Jan 2026");
    assert.equal(formatDate(new Date(2026, 11, 31, 23, 59)), "31 Dec 2026");
  });

  it("falls back for missing or invalid values", () => {
    assert.equal(formatDate(null), "");
    assert.equal(formatDate("nope", "No date"), "No date");
  });

  it("adds a 24-hour time", () => {
    assert.equal(formatDateTime(new Date(2026, 9, 30, 9, 5)), "30 Oct 2026, 09:05");
    assert.equal(formatDateTime("x", "-"), "-");
  });
});

describe("daysUntil", () => {
  it("counts calendar days regardless of the time of day", () => {
    assert.equal(daysUntil("2026-10-30", NOW), 0);
    assert.equal(daysUntil("2026-10-31", NOW), 1);
    assert.equal(daysUntil("2026-10-29", NOW), -1);
    assert.equal(
      daysUntil(new Date(2026, 9, 30, 0, 1), new Date(2026, 9, 30, 23, 59)),
      0,
    );
  });

  it("is not thrown off by a daylight-saving change", () => {
    assert.equal(daysUntil(new Date(2026, 10, 2), new Date(2026, 9, 25, 23, 0)), 8);
    assert.equal(daysUntil(new Date(2026, 2, 30), new Date(2026, 2, 28, 1, 0)), 2);
  });

  it("returns null without a valid date", () => {
    assert.equal(daysUntil(null, NOW), null);
    assert.equal(daysUntil("nope", NOW), null);
  });
});

describe("formatDue", () => {
  it("words the distance to a due date", () => {
    assert.equal(formatDue("2026-10-30", NOW), "Due today");
    assert.equal(formatDue("2026-10-31", NOW), "Due tomorrow");
    assert.equal(formatDue("2026-11-03", NOW), "Due in 4d");
    assert.equal(formatDue("2026-11-06", NOW), "Due in 7d");
    assert.equal(formatDue("2026-11-20", NOW), "Due 20 Nov 2026");
  });

  it("words overdue dates as days late", () => {
    assert.equal(formatDue("2026-10-29", NOW), "1d late");
    assert.equal(formatDue("2026-10-27", NOW), "3d late");
  });

  it("says so when there is no date", () => {
    assert.equal(formatDue(null, NOW), "No due date");
    assert.equal(formatDue("nope", NOW), "No due date");
  });
});

describe("dueUrgency", () => {
  it("classifies a due date against now", () => {
    assert.equal(dueUrgency("2026-10-29", NOW), "overdue");
    assert.equal(dueUrgency("2026-10-30", NOW), "today");
    assert.equal(dueUrgency("2026-10-31", NOW), "later");
    assert.equal(dueUrgency(undefined, NOW), "none");
  });
});
