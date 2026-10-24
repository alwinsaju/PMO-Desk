// Run with `pnpm test`. Phase 4 waiting rules: carrying "waiting on" from an
// approved draft, the since-date, mark / clear, per-to-do chaser cadence, the
// chaser clock (waitingSince, else the last update), history and its cap. Pure.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attentionSummary,
  chaserClockStart,
  computeDue,
  waitingState,
} from "./due.ts";
import {
  TodoPatchSchema,
  appendHistory,
  applyTodoPatch,
  buildTodo,
  emptyDraft,
  historyEntry,
} from "./todoLogic.ts";
import { MAX_HISTORY, defaultReminderPrefs } from "./types.ts";

const ist = (stamp) => new Date(`${stamp}:00+05:30`); // 2026-10-26 is a Monday
const prefs = (patch = {}) => ({ ...defaultReminderPrefs(), ...patch });
const SOURCE = {
  intakeId: null,
  source: "manual",
  link: null,
  subject: "x",
  sender: null,
  receivedAt: null,
  threadKey: null,
};
const build = (draft = {}, now = "2026-10-19T06:30:00.000Z") =>
  buildTodo({ ...emptyDraft("Chase the figures"), ...draft }, {
    now,
    approvedBy: "tester",
    source: SOURCE,
  });
const patch = (todo, p, now = "2026-10-21T06:30:00.000Z") =>
  applyTodoPatch(todo, TodoPatchSchema.parse(p), now);

describe("approving a draft that is waiting", () => {
  it("carries waitingOn over, trimmed, with since = the approval time", () => {
    const todo = build({ waitingOn: "  Jordan Sample " });
    assert.equal(todo.waitingOn, "Jordan Sample");
    assert.equal(todo.waitingSince, "2026-10-19T06:30:00.000Z");
    assert.equal(todo.chaserDays, null);
    assert.deepEqual(
      todo.history.map((h) => h.kind),
      ["created", "waiting"],
    );
  });

  it("uses the draft's own since-date when it has one", () => {
    const todo = build({
      waitingOn: "Jordan Sample",
      waitingSince: "2026-10-15T04:00:00.000Z",
    });
    assert.equal(todo.waitingSince, "2026-10-15T04:00:00.000Z");
  });

  it("is not waiting for a blank or missing name", () => {
    for (const waitingOn of [null, "", "   "]) {
      const todo = build({ waitingOn });
      assert.equal(todo.waitingOn, null);
      assert.equal(todo.waitingSince, null);
    }
  });
});

describe("mark and clear waiting (PATCH)", () => {
  it("marking starts the clock now and writes the timeline", () => {
    const { todo, kinds } = patch(build(), { waitingOn: " Priya Nair " });
    assert.equal(todo.waitingOn, "Priya Nair");
    assert.equal(todo.waitingSince, "2026-10-21T06:30:00.000Z");
    assert.ok(kinds.includes("waiting") && kinds.includes("edit"));
    assert.equal(todo.history.at(-1).kind, "waiting");
    assert.match(todo.history.at(-1).text, /Waiting on Priya Nair/);
  });

  it("can backdate the start, and saving the same name again changes nothing", () => {
    const marked = patch(build(), {
      waitingOn: "Priya Nair",
      waitingSince: "2026-10-14T04:00:00.000Z",
    }).todo;
    assert.equal(marked.waitingSince, "2026-10-14T04:00:00.000Z");
    const again = patch(marked, { waitingOn: "Priya Nair" }, "2026-10-22T06:30:00.000Z");
    assert.equal(again.todo.waitingSince, "2026-10-14T04:00:00.000Z");
    assert.equal(again.todo.history.length, marked.history.length, "no new timeline line");
    assert.ok(!again.kinds.includes("waiting"));
    // Moving the since-date alone (the to-do is waiting) just moves it.
    const moved = patch(marked, { waitingSince: "2026-10-16T04:00:00.000Z" }).todo;
    assert.equal(moved.waitingSince, "2026-10-16T04:00:00.000Z");
  });

  it("waiting on someone else restarts the clock", () => {
    const first = patch(build(), { waitingOn: "Priya Nair" }).todo;
    const second = patch(first, { waitingOn: "Sam Example" }, "2026-10-23T06:30:00.000Z").todo;
    assert.equal(second.waitingSince, "2026-10-23T06:30:00.000Z");
  });

  it("clearing ('got a reply') drops the since-date and is on the timeline", () => {
    const waiting = patch(build(), { waitingOn: "Priya Nair" }).todo;
    const { todo, kinds } = patch(waiting, { waitingOn: null }, "2026-10-22T06:30:00.000Z");
    assert.equal(todo.waitingOn, null);
    assert.equal(todo.waitingSince, null);
    assert.ok(kinds.includes("waiting"));
    assert.match(todo.history.at(-1).text, /no longer waiting \(was waiting on Priya Nair\)/);
    // A blank string clears too.
    assert.equal(patch(waiting, { waitingOn: "  " }).todo.waitingOn, null);
  });

  it("sets and clears a per-to-do chaser cadence, within bounds", () => {
    const todo = patch(build({ waitingOn: "P" }), { chaserDays: 5 }).todo;
    assert.equal(todo.chaserDays, 5);
    assert.equal(patch(todo, { chaserDays: null }).todo.chaserDays, null);
    assert.equal(TodoPatchSchema.safeParse({ chaserDays: 0 }).success, false);
    assert.equal(TodoPatchSchema.safeParse({ chaserDays: 31 }).success, false);
    assert.equal(TodoPatchSchema.safeParse({ chaserDays: 1.5 }).success, false);
  });

  it("records due-date and status changes on the timeline", () => {
    const todo = build({ dueAt: "2026-10-30" });
    const moved = patch(todo, { dueAt: "2026-11-03" }).todo;
    assert.match(moved.history.at(-1).text, /2026-10-30 → 2026-11-03/);
    const done = patch(moved, { status: "done" }).todo;
    assert.equal(done.history.at(-1).text, "Marked done.");
    assert.equal(patch(done, { status: "open" }).todo.history.at(-1).text, "Reopened.");
  });
});

