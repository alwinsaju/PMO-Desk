// Run with `pnpm test`. The reminder engine against a fake clock: weekends,
// the IST day boundary, month/year rollover, snooze, chasers, quiet hours and
// the privacy default of the toast text. Pure: no files, no network.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addDays,
  attentionSummary,
  computeDue,
  describeInstant,
  instantFromLocalInput,
  isWorkingDay,
  snoozeUntil,
  toastFor,
  workingDaysBetween,
  zonedInstant,
} from "./due.ts";
import { ReminderPrefsSchema, defaultReminderPrefs } from "./types.ts";

// 2026-10-26 is a Monday; 2026-10-24 and -25 are the weekend before it.
const ist = (stamp) => new Date(`${stamp}:00+05:30`); // "2026-10-26T09:00"
const prefs = (patch = {}) => ({ ...defaultReminderPrefs(), ...patch });

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
const kinds = (list) => list.map((item) => item.kind);

describe("reminder preferences", () => {
  it("default to IST, 09:00-18:00 Mon-Fri, quiet hours on, privacy on, digest and tray off", () => {
    assert.deepEqual(defaultReminderPrefs(), {
      enabled: true,
      timeZone: "Asia/Kolkata",
      workStart: "09:00",
      workEnd: "18:00",
      workDays: [1, 2, 3, 4, 5],
      quietOutsideHours: true,
      leadWorkingDays: 1,
      chaserDays: 2,
      digest: false,
      hideDetails: true,
      keepRunningInTray: false,
    });
  });

  it("rejects a malformed block (the config loader then falls back to defaults)", () => {
    assert.equal(ReminderPrefsSchema.safeParse({ workStart: "9am" }).success, false);
    assert.equal(ReminderPrefsSchema.safeParse({ chaserDays: 0 }).success, false);
    assert.equal(ReminderPrefsSchema.safeParse({ leadWorkingDays: 6 }).success, false);
    assert.equal(ReminderPrefsSchema.safeParse({ leadWorkingDays: 1.5 }).success, false);
    assert.equal(ReminderPrefsSchema.safeParse({ leadWorkingDays: 0 }).success, true);
  });
});

describe("calendar helpers", () => {
  it("rolls days over months, years and leap days", () => {
    assert.equal(addDays("2026-10-31", 1), "2026-11-01");
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(addDays("2028-02-28", 1), "2028-02-29");
    assert.equal(addDays("2027-02-28", 1), "2027-03-01");
    assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  });

  it("counts working days in (from, to], skipping the weekend", () => {
    const p = prefs();
    assert.equal(isWorkingDay("2026-10-26", p), true);
    assert.equal(isWorkingDay("2026-10-25", p), false);
    assert.equal(workingDaysBetween("2026-10-23", "2026-10-26", p), 1); // Fri -> Mon
    assert.equal(workingDaysBetween("2026-10-19", "2026-10-26", p), 5);
    assert.equal(workingDaysBetween("2026-10-26", "2026-10-26", p), 0);
    assert.equal(workingDaysBetween("2026-12-30", "2027-01-05", p), 4); // across new year
  });

  it("reads wall-clock times in the zone (IST fixed, a DST zone for good measure)", () => {
    assert.equal(
      zonedInstant("2026-10-26", "09:00", "Asia/Kolkata").toISOString(),
      "2026-10-26T03:30:00.000Z",
    );
    assert.equal(
      zonedInstant("2026-03-06", "09:00", "America/New_York").toISOString(),
      "2026-03-06T14:00:00.000Z",
    );
    assert.equal(
      zonedInstant("2026-03-09", "09:00", "America/New_York").toISOString(),
      "2026-03-09T13:00:00.000Z",
    );
  });
});

