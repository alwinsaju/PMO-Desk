// Run with `pnpm test`. Next occurrence of a repeating to-do: pure calendar
// arithmetic on YYYY-MM-DD days, "today" judged in the configured time zone.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTodo, emptyDraft } from "./todoLogic.ts";
import { TodoDraftSchema } from "./types.ts";
import { nextOccurrence, nextTodoDraft, parseRecurrence } from "./recurrence.ts";

const KOLKATA = "Asia/Kolkata";
const todo = (recurrence, dueAt = null, title = "Send the RAID log") => ({
  title,
  recurrence,
  dueAt,
});
const next = (recurrence, dueAt, doneAt, timeZone = "Etc/UTC") =>
  nextOccurrence(todo(recurrence, dueAt), doneAt, timeZone)?.dueAt ?? null;
// 2026-10-28 is a Wednesday.
const WED = "2026-10-28T05:00:00Z";

describe("parseRecurrence", () => {
  it("reads the cadences the model and the form produce", () => {
    for (const text of ["daily", "Every day", "each day", "every 1 day"]) {
      assert.deepEqual(parseRecurrence(text), { kind: "days", n: 1 }, text);
    }
    for (const text of ["weekly", "every week", "Weekly, before Tuesday", "each week"]) {
      assert.deepEqual(parseRecurrence(text), { kind: "days", n: 7 }, text);
    }
    for (const text of [
      "every 2 weeks",
      "every two weeks",
      "fortnightly",
      "every other week",
    ]) {
      assert.deepEqual(parseRecurrence(text), { kind: "days", n: 14 }, text);
    }
    assert.deepEqual(parseRecurrence("every 3 days"), { kind: "days", n: 3 });
    assert.deepEqual(parseRecurrence("every weekday"), { kind: "weekdays" });
    assert.deepEqual(parseRecurrence("weekdays"), { kind: "weekdays" });
    assert.deepEqual(parseRecurrence("every Monday"), { kind: "weekdays-of", days: [1] });
    assert.deepEqual(parseRecurrence("every Mon and Thursday"), {
      kind: "weekdays-of",
      days: [1, 4],
    });
    assert.deepEqual(parseRecurrence("monthly"), { kind: "months", n: 1 });
    assert.deepEqual(parseRecurrence("every 2 months"), { kind: "months", n: 2 });
    assert.deepEqual(parseRecurrence("each quarter"), { kind: "months", n: 3 });
    assert.deepEqual(parseRecurrence("quarterly"), { kind: "months", n: 3 });
    assert.deepEqual(parseRecurrence("yearly"), { kind: "months", n: 12 });
    assert.deepEqual(parseRecurrence("annually"), { kind: "months", n: 12 });
    assert.deepEqual(parseRecurrence("every year"), { kind: "months", n: 12 });
  });

  it("does not guess at what it does not understand", () => {
    for (const text of [
      "",
      "   ",
      null,
      undefined,
      "whenever",
      "twice a week",
      "bi-monthly",
      "every 2nd Tuesday",
      "every first Monday",
      "every 0 days",
      "every 500 days",
      "sometimes weekly",
    ]) {
      assert.equal(parseRecurrence(text), null, String(text));
    }
  });
});

