import assert from "node:assert/strict";
import test from "node:test";
import { registerById } from "./defs.ts";
import {
  NO_PROJECT_LABEL,
  OTHER_PROJECT_LABEL,
  buildProjectDigest,
  digestLines,
  lateChanges,
  openRisks,
  projectKey,
  riskScore,
} from "./projectDigest.ts";
import { statusReport } from "./reports.ts";
import { personChasers, timesheetChaser } from "./timesheets.ts";

const NOW = "2026-03-05T10:00:00.000Z";
const TODAY = "2026-03-05";
const rec = (id, values) => ({
  id: `rg_${id.padStart(12, "0")}`,
  createdAt: NOW,
  updatedAt: NOW,
  values,
});
const raidDef = registerById("raid");
const changesDef = registerById("changes");
const statusDef = registerById("status-report");

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

test("projectKey ignores case and spacing", () => {
  assert.equal(projectKey("  Alpha   Launch "), "alpha launch");
  assert.equal(projectKey(""), "");
});

test("openRisks: only open risks, worst first, then earliest review", () => {
  const items = [
    risk("1", { title: "Low one", impact: "Low", likelihood: "Low" }),
    risk("2", { title: "Big", impact: "High", likelihood: "High" }),
    risk("3", {
      title: "Closed big",
      impact: "High",
      likelihood: "High",
      status: "Closed",
    }),
    rec("4", { kind: "Issue", title: "An issue", status: "Open", impact: "High" }),
    risk("5", { title: "Mid late", dueDate: "2026-03-01" }),
    risk("6", { title: "Mid early", dueDate: "2026-02-01" }),
    risk("7", { title: "Mid none" }),
  ];
  assert.deepEqual(
    openRisks(items, raidDef).map((r) => r.values.title),
    ["Big", "Mid early", "Mid late", "Mid none", "Low one"],
  );
  assert.equal(riskScore(rec("8", { impact: "High" })), 6, "blank likelihood is Medium");
});

test("lateChanges: open and past target only, longest overdue first", () => {
  const items = [
    change("1", { title: "A", targetDate: "2026-03-01" }),
    change("2", { title: "B", targetDate: "2026-02-20" }),
    change("3", { title: "C", targetDate: "2026-03-05" }),
    change("4", { title: "D", targetDate: "2026-02-01", status: "Implemented" }),
    change("5", { title: "E" }),
  ];
  assert.deepEqual(
    lateChanges(items, changesDef, TODAY).map((c) => c.values.title),
    ["B", "A"],
  );
});

test("digest: matches projects without regard to case and groups the rest", () => {
  const raid = [
    risk("1", { title: "Vendor slip", project: "ALPHA", impact: "High", owner: "Ana" }),
    risk("2", { title: "Floating", project: "" }),
    risk("3", { title: "Stray", project: "Gamma" }),
    risk("4", { title: "Spaces", project: "  alpha  " }),
  ];
  const changes = [
    change("1", {
      title: "Add field",
      ref: "CR-1",
      project: "alpha",
      targetDate: "2026-03-01",
    }),
    change("2", { title: "No home", targetDate: "2026-03-02" }),
  ];
  const d = buildProjectDigest(
    ["Alpha", "Beta"],
    raid,
    raidDef,
    changes,
    changesDef,
    TODAY,
  );
  const alpha = d.byProject.get("alpha");
  assert.equal(alpha.riskTotal, 2);
  assert.match(alpha.risks[0], /^Vendor slip \(High impact, medium likelihood, Ana\)$/);
  assert.equal(alpha.lateChanges.length, 1);
  assert.match(alpha.lateChanges[0], /^CR-1 Add field, target 1 Mar, 4 days late$/);
  assert.equal(d.byProject.has("beta"), false);
  assert.equal(d.noProject.riskTotal, 1);
  assert.equal(d.noProject.lateChanges.length, 1);
  assert.match(d.other.risks[0], /^\[Gamma\] Stray/);
});

