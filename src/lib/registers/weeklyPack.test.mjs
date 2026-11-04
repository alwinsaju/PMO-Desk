import assert from "node:assert/strict";
import test from "node:test";
import { registerById } from "./defs.ts";
import {
  PACK_LATE_MAX,
  PACK_NO_PROJECT,
  PACK_NOT_ACTIVE,
  governanceSummary,
  groupByProject,
  hasProjectData,
  raidSummary,
  raidSummaryLines,
  weeklyPack,
} from "./weeklyPack.ts";

const NOW = "2026-11-05T10:00:00.000Z";
const TODAY = "2026-11-05"; // a Thursday
const rec = (id, values, extra = {}) => ({
  id: `rg_${id.padStart(12, "0")}`,
  createdAt: NOW,
  updatedAt: NOW,
  values,
  ...extra,
});
const raidDef = registerById("raid");
const changesDef = registerById("changes");
const statusDef = registerById("status-report");
const govDef = registerById("governance");

const risk = (id, values) =>
  rec(id, {
    kind: "Risk",
    status: "Open",
    impact: "Medium",
    likelihood: "Medium",
    ...values,
  });
const change = (id, values) => rec(id, { status: "Submitted", ...values });
const project = (id, name, extra = {}) =>
  rec(id, {
    project: name,
    status: "Active",
    schedule: "Green",
    budget: "Green",
    scope: "Green",
    ...extra,
  });
const event = (id, values, extra) =>
  rec(id, { kind: "Steering committee", status: "Planned", ...values }, extra);

const pack = (over = {}) =>
  weeklyPack({
    projects: [],
    projectsDef: statusDef,
    raid: [],
    raidDef,
    changes: [],
    changesDef,
    governance: [],
    governanceDef: govDef,
    today: TODAY,
    ...over,
  });

test("raidSummary: counts by kind, lists items past review and the top risks", () => {
  const items = [
    risk("1", {
      title: "Vendor slips",
      impact: "High",
      likelihood: "High",
      owner: "Priya",
    }),
    risk("2", { title: "Old review", dueDate: "2026-10-30" }),
    risk("3", { title: "Closed", status: "Closed", impact: "High", likelihood: "High" }),
    rec("4", {
      kind: "Issue",
      title: "Server down",
      status: "Open",
      impact: "High",
      dueDate: "2026-11-01",
    }),
    rec("5", { kind: "Dependency", title: "Network team", status: "Mitigating" }),
  ];
  const s = raidSummary(items, raidDef, TODAY);
  assert.equal(s.open, 4);
  assert.equal(s.mix, "2 risks, 1 issue, 1 dependency");
  assert.equal(s.lateTotal, 2);
  assert.deepEqual(s.late, [
    "Risk: Old review (Medium impact, medium likelihood, review overdue since 30 Oct, 6 days late)",
    "Issue: Server down (High impact, review overdue since 1 Nov, 4 days late)",
  ]);
  assert.equal(s.riskTotal, 2);
  assert.equal(
    s.topRisks[0],
    "Vendor slips (High impact, high likelihood, Priya)",
    "the worst risk first, no kind prefix",
  );
  const lines = raidSummaryLines(s);
  assert.equal(
    lines[0],
    "Open: 4 (2 risks, 1 issue, 1 dependency); 2 past their review date",
  );
  assert.ok(lines.includes("Past their review date:"));
  assert.ok(lines.includes("Top open risks:"));
});

test("raidSummary: a due date of today is not late; nothing open gives no lines", () => {
  const s = raidSummary([risk("1", { title: "A", dueDate: TODAY })], raidDef, TODAY);
  assert.equal(s.lateTotal, 0);
  assert.equal(s.topRisks[0], "A (Medium impact, medium likelihood, review 5 Nov)");
  const none = raidSummary([risk("2", { title: "B", status: "Closed" })], raidDef, TODAY);
  assert.deepEqual(raidSummaryLines(none), []);
});

test("raidSummary: the late list is capped and says how many there are", () => {
  const items = Array.from({ length: PACK_LATE_MAX + 3 }, (_, n) =>
    risk(String(n + 1), {
      title: `R${String(n).padStart(2, "0")}`,
      dueDate: "2026-10-01",
    }),
  );
  const s = raidSummary(items, raidDef, TODAY);
  assert.equal(s.late.length, PACK_LATE_MAX);
  assert.equal(s.lateTotal, PACK_LATE_MAX + 3);
  assert.ok(
    raidSummaryLines(s).includes(
      `Past their review date (${PACK_LATE_MAX} of ${PACK_LATE_MAX + 3}):`,
    ),
  );
});

test("governanceSummary: planned events in the window, soonest first, and ones whose date passed", () => {
  const events = [
    event("1", { title: "QBR", kind: "QBR", date: "2026-11-12", time: "10:00 IST" }),
    event("2", { title: "Steerco", date: "2026-11-06" }, { todoId: "td1" }),
    event("3", { title: "Far away", date: "2026-12-30" }),
    event("4", { title: "Held", date: "2026-11-07", status: "Held" }),
    event("5", { title: "Missed", date: "2026-11-02" }),
    event("6", { title: "Today", date: TODAY, prepDays: 5 }),
  ];
  const g = governanceSummary(events, govDef, TODAY, 14);
  assert.deepEqual(g.upcoming, [
    "Thu 5 Nov: Today (Steering committee, prep not started)",
    "Fri 6 Nov: Steerco (Steering committee)",
    "Thu 12 Nov, 10:00 IST: QBR (QBR)",
  ]);
  assert.deepEqual(g.passed, ["Mon 2 Nov: Missed (Steering committee)"]);
});