describe("nextOccurrence", () => {
  it("returns the due date and the title, null when the text is not understood", () => {
    assert.deepEqual(nextOccurrence(todo("weekly", "2026-10-28"), WED, "Etc/UTC"), {
      dueAt: "2026-11-04",
      title: "Send the RAID log",
    });
    assert.equal(nextOccurrence(todo("when the moon is full", "2026-10-28"), WED), null);
    assert.equal(nextOccurrence(todo(null, "2026-10-28"), WED), null);
    assert.equal(next("weekly", "2026-10-28", "not a date"), null);
  });

  it("daily moves one day; with no due date it counts from today in the configured zone", () => {
    assert.equal(next("daily", "2026-10-28", WED), "2026-10-29");
    // 20:00Z is already the 29th in Kolkata.
    assert.equal(next("daily", null, "2026-10-28T20:00:00Z", KOLKATA), "2026-10-30");
    assert.equal(next("daily", null, "2026-10-28T20:00:00Z", "Etc/UTC"), "2026-10-29");
    assert.equal(
      next("daily", null, "2026-10-28T20:00:00Z", "No/Such_Zone"),
      "2026-10-30",
    );
  });

  it("weekdays skip the weekend", () => {
    assert.equal(next("every weekday", "2026-10-29", WED), "2026-10-30"); // Thu -> Fri
    assert.equal(next("every weekday", "2026-10-30", WED), "2026-11-02"); // Fri -> Mon
    assert.equal(next("weekdays", "2026-10-31", WED), "2026-11-02"); // Sat -> Mon
    assert.equal(next("weekdays", "2026-11-01", WED), "2026-11-02"); // Sun -> Mon
  });

  it("weekly and every N weeks/days keep the due date's rhythm", () => {
    assert.equal(next("weekly", "2026-10-28", WED), "2026-11-04");
    assert.equal(next("every 2 weeks", "2026-10-28", WED), "2026-11-11");
    assert.equal(next("every 3 days", "2026-10-28", WED), "2026-10-31");
  });

  it("a late to-do rolls forward on its own rhythm to the first date after today", () => {
    assert.equal(next("weekly", "2026-10-01", WED), "2026-10-29");
    assert.equal(next("every 3 days", "2026-10-20", WED), "2026-10-29");
  });

  it("a to-do done early steps from its due date", () => {
    assert.equal(next("weekly", "2026-11-10", WED), "2026-11-17");
    assert.equal(next("every weekday", "2026-11-10", WED), "2026-11-11");
  });

  it("an unreal due date is ignored and counted from today", () => {
    assert.equal(next("weekly", "2026-02-30", WED), "2026-11-04");
  });

  it("every <weekday> lands on the next such day after the due date or today", () => {
    assert.equal(next("every Monday", "2026-10-26", WED), "2026-11-02");
    assert.equal(next("every Monday", null, WED), "2026-11-02");
    assert.equal(next("every Mon and Thu", null, WED), "2026-10-29");
    assert.equal(next("every Friday", "2026-10-30", WED), "2026-11-06");
  });

  it("monthly clamps to the month end and recovers the day afterwards", () => {
    assert.equal(next("monthly", "2026-01-31", "2026-01-31T05:00:00Z"), "2026-02-28");
    assert.equal(next("monthly", "2028-01-31", "2028-01-31T05:00:00Z"), "2028-02-29");
    // Done in March: February's 28th is past, the anchor day is back to the 31st.
    assert.equal(next("monthly", "2026-01-31", "2026-03-01T05:00:00Z"), "2026-03-31");
    assert.equal(next("monthly", "2026-04-30", "2026-04-30T05:00:00Z"), "2026-05-30");
    assert.equal(next("monthly", "2026-12-15", "2026-12-15T05:00:00Z"), "2027-01-15");
    assert.equal(next("every 2 months", "2026-10-31", WED), "2026-12-31");
    assert.equal(next("quarterly", "2026-11-30", "2026-11-30T05:00:00Z"), "2027-02-28");
  });

  it("yearly, including a leap day", () => {
    assert.equal(next("yearly", "2026-10-28", WED), "2027-10-28");
    assert.equal(next("annually", "2028-02-29", "2028-02-29T05:00:00Z"), "2029-02-28");
  });

  it("is calendar arithmetic, so the clocks changing does not shift a day", () => {
    const NY = "America/New_York"; // clocks go back on 2026-11-01
    assert.equal(
      next("weekly", "2026-10-28", "2026-10-28T12:00:00-04:00", NY),
      "2026-11-04",
    );
    assert.equal(
      next("daily", "2026-10-31", "2026-10-31T12:00:00-04:00", NY),
      "2026-11-01",
    );
    assert.equal(
      next("daily", "2026-11-01", "2026-11-01T12:00:00-05:00", NY),
      "2026-11-02",
    );
    assert.equal(
      next("every 7 days", "2026-03-04", "2026-03-04T12:00:00-05:00", NY),
      "2026-03-11",
    );
  });

  it("'today' is the day in the configured zone, either side of a clock change", () => {
    const NY = "America/New_York";
    // 23:30 on 1 Nov in New York (EST) is already 2 Nov in Kolkata.
    const lateEvening = "2026-11-02T04:30:00Z";
    assert.equal(next("daily", null, lateEvening, NY), "2026-11-02");
    assert.equal(next("daily", null, lateEvening, KOLKATA), "2026-11-03");
    // 01:30 EDT on 1 Nov, before the clocks go back.
    assert.equal(next("daily", null, "2026-11-01T05:30:00Z", NY), "2026-11-02");
  });
});

describe("nextTodoDraft", () => {
  const made = (draft) =>
    buildTodo(draft, {
      now: "2026-10-22T04:30:00.000Z",
      approvedBy: "tester",
      source: {
        intakeId: null,
        source: "manual",
        link: null,
        subject: "x",
        sender: null,
        receivedAt: null,
        threadKey: null,
      },
    });

  it("keeps who and what, resets the steps, the waiting and the old dates", () => {
    const original = made({
      ...emptyDraft("Weekly status pack"),
      description: "Send to Pat.",
      owner: { name: "Alwin", email: "alwin@deloitte.com", isMe: true },
      requester: { name: "Pat Sample", email: "pat@deloitte.com" },
      priority: "high",
      tags: ["status", "weekly"],
      recurrence: "weekly",
      dueAt: "2026-10-28",
      checkpointTemplate: "deliverable",
      waitingOn: "Jordan Sample",
      actionItems: [{ text: "Collect RAG", owner: "Jordan", dueAt: "2026-10-27" }],
    });
    const stepped = {
      ...original,
      status: "done",
      checkpoints: original.checkpoints.map((c) => ({ ...c, state: "done" })),
      actionItems: original.actionItems.map((i) => ({ ...i, done: true })),
    };
    const draft = nextTodoDraft(stepped, "2026-11-04");
    assert.equal(TodoDraftSchema.safeParse(draft).success, true);
    assert.equal(draft.title, "Weekly status pack");
    assert.equal(draft.dueAt, "2026-11-04");
    assert.deepEqual(draft.owner, original.owner);
    assert.deepEqual(draft.requester, original.requester);
    assert.deepEqual(draft.tags, ["status", "weekly"]);
    assert.equal(draft.recurrence, "weekly");
    assert.equal(draft.priority, "high");
    assert.equal(draft.checkpointTemplate, "deliverable");
    assert.equal(draft.waitingOn, null);
    assert.deepEqual(draft.actionItems, [
      { text: "Collect RAG", owner: "Jordan", dueAt: null },
    ]);
    const fresh = made(draft);
    assert.ok(fresh.checkpoints.every((c) => c.state === "pending"));
    assert.equal(fresh.status, "open");
  });

  it("falls back to the simple template when the steps were customised", () => {
    const original = made({ ...emptyDraft("x"), checkpointTemplate: "approval" });
    const odd = { ...original, checkpoints: original.checkpoints.slice(1) };
    assert.equal(nextTodoDraft(odd, "2026-11-04").checkpointTemplate, "simple");
  });
});