test("digest: shows only the top few risks and says how many there are", () => {
  const raid = ["a", "b", "c", "d", "e"].map((n, i) =>
    risk(String(i + 1), { title: `R${n}`, project: "Alpha" }),
  );
  const d = buildProjectDigest(["Alpha"], raid, raidDef, [], changesDef, TODAY, 3);
  const lines = digestLines(d.byProject.get("alpha"));
  assert.equal(lines[0], "  Top open risks (3 of 5):");
  assert.equal(lines.length, 4);
  assert.deepEqual(digestLines(undefined), []);
});

test("statusReport: unchanged without registers, adds the digest with them", () => {
  const projects = [project("1", "Alpha", { owner: "Ana" }), project("2", "Beta")];
  const plain = statusReport(projects, statusDef, TODAY);
  assert.ok(!plain.text.includes("Top open risks"));
  assert.deepEqual(statusReport(projects, statusDef, TODAY, undefined), plain);

  const full = statusReport(projects, statusDef, TODAY, {
    raid: [
      risk("1", { title: "Vendor slip", project: "alpha", dueDate: "2026-03-01" }),
      risk("2", { title: "Orphan risk" }),
    ],
    raidDef,
    changes: [
      change("1", { title: "Late CR", project: "Beta", targetDate: "2026-03-01" }),
      change("2", { title: "Odd CR", project: "Zeta", targetDate: "2026-03-01" }),
    ],
    changesDef,
  });
  const text = full.text;
  const alphaAt = text.indexOf("Alpha (Ana)");
  const betaAt = text.indexOf("Beta:");
  assert.ok(alphaAt >= 0 && betaAt >= 0);
  const noProjectAt = text.indexOf(NO_PROJECT_LABEL);
  const risksAt = text.indexOf("Vendor slip");
  assert.ok(risksAt > alphaAt && risksAt < noProjectAt, "under Alpha");
  assert.match(text, /review overdue since 1 Mar/);
  const lateAt = text.indexOf("Late CR");
  assert.ok(lateAt > betaAt && lateAt < noProjectAt, "under Beta");
  assert.match(text, /No project\n {2}Top open risks:\n {2}- Orphan risk/);
  assert.ok(text.includes(OTHER_PROJECT_LABEL));
  assert.match(text, /\[Zeta\] Odd CR/);
  assert.equal(full.overall, plain.overall);
  assert.deepEqual(full.counts, plain.counts);
});

test("statusReport: no extra groups when no record needs one", () => {
  const out = statusReport([project("1", "Alpha")], statusDef, TODAY, {
    raid: [],
    raidDef,
    changes: [],
    changesDef,
  });
  assert.ok(!out.text.includes(NO_PROJECT_LABEL));
  assert.ok(!out.text.includes(OTHER_PROJECT_LABEL));
});

test("personChasers: one draft per person, addressed to them alone", () => {
  const monday = "2026-03-02";
  const missing = [
    { person: "Ben Okafor", email: "ben@x.com" },
    { person: "Mia Chen", email: "" },
    { person: "ben okafor", email: "ben2@x.com" },
  ];
  const drafts = personChasers(monday, missing, "Sam");
  assert.deepEqual(
    drafts.map((d) => [d.person, d.email]),
    [
      ["Ben Okafor", "ben@x.com"],
      ["Mia Chen", ""],
    ],
  );
  assert.match(drafts[0].body, /^Hi Ben,/);
  assert.match(drafts[1].body, /^Hi Mia,/);
  assert.ok(!drafts[0].body.includes("Mia"));
  assert.match(drafts[1].body, /2 Mar to 6 Mar/);
  assert.match(drafts[0].body, /Sam$/);
  assert.equal(drafts[0].subject, timesheetChaser(monday, [missing[0]], "Sam").subject);
  assert.deepEqual(personChasers(monday, [], "Sam"), []);
});
