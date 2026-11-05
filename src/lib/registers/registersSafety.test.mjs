import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { slaDue, recordAlert, summarise } from "./alerts.ts";
import { dateLabel } from "./cells.ts";
import { cellTone, personInitials } from "./cellStyle.ts";
import { registerById } from "./defs.ts";
import { foldIcs } from "./icsFold.ts";
import { invalidLines, recordFromInvalid } from "./invalidRecords.ts";
import { fieldLimit, lengthHint } from "./limits.ts";
import { lineKey, parseMade, withMade } from "./madeLines.ts";
import { normaliseMonth } from "./month.ts";
import {
  applyFieldChange,
  configProblem,
  csvRows,
  fieldErrors,
  filterRecords,
  sanitizeRecord,
  sanitizeValues,
} from "./records.ts";
import { monthEndCheck } from "./reports.ts";
import {
  RegisterError,
  applyRegisterChanges,
  readRegister,
  readSummaries,
} from "./server.ts";
import { parsePriority, parseSlaRows, skippedText } from "./slaImport.ts";
import { matchSubmitted } from "./timesheets.ts";

const def = (id) => registerById(id);
const NOW = "2026-03-05T10:00:00.000Z";
const TODAY = "2026-03-05";
const rec = (id, values, extra = {}) => ({
  id: `rg_${id.padStart(12, "0")}`,
  createdAt: NOW,
  updatedAt: NOW,
  values,
  ...extra,
});

async function tempRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "aios-registers-safety-"));
  return { root, env: { AI_OS_PMO_DATA_DIR: root } };
}

const lesson = (title, category = "People") => ({
  id: "rg_00000000000a",
  createdAt: "2026-01-01T08:00:00.000Z",
  updatedAt: "2026-01-02T08:00:00.000Z",
  values: { project: title, category, recommendation: "Do it again", date: "2026-01-01" },
});

