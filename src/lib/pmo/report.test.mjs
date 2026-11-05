// Run with `pnpm test`. The weekly report's pure logic on a fake clock: week
// boundaries in IST (Sunday and Monday, month and year rollover), what counts as
// closed or new in a period, snoozed / cancelled / waiting / overdue handling,
// long-list capping, escaping, and the Markdown -> plain text conversion.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_MAX_PER_SECTION,
  PeriodRequestSchema,
  closedAtOf,
  dayLabel,
  esc,
  isCapped,
  markdownToPlainText,
  mondayOnOrBefore,
  rangeLabel,
  renderMarkdown,
  renderPlainText,
  reportSubject,
  resolvePeriod,
} from "./report.ts";
import { PmoConfigSchema, PmoConfigPatchSchema } from "./types.ts";
import { SAT, build, config, done, request, todo } from "./reportFixtures.mjs";

const TZ = "Asia/Kolkata";
const at = (iso) => new Date(iso);

describe("periods (IST)", () => {
  const resolve = (kind, now, extra) => {
    const result = resolvePeriod(request(kind, extra), at(now), TZ);
    assert.equal(result.ok, true, result.reason);
    return result.period;
  };

  it("this week is Monday to today, last week the whole Monday-Sunday before, last 7 days is today and six before", () => {
    const sat = resolve("this-week", "2026-10-24T06:30:00Z");
    assert.deepEqual(
      [sat.startDay, sat.endDay, sat.days],
      ["2026-10-19", "2026-10-24", 6],
    );
    const last = resolve("last-week", "2026-10-24T06:30:00Z");
    assert.deepEqual(
      [last.startDay, last.endDay, last.days],
      ["2026-10-12", "2026-10-18", 7],
    );
    const seven = resolve("last-7-days", "2026-10-24T06:30:00Z");
    assert.deepEqual(
      [seven.startDay, seven.endDay, seven.days],
      ["2026-10-18", "2026-10-24", 7],
    );
    assert.equal(sat.label, "Mon 19 Oct to Sat 24 Oct 2026");
  });

  it("Sunday belongs to the week that ends on it; Monday starts a new one", () => {
    const sunday = resolve("this-week", "2026-10-25T10:00:00Z"); // Sun 25 Oct 15:30 IST
    assert.deepEqual([sunday.startDay, sunday.endDay], ["2026-10-19", "2026-10-25"]);
    const monday = resolve("this-week", "2026-10-26T04:00:00Z"); // Mon 26 Oct 09:30 IST
    assert.deepEqual(
      [monday.startDay, monday.endDay, monday.days],
      ["2026-10-26", "2026-10-26", 1],
    );
    const lastFromMonday = resolve("last-week", "2026-10-26T04:00:00Z");
    assert.deepEqual(
      [lastFromMonday.startDay, lastFromMonday.endDay],
      ["2026-10-19", "2026-10-25"],
    );
  });

  it("uses the IST date, not the UTC one: 00:30 IST on Monday is still Sunday in UTC", () => {
    const early = resolve("this-week", "2026-10-25T19:00:00Z"); // Mon 26 Oct 00:30 IST
    assert.equal(early.endDay, "2026-10-26");
    assert.equal(early.startDay, "2026-10-26");
    const late = resolve("this-week", "2026-10-25T18:29:00Z"); // Sun 25 Oct 23:59 IST
    assert.equal(late.endDay, "2026-10-25");
  });

  it("the period is the half-open range from IST midnight to IST midnight", () => {
    const p = resolve("last-week", "2026-10-24T06:30:00Z");
    assert.equal(new Date(p.startMs).toISOString(), "2026-10-11T18:30:00.000Z"); // Mon 12 Oct 00:00 IST
    assert.equal(new Date(p.endMs).toISOString(), "2026-10-18T18:30:00.000Z"); // Mon 19 Oct 00:00 IST
  });

  it("rolls over a month, a year and a leap day", () => {
    const nov = resolve("last-week", "2026-11-03T05:00:00Z"); // Tue 3 Nov
    assert.deepEqual([nov.startDay, nov.endDay], ["2026-10-26", "2026-11-01"]);
    const seven = resolve("last-7-days", "2026-11-02T05:00:00Z");
    assert.equal(seven.startDay, "2026-10-27");
    const jan = resolve("this-week", "2027-01-01T05:00:00Z"); // Fri 1 Jan 2027
    assert.deepEqual(
      [jan.startDay, jan.endDay, jan.days],
      ["2026-12-28", "2027-01-01", 5],
    );
    assert.equal(jan.label, "Mon 28 Dec 2026 to Fri 1 Jan 2027");
    const lastJan = resolve("last-week", "2027-01-01T05:00:00Z");
    assert.deepEqual([lastJan.startDay, lastJan.endDay], ["2026-12-21", "2026-12-27"]);
    const leap = resolve("last-7-days", "2028-03-01T05:00:00Z");
    assert.equal(leap.startDay, "2028-02-24");
    assert.equal(
      resolve("custom", "2028-03-05T05:00:00Z", {
        start: "2028-02-28",
        end: "2028-03-01",
      }).days,
      3,
    );
  });

  it("checks a custom range", () => {
    const reason = (start, end) => {
      const r = resolvePeriod(request("custom", { start, end }), SAT, TZ);
      assert.equal(r.ok, false);
      return r.reason;
    };
    assert.match(reason("2026-10-20", "2026-10-19"), /after the end/);
    assert.match(reason("2026-10-20", "2026-10-30"), /future/);
    assert.match(reason("2026-02-30", "2026-03-01"), /not a real date/);
    assert.match(reason("2026-01-01", "2026-10-01"), /at most 92/);
    assert.match(reason("2025-01-01", "2025-01-10"), /more than a year/);
    // A single day, today, is fine.
    assert.equal(
      resolvePeriod(
        request("custom", { start: "2026-10-24", end: "2026-10-24" }),
        SAT,
        TZ,
      ).ok,
      true,
    );
    // The request schema refuses junk shapes before any of this.
    assert.equal(
      PeriodRequestSchema.safeParse({ kind: "custom", start: "yesterday", end: "today" })
        .success,
      false,
    );
    assert.equal(PeriodRequestSchema.safeParse({ kind: "next-year" }).success, false);
  });

  it("small helpers", () => {
    assert.equal(mondayOnOrBefore("2026-10-25"), "2026-10-19");
    assert.equal(mondayOnOrBefore("2026-10-26"), "2026-10-26");
    assert.equal(dayLabel("2026-10-24"), "Sat 24 Oct");
    assert.equal(dayLabel("nonsense"), "nonsense");
    assert.equal(rangeLabel("2026-10-24", "2026-10-24"), "Sat 24 Oct 2026");
  });
});

