import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  AI_APP_IDS,
  appIdFromName,
  resolveOpenIntent,
} from "../ai-runtime/windowIntent.ts";
import { exportCsvZip, exportJson, readExportData } from "../platform/dataExport.ts";
import { readZip } from "../platform/zip.ts";
import { KIND_LABEL, recordItems, searchItems } from "../search/searchIndex.ts";
import {
  invoiceBlockers,
  overallRag,
  prepStart,
  recordAlert,
  slaDue,
  summarise,
} from "./alerts.ts";
import { capacityGrid, weekStarts } from "./capacity.ts";
import { cellText, exportHint } from "./cells.ts";
import { formatDayMonth } from "../staff/dates.ts";
import { REGISTERS, REGISTER_IDS, TOOL_ALIASES, registerById } from "./defs.ts";
import {
  RECORD_ID,
  csvRows,
  defaultValues,
  fieldErrors,
  filterRecords,
  isHttpUrl,
  isOpen,
  newRecordId,
  projectSuggestions,
  sanitizeConfig,
  sanitizeRecord,
  sanitizeValues,
  sortRecords,
  statusCounts,
} from "./records.ts";
import { changeSummary, monthEndCheck, statusReport, todoSeed } from "./reports.ts";
import {
  RegisterError,
  applyRegisterChanges,
  readRegister,
  readSummaries,
} from "./server.ts";
import { parseDay, parsePriority, parseSlaRows } from "./slaImport.ts";
import {
  matchSubmitted,
  onLeaveAllWeek,
  seedWeek,
  timesheetChaser,
  workDays,
} from "./timesheets.ts";

const def = (id) => registerById(id);
const NOW = "2026-03-05T10:00:00.000Z";
const TODAY = "2026-03-05"; // a Thursday
const rec = (id, values, extra = {}) => ({
  id: `rg_${id.padStart(12, "0")}`,
  createdAt: NOW,
  updatedAt: NOW,
  values,
  ...extra,
});

test("definitions: every key they mention is a real field and every default is allowed", () => {
  assert.equal(new Set(REGISTER_IDS).size, REGISTERS.length);
  assert.equal(REGISTERS.length, 14);
  for (const d of REGISTERS) {
    const keys = new Set(d.fields.map((f) => f.key));
    assert.equal(keys.size, d.fields.length, `${d.id}: duplicate field keys`);
    for (const key of [
      d.titleKey,
      d.statusKey,
      d.dueKey,
      d.ownerKey,
      d.sortKey,
      ...d.columns,
      d.stamp?.key,
    ]) {
      if (key) assert.ok(keys.has(key), `${d.id}: unknown key ${key}`);
    }
    for (const f of d.fields) {
      if (f.type === "select") {
        assert.ok(f.options?.length, `${d.id}.${f.key}: select without options`);
        if (typeof f.default === "string")
          assert.ok(f.options.includes(f.default), `${d.id}.${f.key} default`);
      }
    }
    if (d.statusKey) {
      const options = d.fields.find((f) => f.key === d.statusKey).options;
      for (const c of d.closed ?? [])
        assert.ok(options.includes(c), `${d.id}: closed ${c}`);
    }
    assert.ok(
      d.fields.some((f) => f.required),
      `${d.id}: needs a required field`,
    );
  }
  assert.deepEqual(Object.keys(TOOL_ALIASES).sort(), [...REGISTER_IDS].sort());
  const all = Object.values(TOOL_ALIASES).flat();
  assert.equal(new Set(all).size, all.length, "aliases must be unique");
});

test("records: new ids, defaults and urls", () => {
  assert.match(newRecordId(), RECORD_ID);
  const values = defaultValues(def("raid"), TODAY);
  assert.equal(values.kind, "Risk");
  assert.equal(values.raisedOn, TODAY);
  assert.equal(values.title, "");
  assert.deepEqual(defaultValues(def("doclinks"), TODAY).tags, []);
  assert.equal(defaultValues(def("invoices"), TODAY).timesheetsApproved, false);
  assert.equal(isHttpUrl("https://x.sharepoint.com/a"), true);
  assert.equal(isHttpUrl("javascript:alert(1)"), false);
  assert.equal(isHttpUrl("file:///c:/x"), false);
  assert.equal(isHttpUrl("not a url"), false);
});

