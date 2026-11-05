import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildSignoffTemplate, signoffValues } from "./signoffRequest.ts";
import {
  applyReportTemplate,
  chaserDialogFields,
  chaserFromTemplate,
  chaserValues,
  myFullName,
} from "./templateValues.ts";
import { staffAddressForWaitingOn } from "./chaserRecipient.ts";
import { STARTERS, starterById } from "../templates/starters.ts";

const todo = (over = {}, source = {}) => ({
  title: "Release plan v2",
  description: "It covers the cut-over steps. Please check the rollback section.",
  dueAt: "2026-03-05",
  source: {
    intakeId: null,
    source: "outlook",
    link: "https://example.com/m/1",
    subject: "Release plan",
    sender: "Priya",
    receivedAt: null,
    threadKey: null,
    ...source,
  },
  ...over,
});

const signoffStarter = starterById("signoff-request");

describe("the sign-off starter template", () => {
  const cases = {
    "full context": [todo(), "Sam Rivera <sam@x.com>"],
    "no due date": [todo({ dueAt: null }), "Sam"],
    "no description and no approver": [todo({ description: "" }), ""],
    "a manual to-do": [todo({}, { source: "manual", subject: "", link: null }), "Ana"],
    "a link but no subject": [todo({}, { subject: "" }), "Ana"],
  };
  for (const [name, [item, approver]] of Object.entries(cases)) {
    it(`writes exactly the built-in wording: ${name}`, () => {
      const base = { todo: item, approver, myName: "Alex" };
      assert.deepEqual(
        buildSignoffTemplate({ ...base, template: signoffStarter }),
        buildSignoffTemplate(base),
      );
    });
  }

  it("uses an edited template: subject, body and recipient", () => {
    const out = buildSignoffTemplate({
      todo: todo(),
      approver: "Sam <sam@x.com>",
      myName: "Alex",
      template: {
        subject: "OK {{title}}?",
        to: "boss@x.com",
        cc: "",
        body: "{{greeting}} please sign {{title}}{{by_date}}. {{my_name}}",
      },
    });
    assert.equal(out.subject, "OK Release plan v2?");
    assert.equal(out.to, "boss@x.com");
    assert.equal(out.text, "Hi Sam, please sign Release plan v2 by Thu 5 Mar 2026. Alex");
  });

  it("falls back to the approver's address and the default subject when the template leaves them blank", () => {
    const out = buildSignoffTemplate({
      todo: todo(),
      approver: "Sam <sam@x.com>",
      myName: "Alex",
      template: { subject: "", to: "", cc: "", body: "Hello" },
    });
    assert.equal(out.subject, "Sign-off requested: Release plan v2");
    assert.equal(out.to, "sam@x.com");
  });

  it("offers every value its template targets promise", () => {
    const keys = Object.keys(
      signoffValues({ todo: todo(), approver: "Sam", myName: "A" }),
    ).sort();
    assert.deepEqual(keys, [
      "by_date",
      "context",
      "greeting",
      "my_name",
      "summary",
      "title",
    ]);
  });
});

