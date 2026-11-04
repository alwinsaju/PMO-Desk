// Run with `pnpm test`. Holiday-aware due dates (roadmap q-18): the optional holiday
// set of due.ts. Two promises are tested again and again: with NO holidays (nothing
// passed, or an empty set) every answer is exactly what the days-of-the-week rule
// gave before, and with holidays a day off moves things on to the next working day.
// 2026-10-26 is a Monday. Pure: no files, no network.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  advanceReminderDay,
  attentionSummary,
  computeDue,
  isWorkingDay,
  nextMondayAfter,
  rollPastHoliday,
  snoozeUntil,
  waitingState,
  workingDaysBetween,
} from "./due.ts";
import { defaultReminderPrefs } from "./types.ts";

const ist = (stamp) => new Date(`${stamp}:00+05:30`);
const prefs = (patch = {}) => ({ ...defaultReminderPrefs(), ...patch });
const days = (...list) => new Set(list);
const EMPTY = days();

let n = 0;
const todo = (patch = {}) => ({
  id: `td_${String(++n).padStart(8, "0")}`,
  title: `Fictional task ${n}`,
  description: "",
  owner: { name: "Pat Example", email: null, isMe: true },
  requester: { name: null, email: null },
  dueAt: null,
  priority: "normal",
  actionItems: [],
  checkpoints: [],
  status: "open",
  waitingOn: null,
  tags: [],
  source: {
    intakeId: null,
    source: "manual",
    link: null,
    subject: "x",
    sender: null,
    receivedAt: null,
  },
  reminders: { enabled: false, remindAt: null, snoozedUntil: null, lastRemindedAt: null },
  createdAt: "2026-10-01T04:00:00.000Z",
  approvedAt: "2026-10-01T04:00:00.000Z",
  approvedBy: "tester",
  updatedAt: "2026-10-01T04:00:00.000Z",
  completedAt: null,
  ...patch,
});

describe("isWorkingDay with holidays", () => {
  it("a holiday on a weekday is not a working day", () => {
    const h = days("2026-10-28"); // Wednesday
    assert.equal(isWorkingDay("2026-10-28", prefs(), h), false);
    assert.equal(isWorkingDay("2026-10-27", prefs(), h), true);
  });

  it("no holidays: exactly the weekday rule, whether the set is missing or empty", () => {
    for (const day of ["2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26"]) {
      const before = prefs().workDays.includes(new Date(`${day}T00:00:00Z`).getUTCDay());
      assert.equal(isWorkingDay(day, prefs()), before);
      assert.equal(isWorkingDay(day, prefs(), undefined), before);
      assert.equal(isWorkingDay(day, prefs(), EMPTY), before);
    }
  });

  it("a holiday on a weekend changes nothing", () => {
    const h = days("2026-10-24", "2026-10-25");
    assert.equal(isWorkingDay("2026-10-24", prefs(), h), false);
    assert.equal(workingDaysBetween("2026-10-23", "2026-10-26", prefs(), h), 1);
  });

  it("a holiday is off even on a day the work-days list includes", () => {
    const saturdays = prefs({ workDays: [1, 2, 3, 4, 5, 6] });
    assert.equal(isWorkingDay("2026-10-24", saturdays, days("2026-10-24")), false);
    assert.equal(isWorkingDay("2026-10-24", saturdays), true);
  });
});

