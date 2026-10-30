import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findTask } from "../tasks-engine/catalog.ts";
import { resolveWhen } from "./whenPhrase.ts";
import { resolvePmoIntent } from "./pmoIntent.ts";
import {
  prepareTaskSummary,
  statusReply,
  unknownWhenReply,
  unknownTaskReply,
  whosOffReply,
} from "./pmoReply.ts";

// Friday 30 Oct 2026.
const TODAY = "2026-10-30";
const when = (phrase) => resolveWhen(phrase, TODAY);
const days = (phrase) => {
  const r = when(phrase);
  return r && [r.from, r.to];
};

describe("date phrases", () => {
  it("today, tomorrow, yesterday", () => {
    assert.deepEqual(days(""), [TODAY, TODAY]);
    assert.deepEqual(days("today"), [TODAY, TODAY]);
    assert.deepEqual(days("tomorrow"), ["2026-10-31", "2026-10-31"]);
    assert.deepEqual(days("yesterday"), ["2026-10-29", "2026-10-29"]);
    assert.deepEqual(days("day after tomorrow"), ["2026-11-01", "2026-11-01"]);
  });

  it("a bare weekday is the next one on or after today", () => {
    assert.deepEqual(days("friday"), [TODAY, TODAY]);
    assert.deepEqual(days("monday"), ["2026-11-02", "2026-11-02"]);
    assert.deepEqual(days("wed"), ["2026-11-04", "2026-11-04"]);
    assert.deepEqual(days("on Monday"), ["2026-11-02", "2026-11-02"]);
  });

  it("'next monday' is Monday of next week; 'this' is in the current week", () => {
    assert.deepEqual(days("next Monday"), ["2026-11-02", "2026-11-02"]);
    assert.deepEqual(days("next friday"), ["2026-11-06", "2026-11-06"]);
    assert.deepEqual(days("this monday"), ["2026-10-26", "2026-10-26"]);
    assert.deepEqual(days("this sunday"), ["2026-11-01", "2026-11-01"]);
  });

  it("from a Monday, 'next monday' is a week later", () => {
    assert.deepEqual(
      resolveWhen("next monday", "2026-11-02") && [
        resolveWhen("next monday", "2026-11-02").from,
      ],
      ["2026-11-09"],
    );
  });

  it("weeks, weekends, months and day counts", () => {
    assert.deepEqual(days("this week"), ["2026-10-26", "2026-11-01"]);
    assert.deepEqual(days("next week"), ["2026-11-02", "2026-11-08"]);
    assert.deepEqual(days("last week"), ["2026-10-19", "2026-10-25"]);
    assert.deepEqual(days("this weekend"), ["2026-10-31", "2026-11-01"]);
    assert.deepEqual(days("next weekend"), ["2026-11-07", "2026-11-08"]);
    assert.deepEqual(days("next 3 days"), [TODAY, "2026-11-01"]);
    assert.deepEqual(days("this month"), [TODAY, "2026-10-31"]);
    assert.deepEqual(days("next month"), ["2026-11-01", "2026-11-30"]);
  });

  it("dates in several spellings", () => {
    assert.deepEqual(days("2026-11-05"), ["2026-11-05", "2026-11-05"]);
    assert.deepEqual(days("5 Nov"), ["2026-11-05", "2026-11-05"]);
    assert.deepEqual(days("5th November 2026"), ["2026-11-05", "2026-11-05"]);
    assert.deepEqual(days("Nov 5"), ["2026-11-05", "2026-11-05"]);
    assert.deepEqual(days("on the 5th of nov"), ["2026-11-05", "2026-11-05"]);
    assert.deepEqual(days("sept 3"), ["2027-09-03", "2027-09-03"]);
  });

  it("a date without a year that is long past means next year; a recent one stays", () => {
    assert.deepEqual(days("3 Jan"), ["2027-01-03", "2027-01-03"]);
    assert.deepEqual(days("15 Oct"), ["2026-10-15", "2026-10-15"]);
  });

  it("refuses what it does not understand, and impossible dates", () => {
    for (const text of ["whenever", "31 Feb", "32 Nov", "blue moon", "next never"]) {
      assert.equal(when(text), null, text);
    }
    assert.equal(resolveWhen("today", "nope"), null);
  });

  it("labels what it found", () => {
    assert.equal(when("next Monday").label, "Mon 2 Nov 2026");
    assert.equal(when("next week").label, "Mon 2 Nov to Sun 8 Nov 2026");
  });
});

