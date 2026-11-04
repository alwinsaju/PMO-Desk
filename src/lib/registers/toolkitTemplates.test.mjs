// The PMO Toolkit's template places (targets.ts): the timesheet chaser and the weekly status report.
// The starters must write exactly the built-in text, so nothing changes until a template is edited.
import assert from "node:assert/strict";
import test from "node:test";
import { renderFields } from "../templates/render.ts";
import { STARTERS, starterById } from "../templates/starters.ts";
import { checkInput } from "../templates/library.ts";
import { targetByKey, sampleValues } from "../templates/targets.ts";
import { registerById } from "./defs.ts";
import { statusReport } from "./reports.ts";
import { chaserValues, personChasers, timesheetChaser } from "./timesheets.ts";

const TIMESHEET = "app:toolkit:timesheet-chaser";
const STATUS = "app:toolkit:status-report";

/** The same rule as the Templates app's `useTemplateText(...).fill`. */
const fillFrom = (template) => (values, fallback) => {
  const r = renderFields(
    { subject: template.subject, to: "", cc: "", body: template.body },
    values,
  );
  return { subject: r.subject || fallback.subject, body: r.body || fallback.body };
};

const MONDAY = "2026-11-02";
const ana = { person: "Ana Lopez", email: "ana@x.com" };
const sam = { person: "Sam Rivera", email: "" };

test("both places exist and have a starter that is a valid template for them", () => {
  for (const [key, starterId] of [
    [TIMESHEET, "timesheet-chaser"],
    [STATUS, "toolkit-status-report"],
  ]) {
    assert.ok(targetByKey(key), key);
    const starter = starterById(starterId);
    assert.deepEqual(starter.usedBy, [key]);
    assert.equal(starter.kind, targetByKey(key).kind);
    assert.equal(checkInput(starter).ok, true, JSON.stringify(checkInput(starter)));
  }
  assert.equal(new Set(STARTERS.map((s) => s.starterId)).size, STARTERS.length);
});

test("timesheet chaser: the starter writes exactly the built-in text", () => {
  const fill = fillFrom(starterById("timesheet-chaser"));
  for (const me of ["Alex", ""]) {
    for (const missing of [[ana], [ana, sam], [], [{ person: "Cher", email: "" }]]) {
      assert.deepEqual(
        timesheetChaser(MONDAY, missing, me, fill),
        timesheetChaser(MONDAY, missing, me),
        `${missing.length} people, me="${me}"`,
      );
    }
  }
  assert.deepEqual(
    personChasers(MONDAY, [ana, sam], "Alex", fill),
    personChasers(MONDAY, [ana, sam], "Alex"),
  );
});

test("timesheet chaser: built-in wording is unchanged", () => {
  const one = timesheetChaser(MONDAY, [ana], "Alex");
  assert.equal(one.subject, "Timesheet reminder: week of 2 Nov");
  assert.equal(
    one.body,
    [
      "Hi Ana,",
      "",
      "Our records show no timesheet yet for the week of 2 Nov to 6 Nov.",
      "Could you please file it today, or let me know if it is not needed (for example, you were on leave)?",
      "",
      "Thanks,",
      "Alex",
    ].join("\n"),
  );
  assert.ok(timesheetChaser(MONDAY, [ana, sam], "").body.startsWith("Hi all,"));
  assert.ok(timesheetChaser(MONDAY, [ana], "").body.endsWith("Thanks,"));
});

test("timesheet chaser: an edited template changes the wording, code fills the values", () => {
  const fill = fillFrom({
    subject: "Please file: {{count}} outstanding ({{week_start}})",
    body: "{{greeting}} still missing: {{people}}. Week {{week_start}} to {{week_end}}. {{my_name}}",
  });
  const out = timesheetChaser(MONDAY, [ana, sam], "Alex", fill);
  assert.equal(out.subject, "Please file: 2 outstanding (2 Nov)");
  assert.equal(
    out.body,
    "Hi all, still missing: Ana Lopez, Sam Rivera. Week 2 Nov to 6 Nov. Alex",
  );
  assert.equal(
    out.to,
    "ana@x.com",
    "recipients still come from the people, not the template",
  );
  assert.deepEqual(out.withoutEmail, ["Sam Rivera"]);
  const each = personChasers(MONDAY, [ana, sam], "Alex", fill);
  assert.equal(
    each[0].body,
    "Hi Ana, still missing: Ana Lopez. Week 2 Nov to 6 Nov. Alex",
  );
  assert.equal(each[1].subject, "Please file: 1 outstanding (2 Nov)");
});