test("records: values are cleaned to their field type, with plain refusals", () => {
  const raid = def("raid");
  const ok = sanitizeValues(raid, {
    kind: "Issue",
    title: "  Late vendor ",
    status: "Open",
    dueDate: "2026-03-10",
    extra: "dropped",
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.values.title, "Late vendor");
  assert.equal("extra" in ok.values, false);
  const refuse = (input, match, d = raid) => {
    const r = sanitizeValues(d, input);
    assert.equal(r.ok, false);
    assert.match(r.reason, match);
  };
  refuse({ kind: "Risk", title: "" }, /Title is required/);
  refuse({ kind: "Nope", title: "x", status: "Open" }, /Type must be one of/);
  refuse(
    { kind: "Risk", title: "x", status: "Open", dueDate: "2026-02-30" },
    /not a real date/,
  );
  refuse(
    { project: "p", person: "a", percent: "lots", from: TODAY, to: TODAY },
    /must be a number/,
    def("capacity"),
  );
  refuse({ title: "x", url: "javascript:1" }, /web address/, def("doclinks"));
  const doc = sanitizeValues(def("doclinks"), {
    title: "Plan",
    url: "https://a.b/c",
    tags: " a, b ,a, ",
  });
  assert.deepEqual(doc.values.tags, ["a", "b"]);
  const num = sanitizeValues(def("capacity"), {
    person: "A",
    project: "P",
    percent: "50",
    from: TODAY,
    to: TODAY,
  });
  assert.equal(num.values.percent, 50);
  const bool = sanitizeValues(def("invoices"), {
    invoice: "I-1",
    status: "Draft",
    timesheetsApproved: true,
    detailsChecked: "true",
    approvalObtained: "yes",
  });
  assert.deepEqual(
    [
      bool.values.timesheetsApproved,
      bool.values.detailsChecked,
      bool.values.approvalObtained,
    ],
    [true, true, false],
  );
  // Too long is refused with a count, never cut silently; a saved file is still read leniently.
  const long = sanitizeValues(raid, {
    kind: "Risk",
    title: "x".repeat(500),
    status: "Open",
    description: "y".repeat(9000),
  });
  assert.equal(long.ok, false);
  assert.match(long.reason, /Title is too long: 500 characters, at most 200/);
  assert.match(
    fieldErrors(raid, {
      kind: "Risk",
      title: "x",
      status: "Open",
      description: "y".repeat(4001),
    }).description,
    /Description is too long: 4,001 characters, at most 4,000/,
  );
  const atLimit = sanitizeValues(raid, {
    kind: "Risk",
    title: "x".repeat(200),
    status: "Open",
    description: "y".repeat(4000),
  });
  assert.equal(atLimit.ok, true);
  const cut = sanitizeValues(
    raid,
    { kind: "Risk", title: "x".repeat(500), status: "Open" },
    true,
  );
  assert.equal(cut.values.title.length, 200);
  // A link over the old 500-character cut is kept whole, up to 2,000.
  const longUrl = `https://a.example/${"p".repeat(1500)}`;
  assert.equal(
    sanitizeValues(def("doclinks"), { title: "x", url: longUrl }).values.url,
    longUrl,
  );
  assert.equal(
    sanitizeValues(def("doclinks"), { title: "x", url: `${longUrl}${"p".repeat(600)}` })
      .ok,
    false,
  );
});

test("records: links need a real host and no password; dates before year 1000 are explained", () => {
  assert.equal(isHttpUrl("https:///x"), false);
  assert.equal(isHttpUrl("https://user:pw@example.com/"), false);
  assert.equal(isHttpUrl("https://"), false);
  assert.equal(isHttpUrl("HTTP://EXAMPLE.COM/Path"), true);
  assert.equal(isHttpUrl("https://localhost:3000/a?b=c#d"), true);
  assert.match(
    sanitizeValues(def("doclinks"), { title: "x", url: "https:///x" }).reason,
    /web address/,
  );
  // An old saved link that would fail today still loads.
  assert.equal(
    sanitizeValues(def("doclinks"), { title: "x", url: "https:///x" }, true).ok,
    true,
  );
  assert.match(
    sanitizeValues(def("raid"), {
      kind: "Risk",
      title: "x",
      status: "Open",
      dueDate: "0001-01-01",
    }).reason,
    /needs a year from 1000 on/,
  );
});

test("records: fieldErrors names every bad field, in the form's terms", () => {
  const raid = def("raid");
  assert.deepEqual(fieldErrors(raid, { kind: "Risk", title: "x", status: "Open" }), {});
  assert.deepEqual(
    fieldErrors(raid, {
      kind: "Nope",
      title: " ",
      status: "Open",
      dueDate: "2026-02-30",
    }),
    {
      kind: "Type must be one of: Risk, Assumption, Issue, Dependency.",
      title: "Title is required.",
      dueDate: "Review or resolve by is not a real date (use year-month-day).",
    },
  );
  assert.deepEqual(Object.keys(fieldErrors(raid, {})), ["kind", "title", "status"]);
  const backwards = {
    person: "A",
    project: "P",
    percent: 50,
    from: TODAY,
    to: "2026-03-01",
  };
  assert.deepEqual(fieldErrors(def("capacity"), backwards), {
    to: "The end date cannot be before the start date.",
  });
  // The first message is still what sanitizeValues refuses with.
  assert.equal(sanitizeValues(raid, {}).reason, "Type is required.");
});

test("cells: blank values read as empty, dates and links are shortened, closed statuses are quiet", () => {
  const raid = def("raid");
  const field = (key) => raid.fields.find((f) => f.key === key);
  assert.equal(cellText(field("owner"), undefined), "");
  assert.equal(cellText(field("owner"), ""), "");
  assert.equal(cellText(field("dueDate"), ""), "");
  assert.equal(cellText(field("dueDate"), "2026-03-10"), formatDayMonth("2026-03-10"));
  assert.equal(cellText(field("title"), "x".repeat(120)).length, 88);
  assert.equal(cellText(undefined, ["a", "b"]), "a, b");
  assert.equal(cellText(undefined, true), "✓");
  assert.equal(cellText(undefined, false), "");
  const link = def("doclinks").fields.find((f) => f.key === "url");
  assert.equal(cellText(link, "https://x.sharepoint.com/a/b"), "x.sharepoint.com/a/b");
  assert.equal(cellText(link, "https://x.sharepoint.com/"), "x.sharepoint.com");
  assert.equal(
    cellText(link, "https://x.sharepoint.com/a?token=1"),
    "x.sharepoint.com/a",
  );
  assert.equal(cellText(field("dueDate"), "2000-01-01", "2026-11-05"), "1 Jan 2000");
  assert.equal(
    cellText(field("dueDate"), "2026-03-10", "2026-11-05"),
    formatDayMonth("2026-03-10"),
  );
  assert.equal(exportHint(3, 2), null);
  assert.match(exportHint(0, 0), /Nothing to export yet/);
  assert.match(exportHint(4, 0), /no record matches/);
});

test("records: a record keeps its id, creation time and to-do link, and refuses a forged link", () => {
  const d = def("decisions");
  const first = sanitizeRecord(
    d,
    { values: { title: "Use Teams", status: "Decided" } },
    NOW,
  );
  assert.equal(first.ok, true);
  assert.match(first.record.id, RECORD_ID);
  assert.equal(first.record.createdAt, NOW);
  const later = "2026-04-01T00:00:00.000Z";
  const again = sanitizeRecord(
    d,
    {
      id: "rg_ffffffffffff",
      values: { title: "Use Teams v2", status: "Decided" },
      todoId: "td_0123456789ab",
    },
    later,
    first.record,
  );
  assert.equal(again.record.id, first.record.id, "the existing id wins");
  assert.equal(again.record.createdAt, NOW);
  assert.equal(again.record.updatedAt, later);
  assert.equal(again.record.todoId, "td_0123456789ab");
  assert.equal(
    sanitizeRecord(
      d,
      { values: { title: "x", status: "Decided" }, todoId: "../etc" },
      NOW,
    ).record.todoId,
    undefined,
  );
  assert.equal(
    sanitizeRecord(
      d,
      { id: "rg_0123456789ab", values: { title: "x", status: "Decided" } },
      NOW,
    ).record.id,
    "rg_0123456789ab",
  );
  assert.equal(
    sanitizeRecord(
      d,
      { id: "bad", values: { title: "x", status: "Decided" } },
      NOW,
    ).record.id.startsWith("rg_"),
    true,
  );
  assert.equal(sanitizeRecord(d, "nope", NOW).ok, false);
});

test("records: filter, sort, count and export", () => {
  const d = def("raid");
  const items = [
    rec("1", {
      kind: "Risk",
      title: "Vendor delay",
      status: "Open",
      dueDate: "2026-03-20",
      owner: "Ana",
    }),
    rec("2", {
      kind: "Issue",
      title: "Server down",
      status: "Closed",
      dueDate: "2026-03-01",
      owner: "Ben",
    }),
    rec("3", {
      kind: "Risk",
      title: "No budget",
      status: "Mitigating",
      dueDate: "",
      owner: "Ana",
    }),
    rec("4", {
      kind: "Risk",
      title: "Early one",
      status: "Open",
      dueDate: "2026-03-06",
      owner: "Cy",
    }),
  ];
  assert.equal(isOpen(d, items[1]), false);
  assert.equal(isOpen(def("lessons"), rec("9", {})), true);
  assert.deepEqual(
    filterRecords(d, items, {}).map((i) => i.id.slice(-1)),
    ["1", "3", "4"],
  );
  assert.equal(filterRecords(d, items, { includeClosed: true }).length, 4);
  assert.deepEqual(
    filterRecords(d, items, { status: "Mitigating" }).map((i) => i.id.slice(-1)),
    ["3"],
  );
  assert.deepEqual(
    filterRecords(d, items, { query: "ANA" }).map((i) => i.id.slice(-1)),
    ["1", "3"],
  );
  assert.deepEqual(
    sortRecords(d, items).map((i) => i.id.slice(-1)),
    ["2", "4", "1", "3"],
    "dates ascending, blank last",
  );
  assert.deepEqual(
    sortRecords(def("decisions"), [
      rec("1", { decidedOn: "2026-01-01" }),
      rec("2", { decidedOn: "2026-02-01" }),
    ]).map((i) => i.id.slice(-1)),
    ["2", "1"],
  );
  assert.deepEqual(statusCounts(d, items), [
    { status: "Open", count: 2 },
    { status: "Mitigating", count: 1 },
    { status: "Closed", count: 1 },
  ]);
  assert.deepEqual(statusCounts(def("lessons"), items), []);
  const rows = csvRows(def("doclinks"), [
    rec("1", { title: "Plan", url: "https://a.b", tags: ["x", "y"] }),
  ]);
  assert.equal(rows[0][0], "Title");
  assert.equal(rows[1][5], "x; y");
  assert.equal(
    csvRows(def("invoices"), [
      rec("1", { invoice: "I", timesheetsApproved: true, detailsChecked: false }),
    ])[1][5],
    "yes",
  );
});

test("records: settings keep their numbers and fall back when wrong", () => {
  const sla = def("sla");
  assert.deepEqual(sanitizeConfig(sla, undefined), { p1: 1, p2: 3, p3: 5, p4: 10 });
  assert.deepEqual(
    sanitizeConfig(sla, { p1: "2", p2: -1, p3: 99999, p4: "x", other: 1 }),
    { p1: 2, p2: 3, p3: 5, p4: 10 },
  );
  assert.deepEqual(sanitizeConfig(def("raid"), { anything: 1 }), {});
});

test("alerts: a due date is late, today, soon, or quiet", () => {
  const changes = def("changes");
  const ctx = { today: TODAY, config: {} };
  const at = (targetDate, status = "Submitted") =>
    recordAlert(changes, rec("1", { status, targetDate }), ctx);
  assert.deepEqual(at("2026-03-03"), { level: "late", text: "Late by 2 days" });
  assert.deepEqual(at("2026-03-04"), { level: "late", text: "Late by 1 day" });
  assert.deepEqual(at(TODAY), { level: "soon", text: "Due today" });
  assert.deepEqual(at("2026-03-08"), { level: "soon", text: "Due in 3 days" });
  assert.equal(at("2026-03-30"), null);
  assert.equal(at(""), null);
  assert.equal(at("2026-03-01", "Implemented"), null, "closed never alerts");
});

test("alerts: RAID adds review and ageing", () => {
  const raid = def("raid");
  const ctx = { today: TODAY, config: {} };
  const a = (values) => recordAlert(raid, rec("1", { status: "Open", ...values }), ctx);
  assert.equal(a({ dueDate: "2026-03-01" }).level, "late");
  assert.deepEqual(a({ dueDate: "2026-03-07" }), {
    level: "soon",
    text: "Review in 2 days",
  });
  assert.deepEqual(a({ raisedOn: "2026-01-04" }), {
    level: "info",
    text: "Open 60 days",
  });
  assert.equal(a({ raisedOn: "2026-03-01" }), null);
});

test("alerts: SLA breached, at risk, resolved late, fine", () => {
  const sla = def("sla");
  const config = { p1: 1, p2: 3, p3: 5, p4: 10 };
  const ctx = { today: TODAY, config };
  const a = (values) =>
    recordAlert(sla, rec("1", { status: "Open", priority: "P2", ...values }), ctx);
  assert.equal(
    slaDue(rec("1", { priority: "P2", received: "2026-03-01" }), config),
    "2026-03-04",
  );
  assert.equal(slaDue(rec("1", { priority: "P9", received: "2026-03-01" }), config), "");
  assert.deepEqual(a({ received: "2026-03-01" }), {
    level: "late",
    text: "Breached 1 day ago",
  });
  assert.deepEqual(a({ received: "2026-03-03" }), {
    level: "soon",
    text: "Due in 1 day",
  });
  assert.deepEqual(a({ received: "2026-03-05", priority: "P1" }), {
    level: "soon",
    text: "Due in 1 day",
  });
  assert.deepEqual(a({ received: "2026-03-05", priority: "P4" }), null);
  assert.deepEqual(
    a({ received: "2026-03-01", priority: "P3" })?.level,
    "soon",
    "80% of the time used",
  );
  assert.deepEqual(
    a({ received: "2026-03-01", status: "Resolved", resolvedOn: "2026-03-08" }),
    { level: "info", text: "Resolved 4 days late" },
  );
  assert.equal(
    a({ received: "2026-03-01", status: "Resolved", resolvedOn: "2026-03-03" }),
    null,
  );
});

test("alerts: contracts, stakeholders and events", () => {
  const ctx = { today: TODAY, config: {} };
  const vendors = def("vendors");
  const v = (values) =>
    recordAlert(vendors, rec("1", { status: "Active", noticeDays: 60, ...values }), ctx);
  assert.equal(v({ renewalDate: "2026-03-01" }).text, "Renewal date has passed");
  assert.equal(v({ renewalDate: "2026-04-20" }).text, "Notice window passed 14 days ago");
  assert.deepEqual(v({ renewalDate: "2026-05-20" }), {
    level: "soon",
    text: "Give notice by 21 Mar",
  });
  assert.deepEqual(v({ renewalDate: "2026-05-20", noticeDays: 10 }), {
    level: "info",
    text: "Renews in 76 days",
  });
  assert.equal(v({ renewalDate: "2027-01-01" }), null);
  assert.equal(v({ renewalDate: "" }), null);

  const st = def("stakeholders");
  const s = (values) =>
    recordAlert(st, rec("1", { status: "Active", cadenceDays: 30, ...values }), ctx);
  assert.equal(s({}).text, "No contact logged yet");
  assert.deepEqual(s({ lastContact: "2026-01-01" }), {
    level: "late",
    text: "Contact overdue by 33 days",
  });
  assert.deepEqual(s({ lastContact: "2026-02-08" }), {
    level: "soon",
    text: "Contact due in 5 days",
  });
  assert.equal(s({ lastContact: "2026-03-01" }), null);
  assert.equal(s({ lastContact: "2026-01-01", status: "Inactive" }), null);

  const gov = def("governance");
  const g = (values, extra) =>
    recordAlert(gov, rec("1", { status: "Planned", prepDays: 5, ...values }, extra), ctx);
  assert.equal(g({ date: "2026-03-01" }).level, "late");
  assert.deepEqual(g({ date: TODAY }), { level: "soon", text: "Today" });
  assert.deepEqual(g({ date: "2026-03-09" }), { level: "soon", text: "In 4 days" });
  assert.deepEqual(g({ date: "2026-03-14", prepDays: 12 }), {
    level: "soon",
    text: "Time to start prep",
  });
  assert.equal(
    g({ date: "2026-03-14", prepDays: 12 }, { todoId: "td_0123456789ab" }),
    null,
  );
  assert.equal(g({ date: "2026-03-14" }), null, "prep has not started yet");
  assert.equal(g({ date: "2026-04-12" }), null);
  assert.equal(prepStart(rec("1", { date: "2026-03-12", prepDays: 3 })), "2026-03-09");
});

test("alerts: invoices say what is missing, and RAG rolls up to the worst", () => {
  const inv = def("invoices");
  const ctx = { today: TODAY, config: {} };
  const full = {
    invoice: "I-1",
    status: "Draft",
    poNumber: "PO1",
    timesheetsApproved: true,
    detailsChecked: true,
    approvalObtained: true,
  };
  assert.deepEqual(invoiceBlockers(rec("1", full)), []);
  assert.deepEqual(
    invoiceBlockers(rec("1", { ...full, poNumber: "", approvalObtained: false })),
    ["a PO number", "approval"],
  );
  const a = (values) => recordAlert(inv, rec("1", { ...full, ...values }), ctx);
  assert.deepEqual(a({}), {
    level: "info",
    text: "Everything is in place: mark it ready",
  });
  assert.equal(a({ status: "Ready" }), null);
  assert.deepEqual(a({ status: "Ready", poNumber: "" }), {
    level: "late",
    text: "Marked ready but missing a PO number",
  });
  assert.equal(a({ poNumber: "", sendBy: "2026-03-06" }).level, "late");
  assert.equal(a({ poNumber: "", sendBy: "2026-03-10" }).level, "soon");
  assert.equal(a({ poNumber: "", sendBy: "2026-05-10" }).level, "info");
  assert.equal(a({ status: "Sent", poNumber: "" }), null);

  const rag = def("status-report");
  const r = (values) =>
    rec("1", {
      status: "Active",
      schedule: "Green",
      budget: "Green",
      scope: "Green",
      asOf: TODAY,
      ...values,
    });
  assert.equal(overallRag(r({})), "Green");
  assert.equal(overallRag(r({ budget: "Amber" })), "Amber");
  assert.equal(overallRag(r({ budget: "Amber", scope: "Red" })), "Red");
  assert.deepEqual(recordAlert(rag, r({ scope: "Red", budget: "Red" }), ctx), {
    level: "late",
    text: "Red: budget, scope",
  });
  assert.deepEqual(recordAlert(rag, r({ schedule: "Amber" }), ctx), {
    level: "soon",
    text: "Amber: schedule",
  });
  assert.deepEqual(recordAlert(rag, r({ asOf: "2026-02-20" }), ctx), {
    level: "info",
    text: "Not updated for 13 days",
  });
  assert.equal(recordAlert(def("lessons"), rec("1", {}), ctx), null);
});

test("alerts: a register summary counts open, late and soon", () => {
  const d = def("changes");
  const items = [
    rec("1", { status: "Submitted", targetDate: "2026-03-01" }),
    rec("2", { status: "Approved", targetDate: "2026-03-07" }),
    rec("3", { status: "Draft", targetDate: "2026-06-01" }),
    rec("4", { status: "Implemented", targetDate: "2026-01-01" }),
  ];
  assert.deepEqual(summarise(d, items, { today: TODAY, config: {} }), {
    id: "changes",
    total: 4,
    open: 3,
    late: 1,
    soon: 1,
  });
});

test("timesheets: weeks, leave, pasted lists and the chaser", () => {
  const monday = "2026-03-02";
  assert.deepEqual(workDays(monday), [
    "2026-03-02",
    "2026-03-03",
    "2026-03-04",
    "2026-03-05",
    "2026-03-06",
  ]);
  const leave = [
    { employeeId: "e1", startDate: "2026-02-27", endDate: "2026-03-06" },
    { employeeId: "e2", startDate: "2026-03-04", endDate: "2026-03-04" },
  ];
  assert.equal(onLeaveAllWeek("e1", monday, leave), true);
  assert.equal(onLeaveAllWeek("e2", monday, leave), false);
  const people = [
    { id: "e1", name: "Ana Lopez", email: "ana@x.com" },
    { id: "e2", name: "Ben Okafor", email: "ben@x.com" },
    { id: "e3", name: "Mia Chen", email: "" },
  ];
  const seeded = seedWeek(monday, people, leave);
  assert.deepEqual(
    seeded.map((s) => s.status),
    ["On leave", "Missing", "Missing"],
  );
  assert.equal(seeded[0].week, monday);

  const found = matchSubmitted(
    "Okafor, Ben\nsubmitted by mia chen on Friday\nnobody here",
    people,
  );
  assert.deepEqual(found.matched, ["Ben Okafor", "Mia Chen"]);
  assert.deepEqual(found.unmatched, ["nobody here"]);
  assert.deepEqual(matchSubmitted("ana@x.com; ben@x.com", people).matched, [
    "Ana Lopez",
    "Ben Okafor",
  ]);

  const chaser = timesheetChaser(
    monday,
    [
      { person: "Ben Okafor", email: "ben@x.com" },
      { person: "Mia Chen", email: "" },
    ],
    "Sam",
  );
  assert.equal(chaser.subject, "Timesheet reminder: week of 2 Mar");
  assert.equal(chaser.to, "ben@x.com");
  assert.deepEqual(chaser.withoutEmail, ["Mia Chen"]);
  assert.match(chaser.body, /^Hi all,/);
  assert.match(chaser.body, /2 Mar to 6 Mar/);
  assert.match(chaser.body, /Sam$/);
  assert.match(
    timesheetChaser(monday, [{ person: "Ben Okafor", email: "ben@x.com" }], "").body,
    /^Hi Ben,/,
  );
});

test("capacity: allocations add up per week and leave lowers what is available", () => {
  const alloc = (person, project, percent, from, to) =>
    rec(`${person}${project}`.replace(/\W/g, "").slice(0, 8).padEnd(1, "0"), {
      person,
      project,
      percent,
      from,
      to,
    });
  const items = [
    alloc("Ana", "A", 60, "2026-03-02", "2026-03-20"),
    alloc("Ana", "B", 50, "2026-03-09", "2026-03-13"),
    alloc("Ben", "A", 100, "2026-03-02", "2026-03-06"),
  ].map((r, i) => ({ ...r, id: `rg_${String(i + 1).padStart(12, "0")}` }));
  const weeks = weekStarts("2026-03-02", 3);
  assert.deepEqual(weeks, ["2026-03-02", "2026-03-09", "2026-03-16"]);
  const grid = capacityGrid(items, weeks, (person, monday) =>
    person === "Ben" && monday === "2026-03-02" ? 2 : 0,
  );
  assert.deepEqual(
    grid.map((r) => r.person),
    ["Ana", "Ben"],
  );
  assert.deepEqual(
    grid[0].cells.map((c) => c.percent),
    [60, 110, 60],
  );
  assert.deepEqual(
    grid[0].cells.map((c) => c.over),
    [false, true, false],
  );
  assert.deepEqual(grid[0].cells[1].projects, ["A", "B"]);
  assert.equal(grid[0].overWeeks, 1);
  assert.deepEqual(
    grid[1].cells.map((c) => [c.percent, c.available, c.over]),
    [
      [100, 60, true],
      [0, 100, false],
      [0, 100, false],
    ],
  );
  assert.deepEqual(capacityGrid([], weeks), []);
});

test("reports: the status report, change summary, month-end check and to-do seed", () => {
  const d = def("status-report");
  const p = (id, values) =>
    rec(id, {
      status: "Active",
      schedule: "Green",
      budget: "Green",
      scope: "Green",
      ...values,
    });
  const report = statusReport(
    [
      p("1", {
        project: "Alpha",
        owner: "Ana",
        commentary: "On track\nall good",
        nextSteps: "Go live",
      }),
      p("2", { project: "Beta", schedule: "Red" }),
      p("3", { project: "Old", status: "Closed" }),
    ],
    d,
    TODAY,
  );
  assert.equal(report.overall, "Red");
  assert.deepEqual(report.counts, { Green: 1, Amber: 0, Red: 1 });
  assert.equal(report.subject, "Weekly status report: 5 Mar (Red)");
  assert.ok(report.text.indexOf("Beta") < report.text.indexOf("Alpha"), "worst first");
  assert.ok(report.text.includes("This week: On track all good"));
  assert.ok(report.text.includes("Alpha (Ana): GREEN"));
  assert.ok(!report.text.includes("Old"));
  assert.match(statusReport([], d, TODAY).text, /No active projects/);

  const c = def("changes");
  const cs = changeSummary(
    [
      rec("1", {
        ref: "CR-1",
        title: "Add field",
        status: "Submitted",
        requester: "Ana",
        targetDate: "2026-03-01",
      }),
      rec("2", { title: "Move date", status: "Approved" }),
      rec("3", { title: "Done one", status: "Implemented" }),
    ],
    c,
    TODAY,
  );
  assert.deepEqual(cs.counts, { Submitted: 1, Approved: 1, Implemented: 1 });
  assert.match(cs.text, /Waiting for a decision\n- CR-1 Add field \(Ana\), target 1 Mar/);
  assert.match(cs.text, /Approved, not yet implemented\n- Move date/);
  assert.match(cs.text, /Past their target date\n- CR-1/);

  const inv = def("invoices");
  const full = {
    status: "Draft",
    poNumber: "PO",
    timesheetsApproved: true,
    detailsChecked: true,
    approvalObtained: true,
  };
  const m = monthEndCheck(
    [
      rec("1", { ...full, invoice: "I-1", month: "2026-03" }),
      rec("2", { ...full, invoice: "I-2", month: "2026-03", poNumber: "" }),
      rec("3", { ...full, invoice: "I-3", month: "2026-04" }),
    ],
    inv,
    "2026-03",
    TODAY,
  );
  assert.deepEqual([m.ready, m.blocked, m.daysLeft], [1, 1, 26]);
  assert.match(m.text, /I-2: missing a PO number/);
  assert.match(monthEndCheck([], inv, "2026-02", TODAY).text, /Month-end has passed/);

  const seed = todoSeed(
    def("raid"),
    rec("1", {
      title: "Vendor delay",
      status: "Open",
      dueDate: "2026-03-20",
      owner: "Ana",
    }),
  );
  assert.deepEqual(seed, {
    title: "RAID log: Vendor delay",
    description: "Status: Open\nFrom the RAID log in the PMO toolkit.",
    owner: "Ana",
    dueAt: "2026-03-20",
    tags: ["raid"],
  });
  assert.equal(todoSeed(def("lessons"), rec("1", { project: "P" })).dueAt, null);
});

test("sla import: dates, priorities, headers and skipped lines", () => {
  assert.equal(parseDay("2026-03-02"), "2026-03-02");
  assert.equal(parseDay("2/3/2026"), "2026-03-02", "day first");
  assert.equal(parseDay("02-Mar-2026"), "2026-03-02");
  assert.equal(parseDay("5 March 2026"), "2026-03-05");
  assert.equal(parseDay("2026-03-02 10:15:00"), "2026-03-02");
  assert.equal(parseDay("31/02/2026"), null);
  assert.equal(parseDay("soon"), null);
  assert.equal(parsePriority("1 - Critical"), "P1");
  assert.equal(parsePriority("P3"), "P3");
  assert.equal(parsePriority("High"), "P2");
  assert.equal(parsePriority("Moderate"), "P3");
  assert.equal(parsePriority("whenever"), null);
  const out = parseSlaRows(
    "Number,Priority,Opened,Short description\nINC1,2 - High,2026-03-01,Printer down\nINC2\tP4\t3/3/2026\nINC3,9,2026-03-01\nINC4,P1,someday\nonly two,cells\n\n",
  );
  assert.deepEqual(out.rows, [
    { ref: "INC1", title: "Printer down", priority: "P2", received: "2026-03-01" },
    { ref: "INC2", title: "INC2", priority: "P4", received: "2026-03-03" },
  ]);
  assert.deepEqual(
    out.skipped.map((s) => s.reason),
    [
      "unknown priority “9”",
      "unknown date “someday”",
      "needs a number, a priority and a date",
    ],
  );
});

async function tempRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "aios-registers-"));
  return { root, env: { AI_OS_PMO_DATA_DIR: root } };
}