describe("who is off, as a question", () => {
  const off = (prompt) => resolvePmoIntent(prompt);
  it("recognises the usual ways to ask", () => {
    const cases = {
      "who's off next Monday?": "next Monday",
      "Who is off tomorrow": "tomorrow",
      "who’s out this week?": "this week",
      "who is out of office today": "today",
      "who are on leave next week": "next week",
      "who's on leave": "",
      "who is away on friday": "friday",
      "who all are off tomorrow?": "tomorrow",
      "who will be off on 5 Nov": "5 Nov",
      "is anyone off next week?": "next week",
      "are any of us on pto tomorrow": "tomorrow",
      "anyone on vacation this month": "this month",
    };
    for (const [prompt, expected] of Object.entries(cases)) {
      assert.deepEqual(off(prompt), { kind: "whos_off", when: expected }, prompt);
    }
  });

  it("does not take unrelated sentences", () => {
    for (const prompt of [
      "who is offline",
      "turn the volume off",
      "open notes",
      "who wrote this",
      "write a note about being out sick",
    ]) {
      assert.equal(off(prompt), null, prompt);
    }
  });
});

describe("PMO status questions", () => {
  const topic = (prompt) => {
    const intent = resolvePmoIntent(prompt);
    return intent?.kind === "pmo_status" ? intent.topic : intent;
  };
  it("overdue, chasers, open and summary", () => {
    assert.equal(topic("what's overdue?"), "overdue");
    assert.equal(topic("show overdue to-dos"), "overdue");
    assert.equal(topic("which to-dos are overdue"), "overdue");
    assert.equal(topic("what do I need to chase"), "chasers");
    assert.equal(topic("any chasers due?"), "chasers");
    assert.equal(topic("show overdue chasers"), "chasers");
    assert.equal(topic("how many open to-dos do I have"), "open");
    assert.equal(topic("show my to-dos"), "open");
    assert.equal(topic("PMO status"), "summary");
    assert.equal(topic("what needs my attention"), "summary");
  });

  it("leaves requests to write or do things to the model", () => {
    assert.equal(topic("draft a chaser to Sam"), null);
    assert.equal(topic("write a note about overdue invoices"), null);
    assert.equal(topic("delete my notes"), null);
  });
});

describe("preparing a task", () => {
  const task = (prompt) => {
    const intent = resolvePmoIntent(prompt);
    return intent?.kind === "prepare_task" ? intent.taskId : intent;
  };
  it("finds the task by its usual names", () => {
    assert.equal(task("prepare this week's aging report"), "weekly-aging-report");
    assert.equal(task("Please prep the backlog report"), "weekly-backlog-report");
    assert.equal(task("run the monthly deck"), "monthly-report-deck");
    assert.equal(
      task("can you start the deployment mailer"),
      "deployment-dep-weekend-mailer",
    );
    assert.equal(task("build the shift roster"), "shift-roster");
    assert.equal(task("prepare the december disconnect"), "december-disconnect");
  });

  it("needs both a prepare verb and a known task", () => {
    assert.equal(task("prepare lunch"), null);
    assert.equal(task("the aging report is late"), null);
    assert.equal(task("what is the aging report"), null);
  });

  it("the longest alias wins and an id works", () => {
    assert.equal(findTask("weekly backlog report aging").id, "weekly-backlog-report");
    assert.equal(findTask("shift-roster").id, "shift-roster");
    assert.equal(findTask("nothing here"), null);
  });
});