test("TK-01: a record that fails the checks is kept, shown as invalid, and survives other saves", async () => {
  const { root, env } = await tempRoot();
  try {
    await mkdir(path.join(root, "registers"), { recursive: true });
    const file = path.join(root, "registers", "lessons.json");
    const lessons = def("lessons");
    const bad = lesson("Old lesson", "Procurement");
    const odd = { id: "not-an-id", values: { project: "Odd" } };
    await writeFile(file, JSON.stringify({ version: 1, items: [bad, odd, 5] }));

    const read = await readRegister(lessons, env);
    assert.equal(read.items.length, 0);
    assert.equal(read.invalid.length, 3);
    const [badInfo, oddInfo, fiveInfo] = read.invalid;
    assert.equal(badInfo.key, "rg_00000000000a");
    assert.equal(badInfo.id, "rg_00000000000a");
    assert.equal(badInfo.title, "Old lesson");
    assert.match(badInfo.reason, /must be one of/);
    assert.equal(oddInfo.id, null);
    assert.match(oddInfo.key, /^bad_[0-9a-f]{10}$/);
    assert.match(fiveInfo.reason, /not a record/);

    // Saving another record leaves the three entries in the file, byte for byte.
    const saved = await applyRegisterChanges(
      lessons,
      {
        upsert: [
          {
            values: {
              project: "New",
              category: "People",
              recommendation: "r",
              date: "2026-03-01",
            },
          },
        ],
      },
      env,
    );
    assert.equal(saved.items.length, 1);
    assert.equal(saved.invalid.length, 3);
    const onDisk = JSON.parse(await readFile(file, "utf8"));
    assert.deepEqual(onDisk.items.slice(1), [bad, odd, 5]);

    // Summaries say how many need repair; the counts leave them out.
    const summaries = await readSummaries(TODAY, env);
    assert.equal(summaries.find((s) => s.id === "lessons").invalid, 3);
    assert.equal(summaries.find((s) => s.id === "lessons").total, 1);
    assert.equal("invalid" in summaries.find((s) => s.id === "raid"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("TK-01: an invalid record can be repaired (keeping its id and creation time) or removed", async () => {
  const { root, env } = await tempRoot();
  try {
    await mkdir(path.join(root, "registers"), { recursive: true });
    const file = path.join(root, "registers", "lessons.json");
    const lessons = def("lessons");
    const odd = { id: "not-an-id", values: { project: "Odd" } };
    await writeFile(
      file,
      JSON.stringify({ version: 1, items: [lesson("Old", "Procurement"), odd] }),
    );
    const read = await readRegister(lessons, env);

    // A repair that is still wrong is refused and changes nothing.
    await assert.rejects(
      applyRegisterChanges(
        lessons,
        {
          upsert: [
            { id: "rg_00000000000a", values: { project: "Old", category: "Nope" } },
          ],
        },
        env,
      ),
      RegisterError,
    );
    assert.equal((await readRegister(lessons, env)).invalid.length, 2);

    const fixed = await applyRegisterChanges(
      lessons,
      {
        upsert: [
          {
            id: "rg_00000000000a",
            values: {
              project: "Old",
              category: "People",
              recommendation: "Do it again",
              date: "2026-01-01",
            },
          },
        ],
      },
      env,
    );
    assert.equal(fixed.items.length, 1);
    assert.equal(fixed.items[0].id, "rg_00000000000a");
    assert.equal(fixed.items[0].createdAt, "2026-01-01T08:00:00.000Z");
    assert.equal(fixed.invalid.length, 1);

    const key = read.invalid[1].key;
    const removed = await applyRegisterChanges(lessons, { remove: [key] }, env);
    assert.equal(removed.invalid, undefined);
    const onDisk = JSON.parse(await readFile(file, "utf8"));
    assert.equal(onDisk.items.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("TK-01: rules added later do not push old records out (lenient read), but new saves are strict", () => {
  const invoices = def("invoices");
  const old = {
    id: "rg_0000000000b1",
    values: { invoice: "I-1", status: "Draft", month: "Q1 plan" },
  };
  assert.equal(sanitizeRecord(invoices, old, NOW, undefined, true).ok, true);
  assert.equal(sanitizeRecord(invoices, old, NOW).ok, false);
  const sla = def("sla");
  const inconsistent = {
    id: "rg_0000000000b2",
    values: {
      ref: "I",
      title: "t",
      priority: "P1",
      received: "2026-03-01",
      status: "Open",
      resolvedOn: "2026-03-02",
    },
  };
  assert.equal(sanitizeRecord(sla, inconsistent, NOW, undefined, true).ok, true);
  assert.equal(sanitizeRecord(sla, inconsistent, NOW).ok, false);
});

test("TK-02: CSV cells that a spreadsheet would run as a formula are made safe", () => {
  const raid = def("raid");
  const rows = csvRows(raid, [
    rec("1", {
      kind: "Risk",
      title: "=cmd|' /c calc'!A0",
      description: "+1 -1 @SUM(A1)",
      owner: "\tTab",
      status: "Open",
    }),
  ]);
  const header = rows[0];
  const cell = (label) => rows[1][header.indexOf(label)];
  assert.equal(cell("Title"), "'=cmd|' /c calc'!A0");
  assert.equal(cell("Description"), "'+1 -1 @SUM(A1)");
  assert.equal(cell("Owner"), "'\tTab");
  assert.equal(cell("Type"), "Risk");
  // Numbers stay numbers.
  const cap = csvRows(def("capacity"), [
    rec("2", { person: "A", project: "P", percent: 50, from: TODAY, to: TODAY }),
  ]);
  assert.equal(cap[1].includes("50"), true);
});

test("TK-06: SLA days must be whole numbers from 1 to 365, and nothing is silently replaced", async () => {
  const sla = def("sla");
  assert.equal(configProblem(sla, { p1: 1, p2: 3, p3: 5, p4: 10 }), null);
  assert.match(
    configProblem(sla, { p1: -5, p2: 3, p3: 5, p4: 10 }),
    /P1 days must be a whole number from 1 to 365/,
  );
  assert.match(configProblem(sla, { p1: 1, p2: 99999 }), /P2/);
  assert.match(configProblem(sla, { p3: 1.5 }), /P3/);
  assert.match(configProblem(sla, { p4: "" }), /P4/);
  assert.equal(configProblem(def("raid"), { anything: 1 }), null);

  const { root, env } = await tempRoot();
  try {
    await assert.rejects(
      applyRegisterChanges(sla, { config: { p1: 1, p2: 3, p3: 5, p4: "" } }, env),
      /P4 days must be a whole number/,
    );
    const ok = await applyRegisterChanges(
      sla,
      { config: { p1: "2", p2: 3, p3: 5, p4: 10 } },
      env,
    );
    assert.equal(ok.config.p1, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("TK-07: SLA breached counts agree everywhere, and Resolved / Open stay consistent", () => {
  const sla = def("sla");
  const ctx = { today: TODAY, config: { p1: 1, p2: 3, p3: 5, p4: 10 } };
  const base = { ref: "I", title: "t", priority: "P1", received: "2026-02-01" };
  const resolvedNoDate = rec("1", { ...base, status: "Resolved", resolvedOn: "" });
  const openWithDate = rec("2", { ...base, status: "Open", resolvedOn: "2026-02-03" });
  const openLate = rec("3", { ...base, status: "Open", resolvedOn: "" });
  assert.equal(
    recordAlert(sla, resolvedNoDate, ctx),
    null,
    "no red Breached on a Resolved item",
  );
  assert.equal(recordAlert(sla, openWithDate, ctx).level, "late");
  assert.match(recordAlert(sla, openLate, ctx).text, /^Breached/);
  const summary = summarise(sla, [resolvedNoDate, openWithDate, openLate], ctx);
  assert.equal(summary.late, 2);
  assert.equal(slaDue(openLate, ctx.config), "2026-02-02");

  assert.match(
    fieldErrors(sla, { ...base, status: "Open", resolvedOn: "2026-02-03" }).resolvedOn,
    /still Open/,
  );
  assert.match(
    fieldErrors(sla, { ...base, status: "Resolved", resolvedOn: "" }).resolvedOn,
    /Add the day it was resolved/,
  );
  assert.deepEqual(
    fieldErrors(sla, { ...base, status: "Resolved", resolvedOn: "2026-02-03" }),
    {},
  );

  const values = { ...base, status: "Open", resolvedOn: "" };
  assert.equal(
    applyFieldChange(sla, values, "status", "Resolved", TODAY).resolvedOn,
    TODAY,
  );
  assert.equal(
    applyFieldChange(
      sla,
      { ...values, status: "Resolved", resolvedOn: "2026-02-03" },
      "status",
      "Open",
      TODAY,
    ).resolvedOn,
    "",
  );
  assert.equal(
    applyFieldChange(
      sla,
      { ...values, resolvedOn: "2026-02-09" },
      "status",
      "Resolved",
      TODAY,
    ).resolvedOn,
    "2026-02-09",
    "an existing day is kept",
  );
  assert.equal(
    applyFieldChange(def("raid"), { status: "Open" }, "status", "Closed", TODAY).status,
    "Closed",
  );
});

test("TK-08: picking a closed status in the filter shows those records", () => {
  const raid = def("raid");
  const items = [
    rec("1", { status: "Open" }),
    rec("2", { status: "Closed" }),
    rec("3", { status: "Mitigating" }),
  ];
  const ids = (filter) => filterRecords(raid, items, filter).map((i) => i.id.slice(-1));
  assert.deepEqual(ids({}), ["1", "3"]);
  assert.deepEqual(ids({ status: "Closed" }), ["2"]);
  assert.deepEqual(ids({ status: "Open" }), ["1"]);
  assert.deepEqual(ids({ includeClosed: true }), ["1", "2", "3"]);
});

test("TK-09: invoice months are read from the ways people write them, and counted", () => {
  for (const [input, month] of [
    ["2026-03", "2026-03"],
    ["2026-3", "2026-03"],
    ["2026/03", "2026-03"],
    ["3/2026", "2026-03"],
    ["03-2026", "2026-03"],
    ["Nov 2026", "2026-11"],
    ["November 2026", "2026-11"],
    ["nov. 2026", "2026-11"],
    ["2026 Nov", "2026-11"],
    ["2026-11-05", "2026-11"],
    ["  2026-03  ", "2026-03"],
  ]) {
    assert.equal(normaliseMonth(input), month, input);
  }
  for (const bad of [
    "",
    "2026-13",
    "2026-00",
    "13/2026",
    "Q1 2026",
    "soon",
    "Foo 2026",
    "26-03",
    "99999-01",
  ]) {
    assert.equal(normaliseMonth(bad), null, bad);
  }

  const inv = def("invoices");
  assert.deepEqual(
    sanitizeValues(inv, { invoice: "I", status: "Draft", month: "Nov 2026" }).values
      .month,
    "2026-11",
  );
  assert.equal(
    sanitizeValues(inv, { invoice: "I", status: "Draft", month: "2026-13" }).ok,
    false,
  );
  assert.match(
    fieldErrors(inv, { invoice: "I", status: "Draft", month: "2026-13" }).month,
    /Month must be a month like 2026-03/,
  );
  assert.equal(
    sanitizeValues(inv, { invoice: "I", status: "Draft", month: "" }).ok,
    true,
  );

  const full = {
    status: "Draft",
    poNumber: "PO",
    timesheetsApproved: true,
    detailsChecked: true,
    approvalObtained: true,
  };
  const items = [
    rec("1", { ...full, invoice: "I-1", month: "Nov 2026" }),
    rec("2", { ...full, invoice: "I-2", month: "2026-11", poNumber: "" }),
    rec("3", { ...full, invoice: "I-3", month: "2026-12" }),
  ];
  const check = monthEndCheck(items, inv, "2026-11", "2026-11-05");
  assert.deepEqual(
    [check.valid, check.ready, check.blocked, check.daysLeft],
    [true, 1, 1, 25],
  );
  const typed = monthEndCheck(items, inv, "November 2026", "2026-11-05");
  assert.equal(typed.month, "2026-11");
  assert.equal(typed.ready, 1);
  const blank = monthEndCheck(items, inv, "", "2026-11-05");
  assert.equal(blank.valid, false);
  assert.equal(blank.text, "");
});

test("TK-22: a date outside this year shows its year", () => {
  assert.equal(dateLabel("2000-01-01", "2026-11-05"), "1 Jan 2000");
  assert.equal(dateLabel("2026-02-29".replace("29", "28"), "2026-11-05"), "28 Feb");
  assert.equal(dateLabel("2028-02-29", "2026-11-05"), "29 Feb 2028");
  assert.equal(dateLabel("2028-02-29"), "29 Feb");
});

test("TK-23: calendar lines fold at 75 octets, never inside a character, and folding twice changes nothing", () => {
  const long = `DESCRIPTION:${"Attendees: ZoÃ« MÃ¼ller, å±±ç”°å¤ªéƒŽ; ".repeat(12)}`;
  const text = `BEGIN:VCALENDAR\r\nSUMMARY:short\r\n${long}\r\nEND:VCALENDAR\r\n`;
  const folded = foldIcs(text);
  const encoder = new TextEncoder();
  for (const line of folded.split("\r\n")) {
    assert.ok(encoder.encode(line).length <= 75, `too long: ${line.length}`);
  }
  assert.equal(folded.endsWith("END:VCALENDAR\r\n"), true);
  // Unfolding (remove CRLF + space) gives the original back.
  assert.equal(folded.replace(/\r\n /g, ""), text);
  assert.equal(foldIcs(folded), folded);
  assert.equal(foldIcs("A:b\r\n"), "A:b\r\n");
});

test("TK-28: initials skip symbols, and a pasted name matches whole words only", () => {
  assert.equal(personInitials("<script>alert(1)</script>"), "S");
  assert.equal(personInitials("Priya Nair"), "PN");
  assert.equal(personInitials("priya.nair@x.com"), "PN");
  const people = [
    { name: "Ann Lee", email: "ann@x.com" },
    { name: "Joann Lee", email: "joann@x.com" },
  ];
  assert.deepEqual(matchSubmitted("Joann Lee", people).matched, ["Joann Lee"]);
  assert.deepEqual(matchSubmitted("Ann Lee", people).matched, ["Ann Lee"]);
  assert.deepEqual(matchSubmitted("Lee, Ann", people).matched, ["Ann Lee"]);
  assert.deepEqual(matchSubmitted("Ann Lee <ann@x.com>", people).matched, ["Ann Lee"]);
  assert.deepEqual(matchSubmitted("Submitted: Joann Lee (done)", people).matched, [
    "Joann Lee",
  ]);
  assert.equal(cellTone(def("raid"), "impact", "High"), "danger");
});

test("TK-20: day counts and the to-dos-made count must be whole numbers", () => {
  const minutes = def("minutes");
  const base = { title: "Steering", date: TODAY };
  assert.equal(sanitizeValues(minutes, { ...base, actions: 3 }).ok, true);
  assert.match(
    sanitizeValues(minutes, { ...base, actions: 1.5 }).reason,
    /To-dos made must be a whole number/,
  );
  assert.match(
    sanitizeValues(minutes, { ...base, actions: -3 }).reason,
    /To-dos made must be at least 0/,
  );
  assert.equal(sanitizeValues(minutes, { ...base, actions: 1.5 }, true).ok, true);
  assert.match(
    fieldErrors(def("stakeholders"), { name: "A", cadenceDays: 7.5 }).cadenceDays,
    /whole number/,
  );
});

test("TK-18: an undo can bring back the original creation time, but not a future one", () => {
  const raid = def("raid");
  const input = {
    id: "rg_0000000000c1",
    createdAt: "2026-01-01T08:00:00.000Z",
    values: { kind: "Risk", title: "x", status: "Open" },
  };
  assert.equal(
    sanitizeRecord(raid, input, NOW).record.createdAt,
    "2026-01-01T08:00:00.000Z",
  );
  assert.equal(
    sanitizeRecord(raid, { ...input, createdAt: "2099-01-01T00:00:00.000Z" }, NOW).record
      .createdAt,
    NOW,
  );
  assert.equal(
    sanitizeRecord(raid, { ...input, createdAt: "junk" }, NOW).record.createdAt,
    NOW,
  );
});

test("TK-01: an invalid record opens in the form with its wrong value kept, or can only be read when it has no id", () => {
  const lessons = def("lessons");
  const info = {
    key: "rg_00000000000a",
    id: "rg_00000000000a",
    title: "Old",
    reason: "Category must be one of: ...",
    raw: {
      id: "rg_00000000000a",
      createdAt: "2026-01-01T08:00:00.000Z",
      todoId: "td_0123456789ab",
      values: { project: "Old", category: "Procurement", extra: { a: 1 }, tags: 5 },
    },
  };
  const record = recordFromInvalid(lessons, info);
  assert.equal(record.id, "rg_00000000000a");
  assert.equal(record.createdAt, "2026-01-01T08:00:00.000Z");
  assert.equal(record.todoId, "td_0123456789ab");
  assert.deepEqual(record.values, { project: "Old", category: "Procurement" });
  assert.deepEqual(
    fieldErrors(lessons, record.values).category,
    "Category must be one of: Planning, Delivery, People, Process, Tools, Stakeholders, Other.",
  );
  assert.deepEqual(invalidLines(lessons, info), [
    "Project: Old",
    "Category: Procurement",
  ]);
  const noId = { key: "bad_abc", id: null, title: "x", reason: "r", raw: 5 };
  assert.equal(recordFromInvalid(lessons, noId), null);
  assert.deepEqual(invalidLines(lessons, noId), ["5"]);
});

test("TK-03: the form says how close a text is to its limit", () => {
  const field = (id, key) => def(id).fields.find((f) => f.key === key);
  assert.equal(fieldLimit(field("raid", "title")), 200);
  assert.equal(fieldLimit(field("raid", "description")), 4000);
  assert.equal(fieldLimit(field("doclinks", "url")), 2000);
  assert.equal(fieldLimit(field("raid", "status")), null);
  assert.equal(lengthHint(100, 200), undefined);
  assert.equal(lengthHint(180, 200), "180 of 200 characters");
  assert.equal(lengthHint(4100, 4000), "4,100 of 4,000 characters");
  assert.equal(lengthHint(5000, null), undefined);
});

test("TK-05: lines that became to-dos are remembered, whatever their case or spacing", () => {
  const a = { title: "Send the  deck", owner: "Priya", dueAt: "2026-03-06" };
  const kept = withMade([], [a]);
  assert.deepEqual(kept, ["send the deck|priya|2026-03-06"]);
  assert.equal(
    kept.includes(lineKey({ ...a, title: "SEND the deck", owner: "priya" })),
    true,
  );
  assert.equal(kept.includes(lineKey({ ...a, dueAt: "2026-03-07" })), false);
  assert.deepEqual(withMade(kept, [a]), kept, "each once");
  assert.deepEqual(parseMade(JSON.stringify(kept)), kept);
  assert.deepEqual(parseMade("not json"), []);
  assert.deepEqual(parseMade(JSON.stringify({ a: 1 })), []);
  assert.deepEqual(parseMade(null), []);
  assert.equal(
    withMade(
      [],
      Array.from({ length: 400 }, (_, i) => ({
        title: `t${i}`,
        owner: null,
        dueAt: null,
      })),
    ).length,
    300,
  );
});

test("TK-15: pasted incidents: duplicates, blank numbers and odd priorities are skipped with reasons", () => {
  assert.equal(parsePriority("urgentish"), null);
  assert.equal(parsePriority("Urgent"), "P1");
  assert.equal(parsePriority("2 - High"), "P2");
  assert.equal(parsePriority("Low"), "P4");
  assert.equal(parsePriority("lowest"), null);
  const out = parseSlaRows(
    [
      "INC1,P1,2026-03-01,One",
      "inc1,P2,2026-03-02,Again",
      ",P1,2026-03-01,No number",
      "INC2,urgentish,2026-03-01",
      "INC3,P3,whenever",
    ].join("\n"),
  );
  assert.deepEqual(
    out.rows.map((r) => r.ref),
    ["INC1"],
  );
  assert.deepEqual(
    out.skipped.map((s) => s.reason),
    [
      "“inc1” is listed twice",
      "no number in front",
      "unknown priority “urgentish”",
      "unknown date “whenever”",
    ],
  );
  assert.equal(skippedText([]), "");
  assert.equal(
    skippedText(out.skipped),
    "; skipped 4 (“inc1” is listed twice; no number in front; unknown priority “urgentish”; and more)",
  );
  const long = parseSlaRows(`${"R".repeat(300)},P1,2026-03-01,${"T".repeat(300)}`);
  assert.equal(long.rows[0].ref.length, 200);
  assert.equal(long.rows[0].title.length, 200);
});