describe("computeDue: due-soon", () => {
  const due = todo({ dueAt: "2026-10-27" }); // Tuesday

  it("fires once, on the day before, inside working hours", () => {
    const out = computeDue([due], ist("2026-10-26T10:00"), prefs());
    assert.deepEqual(kinds(out), ["due-soon"]);
    assert.equal(out[0].key, `due-soon:${due.id}:2026-10-27`);
    assert.equal(out[0].todoId, due.id);
    assert.match(out[0].body, /Due tomorrow/);
    // The same key on every later pass the same day: the caller dedupes by it.
    assert.equal(computeDue([due], ist("2026-10-26T15:00"), prefs())[0].key, out[0].key);
  });

  it("is not yet due-soon 24 h or more ahead, and the boundary is strict", () => {
    assert.deepEqual(
      computeDue([due], ist("2026-10-25T10:00"), prefs({ quietOutsideHours: false })),
      [],
    );
    // Exactly 24 h before the start of Tue 27 = Mon 26 00:00.
    assert.deepEqual(
      computeDue([due], ist("2026-10-26T00:00"), prefs({ quietOutsideHours: false })),
      [],
    );
    assert.deepEqual(
      kinds(
        computeDue([due], ist("2026-10-26T00:01"), prefs({ quietOutsideHours: false })),
      ),
      ["due-soon"],
    );
  });

  it("waits for working hours when quiet, fires any time when not", () => {
    assert.deepEqual(computeDue([due], ist("2026-10-26T08:30"), prefs()), []);
    assert.deepEqual(computeDue([due], ist("2026-10-26T18:00"), prefs()), []);
    assert.deepEqual(
      kinds(
        computeDue([due], ist("2026-10-26T21:00"), prefs({ quietOutsideHours: false })),
      ),
      ["due-soon"],
    );
  });

  it("reminds a Monday due date on the Friday before, then goes overdue-on-the-day", () => {
    const monday = todo({ dueAt: "2026-10-26" });
    assert.deepEqual(computeDue([monday], ist("2026-10-22T11:00"), prefs()), []); // Thu
    const friday = computeDue([monday], ist("2026-10-23T09:00"), prefs());
    assert.deepEqual(kinds(friday), ["due-soon"]);
    assert.equal(friday[0].key, `due-soon:${monday.id}:2026-10-26`);
    assert.match(friday[0].body, /Due Mon 26 Oct/);
    // Quiet hours hold the rest of the weekend back; the Friday reminder is not repeated by key.
    assert.deepEqual(computeDue([monday], ist("2026-10-24T11:00"), prefs()), []); // Sat
    assert.deepEqual(computeDue([monday], ist("2026-10-25T11:00"), prefs()), []); // Sun
    const onTheDay = computeDue([monday], ist("2026-10-26T09:00"), prefs());
    assert.deepEqual(kinds(onTheDay), ["overdue"]);
    assert.equal(onTheDay[0].body, "Due today.");
  });

  it("reminds a mid-week due date on the previous working day", () => {
    const thursday = todo({ dueAt: "2026-10-29" });
    assert.deepEqual(computeDue([thursday], ist("2026-10-27T11:00"), prefs()), []);
    assert.deepEqual(kinds(computeDue([thursday], ist("2026-10-28T11:00"), prefs())), [
      "due-soon",
    ]);
  });

  it("counts the lead in working days (lead 2 skips the weekend)", () => {
    const lead2 = prefs({ leadWorkingDays: 2 });
    const monday = todo({ dueAt: "2026-10-26" });
    assert.deepEqual(computeDue([monday], ist("2026-10-21T11:00"), lead2), []); // Wed
    assert.deepEqual(kinds(computeDue([monday], ist("2026-10-22T09:00"), lead2)), [
      "due-soon",
    ]); // Thu: Fri and Thu are the two working days before
    const wednesday = todo({ dueAt: "2026-10-28" });
    assert.deepEqual(computeDue([wednesday], ist("2026-10-25T11:00"), lead2), []);
    assert.deepEqual(kinds(computeDue([wednesday], ist("2026-10-26T09:00"), lead2)), [
      "due-soon",
    ]);
    const friday = todo({ dueAt: "2026-10-30" });
    assert.deepEqual(computeDue([friday], ist("2026-10-27T11:00"), lead2), []);
    assert.deepEqual(kinds(computeDue([friday], ist("2026-10-28T11:00"), lead2)), [
      "due-soon",
    ]);
  });

  it("lead 0 sends no advance reminder (the due day itself still does)", () => {
    const p = prefs({ leadWorkingDays: 0 });
    const tuesday = todo({ dueAt: "2026-10-27" });
    assert.deepEqual(computeDue([tuesday], ist("2026-10-26T10:00"), p), []);
    assert.deepEqual(kinds(computeDue([tuesday], ist("2026-10-27T09:00"), p)), [
      "overdue",
    ]);
  });

  it("defers a reminder that fell in quiet hours to the next allowed time instead of dropping it", () => {
    const wednesday = todo({ dueAt: "2026-10-28" }); // reminder day Tue 27
    // Tue evening and the next morning before the window: held back.
    assert.deepEqual(computeDue([wednesday], ist("2026-10-27T19:00"), prefs()), []);
    // Missed the whole of Tuesday (app closed): the heads-up is not lost on a
    // later working day before the due day.
    const lead3 = prefs({ leadWorkingDays: 3 });
    const missed = computeDue([wednesday], ist("2026-10-27T09:00"), lead3);
    assert.deepEqual(kinds(missed), ["due-soon"]); // reminder day was Fri 23
    // A Sat/Sun reminder day cannot exist; with quiet off the Friday heads-up
    // for Monday still shows on Sunday.
    const monday = todo({ dueAt: "2026-10-26" });
    assert.deepEqual(
      kinds(
        computeDue(
          [monday],
          ist("2026-10-25T11:00"),
          prefs({ quietOutsideHours: false }),
        ),
      ),
      ["due-soon"],
    );
    // Quiet on: Friday evening is outside the window, Monday is the due day.
    assert.deepEqual(computeDue([monday], ist("2026-10-23T19:00"), prefs()), []);
  });

  it("crosses a month and a year boundary", () => {
    const newYear = todo({ dueAt: "2027-01-01" });
    assert.deepEqual(kinds(computeDue([newYear], ist("2026-12-31T10:00"), prefs())), [
      "due-soon",
    ]);
    const firstOfMonth = todo({ dueAt: "2026-11-02" });
    assert.deepEqual(
      kinds(
        computeDue(
          [firstOfMonth],
          ist("2026-11-01T10:00"),
          prefs({ quietOutsideHours: false }),
        ),
      ),
      ["due-soon"],
    );
  });

  it("uses the IST day, not the UTC one", () => {
    // 20:00 UTC on the 22nd is 01:30 IST on Friday the 23rd.
    const instant = new Date("2026-10-22T20:00:00Z");
    const relaxed = prefs({ quietOutsideHours: false });
    // Due Sat 24: 22.5 h ahead in IST -> due-soon.
    assert.deepEqual(
      kinds(computeDue([todo({ dueAt: "2026-10-24" })], instant, relaxed)),
      ["due-soon"],
    );
    // Due Fri 23: that day has already begun in IST, but it is before 09:00 -> nothing yet.
    assert.deepEqual(computeDue([todo({ dueAt: "2026-10-23" })], instant, relaxed), []);
  });
});

