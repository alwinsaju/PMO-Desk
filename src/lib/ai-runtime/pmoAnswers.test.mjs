import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { createEmployee } from "../staff/employees.ts";
import { createTimeOff } from "../staff/timeoff.ts";
import { answerPmoIntent } from "./pmoAnswers.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...parts) => readFileSync(path.join(here, "..", "..", ...parts), "utf8");

// Fri 30 Oct 2026, 10:00 in Kolkata.
const NOW = new Date("2026-10-30T04:30:00.000Z");
const prefs = { timeZone: "Asia/Kolkata", workDays: [1, 2, 3, 4, 5], chaserDays: 2 };

const ana = createEmployee(
  {
    id: "emp_000000000001",
    firstName: "Ana",
    lastName: "Rao",
    deloitteEmail: "ana@x.com",
  },
  NOW.toISOString(),
);
const staff = (over = {}) => ({
  employees: [ana],
  timeOff: [
    createTimeOff(
      {
        employeeId: ana.id,
        startDate: "2026-11-02",
        endDate: "2026-11-03",
        status: "approved",
      },
      NOW.toISOString(),
    ),
  ],
  shifts: [],
  members: [],
  events: [],
  ...over,
});
const todo = (over = {}) => ({
  id: "todo_00000001",
  title: "Release plan",
  owner: { name: "Ana", email: null, isMe: true },
  status: "open",
  dueAt: null,
  priority: "normal",
  waitingOn: null,
  waitingSince: null,
  updatedAt: NOW.toISOString(),
  chaserDays: null,
  ...over,
});

const deps = (over = {}) => ({
  now: () => NOW,
  timeZone: async () => "Asia/Kolkata",
  staff: async () => staff(),
  pmo: async () => ({ todos: [], prefs }),
  ...over,
});

