// Run with `pnpm test`. Week / Month views of the PMO calendar and the priority dots.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CALENDAR_MODES,
  SHOWN_PER_DAY,
  calendarWeeks,
  dayDots,
  periodLabel,
  shiftAnchor,
  stepLabel,
} from "./calendarView.ts";

const todo = (id, dueAt, priority = "normal", status = "open") => ({
  id,
  title: id,
  dueAt,
  priority,
  status,
});

describe("calendarWeeks", () => {
  const todos = [todo("a", "2026-10-30", "high"), todo("b", "2026-11-02")];

  it("gives a whole month as weeks starting Monday", () => {
    const weeks = calendarWeeks("month", "2026-10-30", todos);
    assert.ok(weeks.length >= 5);
    assert.equal(weeks[0][0].day, "2026-09-28");
    assert.ok(weeks.every((week) => week.length === 7));
  });

  it("gives the one week that holds the anchor day, with its to-dos", () => {
    const weeks = calendarWeeks("week", "2026-10-30", todos);
    assert.equal(weeks.length, 1);
    assert.deepEqual(
      weeks[0].map((cell) => cell.day),
      [
        "2026-10-26",
        "2026-10-27",
        "2026-10-28",
        "2026-10-29",
        "2026-10-30",
        "2026-10-31",
        "2026-11-01",
      ],
    );
    assert.deepEqual(
      weeks[0].find((cell) => cell.day === "2026-10-30").todos.map((t) => t.id),
      ["a"],
    );
  });

  it("does not dim the days of the neighbouring month in a week", () => {
    const [week] = calendarWeeks("week", "2026-10-30", todos);
    assert.ok(week.every((cell) => cell.inMonth));
  });

  it("finds the week across a year boundary", () => {
    const [week] = calendarWeeks("week", "2027-01-01", []);
    assert.equal(week[0].day, "2026-12-28");
    assert.equal(week[6].day, "2027-01-03");
  });
});

describe("shiftAnchor", () => {
  it("steps a week from its Monday", () => {
    assert.equal(shiftAnchor("week", "2026-10-30", 1), "2026-11-02");
    assert.equal(shiftAnchor("week", "2026-10-30", -1), "2026-10-19");
  });
  it("steps a month to its first day, over a year end", () => {
    assert.equal(shiftAnchor("month", "2026-10-30", 1), "2026-11-01");
    assert.equal(shiftAnchor("month", "2026-12-15", 1), "2027-01-01");
    assert.equal(shiftAnchor("month", "2026-01-31", -1), "2025-12-01");
  });
});

describe("labels", () => {
  it("names the month or the week", () => {
    assert.equal(periodLabel("month", "2026-10-30"), "October 2026");
    assert.equal(periodLabel("week", "2026-10-30"), "26 Oct – 1 Nov 2026");
    assert.equal(periodLabel("week", "2026-12-30"), "28 Dec – 3 Jan 2027");
  });
  it("labels the step buttons for the mode", () => {
    assert.equal(stepLabel("week", -1), "Previous week");
    assert.equal(stepLabel("month", 1), "Next month");
  });
  it("offers Week then Month, and lists more per day in a week", () => {
    assert.deepEqual(
      CALENDAR_MODES.map((m) => m.id),
      ["week", "month"],
    );
    assert.ok(SHOWN_PER_DAY.week > SHOWN_PER_DAY.month);
  });
});

describe("dayDots", () => {
  it("orders the dots by urgency and maps priority to colour", () => {
    const { tones, more } = dayDots([
      { priority: "low" },
      { priority: "high" },
      { priority: "normal" },
    ]);
    assert.deepEqual(tones, ["red", "amber", "muted"]);
    assert.equal(more, 0);
  });
  it("caps the dots and counts the rest", () => {
    const many = Array.from({ length: 8 }, () => ({ priority: "low" }));
    const { tones, more } = dayDots(many, 5);
    assert.equal(tones.length, 5);
    assert.equal(more, 3);
  });
  it("keeps the most urgent when it has to cap", () => {
    const { tones } = dayDots(
      [...Array.from({ length: 6 }, () => ({ priority: "low" })), { priority: "high" }],
      3,
    );
    assert.equal(tones[0], "red");
  });
  it("treats an unknown priority as the quiet colour and an empty day as no dots", () => {
    assert.deepEqual(dayDots([{ priority: "whenever" }]).tones, ["muted"]);
    assert.deepEqual(dayDots([]), { tones: [], more: 0 });
  });
});