describe("computeDue: overdue", () => {
  const due = todo({ dueAt: "2026-10-23" }); // Friday

  it("starts at 09:00 IST on the due day", () => {
    assert.deepEqual(computeDue([due], ist("2026-10-23T08:59"), prefs()), []);
    const out = computeDue([due], ist("2026-10-23T09:00"), prefs());
    assert.deepEqual(kinds(out), ["overdue"]);
    assert.equal(out[0].key, `overdue:${due.id}:2026-10-23:2026-10-23`);
  });

  it("uses the IST clock: 03:30 UTC is 09:00 IST", () => {
    assert.deepEqual(computeDue([due], new Date("2026-10-23T03:29:00Z"), prefs()), []);
    assert.deepEqual(
      kinds(computeDue([due], new Date("2026-10-23T03:30:00Z"), prefs())),
      ["overdue"],
    );
  });

  it("repeats once per working day with a new key, skipping Saturday and Sunday", () => {
    const fri = computeDue([due], ist("2026-10-23T10:00"), prefs());
    const sat = computeDue([due], ist("2026-10-24T10:00"), prefs());
    const sun = computeDue([due], ist("2026-10-25T10:00"), prefs());
    const mon = computeDue([due], ist("2026-10-26T10:00"), prefs());
    const tue = computeDue([due], ist("2026-10-27T10:00"), prefs());
    assert.equal(sat.length, 0);
    assert.equal(sun.length, 0);
    assert.equal(mon[0].body, "Overdue by 3 days (was due Fri 23 Oct).");
    assert.equal(new Set([fri[0].key, mon[0].key, tue[0].key]).size, 3);
    // Same day, later pass: the same key.
    assert.equal(computeDue([due], ist("2026-10-26T16:00"), prefs())[0].key, mon[0].key);
  });

  it("holds back after the working day when quiet, and not when quiet is off", () => {
    assert.deepEqual(computeDue([due], ist("2026-10-26T18:30"), prefs()), []);
    assert.deepEqual(
      kinds(
        computeDue([due], ist("2026-10-26T18:30"), prefs({ quietOutsideHours: false })),
      ),
      ["overdue"],
    );
    // Even with quiet off it never fires before the day starts or on a day off.
    assert.deepEqual(
      computeDue([due], ist("2026-10-26T07:00"), prefs({ quietOutsideHours: false })),
      [],
    );
    assert.deepEqual(
      computeDue([due], ist("2026-10-25T12:00"), prefs({ quietOutsideHours: false })),
      [],
    );
  });

  it("rolls over a month end and a year end", () => {
    const october = todo({ dueAt: "2026-10-30" });
    assert.match(
      computeDue([october], ist("2026-11-02T09:30"), prefs())[0].body,
      /^Overdue by 3 days/,
    );
    const december = todo({ dueAt: "2026-12-31" });
    const out = computeDue([december], ist("2027-01-04T09:30"), prefs());
    assert.match(out[0].body, /^Overdue by 4 days/);
    assert.ok(out[0].key.endsWith(":2027-01-04"));
    const leap = todo({ dueAt: "2028-02-28" });
    assert.match(
      computeDue([leap], ist("2028-03-01T09:30"), prefs())[0].body,
      /^Overdue by 2 days/,
    );
  });

  it("honours custom working hours and days", () => {
    const early = prefs({
      workStart: "07:30",
      workEnd: "12:00",
      workDays: [1, 2, 3, 4, 5, 6],
    });
    assert.deepEqual(kinds(computeDue([due], ist("2026-10-24T08:00"), early)), [
      "overdue",
    ]); // Saturday is a work day now
    assert.deepEqual(computeDue([due], ist("2026-10-24T12:00"), early), []);
  });
});