describe("who is off", () => {
  it("answers for a named day from the staff data", async () => {
    const out = await answerPmoIntent({ kind: "whos_off", when: "next Monday" }, deps());
    assert.deepEqual(out, {
      type: "message",
      text: "Off on Mon 2 Nov 2026 (1 person):\n• Ana Rao (PTO)",
    });
  });

  it("says nobody is off when that is true", async () => {
    const out = await answerPmoIntent({ kind: "whos_off", when: "today" }, deps());
    assert.equal(out.text, "Nobody is off on Fri 30 Oct 2026.");
  });

  it("uses the reminder time zone to decide what today is", async () => {
    // 22:00 UTC on the 29th is already the 30th in Kolkata but still the 29th in UTC.
    const late = new Date("2026-10-29T22:00:00.000Z");
    const out = await answerPmoIntent(
      { kind: "whos_off", when: "" },
      deps({ now: () => late }),
    );
    assert.match(out.text, /Fri 30 Oct 2026/);
    const utc = await answerPmoIntent(
      { kind: "whos_off", when: "" },
      deps({ now: () => late, timeZone: async () => "UTC" }),
    );
    assert.match(utc.text, /Thu 29 Oct 2026/);
  });

  it("asks again when it cannot read the day, without touching the staff data", async () => {
    let touched = false;
    const out = await answerPmoIntent(
      { kind: "whos_off", when: "blue moon" },
      deps({ staff: async () => ((touched = true), staff()) }),
    );
    assert.match(out.text, /couldn't tell which day "blue moon"/);
    assert.doesNotMatch(out.text, /Did you mean/);
    assert.equal(touched, false);
  });

  it("offers the nearest spelling when the day looks like a typo", async () => {
    const out = await answerPmoIntent({ kind: "whos_off", when: "next mondy" }, deps());
    assert.match(out.text, /couldn't tell which day "next mondy"/);
    assert.match(out.text, /Did you mean "next monday"\?/);
  });

  it("includes a request that is waiting for approval, and says so", async () => {
    const pending = createTimeOff(
      {
        employeeId: ana.id,
        startDate: "2026-11-04",
        endDate: "2026-11-04",
        status: "pending",
      },
      NOW.toISOString(),
    );
    const out = await answerPmoIntent(
      { kind: "whos_off", when: "4 Nov" },
      deps({ staff: async () => staff({ timeOff: [pending] }) }),
    );
    assert.match(out.text, /Ana Rao \(PTO, waiting for approval\)/);
  });
});

describe("people and changes", () => {
  const ben = createEmployee(
    {
      id: "emp_000000000002",
      firstName: "Ben",
      lastName: "Cole",
      deloitteEmail: "b@x.com",
    },
    NOW.toISOString(),
  );
  const leave = (
    employee,
    start,
    end,
    status = "approved",
    createdAt = NOW.toISOString(),
  ) =>
    createTimeOff(
      { employeeId: employee.id, startDate: start, endDate: end, status },
      createdAt,
    );
  const two = (over = {}) =>
    deps({ staff: async () => staff({ employees: [ana, ben], ...over }) });

  it("says when someone is back, skipping the weekend", async () => {
    // Ana is off Mon 2 to Tue 3 Nov; today is Fri 30 Oct, so she is in today and next off Monday.
    const out = await answerPmoIntent({ kind: "person_back", name: "ana" }, deps());
    assert.match(
      out.text,
      /Ana Rao is not off today\. Next time off: PTO, Mon 2 Nov 2026 to Tue 3 Nov 2026/,
    );
    const today = await answerPmoIntent(
      { kind: "person_back", name: "Ana Rao" },
      two({ timeOff: [leave(ana, "2026-10-29", "2026-10-30")] }),
    );
    assert.match(today.text, /off today \(PTO\) and is back on Mon 2 Nov 2026/);
  });

  it("asks which person when a name matches several, and says when nobody does", async () => {
    const dup = createEmployee(
      {
        id: "emp_000000000003",
        firstName: "Ana",
        lastName: "Silva",
        deloitteEmail: "s@x.com",
      },
      NOW.toISOString(),
    );
    const several = await answerPmoIntent(
      { kind: "person_back", name: "Ana" },
      deps({ staff: async () => staff({ employees: [ana, dup] }) }),
    );
    assert.match(several.text, /More than one person matches "Ana": Ana Rao, Ana Silva/);
    const none = await answerPmoIntent({ kind: "person_back", name: "Zed" }, deps());
    assert.equal(none.text, 'I couldn\'t find anyone called "Zed" in Staff.');
  });

  it("names a person's shift for a day", async () => {
    const schedules = [
      {
        id: "s1",
        name: "Core",
        shifts: [{ id: "n", label: "Shift-3", start: "22:00", end: "06:00", days: [] }],
      },
    ];
    const data = {
      members: [{ id: "m1", name: "Ben Cole", employeeId: ben.id }],
      shifts: [{ id: "m1|2026-10-31", memberId: "m1", date: "2026-10-31", ref: "s1:n" }],
      schedules,
    };
    const out = await answerPmoIntent(
      { kind: "person_shift", name: "Ben", when: "tomorrow" },
      two(data),
    );
    assert.equal(out.text, "Ben Cole on Sat 31 Oct 2026: Shift-3 (22:00 to 06:00 IST).");
    const none = await answerPmoIntent(
      { kind: "person_shift", name: "Ben", when: "today" },
      two(data),
    );
    assert.match(none.text, /nothing on the shift roster/);
    const unlisted = await answerPmoIntent(
      { kind: "person_shift", name: "Ana", when: "today" },
      two(data),
    );
    assert.match(unlisted.text, /not on the shift roster/);
  });

  it("lists what changed since a day", async () => {
    const yesterday = "2026-10-29T06:00:00.000Z";
    const old = "2026-10-01T06:00:00.000Z";
    const out = await answerPmoIntent(
      { kind: "changes", since: "yesterday" },
      deps({
        pmo: async () => ({
          todos: [
            todo({ title: "Fresh", createdAt: yesterday }),
            todo({
              id: "todo_00000002",
              title: "Wrapped up",
              status: "done",
              createdAt: old,
              completedAt: NOW.toISOString(),
            }),
            todo({ id: "todo_00000003", title: "Ancient", createdAt: old }),
          ],
          prefs,
        }),
        staff: async () =>
          staff({
            employees: [ana, ben],
            timeOff: [leave(ben, "2026-11-10", "2026-11-11", "pending", yesterday)],
          }),
      }),
    );
    assert.match(out.text, /^Since Thu 29 Oct 2026:/);
    assert.match(out.text, /New to-dos \(1\):\n• Fresh/);
    assert.match(out.text, /Closed to-dos \(1\):\n• Wrapped up/);
    assert.match(
      out.text,
      /New time-off requests \(1\):\n• Ben Cole: PTO, Tue 10 Nov 2026 to Wed 11 Nov 2026/,
    );
    assert.doesNotMatch(out.text, /Ancient/);
  });

  it("says so when nothing changed or the day is unreadable", async () => {
    const quiet = await answerPmoIntent(
      { kind: "changes", since: "" },
      deps({ staff: async () => staff({ timeOff: [] }) }),
    );
    assert.match(
      quiet.text,
      /^Nothing in to-dos or time off has changed since Thu 29 Oct 2026\./,
    );
    const bad = await answerPmoIntent({ kind: "changes", since: "blue moon" }, deps());
    assert.match(bad.text, /couldn't tell which day "blue moon"/);
  });
});

describe("PMO status", () => {
  const todos = [
    todo({ id: "todo_00000001", title: "Late one", dueAt: "2026-10-27" }),
    todo({
      id: "todo_00000002",
      title: "Quiet",
      waitingOn: "Sam",
      waitingSince: "2026-10-26T04:00:00.000Z",
    }),
    todo({ id: "todo_00000003", title: "Done", status: "done", dueAt: "2026-10-01" }),
  ];
  const withTodos = deps({ pmo: async () => ({ todos, prefs }) });

  it("lists what is overdue", async () => {
    const out = await answerPmoIntent(
      { kind: "pmo_status", topic: "overdue" },
      withTodos,
    );
    assert.equal(out.text, "1 to-do overdue:\n• Late one (Overdue by 3 days, Ana)");
  });

  it("lists every overdue to-do, not just the first few", async () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      todo({ id: `todo_0000010${i}`, title: `Late ${i}`, dueAt: "2026-10-20" }),
    );
    const out = await answerPmoIntent(
      { kind: "pmo_status", topic: "overdue" },
      deps({ pmo: async () => ({ todos: many, prefs }) }),
    );
    assert.match(out.text, /^9 to-dos overdue:/);
    assert.equal(out.text.split("\n").at(-1), "+3 more");
  });

  it("lists who to chase, and summarises", async () => {
    const chasers = await answerPmoIntent(
      { kind: "pmo_status", topic: "chasers" },
      withTodos,
    );
    assert.equal(
      chasers.text,
      "1 chaser due:\n• Quiet: waiting on Sam, 4 working days quiet",
    );
    const summary = await answerPmoIntent(
      { kind: "pmo_status", topic: "summary" },
      withTodos,
    );
    assert.equal(
      summary.text.split("\n")[0],
      "2 open to-dos: 1 overdue, 1 waiting on others.",
    );
  });

  it("with nothing open, says so", async () => {
    const out = await answerPmoIntent({ kind: "pmo_status", topic: "open" }, deps());
    assert.equal(out.text, "No open to-dos.");
  });
});

describe("preparing a task", () => {
  it("turns a known task into an action for the bar, and only that", async () => {
    const out = await answerPmoIntent(
      { kind: "prepare_task", taskId: "weekly-aging-report" },
      deps(),
    );
    assert.deepEqual(out, {
      type: "action",
      name: "prepare_task",
      arguments: { taskId: "weekly-aging-report" },
    });
  });

  it("refuses a task that does not exist", async () => {
    const out = await answerPmoIntent(
      { kind: "prepare_task", taskId: "../../etc" },
      deps(),
    );
    assert.equal(out.type, "error");
  });
});

describe("the command route", () => {
  const route = read("app", "api", "ai", "command", "route.ts");
  const pmoRoute = read("app", "api", "ai", "pmo", "route.ts");

  it("offers the PMO tools on every call and checks the tool name against an allowlist", () => {
    assert.match(route, /\[\.\.\.WINDOW_TOOLS, \.\.\.PMO_TOOLS\]/);
    assert.match(
      route,
      /PMO_TOOL_NAMES: readonly PmoToolName\[\] = \["whos_off", "pmo_status", "prepare_task"\]/,
    );
    assert.match(route, /isPmoToolName\(name\)/);
  });

  it("runs the PMO tools by code from the real data, never from the model's text", () => {
    assert.match(route, /answerPmoIntent\(intent, livePmoDeps\)/);
  });

  it("the no-model PMO route validates its body and is not cacheable", () => {
    assert.match(pmoRoute, /intentSchema\.safeParse/);
    assert.match(pmoRoute, /dynamic = "force-dynamic"/);
    assert.match(pmoRoute, /readBodyCapped\(request, BODY_BYTES\)/);
  });

  it("the bar sends recognised PMO questions to the no-model route", () => {
    const bar = read("components", "ai-layer", "CommandBar.tsx");
    assert.match(bar, /resolvePmoIntent\(prompt\)/);
    assert.match(bar, /pmoIntent \? "\/api\/ai\/pmo" : "\/api\/ai\/command"/);
  });
});