describe("rollPastHoliday", () => {
  it("leaves a day alone when it is not a holiday, including a weekend day", () => {
    assert.equal(rollPastHoliday("2026-10-30", days("2026-11-02")), "2026-10-30");
    assert.equal(rollPastHoliday("2026-10-31", days("2026-11-02")), "2026-10-31"); // Sat stays Sat
    assert.equal(rollPastHoliday("2026-10-30"), "2026-10-30");
    assert.equal(rollPastHoliday("2026-10-30", EMPTY), "2026-10-30");
  });

  it("a holiday on the due day moves it to the next working day", () => {
    assert.equal(rollPastHoliday("2026-10-28", days("2026-10-28")), "2026-10-29");
  });

  it("a Friday holiday goes over the weekend to Monday", () => {
    assert.equal(rollPastHoliday("2026-10-30", days("2026-10-30")), "2026-11-02");
  });

  it("a run of holidays over a weekend is crossed in one go", () => {
    // Thu 29 and Fri 30 Oct, then Mon 2 Nov: the next working day is Tue 3 Nov.
    const run = days("2026-10-29", "2026-10-30", "2026-11-02");
    assert.equal(rollPastHoliday("2026-10-29", run), "2026-11-03");
    assert.equal(rollPastHoliday("2026-10-30", run), "2026-11-03");
    assert.equal(rollPastHoliday("2026-11-02", run), "2026-11-03");
  });

  it("a holiday that fills the weekend too (Fri to Mon) lands on Tuesday", () => {
    const run = days("2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02");
    assert.equal(rollPastHoliday("2026-10-30", run), "2026-11-03");
  });

  it("a Saturday holiday moves to Monday (the next working day)", () => {
    assert.equal(rollPastHoliday("2026-10-31", days("2026-10-31")), "2026-11-02");
  });

  it("respects the work-days list", () => {
    const monToSat = [1, 2, 3, 4, 5, 6];
    assert.equal(
      rollPastHoliday("2026-10-30", days("2026-10-30"), monToSat),
      "2026-10-31",
    );
    assert.equal(
      rollPastHoliday("2026-10-30", days("2026-10-30"), [2, 3, 4]),
      "2026-11-03",
    );
  });

  it("with no work day at all it gives the day back instead of looping", () => {
    assert.equal(rollPastHoliday("2026-10-30", days("2026-10-30"), []), "2026-10-30");
  });

  it("crosses a year end", () => {
    // Thu 31 Dec 2026 is a holiday: Fri 1 Jan 2027 is next.
    assert.equal(rollPastHoliday("2026-12-31", days("2026-12-31")), "2027-01-01");
    // 1 Jan is a holiday too: Mon 4 Jan.
    assert.equal(
      rollPastHoliday("2026-12-31", days("2026-12-31", "2027-01-01")),
      "2027-01-04",
    );
  });

  it("crosses a leap day, and the day after 28 Feb in a non-leap year", () => {
    // 2024: Thu 29 Feb is a holiday, Fri 1 Mar is next; with 1 Mar too, Mon 4 Mar.
    assert.equal(rollPastHoliday("2024-02-29", days("2024-02-29")), "2024-03-01");
    assert.equal(
      rollPastHoliday("2024-02-29", days("2024-02-29", "2024-03-01")),
      "2024-03-04",
    );
    // 2028: Mon 28 Feb holiday goes to Tue 29 Feb (a real day); 2027: Sun 28 Feb -> Mon 1 Mar.
    assert.equal(rollPastHoliday("2028-02-28", days("2028-02-28")), "2028-02-29");
    assert.equal(rollPastHoliday("2027-02-26", days("2027-02-26")), "2027-03-01");
  });
});

describe("nextMondayAfter with holidays", () => {
  it("is unchanged without holidays", () => {
    assert.equal(nextMondayAfter("2026-10-28"), "2026-11-02");
    assert.equal(nextMondayAfter("2026-10-28", EMPTY), "2026-11-02");
    assert.equal(nextMondayAfter("2026-11-02"), "2026-11-09"); // a Monday gives a week later
  });

  it("a holiday Monday gives the next working day", () => {
    assert.equal(nextMondayAfter("2026-10-28", days("2026-11-02")), "2026-11-03");
    assert.equal(
      nextMondayAfter("2026-10-28", days("2026-11-02", "2026-11-03")),
      "2026-11-04",
    );
  });

  it("a holiday on another day changes nothing", () => {
    assert.equal(nextMondayAfter("2026-10-28", days("2026-11-03")), "2026-11-02");
  });
});