test("timesheet chaser: a template that renders empty falls back to the built-in text", () => {
  const out = timesheetChaser(
    MONDAY,
    [ana],
    "Alex",
    fillFrom({ subject: "", body: "{{my_name}}" }),
  );
  assert.equal(out.subject, timesheetChaser(MONDAY, [ana], "Alex").subject);
  assert.equal(out.body, "Alex");
});

test("every value the code makes is a placeholder of its place, and the reverse", () => {
  const names = (key) =>
    targetByKey(key)
      .placeholders.map((p) => p.name)
      .sort();
  assert.deepEqual(
    Object.keys(chaserValues(MONDAY, ["A B"], "Alex")).sort(),
    names(TIMESHEET),
  );

  const status = statusReport([], registerById("status-report"), "2026-11-05");
  // `my_name` is added by the panel, which knows who is signed in.
  assert.deepEqual([...Object.keys(status.values), "my_name"].sort(), names(STATUS));
  assert.ok(Object.keys(sampleValues([TIMESHEET])).length > 0);
});

const statusDef = registerById("status-report");
const raidDef = registerById("raid");
const changesDef = registerById("changes");
const rec = (id, values) => ({
  id: `rg_${id.padStart(12, "0")}`,
  createdAt: "2026-11-05T10:00:00.000Z",
  updatedAt: "2026-11-05T10:00:00.000Z",
  values,
});
const project = (id, name, extra = {}) =>
  rec(id, {
    project: name,
    status: "Active",
    schedule: "Green",
    budget: "Green",
    scope: "Green",
    ...extra,
  });

test("status report: the starter writes exactly the built-in text, with and without registers", () => {
  const fill = fillFrom(starterById("toolkit-status-report"));
  const projects = [
    project("1", "Atlas", {
      owner: "Priya",
      budget: "Red",
      commentary: "Vendor\ndelay",
      nextSteps: "Escalate",
    }),
    project("2", "Borealis", { schedule: "Amber" }),
    project("3", "Done", { status: "Closed" }),
  ];
  const registers = {
    raid: [
      rec("5", {
        kind: "Risk",
        title: "Vendor slips",
        status: "Open",
        impact: "High",
        likelihood: "High",
        project: "Atlas",
      }),
      rec("6", {
        kind: "Risk",
        title: "Unassigned",
        status: "Open",
        impact: "Low",
        likelihood: "Low",
      }),
    ],
    raidDef,
    changes: [
      rec("7", {
        title: "Add SSO",
        status: "Submitted",
        targetDate: "2026-11-01",
        project: "Mystery",
      }),
    ],
    changesDef,
  };
  for (const [name, input] of [
    ["no projects", [[], undefined]],
    ["projects only", [projects, undefined]],
    ["with registers", [projects, registers]],
  ]) {
    const report = statusReport(input[0], statusDef, "2026-11-05", input[1]);
    const written = fill(
      { ...report.values, my_name: "Alex" },
      { subject: report.subject, body: report.text },
    );
    assert.equal(written.subject, report.subject, name);
    assert.equal(written.body, report.text, name);
  }
});

test("status report: an edited template can add a greeting and a sign-off around the projects", () => {
  const fill = fillFrom({
    subject: "Status {{date_short}}: {{overall_upper}}",
    body: "Hi all,\n\n{{red}}/{{amber}}/{{green}}\n\n{{projects}}\n\nThanks,\n{{my_name}}",
  });
  const report = statusReport(
    [project("1", "Atlas", { schedule: "Red" })],
    statusDef,
    "2026-11-05",
  );
  const out = fill(
    { ...report.values, my_name: "Alex" },
    { subject: report.subject, body: report.text },
  );
  assert.equal(out.subject, "Status 5 Nov: RED");
  assert.ok(out.body.startsWith("Hi all,\n\n1/0/0\n\nAtlas: RED"));
  assert.ok(out.body.endsWith("Thanks,\nAlex"));
});