test("groupByProject: active projects in order, then others by name, then no project", () => {
  const items = [
    change("1", { title: "A", project: "beta" }),
    change("2", { title: "B", project: "  Alpha  Launch " }),
    change("3", { title: "C" }),
    change("4", { title: "D", project: "Zed" }),
    change("5", { title: "E", project: "Gamma" }),
  ];
  const groups = groupByProject(items, ["Alpha Launch", "Beta", "Unused"]);
  assert.deepEqual(
    groups.map((g) => [g.label, g.records.length]),
    [
      ["Alpha Launch", 1],
      ["Beta", 1],
      [`Gamma (${PACK_NOT_ACTIVE})`, 1],
      [`Zed (${PACK_NOT_ACTIVE})`, 1],
      [PACK_NO_PROJECT, 1],
    ],
  );
});

test("hasProjectData: false when every Project is blank", () => {
  assert.equal(
    hasProjectData([risk("1", { title: "A" })], [change("2", { project: "  " })]),
    false,
  );
  assert.equal(hasProjectData([risk("1", { title: "A", project: "X" })], []), true);
});

test("weeklyPack: flat when no record has a Project", () => {
  const out = pack({
    projects: [project("1", "Atlas", { owner: "Priya", budget: "Red" })],
    raid: [risk("1", { title: "Vendor slips", impact: "High", likelihood: "High" })],
    changes: [change("1", { title: "Add SSO", ref: "CR-1", targetDate: "2026-11-01" })],
    governance: [event("1", { title: "Steerco", date: "2026-11-06" })],
  });
  assert.equal(out.grouped, false);
  assert.equal(out.overall, "Red");
  assert.equal(out.subject, "Weekly PMO pack: 5 Nov (Red)");
  const lines = out.text.split("\n");
  assert.equal(lines[0], "Weekly PMO pack: 5 Nov 2026");
  for (const heading of [
    "STATUS",
    "CHANGE REQUESTS",
    "RAID LOG: PAST REVIEW DATE AND TOP OPEN RISKS",
    "GOVERNANCE: NEXT 14 DAYS",
  ]) {
    assert.ok(lines.includes(heading), heading);
  }
  assert.ok(out.text.includes("Overall: RED (1 red, 0 amber, 0 green)"));
  assert.ok(
    !out.text.includes("Weekly status report"),
    "the report's own heading is dropped",
  );
  assert.ok(out.text.includes("Waiting for a decision"));
  assert.ok(out.text.includes("Past their target date"));
  assert.ok(out.text.includes("- Vendor slips (High impact, high likelihood)"));
  assert.ok(out.text.includes("- Fri 6 Nov: Steerco (Steering committee"));
  assert.ok(!out.text.includes("BY PROJECT"));
});

test("weeklyPack: grouped by Project, active projects first, no project last", () => {
  const out = pack({
    projects: [project("1", "Atlas"), project("2", "Borealis", { schedule: "Amber" })],
    raid: [
      risk("1", { title: "Atlas risk", project: "atlas" }),
      risk("2", { title: "Loose risk" }),
      risk("3", { title: "Borealis risk", project: "Borealis", dueDate: "2026-10-20" }),
      risk("4", { title: "Stranger", project: "Mystery" }),
    ],
    changes: [change("1", { title: "Atlas change", project: "Atlas" })],
  });
  assert.equal(out.grouped, true);
  const text = out.text;
  const raidAt = text.indexOf("RAID LOG");
  const at = (s) => text.indexOf(s, raidAt);
  assert.ok(text.includes("RAID LOG: PAST REVIEW DATE AND TOP OPEN RISKS, BY PROJECT"));
  // Borealis is Amber, so it comes before Atlas (Green), like the status report.
  assert.ok(at("Borealis:\n") < at("Atlas:\n"));
  assert.ok(at("Atlas:\n") < at(`Mystery (${PACK_NOT_ACTIVE}):`));
  assert.ok(at(`Mystery (${PACK_NOT_ACTIVE}):`) < at(`${PACK_NO_PROJECT}:`));
  assert.ok(
    text.includes("  - Borealis risk (Medium impact, medium likelihood, review overdue"),
  );
  assert.ok(text.includes("  Waiting for a decision"));
});

test("weeklyPack: every section says so when empty, and the pack never throws on no data", () => {
  const out = pack();
  assert.ok(out.text.includes("No active projects."));
  assert.ok(out.text.includes("No change requests."));
  assert.ok(out.text.includes("No open RAID items."));
  assert.ok(out.text.includes("Nothing planned in the next 14 days."));
  assert.equal(out.overall, "Green");
});

test("weeklyPack: a governance date that has passed is called out", () => {
  const out = pack({
    governance: [event("1", { title: "Audit prep", date: "2026-11-01", kind: "Audit" })],
  });
  assert.ok(out.text.includes("Date has passed, still planned"));
  assert.ok(out.text.includes("- Sun 1 Nov: Audit prep (Audit)"));
});