describe("the chaser clock", () => {
  const waiting = (patchTodo = {}) => ({
    ...build({ waitingOn: "Sam Example" }),
    ...patchTodo,
  });

  it("starts at waitingSince, and falls back to the last update for an older to-do", () => {
    assert.equal(
      chaserClockStart({ waitingSince: "2026-10-19T06:30:00.000Z", updatedAt: "2026-10-25T00:00:00.000Z" }),
      "2026-10-19T06:30:00.000Z",
    );
    assert.equal(
      chaserClockStart({ waitingSince: null, updatedAt: "2026-10-25T00:00:00.000Z" }),
      "2026-10-25T00:00:00.000Z",
    );
    assert.equal(chaserClockStart({ waitingSince: undefined, updatedAt: "nonsense" }), null);
  });

  it("an edit after marking waiting does not restart the clock", () => {
    // Waiting since Monday 19; edited (title) on Wednesday 21: chaser still due on the 21st.
    const todo = waiting({ updatedAt: ist("2026-10-21T09:30").toISOString() });
    const due = computeDue([todo], ist("2026-10-21T10:00"), prefs());
    assert.deepEqual(
      due.map((n) => n.kind),
      ["chaser"],
    );
    assert.match(due[0].body, /Waiting on Sam Example with no update for 2 working days/);
  });

  it("uses the to-do's own cadence over the global one, and the global one otherwise", () => {
    const base = waiting({ waitingSince: ist("2026-10-19T12:00").toISOString() });
    const at = ist("2026-10-20T10:00"); // 1 working day later
    assert.deepEqual(computeDue([base], at, prefs()), []);
    assert.equal(computeDue([{ ...base, chaserDays: 1 }], at, prefs()).length, 1);
    const later = ist("2026-10-22T10:00"); // 3 working days
    assert.deepEqual(computeDue([{ ...base, chaserDays: 5 }], later, prefs({ chaserDays: 1 })), []);
    assert.equal(computeDue([base], later, prefs({ chaserDays: 1 })).length, 1);
    // Each repeat is another N days, so the dedupe key moves with the cadence.
    const round = (n) =>
      computeDue([{ ...base, chaserDays: n }], ist("2026-10-23T10:00"), prefs())[0]?.key;
    assert.notEqual(round(1), round(2));
  });

  it("describes the waiting state for the row and the panel", () => {
    const todo = waiting({ waitingSince: ist("2026-10-19T12:00").toISOString(), chaserDays: 3 });
    const state = waitingState(todo, ist("2026-10-23T10:00"), prefs());
    assert.deepEqual(
      { ...state },
      {
        quietDays: 4,
        calendarDays: 4,
        everyDays: 3,
        chaseDue: true,
        round: 1,
        sinceDay: "2026-10-19",
      },
    );
    assert.equal(waitingState({ ...todo, waitingOn: null }, ist("2026-10-23T10:00"), prefs()), null);
    assert.equal(waitingState({ ...todo, status: "done" }, ist("2026-10-23T10:00"), prefs()), null);
  });

  it("the badge counts a to-do once it passes its own cadence", () => {
    const todo = waiting({ waitingSince: ist("2026-10-19T12:00").toISOString() });
    const now = ist("2026-10-21T10:00");
    assert.equal(attentionSummary([todo], now, prefs()).waiting, 1);
    assert.equal(attentionSummary([{ ...todo, chaserDays: 5 }], now, prefs()).waiting, 0);
  });
});

describe("history", () => {
  it("keeps the first entry and the newest ones within the cap", () => {
    let history = [historyEntry("created", "first", "2026-10-01T00:00:00Z")];
    for (let i = 0; i < MAX_HISTORY + 20; i++) {
      history = appendHistory(history, historyEntry("message", `m${i}`, "2026-10-02T00:00:00Z"));
    }
    assert.equal(history.length, MAX_HISTORY);
    assert.equal(history[0].text, "first");
    assert.equal(history.at(-1).text, `m${MAX_HISTORY + 19}`);
    assert.equal(history[1].text, `m${20 + 1}`);
  });
});