describe("computeDue: snooze, status and the master switch", () => {
  it("skips a snoozed to-do until the snooze ends", () => {
    const snoozed = todo({
      dueAt: "2026-10-23",
      reminders: {
        enabled: false,
        remindAt: null,
        snoozedUntil: "2026-10-26T04:30:00.000Z",
        lastRemindedAt: null,
      }, // Mon 10:00 IST
    });
    assert.deepEqual(computeDue([snoozed], ist("2026-10-26T09:30"), prefs()), []);
    assert.deepEqual(kinds(computeDue([snoozed], ist("2026-10-26T10:00"), prefs())), [
      "overdue",
    ]);
  });

  it("ignores done and cancelled to-dos, and does nothing when disabled", () => {
    const base = { dueAt: "2026-10-23", waitingOn: "Sam" };
    assert.deepEqual(
      computeDue(
        [todo({ ...base, status: "done" }), todo({ ...base, status: "cancelled" })],
        ist("2026-10-26T10:00"),
        prefs(),
      ),
      [],
    );
    assert.deepEqual(
      computeDue([todo(base)], ist("2026-10-26T10:00"), prefs({ enabled: false })),
      [],
    );
  });
});

describe("computeDue: chaser", () => {
  const waiting = (updatedAt, patch = {}) =>
    todo({ waitingOn: "Sam Example", updatedAt: ist(updatedAt).toISOString(), ...patch });

  it("fires after N working days of silence, and not before", () => {
    const t = waiting("2026-10-19T12:00"); // Monday
    assert.deepEqual(computeDue([t], ist("2026-10-20T10:00"), prefs()), []); // 1 working day
    const wed = computeDue([t], ist("2026-10-21T10:00"), prefs()); // 2
    assert.deepEqual(kinds(wed), ["chaser"]);
    assert.match(wed[0].body, /Waiting on Sam Example with no update for 2 working days/);
  });

  it("repeats every N working days, once per round, never on a day off", () => {
    const t = waiting("2026-10-19T12:00");
    const key = (stamp) => computeDue([t], ist(stamp), prefs())[0]?.key;
    const wed = key("2026-10-21T10:00");
    assert.equal(key("2026-10-22T10:00"), wed); // 3 days: still round 1, same key
    const fri = key("2026-10-23T10:00"); // 4 days: round 2
    assert.notEqual(fri, wed);
    assert.equal(key("2026-10-24T10:00"), undefined); // Saturday
    assert.equal(key("2026-10-26T10:00"), fri); // 5 days: still round 2
  });

  it("counts working days across a weekend and honours chaserDays", () => {
    const t = waiting("2026-10-23T15:00"); // Friday
    assert.deepEqual(computeDue([t], ist("2026-10-26T10:00"), prefs()), []); // Monday = 1
    assert.deepEqual(kinds(computeDue([t], ist("2026-10-27T10:00"), prefs())), [
      "chaser",
    ]); // Tuesday = 2
    assert.deepEqual(
      kinds(computeDue([t], ist("2026-10-26T10:00"), prefs({ chaserDays: 1 }))),
      ["chaser"],
    );
  });

  it("needs waitingOn, and an update resets the clock", () => {
    assert.deepEqual(
      computeDue(
        [waiting("2026-10-19T12:00", { waitingOn: null })],
        ist("2026-10-26T10:00"),
        prefs(),
      ),
      [],
    );
    assert.deepEqual(
      computeDue(
        [waiting("2026-10-19T12:00", { waitingOn: "   " })],
        ist("2026-10-26T10:00"),
        prefs(),
      ),
      [],
    );
    assert.deepEqual(
      computeDue([waiting("2026-10-26T09:10")], ist("2026-10-26T10:00"), prefs()),
      [],
    );
  });

  it("is judged on the IST day of the last update", () => {
    // 21:00 UTC Monday is already Tuesday 02:30 IST.
    const t = todo({ waitingOn: "Sam", updatedAt: "2026-10-19T21:00:00.000Z" });
    assert.deepEqual(computeDue([t], ist("2026-10-21T10:00"), prefs()), []); // 1 working day since Tue
    assert.deepEqual(kinds(computeDue([t], ist("2026-10-22T10:00"), prefs())), [
      "chaser",
    ]);
  });

  it("spans a year end", () => {
    const t = waiting("2026-12-30T12:00");
    assert.deepEqual(kinds(computeDue([t], ist("2027-01-01T10:00"), prefs())), [
      "chaser",
    ]); // Thu 31, Fri 1
  });
});