describe("what the report contains", () => {
  it("counts a to-do closed exactly at the start of the period, not one at the very end of the one before", () => {
    const boundary = done("2026-10-18T18:30:00.000Z", {
      title: "Closed at Monday 00:00 IST",
    });
    const justBefore = done("2026-10-18T18:29:59.999Z", {
      title: "Closed Sunday 23:59:59.999 IST",
    });
    const endOfWeek = done("2026-10-25T18:29:59.999Z", { title: "Closed Sunday night" });
    const nextWeek = done("2026-10-25T18:30:00.000Z", {
      title: "Closed Monday 00:00 next week",
    });
    const lastWeek = build(
      [boundary, justBefore, endOfWeek, nextWeek],
      at("2026-10-26T04:00:00Z"),
      request("last-week"),
    );
    // Exactly Monday 00:00 IST is in; one millisecond earlier (the week before) is out.
    assert.deepEqual(lastWeek.completed.map((i) => i.title).sort(), [
      "Closed Sunday night",
      "Closed at Monday 00:00 IST",
    ]);
    const thisWeek = build(
      [boundary, justBefore, endOfWeek, nextWeek],
      at("2026-10-27T04:00:00Z"),
      request("this-week"),
    );
    assert.deepEqual(
      thisWeek.completed.map((i) => i.title),
      ["Closed Monday 00:00 next week"],
    );
    // The closed day is the IST day.
    assert.equal(thisWeek.completed[0].closedDay, "2026-10-26");
  });

  it("completed: newest first, only done, with the owner; cancelled ones only add to a count", () => {
    const data = build([
      done("2026-10-20T05:00:00Z", { title: "Earlier", ownerName: "Sam" }),
      done("2026-10-23T05:00:00Z", { title: "Later" }),
      todo({ status: "cancelled", updatedAt: "2026-10-22T05:00:00Z", title: "Dropped" }),
      done("2026-10-01T05:00:00Z", { title: "Last month" }),
    ]);
    assert.deepEqual(
      data.completed.map((i) => i.title),
      ["Later", "Earlier"],
    );
    assert.equal(data.completed[1].owner, "Sam");
    assert.equal(data.summary.cancelled, 1);
    const text = renderMarkdown(data);
    assert.ok(!text.includes("Dropped"));
    assert.match(text, /- Cancelled this period: 1/);
  });

  it("closedAtOf falls back to the timeline, then to the last update", () => {
    const withHistory = todo({
      status: "done",
      completedAt: null,
      updatedAt: "2026-10-30T00:00:00Z",
      history: [
        {
          id: "hs_1",
          at: "2026-10-21T05:00:00Z",
          kind: "status",
          text: "Marked done.",
          intakeId: null,
          from: null,
        },
      ],
    });
    assert.equal(closedAtOf(withHistory), "2026-10-21T05:00:00Z");
    const bare = todo({
      status: "done",
      completedAt: null,
      updatedAt: "2026-10-22T05:00:00Z",
      history: [],
    });
    assert.equal(closedAtOf(bare), "2026-10-22T05:00:00Z");
    assert.equal(closedAtOf(todo()), null);
    const cancelled = todo({ status: "cancelled", updatedAt: "2026-10-22T05:00:00Z" });
    assert.equal(closedAtOf(cancelled), "2026-10-22T05:00:00Z");
    // A to-do reopened after being done is open work, not a completion.
    assert.equal(
      build([todo({ status: "open", completedAt: null })]).completed.length,
      0,
    );
  });

  it("new this period: by creation time, any status but cancelled", () => {
    const data = build([
      todo({ title: "New open", createdAt: "2026-10-20T05:00:00Z" }),
      done("2026-10-21T05:00:00Z", {
        title: "New and closed",
        createdAt: "2026-10-20T06:00:00Z",
      }),
      todo({ title: "Old", createdAt: "2026-10-10T05:00:00Z" }),
      todo({
        title: "New cancelled",
        createdAt: "2026-10-20T05:00:00Z",
        status: "cancelled",
        updatedAt: "2026-10-21T05:00:00Z",
      }),
    ]);
    assert.deepEqual(data.created.map((i) => i.title).sort(), [
      "New and closed",
      "New open",
    ]);
    assert.equal(data.created.find((i) => i.title === "New and closed").status, "done");
    assert.match(
      renderMarkdown(data),
      /New and closed \(Priya Nair\), added Tue 20 Oct, already closed/,
    );
  });

  it("overdue is judged against today in IST, with the days late; due today is not overdue", () => {
    const data = build([
      todo({ title: "Late 5", dueAt: "2026-10-19" }),
      todo({ title: "Late 1", dueAt: "2026-10-23" }),
      todo({ title: "Today", dueAt: "2026-10-24" }),
      todo({ title: "No date" }),
      done("2026-10-23T05:00:00Z", { title: "Closed late", dueAt: "2026-10-01" }),
    ]);
    assert.deepEqual(
      data.overdue.map((i) => [i.title, i.daysOverdue]),
      [
        ["Late 5", 5],
        ["Late 1", 1],
      ],
    );
    assert.equal(data.summary.overdue, 2);
    assert.ok(data.inProgress.some((i) => i.title === "Today"));
    assert.match(
      renderMarkdown(data),
      /Late 5 \(Priya Nair\): 5 days overdue \(was due Mon 19 Oct\)/,
    );
    assert.match(renderMarkdown(data), /Late 1 \(Priya Nair\): 1 day overdue/);
  });

  it("waiting on others: who, since when, how many days; clearing waiting removes it", () => {
    const waiting = todo({
      title: "Need the vendor quote",
      waitingOn: "Jordan Lee",
      waitingSince: "2026-10-19T04:00:00Z",
    });
    const cleared = todo({ title: "Got reply", waitingOn: null, waitingSince: null });
    const data = build([waiting, cleared]);
    assert.equal(data.waiting.length, 1);
    assert.equal(data.waiting[0].waitingOn, "Jordan Lee");
    assert.equal(data.waiting[0].sinceDay, "2026-10-19");
    assert.equal(data.waiting[0].days, 5);
    assert.equal(
      data.waiting[0].workingDays,
      4,
      "Tue-Fri; the day it started does not count",
    );
    assert.match(
      renderMarkdown(data),
      /waiting on Jordan Lee since Mon 19 Oct \(5 days\)/,
    );
    // Not also under "In progress", so each open item has one home besides the overdue/waiting overlap.
    assert.deepEqual(
      data.inProgress.map((i) => i.title),
      ["Got reply"],
    );
    // A to-do from before phase 4 (no waitingSince) is timed from its last update.
    const legacy = todo({
      waitingOn: "Sam",
      waitingSince: null,
      updatedAt: "2026-10-22T04:00:00Z",
    });
    assert.equal(build([legacy]).waiting[0].days, 2);
  });

  it("an item that is overdue and waiting appears in both lists, once in the totals of each", () => {
    const both = todo({
      title: "Late and waiting",
      dueAt: "2026-10-20",
      waitingOn: "Sam",
      waitingSince: "2026-10-20T04:00:00Z",
    });
    const data = build([both]);
    assert.equal(data.summary.open, 1);
    assert.equal(data.summary.overdue, 1);
    assert.equal(data.summary.waiting, 1);
    assert.equal(data.inProgress.length, 0);
    assert.match(renderMarkdown(data), /Open: 1 \(1 overdue, 1 waiting on others\)/);
    assert.match(renderMarkdown(data), /4 days overdue.*waiting on Sam/);
  });

  it("snoozed to-dos are still open work and are marked; an expired snooze is not", () => {
    const snoozed = todo({
      title: "Snoozed one",
      dueAt: "2026-10-21",
      reminders: {
        enabled: false,
        remindAt: null,
        snoozedUntil: "2026-10-26T03:30:00Z",
        lastRemindedAt: null,
      },
    });
    const expired = todo({
      title: "Expired snooze",
      reminders: {
        enabled: false,
        remindAt: null,
        snoozedUntil: "2026-10-20T03:30:00Z",
        lastRemindedAt: null,
      },
    });
    const data = build([snoozed, expired]);
    assert.equal(data.summary.open, 2);
    assert.equal(data.summary.snoozed, 1);
    assert.equal(data.overdue[0].title, "Snoozed one");
    const text = renderMarkdown(data);
    assert.match(text, /snoozed until Mon 26 Oct/);
    assert.match(text, /Open: 2 \(1 overdue, 1 snoozed\)/);
    assert.ok(!/Expired snooze.*snoozed/.test(text));
  });

  it("in progress shows steps done/total and the current stage; sorted soonest due first", () => {
    const withSteps = todo({ title: "Deck", dueAt: "2026-10-30" });
    withSteps.checkpoints = [
      { id: "cp_1", label: "Draft", kind: "step", state: "done", doneAt: "x" },
      { id: "cp_2", label: "Internal review", kind: "step", state: "pending" },
      { id: "cp_3", label: "Delivered", kind: "step", state: "pending" },
    ];
    const later = todo({ title: "Later", dueAt: "2026-11-20" });
    const undated = todo({ title: "Undated" });
    const data = build([undated, later, withSteps]);
    assert.deepEqual(
      data.inProgress.map((i) => i.title),
      ["Deck", "Later", "Undated"],
    );
    assert.deepEqual(data.inProgress[0].progress, {
      done: 1,
      total: 3,
      stage: "Internal review",
    });
    assert.match(
      renderMarkdown(data),
      /Deck \(Priya Nair\): 1\/3 steps, now at Internal review, due Fri 30 Oct/,
    );
  });

  it("due in the next 7 days covers today and six days; needs a decision is an approval step that is the current stage", () => {
    const approval = todo({ title: "Sign-off pack", dueAt: "2026-10-27" });
    approval.checkpoints = [
      { id: "cp_1", label: "Draft", kind: "step", state: "done" },
      { id: "cp_2", label: "Sign-off received", kind: "approval", state: "pending" },
    ];
    const notYet = todo({ title: "Approval later" });
    notYet.checkpoints = [
      { id: "cp_1", label: "Draft", kind: "step", state: "pending" },
      { id: "cp_2", label: "Sign-off received", kind: "approval", state: "pending" },
    ];
    const data = build([
      todo({ title: "Today", dueAt: "2026-10-24" }),
      todo({ title: "Day six", dueAt: "2026-10-30" }),
      todo({ title: "Day seven", dueAt: "2026-10-31" }),
      approval,
      notYet,
    ]);
    assert.deepEqual(
      data.dueNext.map((i) => i.title),
      ["Today", "Sign-off pack", "Day six"],
    );
    assert.deepEqual(data.upcoming, { startDay: "2026-10-24", endDay: "2026-10-30" });
    assert.deepEqual(
      data.decisions.map((i) => [i.title, i.checkpoint]),
      [["Sign-off pack", "Sign-off received"]],
    );
    const text = renderMarkdown(data);
    assert.match(text, /## Needs a decision \(1\)/);
    assert.match(
      text,
      /Sign-off pack \(Priya Nair\): decision pending at "Sign-off received", due Tue 27 Oct/,
    );
    assert.match(text, /## Due in the next 7 days \(Sat 24 Oct to Fri 30 Oct\) \(3\)/);
    // Without one, the section is left out.
    assert.ok(!renderMarkdown(build([todo()])).includes("Needs a decision"));
  });

  it("an empty period says so in every section and keeps the summary honest", () => {
    const text = renderMarkdown(build([]));
    assert.match(text, /^# Weekly status\n/);
    assert.match(text, /- Open: 0\n/);
    for (const heading of [
      "Completed this period",
      "In progress",
      "Overdue",
      "Waiting on others",
      "New this period",
    ]) {
      assert.match(text, new RegExp(`## ${heading} \\(0\\)\\n- None\\.`));
    }
  });

  it("unassigned owners and untitled to-dos read sensibly; a bad time zone falls back to IST", () => {
    const a = todo({
      title: "  ",
      owner: { name: null, email: "pat@example.com", isMe: null },
    });
    const b = todo({ title: "Nobody", owner: { name: " ", email: null, isMe: null } });
    const c = todo({ title: "Mine", owner: { name: null, email: null, isMe: true } });
    const data = build([a, b, c]);
    const owners = Object.fromEntries(data.inProgress.map((i) => [i.title, i.owner]));
    assert.equal(owners["(untitled)"], "pat@example.com");
    assert.equal(owners.Nobody, "Unassigned");
    assert.equal(owners.Mine, "Me");
    const odd = {
      ...config,
      reminders: { ...config.reminders, timeZone: "Mars/Olympus" },
    };
    assert.equal(build([], SAT, request("this-week"), odd).timeZone, TZ);
  });

  it("a header with a project name, from the config", () => {
    const named = { ...config, report: { title: "Status", projectName: "Atlas" } };
    const data = build([], SAT, request("this-week"), named);
    assert.equal(data.title, "Atlas: Status");
    assert.match(renderMarkdown(data), /^# Atlas: Status\n/);
    assert.equal(reportSubject(data), "Atlas: Status: Mon 19 Oct to Sat 24 Oct 2026");
    const blank = { ...config, report: { title: "  ", projectName: " " } };
    assert.equal(build([], SAT, request("this-week"), blank).title, "Weekly status");
  });

  it("the config carries the report block, with defaults and strict edits", () => {
    assert.deepEqual(PmoConfigSchema.parse({}).report, {
      title: "Weekly status",
      projectName: "",
    });
    assert.deepEqual(PmoConfigSchema.parse({ report: { projectName: "Atlas" } }).report, {
      title: "Weekly status",
      projectName: "Atlas",
    });
    // A bad hand-edit falls back for this block only.
    const broken = PmoConfigSchema.parse({ retentionDays: 30, report: { title: 5 } });
    assert.equal(broken.retentionDays, 30);
    assert.equal(broken.report.title, "Weekly status");
    const edit = (report) => PmoConfigPatchSchema.safeParse({ report });
    assert.equal(edit({ title: "Weekly", projectName: "" }).success, true);
    assert.match(
      edit({ title: "   ", projectName: "" }).error.issues[0].message,
      /Enter a title/,
    );
    assert.match(
      edit({ title: "x".repeat(81), projectName: "" }).error.issues[0].message,
      /At most 80/,
    );
    assert.match(
      edit({ title: "ok", projectName: "y".repeat(81) }).error.issues[0].message,
      /At most 80/,
    );
  });
});

describe("long lists", () => {
  const many = (n) =>
    Array.from({ length: n }, (_, i) =>
      done(`2026-10-2${(i % 4) + 0}T05:${String(i).padStart(2, "0")}:00Z`, {
        title: `Done item ${String(i).padStart(2, "0")}`,
      }),
    );

  it("caps each section at 10 with '+N more', but the data and the full render keep everything", () => {
    const data = build(many(25));
    assert.equal(data.completed.length, 25);
    assert.equal(isCapped(data), true);
    const text = renderMarkdown(data);
    assert.match(text, /## Completed this period \(25\)/);
    assert.equal(text.match(/^- Done item/gm).length, DEFAULT_MAX_PER_SECTION);
    assert.match(text, /- \+15 more\n/);
    const full = renderMarkdown(data, { maxPerSection: Number.POSITIVE_INFINITY });
    assert.equal(full.match(/^- Done item/gm).length, 25);
    assert.ok(!full.includes("more\n"));
    assert.equal(isCapped(build(many(10))), false);
    assert.ok(!renderMarkdown(build(many(10))).includes("+0 more"));
    // A smaller cap works too.
    assert.match(renderMarkdown(data, { maxPerSection: 3 }), /- \+22 more/);
  });
});

describe("escaping", () => {
  const hostile = [
    "<script>alert(1)</script>",
    "[click me](javascript:alert(1))",
    "Real title\n## Fake heading\n- fake bullet",
    "**bold** `code` _under_ ~strike~ | pipe |",
    `RTL ${String.fromCharCode(0x202e)}evil${String.fromCharCode(0x202c)} and ${String.fromCharCode(7)} bell and zero${String.fromCharCode(0x200b)}width`,
  ];

  it("keeps hostile titles, owners and waiting-on inert and on one line", () => {
    const todos = hostile.map((title, i) =>
      todo({
        title,
        ownerName: `Owner <b>${i}</b>`,
        dueAt: "2026-10-20",
        waitingOn: `Vendor [x](http://evil) ${i}`,
        waitingSince: "2026-10-20T04:00:00Z",
      }),
    );
    const md = renderMarkdown(build(todos));
    // No raw angle brackets, so nothing can become HTML.
    assert.ok(!/<|>/.test(md.replace(/\\[<>]/g, "")), "every < and > is escaped");
    // Escaped Markdown characters cannot form a link or emphasis.
    assert.ok(!/(^|[^\\])\[/.test(md), "every [ is escaped");
    assert.ok(
      !/(^|[^\\])[*_`~|]/.test(
        md
          .split("\n")
          .filter((l) => l.startsWith("- ") && /Real title|bold|click|script/.test(l))
          .join("\n"),
      ),
    );
    // The newline in a title cannot add a heading or a bullet.
    assert.equal((md.match(/^## Fake heading/gm) ?? []).length, 0);
    assert.equal((md.match(/^- fake bullet/gm) ?? []).length, 0);
    const headings = md.split("\n").filter((l) => l.startsWith("#"));
    assert.deepEqual(
      headings.map((h) => h.replace(/ \(.*$/, "")),
      [
        "# Weekly status",
        "## Summary",
        "## Completed this period",
        "## In progress",
        "## Overdue",
        "## Waiting on others",
        "## Due in the next 7 days",
        "## New this period",
      ],
    );
    // Control and bidi characters are gone.
    assert.ok(
      !new RegExp(
        "[" +
          [
            [0, 8],
            [0x0b, 0x1f],
            [0x7f, 0x7f],
            [0x200b, 0x200f],
            [0x202a, 0x202e],
            [0x2066, 0x2069],
          ]
            .map(([a, b]) => String.fromCharCode(a) + "-" + String.fromCharCode(b))
            .join("") +
          "]",
      ).test(md),
    );
    // The words stay, flattened onto the one bullet.
    assert.ok(md.includes("- Real title ## Fake heading - fake bullet (Owner"));
  });

  it("plain text shows what the person typed, unescaped, and is never HTML", () => {
    const md = renderMarkdown(build([todo({ title: "<b>Q4</b> [plan] *draft*" })]));
    const text = markdownToPlainText(md);
    assert.match(text, /• <b>Q4<\/b> \[plan\] \*draft\* \(Priya Nair\)/);
    assert.ok(!text.includes("\\"));
    assert.equal(
      renderPlainText(build([todo({ title: "Plain" })])),
      markdownToPlainText(renderMarkdown(build([todo({ title: "Plain" })]))),
    );
  });

  it("esc collapses whitespace and handles null", () => {
    assert.equal(esc("  a \n\t b  "), "a b");
    assert.equal(esc(null), "");
    assert.equal(esc("a_b*c"), "a\\_b\\*c");
  });
});

describe("markdown to plain text", () => {
  it("turns headings, bullets, emphasis and links into text for Outlook or Teams", () => {
    const text = markdownToPlainText(
      "# Title\n\nPeriod: x\n\n## Summary\n- Open: **3** and *two*\n- See [the plan](https://example.com/p)\n\n\n\n## Next\n- `code` and __bold__\n",
    );
    assert.equal(
      text,
      "Title\n\nPeriod: x\n\nSummary\n• Open: 3 and two\n• See the plan (https://example.com/p)\n\nNext\n• code and bold\n",
    );
  });

  it("keeps escaped characters as characters and handles CRLF and an empty string", () => {
    assert.equal(
      markdownToPlainText("- a \\*not bold\\* and \\_x\\_ and 2 \\* 3\r\n"),
      "• a *not bold* and _x_ and 2 * 3\n",
    );
    assert.equal(markdownToPlainText(""), "\n");
  });

  it("a whole report converts without tables, markup or backslashes left behind", () => {
    const data = build([
      todo({ title: "Plan_v2 *final*", dueAt: "2026-10-20" }),
      done("2026-10-22T05:00:00Z", { title: "Shipped" }),
    ]);
    const text = renderPlainText(data);
    assert.ok(!/[#`|\\]/.test(text.replace("Plan_v2 *final*", "")));
    assert.match(
      text,
      /^Weekly status\n\nPeriod: Mon 19 Oct to Sat 24 Oct 2026\nStatus as of Sat 24 Oct 2026\n\nSummary\n• Open: 1 \(1 overdue\)/,
    );
    assert.match(text, /• Plan_v2 \*final\* \(Priya Nair\): 4 days overdue/);
  });
});