describe("snooze presets with holidays", () => {
  const p = prefs();
  const friEvening = ist("2026-10-23T20:15");

  it("with no holidays the presets are exactly as before", () => {
    for (const choice of ["1h", "after-lunch", "tomorrow", "3d", "monday"]) {
      const plain = snoozeUntil(choice, friEvening, p).toISOString();
      assert.equal(snoozeUntil(choice, friEvening, p, undefined).toISOString(), plain);
      assert.equal(snoozeUntil(choice, friEvening, p, EMPTY).toISOString(), plain);
    }
    // Tomorrow on a Friday is still the Saturday: only a holiday moves it.
    assert.equal(
      snoozeUntil("tomorrow", friEvening, p, EMPTY).toISOString(),
      ist("2026-10-24T09:00").toISOString(),
    );
  });

  it("tomorrow on a holiday goes to the next working day", () => {
    // Tue 27 Oct is a holiday; asked on Monday it wakes on Wed 28 Oct.
    assert.equal(
      snoozeUntil(
        "tomorrow",
        ist("2026-10-26T10:00"),
        p,
        days("2026-10-27"),
      ).toISOString(),
      ist("2026-10-28T09:00").toISOString(),
    );
  });

  it("tomorrow on a holiday Friday goes over the weekend to Monday", () => {
    assert.equal(
      snoozeUntil(
        "tomorrow",
        ist("2026-10-29T10:00"),
        p,
        days("2026-10-30"),
      ).toISOString(),
      ist("2026-11-02T09:00").toISOString(),
    );
  });

  it("tomorrow in a holiday run over a weekend", () => {
    const run = days("2026-10-30", "2026-11-02");
    assert.equal(
      snoozeUntil("tomorrow", ist("2026-10-29T10:00"), p, run).toISOString(),
      ist("2026-11-03T09:00").toISOString(),
    );
  });

  it("next Monday on a holiday goes to the next working day", () => {
    assert.equal(
      snoozeUntil("monday", friEvening, p, days("2026-10-26")).toISOString(),
      ist("2026-10-27T09:00").toISOString(),
    );
  });

  it("In 3 days is calendar based and never skips a holiday", () => {
    // Wed 21 Oct + 3 = Sat 24 Oct; make a weekday holiday too: Thu 22 Oct + 3 = Sun.
    const h = days("2026-10-24", "2026-10-25", "2026-10-26", "2026-10-23");
    assert.equal(
      snoozeUntil("3d", ist("2026-10-21T10:00"), p, h).toISOString(),
      ist("2026-10-24T09:00").toISOString(),
    );
    assert.equal(
      snoozeUntil("3d", ist("2026-10-23T20:15"), p, h).toISOString(),
      ist("2026-10-26T09:00").toISOString(), // Monday 26 is a holiday and still the answer
    );
  });

  it("one hour never moves", () => {
    assert.equal(
      snoozeUntil("1h", friEvening, p, days("2026-10-23")).toISOString(),
      ist("2026-10-23T21:15").toISOString(),
    );
  });

  it("after lunch, once 14:00 has passed, wakes on the next morning that is not a holiday", () => {
    assert.equal(
      snoozeUntil(
        "after-lunch",
        ist("2026-10-26T15:00"),
        p,
        days("2026-10-27"),
      ).toISOString(),
      ist("2026-10-28T09:00").toISOString(),
    );
    // Before 14:00 it is still today, holiday or not.
    assert.equal(
      snoozeUntil(
        "after-lunch",
        ist("2026-10-26T11:00"),
        p,
        days("2026-10-26"),
      ).toISOString(),
      ist("2026-10-26T14:00").toISOString(),
    );
  });

  it("reads the day in the zone: 01:30 IST Friday still has tomorrow as Saturday", () => {
    const lateThursdayUtc = new Date("2026-10-22T20:00:00Z"); // Fri 01:30 IST
    assert.equal(
      snoozeUntil("tomorrow", lateThursdayUtc, p, days("2026-10-24")).toISOString(),
      ist("2026-10-26T09:00").toISOString(),
    );
    assert.equal(
      snoozeUntil("tomorrow", lateThursdayUtc, p, days("2026-10-23")).toISOString(),
      ist("2026-10-24T09:00").toISOString(), // Friday is today in IST, not tomorrow
    );
  });

  it("uses the work-days list given in the prefs", () => {
    const sixDays = prefs({ workDays: [1, 2, 3, 4, 5, 6] });
    assert.equal(
      snoozeUntil(
        "tomorrow",
        ist("2026-10-29T10:00"),
        sixDays,
        days("2026-10-30"),
      ).toISOString(),
      ist("2026-10-31T09:00").toISOString(), // Saturday is a working day for this person
    );
  });

  it("crosses a year end and a leap day", () => {
    assert.equal(
      snoozeUntil(
        "tomorrow",
        ist("2026-12-30T10:00"),
        p,
        days("2026-12-31"),
      ).toISOString(),
      ist("2027-01-01T09:00").toISOString(),
    );
    assert.equal(
      snoozeUntil(
        "tomorrow",
        ist("2024-02-28T10:00"),
        p,
        days("2024-02-29"),
      ).toISOString(),
      ist("2024-03-01T09:00").toISOString(),
    );
  });
});