describe("computeDue: digest and ordering", () => {
  const items = () => [todo({ title: "A" }), todo({ title: "B" })];

  it("is off by default and one summary per working day when on", () => {
    assert.deepEqual(computeDue(items(), ist("2026-10-26T10:00"), prefs()), []);
    const on = prefs({ digest: true });
    const out = computeDue(items(), ist("2026-10-26T09:00"), on);
    assert.deepEqual(kinds(out), ["digest"]);
    assert.equal(out[0].key, "digest:2026-10-26");
    assert.equal(out[0].todoId, null);
    assert.equal(out[0].count, 2);
    assert.match(out[0].body, /- A\n- B/);
    assert.equal(
      computeDue(items(), ist("2026-10-26T14:00"), on)[0].key,
      "digest:2026-10-26",
    );
    assert.deepEqual(computeDue(items(), ist("2026-10-26T08:59"), on), []);
    assert.deepEqual(computeDue(items(), ist("2026-10-24T10:00"), on), []);
    assert.deepEqual(computeDue([], ist("2026-10-26T10:00"), on), []);
  });

  it("lists overdue first, then chasers, then due-soon, then the digest", () => {
    const list = [
      todo({ title: "soon", dueAt: "2026-10-27" }),
      todo({ title: "late", dueAt: "2026-10-20" }),
      todo({ title: "wait", waitingOn: "Sam", updatedAt: "2026-10-19T05:00:00.000Z" }),
    ];
    const out = computeDue(list, ist("2026-10-26T10:00"), prefs({ digest: true }));
    assert.deepEqual(kinds(out), ["overdue", "chaser", "due-soon", "digest"]);
  });
});