test("server: add, change, remove and keep settings, one file per register", async () => {
  const { root, env } = await tempRoot();
  try {
    const raid = def("raid");
    let n = 0;
    const clock = () => `2026-03-0${++n}T09:00:00.000Z`;
    const empty = await readRegister(raid, env);
    assert.deepEqual(empty, { items: [], config: {} });

    const added = await applyRegisterChanges(
      raid,
      {
        upsert: [
          { values: { kind: "Risk", title: "A", status: "Open" } },
          { values: { kind: "Issue", title: "B", status: "Open" } },
        ],
      },
      env,
      clock,
    );
    assert.equal(added.items.length, 2);
    const [a, b] = added.items;
    assert.equal(a.createdAt, "2026-03-01T09:00:00.000Z");

    const edited = await applyRegisterChanges(
      raid,
      {
        upsert: [
          { id: a.id, values: { kind: "Risk", title: "A2", status: "Mitigating" } },
        ],
        remove: [b.id],
      },
      env,
      clock,
    );
    assert.deepEqual(
      edited.items.map((i) => i.values.title),
      ["A2"],
    );
    assert.equal(edited.items[0].createdAt, "2026-03-01T09:00:00.000Z");
    assert.equal(edited.items[0].updatedAt, "2026-03-02T09:00:00.000Z");
    const onDisk = JSON.parse(
      await readFile(path.join(root, "registers", "raid.json"), "utf8"),
    );
    assert.equal(onDisk.version, 1);
    assert.equal(onDisk.items.length, 1);

    const sla = def("sla");
    const cfg = await applyRegisterChanges(
      sla,
      { config: { p1: 2, p2: 3, p3: 5, p4: 10 } },
      env,
      clock,
    );
    assert.deepEqual(cfg.config, { p1: 2, p2: 3, p3: 5, p4: 10 });
    assert.deepEqual((await readRegister(sla, env)).config, cfg.config);
    assert.equal(
      (await readRegister(raid, env)).items.length,
      1,
      "registers are separate",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("server: a bad record changes nothing, and limits hold", async () => {
  const { root, env } = await tempRoot();
  try {
    const raid = def("raid");
    await applyRegisterChanges(
      raid,
      { upsert: [{ values: { kind: "Risk", title: "Keep", status: "Open" } }] },
      env,
    );
    await assert.rejects(
      applyRegisterChanges(
        raid,
        {
          upsert: [
            { values: { kind: "Risk", title: "Ok", status: "Open" } },
            { values: { kind: "Risk", title: "", status: "Open" } },
          ],
        },
        env,
      ),
      (e) => e instanceof RegisterError && /Title is required/.test(e.message),
    );
    assert.equal((await readRegister(raid, env)).items.length, 1);
    await assert.rejects(applyRegisterChanges(raid, { upsert: "x" }, env), /at most/);
    await assert.rejects(applyRegisterChanges(raid, { remove: "x" }, env), /list of ids/);
    await assert.rejects(
      applyRegisterChanges(
        raid,
        { upsert: Array.from({ length: 501 }, () => ({})) },
        env,
      ),
      /at most 500/,
    );
    assert.equal(
      (await applyRegisterChanges(raid, undefined, env)).items.length,
      1,
      "no changes is fine",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("server: a damaged file is reported, never overwritten, and odd records are skipped", async () => {
  const { root, env } = await tempRoot();
  try {
    await mkdir(path.join(root, "registers"), { recursive: true });
    const file = path.join(root, "registers", "decisions.json");
    await writeFile(file, "{not json");
    const d = def("decisions");
    await assert.rejects(
      readRegister(d, env),
      (e) => e instanceof RegisterError && e.status === 500,
    );
    await assert.rejects(
      applyRegisterChanges(
        d,
        { upsert: [{ values: { title: "x", status: "Decided" } }] },
        env,
      ),
      RegisterError,
    );
    assert.equal(await readFile(file, "utf8"), "{not json");

    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        items: [
          {
            id: "rg_000000000001",
            createdAt: NOW,
            updatedAt: NOW,
            values: { title: "Good", status: "Decided" },
          },
          { id: "bad id", values: {} },
          { id: "rg_000000000002", values: { title: "", status: "Decided" } },
          5,
        ],
      }),
    );
    const read = await readRegister(d, env);
    assert.deepEqual(
      read.items.map((i) => i.values.title),
      ["Good"],
    );
    assert.equal(read.items[0].createdAt, NOW);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("server: summaries cover every tool and survive a damaged one", async () => {
  const { root, env } = await tempRoot();
  try {
    await applyRegisterChanges(
      def("changes"),
      {
        upsert: [
          { values: { title: "Late", status: "Submitted", targetDate: "2026-03-01" } },
        ],
      },
      env,
    );
    await mkdir(path.join(root, "registers"), { recursive: true });
    await writeFile(path.join(root, "registers", "raid.json"), "broken");
    const out = await readSummaries(TODAY, env);
    assert.equal(out.length, 14);
    assert.deepEqual(
      out.find((s) => s.id === "changes"),
      { id: "changes", total: 1, open: 1, late: 1, soon: 0 },
    );
    assert.deepEqual(
      out.find((s) => s.id === "raid"),
      { id: "raid", total: 0, open: 0, late: 0, soon: 0, unreadable: true },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("command bar: every tool can be opened by name and none collides with another app", () => {
  assert.ok(AI_APP_IDS.includes("pmo-toolkit"));
  for (const id of REGISTER_IDS)
    assert.ok(AI_APP_IDS.includes(id), `${id} is a known app`);
  for (const [id, aliases] of Object.entries(TOOL_ALIASES)) {
    for (const alias of aliases)
      assert.equal(appIdFromName(alias), id, `"${alias}" opens ${id}`);
  }
  assert.equal(resolveOpenIntent("open the RAID log"), "raid");
  assert.equal(resolveOpenIntent("launch decision log"), "decisions");
  assert.equal(resolveOpenIntent("show my timesheet chaser"), "timesheets");
  assert.equal(resolveOpenIntent("open pmo toolkit"), "pmo-toolkit");
  assert.equal(
    resolveOpenIntent("open pmo to-do"),
    "pmo-todo",
    "the older names still win",
  );
  assert.equal(resolveOpenIntent("open templates"), "templates");
});

test("search: records of a tool are found by their words and open that tool", () => {
  const items = recordItems({ id: "raid", title: "RAID log" }, [
    {
      id: "rg_000000000001",
      title: "Vendor delay",
      subtitle: "Open",
      keywords: "Ana supplier slipped",
    },
    {
      id: "rg_000000000002",
      title: "Budget gap",
      subtitle: "Closed",
      keywords: "finance",
    },
  ]);
  assert.equal(items[0].kind, "record");
  assert.deepEqual(items[0].target, { app: "raid" });
  assert.equal(items[0].subtitle, "RAID log, Open");
  assert.equal(searchItems(items, "supplier")[0].title, "Vendor delay");
  assert.equal(searchItems(items, "finance")[0].title, "Budget gap");
  assert.equal(searchItems(items, "nothing-like-this").length, 0);
  assert.equal(KIND_LABEL.record, "PMO tool");
});

test("export: register records go into the JSON and a CSV per tool", async () => {
  const { root, env } = await tempRoot();
  try {
    await applyRegisterChanges(
      def("decisions"),
      {
        upsert: [{ values: { title: "Use Teams", status: "Decided", decidedBy: "Ana" } }],
      },
      env,
    );
    const data = await readExportData(root);
    assert.equal(data.registers.decisions.length, 1);
    assert.deepEqual(Object.keys(data.registers), ["decisions"]);
    const json = JSON.parse(exportJson(data, new Date(NOW), "6.0.0"));
    assert.equal(json.registers.decisions[0].values.title, "Use Teams");
    const files = Object.fromEntries(
      readZip(exportCsvZip(data)).map((e) => [
        e.name,
        Buffer.from(e.data).toString("utf8"),
      ]),
    );
    assert.ok("registers/decisions.csv" in files);
    assert.ok(files["registers/decisions.csv"].includes("Use Teams"));
    assert.equal(
      Object.keys(files).includes("registers/raid.csv"),
      false,
      "empty tools are left out",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("project field: optional free text on RAID, changes and SLA, suggested from status reports", () => {
  for (const id of ["raid", "changes", "sla"]) {
    const d = def(id);
    const field = d.fields.find((f) => f.key === "project");
    assert.equal(field.type, "text", `${id}: plain text, not a select`);
    assert.ok(!field.required, `${id}: must stay optional`);
    assert.equal(field.options, undefined);
    assert.equal(field.suggest, "projects");
    assert.ok(d.columns.includes("project"), `${id}: shown as a column`);
    assert.equal(defaultValues(d, TODAY).project, "");
  }
  // Only the three registers that gained the field ask for suggestions.
  assert.deepEqual(
    REGISTERS.filter((d) => d.fields.some((f) => f.suggest)).map((d) => d.id),
    ["raid", "sla", "changes"],
  );
  // Any text is accepted, whether or not it is a known project; it is trimmed, and a too-long one is refused.
  const raid = def("raid");
  const base = { kind: "Risk", title: "x", status: "Open" };
  assert.equal(sanitizeValues(raid, base).ok, true, "empty project is fine");
  assert.equal(sanitizeValues(raid, base).values.project, "");
  assert.equal(
    sanitizeValues(raid, { ...base, project: "  Brand New Thing " }).values.project,
    "Brand New Thing",
  );
  assert.match(
    sanitizeValues(raid, { ...base, project: "p".repeat(500) }).reason,
    /Project is too long/,
  );
  assert.deepEqual(fieldErrors(raid, base), {});
  // The search box finds a record by its project, case-insensitively.
  const items = [
    rec("1", { ...base, project: "Alpha" }),
    rec("2", { ...base, project: "Beta" }),
  ];
  assert.deepEqual(
    filterRecords(raid, items, { query: "ALPHA" }).map((i) => i.id.slice(-1)),
    ["1"],
  );
  assert.equal(csvRows(raid, items)[0].includes("Project"), true);
});

test("project field: suggestions are the status-report project names, each once, any case", () => {
  const sr = (id, project) => rec(id, { project, status: "Active" });
  assert.deepEqual(
    projectSuggestions([
      sr("1", "Zeta"),
      sr("2", "alpha"),
      sr("3", "Alpha"),
      sr("4", "  ALPHA  "),
      sr("5", ""),
      sr("6", "Beta"),
      rec("7", {}),
    ]),
    ["alpha", "Beta", "Zeta"],
    "first spelling wins, sorted, blanks dropped",
  );
  assert.deepEqual(projectSuggestions([]), []);
});

test("project field: records saved before it existed load, save and round-trip unchanged", async () => {
  const { root, env } = await tempRoot();
  try {
    await mkdir(path.join(root, "registers"), { recursive: true });
    const OLD = {
      raid: {
        kind: "Issue",
        title: "Old issue",
        description: "d",
        owner: "Ana",
        status: "Mitigating",
        impact: "High",
        likelihood: "Low",
        raisedOn: "2026-01-04",
        dueDate: "2026-03-20",
        mitigation: "m",
      },
      sla: {
        ref: "INC1",
        title: "Old ticket",
        priority: "P2",
        received: "2026-03-01",
        resolvedOn: "",
        status: "Open",
        owner: "Ben",
      },
      changes: {
        ref: "CR-1",
        title: "Old change",
        requester: "Cy",
        status: "Approved",
        impact: "Low",
        cost: "2 days",
        targetDate: "2026-04-01",
        description: "x",
        decisionNote: "y",
      },
    };
    const SEEN = {
      raid: "2026-02-01T08:00:00.000Z",
      sla: "2026-02-02T08:00:00.000Z",
      changes: "2026-02-03T08:00:00.000Z",
    };
    for (const [id, values] of Object.entries(OLD)) {
      const d = def(id);
      const stored = {
        id: "rg_0000000000a1",
        createdAt: SEEN[id],
        updatedAt: SEEN[id],
        values,
        todoId: "td_0123456789ab",
      };
      // 1. The sanitiser keeps every old value and just adds an empty project.
      const parsed = sanitizeRecord(d, stored, SEEN[id]);
      assert.equal(parsed.ok, true, `${id}: an old record still validates`);
      // (changes also gained the optional impactNote, which an old record gets empty.)
      const added = id === "changes" ? { project: "", impactNote: "" } : { project: "" };
      assert.deepEqual(parsed.record.values, { ...values, ...added });
      assert.equal(parsed.record.todoId, "td_0123456789ab");

      // 2. Reading an old file returns the record, not an empty register.
      await writeFile(
        path.join(root, "registers", `${id}.json`),
        JSON.stringify({ version: 1, items: [stored] }),
      );
      const read = await readRegister(d, env);
      assert.equal(read.items.length, 1, `${id}: not dropped on read`);
      assert.deepEqual(read.items[0].values, { ...values, ...added });
      assert.equal(read.items[0].createdAt, SEEN[id]);
      assert.equal(read.items[0].todoId, "td_0123456789ab");

      // 3. Saving a different record rereads and rewrites the file; the old one must survive.
      const saved = await applyRegisterChanges(
        d,
        { upsert: [{ values: { ...values, title: "Brand new", project: "Alpha" } }] },
        env,
      );
      assert.equal(saved.items.length, 2, `${id}: old record kept after a save`);
      const onDisk = JSON.parse(
        await readFile(path.join(root, "registers", `${id}.json`), "utf8"),
      );
      assert.equal(onDisk.items.length, 2);
      const kept = onDisk.items.find((i) => i.id === "rg_0000000000a1");
      assert.deepEqual(kept.values, { ...values, ...added });
      assert.equal(kept.createdAt, SEEN[id]);
      assert.equal(kept.todoId, "td_0123456789ab");
      assert.equal(
        onDisk.items.find((i) => i.id !== "rg_0000000000a1").values.project,
        "Alpha",
        `${id}: the new field is saved`,
      );

      // 4. Editing an old record to add a project works and keeps its identity.
      const edited = await applyRegisterChanges(
        d,
        { upsert: [{ id: "rg_0000000000a1", values: { ...values, project: "Beta" } }] },
        env,
      );
      const again = edited.items.find((i) => i.id === "rg_0000000000a1");
      assert.equal(again.values.project, "Beta");
      assert.equal(again.createdAt, SEEN[id]);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