describe("working-day counts with holidays", () => {
  it("skips a holiday inside the range", () => {
    // Mon 26 -> Fri 30 Oct is 4 working days; with Wed 28 off, 3.
    assert.equal(workingDaysBetween("2026-10-26", "2026-10-30", prefs()), 4);
    assert.equal(
      workingDaysBetween("2026-10-26", "2026-10-30", prefs(), days("2026-10-28")),
      3,
    );
  });

  it("a holiday run over a weekend counts none of its days", () => {
    // Thu 29 -> Tue 3 Nov: Fri, Mon and Tue would count; Fri 30 and Mon 2 are holidays.
    assert.equal(workingDaysBetween("2026-10-29", "2026-11-03", prefs()), 3);
    assert.equal(
      workingDaysBetween(
        "2026-10-29",
        "2026-11-03",
        prefs(),
        days("2026-10-30", "2026-11-02"),
      ),
      1,
    );
  });

  it("the start day is not counted, the end day is", () => {
    assert.equal(
      workingDaysBetween("2026-10-27", "2026-10-28", prefs(), days("2026-10-27")),
      1,
    );
    assert.equal(
      workingDaysBetween("2026-10-27", "2026-10-28", prefs(), days("2026-10-28")),
      0,
    );
  });

  it("across a year end and a leap day", () => {
    assert.equal(workingDaysBetween("2026-12-30", "2027-01-05", prefs()), 4);
    assert.equal(
      workingDaysBetween(
        "2026-12-30",
        "2027-01-05",
        prefs(),
        days("2026-12-31", "2027-01-01"),
      ),
      2,
    );
    // Wed 28 Feb 2024 -> Fri 1 Mar 2024: Thu 29 Feb (leap day) and Fri 1 Mar.
    assert.equal(workingDaysBetween("2024-02-28", "2024-03-01", prefs()), 2);
    assert.equal(
      workingDaysBetween("2024-02-28", "2024-03-01", prefs(), days("2024-02-29")),
      1,
    );
  });

  it("no holidays: the same numbers as before", () => {
    for (const set of [undefined, EMPTY]) {
      assert.equal(workingDaysBetween("2026-10-19", "2026-10-26", prefs(), set), 5);
      assert.equal(workingDaysBetween("2026-10-26", "2026-10-26", prefs(), set), 0);
    }
  });
});