describe("toastFor (privacy default)", () => {
  const overdue = (title) => ({
    todoId: `td_${title}`,
    kind: "overdue",
    key: title,
    title,
    body: "Due today.",
  });

  it("says only how many items need attention, with no titles, by default", () => {
    const one = toastFor([overdue("Secret client SOW")], { hideDetails: true });
    assert.deepEqual(one, {
      title: "PMO To-Do: 1 item needs attention",
      body: "",
      todoId: "td_Secret client SOW",
    });
    const three = toastFor([overdue("a"), overdue("b"), overdue("c")], {
      hideDetails: true,
    });
    assert.equal(three.title, "PMO To-Do: 3 items need attention");
    assert.equal(three.body, "");
    assert.equal(three.todoId, null);
    assert.doesNotMatch(JSON.stringify(three), /Secret|"a"/);
  });

  it("counts a to-do once even when it has two reminders", () => {
    const a = overdue("a");
    const t = toastFor([a, { ...a, kind: "chaser", key: "c" }], { hideDetails: true });
    assert.equal(t.title, "PMO To-Do: 1 item needs attention");
  });

  it("shows the title when details are allowed", () => {
    const t = toastFor([overdue("Quarterly deck")], { hideDetails: false });
    assert.deepEqual(t, {
      title: "Quarterly deck",
      body: "Due today.",
      todoId: "td_Quarterly deck",
    });
    const many = toastFor([overdue("A"), overdue("B")], { hideDetails: false });
    assert.equal(many.title, "PMO To-Do: 2 items need attention");
    assert.match(many.body, /- A\n- B/);
  });

  it("handles the digest and the empty batch", () => {
    const digest = {
      todoId: null,
      kind: "digest",
      key: "digest:x",
      title: "PMO To-Do: 4 open items",
      body: "- A",
      count: 4,
    };
    assert.equal(
      toastFor([digest], { hideDetails: true }).title,
      "PMO To-Do: 4 items need attention",
    );
    assert.equal(toastFor([digest], { hideDetails: true }).body, "");
    assert.equal(toastFor([digest], { hideDetails: false }).body, "- A");
    assert.equal(toastFor([], { hideDetails: true }), null);
  });
});

describe("attentionSummary (the dock badge)", () => {
  it("counts overdue, due today or tomorrow, and long-waiting items once each", () => {
    const now = ist("2026-10-26T10:00");
    const list = [
      todo({ dueAt: "2026-10-20" }), // overdue
      todo({ dueAt: "2026-10-26" }), // today
      todo({ dueAt: "2026-10-27" }), // tomorrow
      todo({ dueAt: "2026-10-30" }), // later: no
      todo({
        dueAt: "2026-10-20",
        waitingOn: "Sam",
        updatedAt: "2026-10-19T05:00:00.000Z",
      }), // overdue AND waiting
      todo({ dueAt: "2026-10-20", status: "done" }),
      todo({
        dueAt: "2026-10-20",
        reminders: {
          enabled: false,
          remindAt: null,
          snoozedUntil: "2026-10-27T04:00:00.000Z",
          lastRemindedAt: null,
        },
      }),
    ];
    assert.deepEqual(attentionSummary(list, now, prefs()), {
      count: 4,
      overdue: 2,
      dueSoon: 2,
      waiting: 1,
    });
  });
});