describe("replies", () => {
  const entry = (name, label, start, end, over = {}) => ({
    key: `${name}${start}`,
    name,
    employeeId: null,
    label,
    start,
    end,
    source: "time-off",
    pending: false,
    ...over,
  });
  const result = (entries, holidays = []) => ({
    from: "2026-11-02",
    to: "2026-11-02",
    entries,
    holidays,
  });
  const monday = when("next monday");

  it("lists who is off on one day", () => {
    const text = whosOffReply(
      monday,
      result([
        entry("Ana Rao", "PTO", "2026-11-02", "2026-11-04"),
        entry("Ben Cho", "Sick leave", "2026-11-02", "2026-11-02"),
      ]),
    );
    assert.equal(
      text,
      "Off on Mon 2 Nov 2026 (2 people):\n• Ana Rao (PTO)\n• Ben Cho (Sick leave)",
    );
  });

  it("says when nobody is off, and mentions a holiday", () => {
    assert.equal(whosOffReply(monday, result([])), "Nobody is off on Mon 2 Nov 2026.");
    const text = whosOffReply(
      monday,
      result(
        [],
        [
          {
            id: "h",
            date: "2026-11-02",
            endDate: "2026-11-02",
            label: "Diwali",
            kind: "holiday",
            locations: ["Pune"],
          },
        ],
      ),
    );
    assert.equal(text, "Nobody is off on Mon 2 Nov 2026.\nHoliday: Diwali (Pune).");
  });

  it("for a range, shows each person's dates and flags a pending request", () => {
    const week = when("next week");
    const text = whosOffReply(week, {
      ...result([entry("Ana Rao", "PTO", "2026-11-03", "2026-11-05", { pending: true })]),
      from: week.from,
      to: week.to,
    });
    assert.equal(
      text,
      "Off Mon 2 Nov to Sun 8 Nov 2026 (1 person):\n• Ana Rao (PTO, 3 – 5 Nov 2026, waiting for approval)",
    );
  });

  it("caps a long list", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      entry(`P${i}`, "PTO", "2026-11-02", "2026-11-02"),
    );
    const lines = whosOffReply(monday, result(many)).split("\n");
    assert.equal(lines.length, 1 + 6 + 1);
    assert.equal(lines.at(-1), "+3 more");
    assert.match(lines[0], /\(9 people\)/);
  });

  it("explains a date it could not read", () => {
    assert.match(unknownWhenReply("blue moon"), /couldn't tell which day "blue moon"/);
    assert.match(unknownWhenReply("mondy", "monday"), /Did you mean "monday"\?/);
    assert.equal(
      unknownTaskReply("agin report", { label: "Aging Report" }),
      'I don\'t know a task called "agin report". Did you mean Aging Report?',
    );
    assert.equal(unknownTaskReply("xyz"), 'I don\'t know a task called "xyz".');
  });

  const row = (title, daysLate, over = {}) => ({
    id: title,
    title,
    owner: "Ana",
    dueAt: "2026-10-28",
    daysLate,
    priority: "normal",
    waitingOn: null,
    ...over,
  });
  const todos = (over = {}) => ({
    open: 7,
    overdue: 2,
    dueToday: 1,
    dueTomorrow: 0,
    waiting: 3,
    chaseDue: 1,
    noDueDate: 1,
    urgent: [row("Late A", 2), row("Late B", 1), row("Today", 0, { dueAt: TODAY })],
    ...over,
  });
  const data = (over = {}) => ({
    todos: todos(),
    chasers: [
      {
        id: "c",
        title: "Release plan",
        waitingOn: "Sam",
        quietDays: 4,
        everyDays: 2,
        overBy: 2,
      },
    ],
    today: TODAY,
    ...over,
  });

  it("overdue lists only the late ones", () => {
    assert.equal(
      statusReply("overdue", data()),
      "2 to-dos overdue:\n• Late A (Overdue by 2 days, Ana)\n• Late B (Overdue by 1 day, Ana)",
    );
    assert.equal(
      statusReply("overdue", data({ todos: todos({ overdue: 0, urgent: [] }) })),
      "Nothing is overdue.",
    );
  });

  it("chasers", () => {
    assert.equal(
      statusReply("chasers", data()),
      "1 chaser due:\n• Release plan: waiting on Sam, 4 working days quiet",
    );
    assert.equal(statusReply("chasers", data({ chasers: [] })), "No chasers are due.");
  });

  it("open and summary", () => {
    assert.equal(
      statusReply("open", data()),
      "7 open to-dos: 2 overdue, 1 due today, 3 waiting on others.",
    );
    assert.equal(
      statusReply(
        "open",
        data({
          todos: todos({ open: 0, overdue: 0, dueToday: 0, waiting: 0, urgent: [] }),
        }),
      ),
      "No open to-dos.",
    );
    const summary = statusReply("summary", data()).split("\n");
    assert.equal(
      summary[0],
      "7 open to-dos: 2 overdue, 1 due today, 3 waiting on others.",
    );
    assert.equal(summary[1], "1 chaser due.");
    assert.equal(summary.length, 5);
  });

  it("says what opening a task means, naming it", () => {
    assert.match(
      prepareTaskSummary("weekly-aging-report"),
      /^Opening Aging Report: .*Nothing is sent without your approval\.$/,
    );
  });
});