describe("the advance reminder day with holidays", () => {
  it("steps back over a holiday and the weekend", () => {
    // Due Tue 3 Nov, lead 1: Monday normally; with Mon 2 Nov off, the Friday before.
    assert.equal(advanceReminderDay("2026-11-03", prefs()), "2026-11-02");
    assert.equal(advanceReminderDay("2026-11-03", prefs(), EMPTY), "2026-11-02");
    assert.equal(
      advanceReminderDay("2026-11-03", prefs(), days("2026-11-02")),
      "2026-10-30",
    );
  });

  it("a holiday run over a weekend", () => {
    assert.equal(
      advanceReminderDay("2026-11-03", prefs(), days("2026-10-30", "2026-11-02")),
      "2026-10-29",
    );
  });

  it("a lead of 0 still means no advance reminder", () => {
    assert.equal(
      advanceReminderDay("2026-11-03", prefs({ leadWorkingDays: 0 }), days("2026-11-02")),
      null,
    );
  });

  it("the due day being a holiday does not change which day comes before it", () => {
    assert.equal(
      advanceReminderDay("2026-11-03", prefs(), days("2026-11-03")),
      "2026-11-02",
    );
  });
});

describe("reminders on a holiday", () => {
  it("nothing day-bound fires on a holiday; it waits for the next working morning", () => {
    const overdue = todo({ dueAt: "2026-10-27" });
    const h = days("2026-10-28"); // Wed
    // Wed 28 Oct 10:00, a holiday: silent. Without the holiday it is overdue.
    assert.deepEqual(computeDue([overdue], ist("2026-10-28T10:00"), prefs(), h), []);
    assert.equal(computeDue([overdue], ist("2026-10-28T10:00"), prefs()).length, 1);
    // Thursday it fires again.
    assert.deepEqual(
      computeDue([overdue], ist("2026-10-29T10:00"), prefs(), h).map((x) => x.kind),
      ["overdue"],
    );
  });

  it("no holidays: the same notifications as before", () => {
    const list = [todo({ dueAt: "2026-10-27" }), todo({ dueAt: "2026-10-29" })];
    const now = ist("2026-10-28T10:00");
    assert.deepEqual(
      computeDue(list, now, prefs(), EMPTY),
      computeDue(list, now, prefs()),
    );
    assert.deepEqual(
      computeDue(list, now, prefs(), undefined),
      computeDue(list, now, prefs()),
    );
  });

  it("the advance reminder moves back over a holiday", () => {
    // Due Tue 3 Nov, Mon 2 Nov is a holiday: the heads-up is due from Friday 30 Oct,
    // not from the Monday.
    const t = todo({ dueAt: "2026-11-03" });
    const friday = ist("2026-10-30T12:00");
    assert.deepEqual(
      computeDue([t], friday, prefs(), days("2026-11-02")).map((x) => x.kind),
      ["due-soon"],
    );
    assert.equal(computeDue([t], friday, prefs()).length, 0);
    const wednesday = ist("2026-10-28T12:00");
    assert.equal(computeDue([t], wednesday, prefs(), days("2026-11-02")).length, 0);
  });
});

describe("chasers with holidays", () => {
  const waiting = todo({
    waitingOn: "Sam",
    waitingSince: "2026-10-26T04:00:00.000Z", // Mon 26 Oct 09:30 IST
    updatedAt: "2026-10-26T04:00:00.000Z",
  });

  it("a holiday is not a quiet working day", () => {
    const wed = ist("2026-10-28T10:00");
    assert.equal(waitingState(waiting, wed, prefs()).quietDays, 2);
    assert.equal(waitingState(waiting, wed, prefs(), EMPTY).quietDays, 2);
    const state = waitingState(waiting, wed, prefs(), days("2026-10-27"));
    assert.equal(state.quietDays, 1);
    assert.equal(state.chaseDue, false); // the default cadence is 2 working days
    assert.equal(state.calendarDays, 2);
  });

  it("the chaser becomes due one working day later, and the count feeds the badge", () => {
    const h = days("2026-10-27");
    assert.equal(
      waitingState(waiting, ist("2026-10-29T10:00"), prefs(), h).chaseDue,
      true,
    );
    assert.equal(
      attentionSummary([waiting], ist("2026-10-28T10:00"), prefs()).waiting,
      1,
    );
    assert.equal(
      attentionSummary([waiting], ist("2026-10-28T10:00"), prefs(), h).waiting,
      0,
    );
  });
});