describe("chaser values", () => {
  const prefs = { timeZone: "Asia/Kolkata", workDays: [1, 2, 3, 4, 5], chaserDays: 2 };
  const waiting = (over = {}) => ({
    title: "  Release   plan ",
    waitingOn: "Sam Rivera <sam@x.com>",
    waitingSince: "2026-10-19T04:00:00.000Z",
    updatedAt: "2026-10-19T04:00:00.000Z",
    chaserDays: null,
    status: "open",
    ...over,
  });
  const now = new Date("2026-10-23T06:00:00.000Z");

  it("greets a person by first name and counts working days", () => {
    const values = chaserValues({ todo: waiting(), now, prefs, myName: "Alex" });
    assert.equal(values.greeting, "Hi Sam,");
    assert.equal(values.waiting_on, "Sam Rivera <sam@x.com>");
    assert.equal(values.title, "Release plan");
    assert.equal(values.waited, "4 working days");
  });

  it("keeps a team name whole and copes with nobody", () => {
    assert.equal(
      chaserValues({
        todo: waiting({ waitingOn: "the vendor team" }),
        now,
        prefs,
        myName: "A",
      }).greeting,
      "Hi the vendor team,",
    );
    const none = chaserValues({
      todo: waiting({ waitingOn: null }),
      now,
      prefs,
      myName: "A",
    });
    assert.equal(none.greeting, "Hi,");
    assert.equal(none.waited, "a while");
  });

  it("never says 'waiting 0 days'", () => {
    const today = chaserValues({
      todo: waiting({ waitingSince: now.toISOString() }),
      now,
      prefs,
      myName: "A",
    });
    assert.equal(today.waited, "less than a day");
    const oneDay = chaserValues({
      todo: waiting({ waitingSince: "2026-10-22T06:00:00.000Z" }),
      now,
      prefs,
      myName: "A",
    });
    assert.equal(oneDay.waited, "1 working day");
    const weekend = chaserValues({
      todo: waiting({ waitingSince: "2026-10-24T06:00:00.000Z" }),
      now: new Date("2026-10-25T06:00:00.000Z"),
      prefs,
      myName: "A",
    });
    assert.equal(weekend.waited, "1 day");
  });

  it("signs with the full name as configured", () => {
    assert.equal(myFullName({ names: ["Qa Tester", "Qa"] }), "Qa Tester");
    assert.equal(myFullName({ names: ["  Qa   Tester "] }), "Qa Tester");
    assert.equal(myFullName({ names: [] }), "");
  });

  it("a template with a blank subject or recipient keeps the app's own (regression)", () => {
    const values = chaserValues({ todo: waiting(), now, prefs, myName: "Alex" });
    const fallback = { subject: "Re: Release plan", to: "sam@example.com" };
    const blank = chaserDialogFields(
      { subject: "", to: "", cc: "", body: "{{greeting}}\n\nAny news?" },
      values,
      fallback,
    );
    assert.equal(blank.subject, "Re: Release plan");
    assert.equal(blank.to, "sam@example.com");
    assert.equal(blank.body, "Hi Sam,\n\nAny news?");
    const filled = chaserDialogFields(
      { subject: "Chasing {{title}}", to: "team@example.com", cc: "", body: "x" },
      values,
      fallback,
    );
    assert.equal(filled.subject, "Chasing Release plan");
    assert.equal(filled.to, "team@example.com");
  });

  it("the chaser starter renders into a complete message", () => {
    const out = chaserFromTemplate(
      starterById("chaser"),
      chaserValues({ todo: waiting(), now, prefs, myName: "Alex" }),
    );
    assert.equal(out.subject, "Following up: Release plan");
    assert.match(
      out.body,
      /^Hi Sam,\n\nJust checking in on "Release plan"\. I have been waiting on this for 4 working days/,
    );
    assert.match(out.body, /Thanks,\nAlex$/);
    assert.ok(!out.body.includes("{{"));
  });
});

describe("chaser recipient from Staff", () => {
  const staff = [
    { firstName: "Sam", lastName: "Rivera", deloitteEmail: "sam@x.com" },
    { firstName: "Mia", lastName: "Chen", deloitteEmail: "mia@x.com" },
    { firstName: "Mia", lastName: "Patel", deloitteEmail: "mia.p@x.com" },
    { firstName: "Qa", lastName: "Tester", deloitteEmail: "qa@x.com" },
  ];
  it("finds the one person the to-do waits on", () => {
    assert.equal(staffAddressForWaitingOn("Sam Rivera", staff), "sam@x.com");
    assert.equal(staffAddressForWaitingOn("Sam", staff), "sam@x.com");
    assert.equal(staffAddressForWaitingOn("Mia Chen (Finance)", staff), "mia@x.com");
  });
  it("gives nothing when nobody or several people fit, or it is me", () => {
    assert.equal(staffAddressForWaitingOn("Mia", staff), null);
    assert.equal(staffAddressForWaitingOn("the vendor team", staff), null);
    assert.equal(staffAddressForWaitingOn(null, staff), null);
    assert.equal(staffAddressForWaitingOn("Qa Tester", staff, ["QA@x.com"]), null);
  });
});

describe("the report template", () => {
  const me = { names: ["Alex Morgan"] };
  const input = {
    title: "Atlas: Weekly status",
    periodLabel: "Mon 19 Oct to Sun 25 Oct 2026",
    me,
  };

  it("the starter changes nothing but the subject line it already had", () => {
    const out = applyReportTemplate(
      starterById("weekly-status-report"),
      "# R\n\n- a\n",
      input,
    );
    assert.equal(out.body, "# R\n\n- a\n");
    assert.equal(out.subject, "Atlas: Weekly status: Mon 19 Oct to Sun 25 Oct 2026");
  });

  it("wraps the report in a greeting and a sign-off", () => {
    const out = applyReportTemplate(
      {
        subject: "Update {{period}}",
        to: "",
        cc: "",
        body: "Hi all,\n\n{{report}}\n\nThanks,\n{{my_name}}",
      },
      "Summary\n- Open: 3",
      input,
    );
    assert.equal(out.body, "Hi all,\n\nSummary\n- Open: 3\n\nThanks,\nAlex\n");
  });

  it("never expands a placeholder that is inside the report text", () => {
    const out = applyReportTemplate(
      { subject: "", to: "", cc: "", body: "{{report}}" },
      "see {{my_name}}",
      input,
    );
    assert.equal(out.body, "see {{my_name}}\n");
  });
});

describe("starters", () => {
  it("every starter id is unique", () => {
    assert.equal(new Set(STARTERS.map((s) => s.starterId)).size, STARTERS.length);
  });
});
