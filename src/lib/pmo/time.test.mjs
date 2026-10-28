// Run with `pnpm test`. One validated time-zone source: safeTimeZone, and every
// "today" helper reads the configured zone instead of a hard-coded IST.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeDue, localParts, snoozeUntil, zonedInstant } from "./due.ts";
import {
  DEFAULT_TIME_ZONE,
  istDate,
  istDayLabels,
  istStamp,
  safeTimeZone,
} from "./time.ts";
import { defaultReminderPrefs } from "./types.ts";

const NY = "America/New_York";

describe("safeTimeZone", () => {
  it("keeps a valid IANA zone", () => {
    assert.equal(safeTimeZone(NY), NY);
    assert.equal(safeTimeZone("UTC"), "UTC");
  });

  it("falls back to the default for blank, undefined and unknown names", () => {
    assert.equal(DEFAULT_TIME_ZONE, "Asia/Kolkata");
    for (const bad of ["", "   ", undefined, "Mars/Olympus", "not a zone", 42])
      assert.equal(safeTimeZone(bad), DEFAULT_TIME_ZONE, String(bad));
  });
});

describe("istDate and friends read the configured zone", () => {
  it("defaults to IST", () => {
    assert.equal(istDate("2026-10-22T20:00:00Z"), "2026-10-23");
  });

  it("New York: 02:00 UTC on the 26th is still the 25th there, already the 26th in IST", () => {
    const instant = "2026-10-26T02:00:00Z";
    assert.equal(istDate(instant, NY), "2026-10-25");
    assert.equal(istDate(instant), "2026-10-26");
  });

  it("an invalid zone never throws and means the default", () => {
    assert.equal(istDate("2026-10-26T02:00:00Z", "Mars/Olympus"), "2026-10-26");
    assert.ok(istStamp("2026-10-26T02:00:00Z", "Mars/Olympus").includes("IST"));
    assert.equal(istDayLabels("2026-10-26T02:00:00Z", 1, "").received, "Mon 2026-10-26");
  });

  it("DST end (New York, 2026-11-01): the day boundary follows the wall clock", () => {
    assert.equal(istDate("2026-11-01T04:30:00Z", NY), "2026-11-01"); // 00:30 EDT
    assert.equal(istDate("2026-11-02T04:59:00Z", NY), "2026-11-01"); // 23:59 EST
    assert.equal(istDate("2026-11-02T05:00:00Z", NY), "2026-11-02"); // 00:00 EST
  });

  it("labels and stamp use the zone", () => {
    const labels = istDayLabels("2026-10-26T02:00:00Z", 2, NY);
    assert.equal(labels.received, "Sun 2026-10-25");
    assert.deepEqual(labels.upcoming, ["Mon 2026-10-26", "Tue 2026-10-27"]);
    assert.match(
      istStamp("2026-10-26T02:00:00Z", NY),
      /^2026-10-25T22:00 America\/New_York \(Sunday,? 25 October 2026\)$/,
    );
  });
});

describe("the reminder engine survives a bad zone", () => {
  it("localParts, zonedInstant, snoozeUntil and computeDue fall back instead of throwing", () => {
    const now = new Date("2026-10-26T05:00:00Z"); // Mon 10:30 IST
    assert.equal(localParts(now, "Mars/Olympus").day, "2026-10-26");
    assert.equal(
      zonedInstant("2026-10-26", "09:00", "Mars/Olympus").toISOString(),
      "2026-10-26T03:30:00.000Z",
    );
    assert.doesNotThrow(() =>
      snoozeUntil("tomorrow", now, { timeZone: "Mars/Olympus", workStart: "09:00" }),
    );
    const prefs = { ...defaultReminderPrefs(), timeZone: "Mars/Olympus" };
    assert.doesNotThrow(() => computeDue([], now, prefs));
  });
});
