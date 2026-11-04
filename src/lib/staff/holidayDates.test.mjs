// Run with `pnpm test`. The holiday days of one location, worked out from the Staff
// roster's holiday events (the input of holiday-aware due dates, roadmap q-18).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HOLIDAY_WINDOW_DAYS,
  NO_HOLIDAYS,
  holidayDatesFor,
  sanitizeHolidayLocation,
} from "./holidayDates.ts";

let id = 0;
const holiday = (date, label, locations, endDate = date) => ({
  id: `ev${++id}`,
  date,
  endDate,
  label,
  kind: "holiday",
  ...(locations ? { locations } : {}),
});

const FROM = "2026-11-05";

describe("holidayDatesFor", () => {
  it("gives the days of holidays that apply at the location", () => {
    const events = [
      holiday("2026-12-25", "Christmas Day", ["Pune", "Hyderabad"]),
      holiday("2026-11-19", "Local day", ["Mumbai"]),
    ];
    assert.deepEqual([...holidayDatesFor(events, "Pune", FROM)], ["2026-12-25"]);
    assert.deepEqual([...holidayDatesFor(events, "Mumbai", FROM)], ["2026-11-19"]);
  });

  it("with no location there are no holidays, even for 'every location' ones", () => {
    const events = [holiday("2026-12-25", "Christmas Day")];
    assert.equal(holidayDatesFor(events, "", FROM), NO_HOLIDAYS);
    assert.equal(holidayDatesFor(events, "   ", FROM), NO_HOLIDAYS);
    assert.equal(NO_HOLIDAYS.size, 0);
  });

  it("a holiday that lists no places applies to a person who has a location", () => {
    const events = [holiday("2026-12-25", "Christmas Day", [])];
    assert.deepEqual([...holidayDatesFor(events, "Pune", FROM)], ["2026-12-25"]);
  });

  it("a location with no holidays gives the shared empty set", () => {
    const events = [holiday("2026-12-25", "Christmas Day", ["Pune"])];
    assert.equal(holidayDatesFor(events, "Kolkata", FROM), NO_HOLIDAYS);
    assert.equal(holidayDatesFor([], "Pune", FROM), NO_HOLIDAYS);
    assert.equal(holidayDatesFor(undefined, "Pune", FROM), NO_HOLIDAYS);
  });

  it("matches the way the roster does: aliases and case", () => {
    const events = [holiday("2026-12-25", "Christmas Day", ["Bengaluru"])];
    assert.equal(holidayDatesFor(events, "Bangalore", FROM).size, 1);
    assert.equal(holidayDatesFor(events, " bengaluru ", FROM).size, 1);
    assert.equal(holidayDatesFor(events, "BLR", FROM).size, 0); // abbreviations are not names
  });

  it("only holidays count, not swaps or notes", () => {
    const events = [
      { ...holiday("2026-12-01", "Swap day", ["Pune"]), kind: "swap" },
      { ...holiday("2026-12-02", "Winter disconnect", ["Pune"]), kind: "note" },
    ];
    assert.equal(holidayDatesFor(events, "Pune", FROM), NO_HOLIDAYS);
  });

  it("a holiday that runs over several days gives every day, weekend included", () => {
    // Fri 25 Dec to Mon 28 Dec 2026.
    const events = [holiday("2026-12-25", "Christmas break", ["Pune"], "2026-12-28")];
    assert.deepEqual([...holidayDatesFor(events, "Pune", FROM)].sort(), [
      "2026-12-25",
      "2026-12-26",
      "2026-12-27",
      "2026-12-28",
    ]);
  });

  it("a run that started before the window counts only from the first day of it", () => {
    const events = [holiday("2026-11-02", "Long break", ["Pune"], "2026-11-06")];
    assert.deepEqual([...holidayDatesFor(events, "Pune", FROM)].sort(), [
      "2026-11-05",
      "2026-11-06",
    ]);
  });

  it("ignores days before today and beyond the window (about 400 days)", () => {
    const events = [
      holiday("2026-11-04", "Yesterday", ["Pune"]),
      holiday("2026-11-05", "Today", ["Pune"]),
      holiday("2027-12-09", "Last day of the window", ["Pune"]),
      holiday("2027-12-10", "Too far", ["Pune"]),
    ];
    assert.equal(HOLIDAY_WINDOW_DAYS, 400);
    // 2026-11-05 + 399 days = 2027-12-09.
    assert.deepEqual([...holidayDatesFor(events, "Pune", FROM)].sort(), [
      "2026-11-05",
      "2027-12-09",
    ]);
  });

  it("covers a year end and a leap day", () => {
    const events = [
      holiday("2026-12-31", "New Year's Eve", ["Pune"]),
      holiday("2027-01-01", "New Year", ["Pune"]),
      holiday("2028-02-29", "Leap day", ["Pune"]),
    ];
    const set = holidayDatesFor(events, "Pune", "2026-12-30", 800);
    assert.deepEqual([...set].sort(), ["2026-12-31", "2027-01-01", "2028-02-29"]);
    // The same run written as one event over the year end.
    const run = [holiday("2026-12-31", "Shutdown", ["Pune"], "2027-01-02")];
    assert.deepEqual([...holidayDatesFor(run, "Pune", FROM)].sort(), [
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
  });

  it("skips damaged events instead of throwing", () => {
    const events = [
      holiday("not-a-date", "Bad", ["Pune"]),
      holiday("2026-02-30", "Not a day", ["Pune"]),
      holiday("2026-12-25", "Reversed", ["Pune"], "2026-12-20"),
      holiday("2026-12-26", "Endless", ["Pune"], "2099-01-01"),
    ];
    const set = holidayDatesFor(events, "Pune", FROM);
    assert.ok(set.has("2026-12-25")); // an end before the start is read as one day
    assert.ok(set.has("2026-12-26"));
    assert.ok(set.size <= 63); // capped, not years long
  });

  it("returns nothing for a bad start day or a zero-day window", () => {
    const events = [holiday("2026-12-25", "Christmas Day", ["Pune"])];
    assert.equal(holidayDatesFor(events, "Pune", "tomorrow"), NO_HOLIDAYS);
    assert.equal(holidayDatesFor(events, "Pune", FROM, 0), NO_HOLIDAYS);
  });
});

describe("sanitizeHolidayLocation", () => {
  it("defaults to empty for anything that is not text", () => {
    for (const bad of [undefined, null, 5, {}, [], true]) {
      assert.equal(sanitizeHolidayLocation(bad), "");
    }
  });

  it("trims, collapses spaces, strips control characters and writes aliases the roster's way", () => {
    assert.equal(sanitizeHolidayLocation("  Pune  "), "Pune");
    assert.equal(sanitizeHolidayLocation("New\u0000   Town"), "New Town");
    assert.equal(sanitizeHolidayLocation("Bangalore"), "Bengaluru");
    assert.equal(sanitizeHolidayLocation("united states"), "US");
    assert.equal(sanitizeHolidayLocation("Lisbon"), "Lisbon"); // unknown places are kept as typed
  });

  it("caps the length", () => {
    assert.equal(sanitizeHolidayLocation("x".repeat(500)).length, 60);
  });
});