describe("snooze", () => {
  const p = prefs();
  it("after lunch is 14:00 today, or tomorrow morning once that has passed", () => {
    assert.equal(
      snoozeUntil("after-lunch", ist("2026-10-23T11:00"), p).toISOString(),
      ist("2026-10-23T14:00").toISOString(),
    );
    assert.equal(
      snoozeUntil("after-lunch", ist("2026-10-23T15:00"), p).toISOString(),
      ist("2026-10-24T09:00").toISOString(),
    );
  });
  it("offers one hour, tomorrow 09:00 IST and next Monday 09:00 IST", () => {
    const friEvening = ist("2026-10-23T20:15");
    assert.equal(
      snoozeUntil("1h", friEvening, p).toISOString(),
      ist("2026-10-23T21:15").toISOString(),
    );
    assert.equal(
      snoozeUntil("tomorrow", friEvening, p).toISOString(),
      ist("2026-10-24T09:00").toISOString(),
    );
    assert.equal(
      snoozeUntil("monday", friEvening, p).toISOString(),
      ist("2026-10-26T09:00").toISOString(),
    );
  });

  it("offers 3 days as the start of the working day three calendar days on, weekends included", () => {
    // Wed 21 Oct -> Sat 24 Oct; Fri 23 Oct (evening) -> Mon 26 Oct; Sat 24 Oct -> Tue 27 Oct.
    assert.equal(
      snoozeUntil("3d", ist("2026-10-21T10:00"), p).toISOString(),
      ist("2026-10-24T09:00").toISOString(),
    );
    assert.equal(
      snoozeUntil("3d", ist("2026-10-23T20:15"), p).toISOString(),
      ist("2026-10-26T09:00").toISOString(),
    );
    assert.equal(
      snoozeUntil("3d", ist("2026-10-24T08:00"), p).toISOString(),
      ist("2026-10-27T09:00").toISOString(),
    );
  });

  it("3 days crosses a year end, reads the date in the zone and uses the start of day", () => {
    assert.equal(
      snoozeUntil("3d", ist("2026-12-30T22:00"), p).toISOString(),
      ist("2027-01-02T09:00").toISOString(),
    );
    // 20:00 UTC Thursday is 01:30 IST Friday: three days on is Monday.
    assert.equal(
      snoozeUntil("3d", new Date("2026-10-22T20:00:00Z"), p).toISOString(),
      ist("2026-10-26T09:00").toISOString(),
    );
    assert.equal(
      snoozeUntil("3d", ist("2026-10-21T10:00"), {
        ...p,
        workStart: "08:30",
      }).toISOString(),
      ist("2026-10-24T08:30").toISOString(),
    );
  });

  it("takes next Monday from every weekday, a full week from a Monday, across a month end", () => {
    assert.equal(
      snoozeUntil("monday", ist("2026-10-26T08:00"), p).toISOString(),
      ist("2026-11-02T09:00").toISOString(),
    );
    assert.equal(
      snoozeUntil("monday", ist("2026-10-25T08:00"), p).toISOString(),
      ist("2026-10-26T09:00").toISOString(),
    );
    assert.equal(
      snoozeUntil("monday", ist("2026-10-28T08:00"), p).toISOString(),
      ist("2026-11-02T09:00").toISOString(),
    );
    assert.equal(
      snoozeUntil("tomorrow", ist("2026-12-31T22:00"), p).toISOString(),
      ist("2027-01-01T09:00").toISOString(),
    );
  });

  it("uses the IST date even when UTC is still the day before", () => {
    // 20:00 UTC Thursday is 01:30 IST Friday: "tomorrow" is Saturday.
    assert.equal(
      snoozeUntil("tomorrow", new Date("2026-10-22T20:00:00Z"), p).toISOString(),
      ist("2026-10-24T09:00").toISOString(),
    );
  });

  it("reads a custom datetime-local value in the zone and describes it", () => {
    const custom = instantFromLocalInput("2026-10-26T09:30", "Asia/Kolkata");
    assert.equal(custom.toISOString(), "2026-10-26T04:00:00.000Z");
    assert.equal(instantFromLocalInput("nonsense", "Asia/Kolkata"), null);
    assert.equal(describeInstant(custom, "Asia/Kolkata"), "Mon 26 Oct, 09:30");
  });
});
