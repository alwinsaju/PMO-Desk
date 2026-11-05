import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { addDays } from "../staff/dates.ts";
import { recordAlert, summarise, timesheetWeekIsLate } from "./alerts.ts";
import { registerById, REGISTERS } from "./defs.ts";
import { listColumns } from "./layout.ts";
import { fieldErrors, filterRecords, sanitizeValues, sortRecords } from "./records.ts";
import {
  CHANGED_ELSEWHERE,
  DELETED_ELSEWHERE,
  RegisterError,
  applyRegisterChanges,
} from "./server.ts";
import { afterSave, versionFields } from "./versionChain.ts";
import { recordWarnings } from "./warnings.ts";
import {
  WINDOW_THRESHOLD,
  averageHeight,
  buildOffsets,
  columnsFor,
  itemsOfRows,
  rowAt,
  rowCount,
  scrollDeltaFor,
  windowFor,
} from "./windowing.ts";

const def = (id) => registerById(id);
const TODAY = "2026-11-05"; // a Thursday
const rec = (id, values, extra = {}) => ({
  id: `rg_${String(id).padStart(12, "0")}`,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  values,
  ...extra,
});

async function tempRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "aios-registers-scale-"));
  return { root, env: { AI_OS_PMO_DATA_DIR: root } };
}

test("TK-24 windowing: rows are found by offset, and only the visible ones plus overscan are drawn", () => {
  const offsets = buildOffsets(1000, () => 40);
  assert.equal(offsets.length, 1001);
  assert.equal(offsets[1000], 40000);
  assert.equal(rowAt(offsets, 0), 0);
  assert.equal(rowAt(offsets, 39.9), 0);
  assert.equal(rowAt(offsets, 40), 1);
  assert.equal(rowAt(offsets, 1_000_000), 999, "past the end is the last row");
  assert.equal(rowAt([0], 10), 0, "an empty list");

  const top = windowFor(offsets, 0, 400, 5);
  assert.deepEqual([top.start, top.end], [0, 16]); // rows 0..10 visible, +5 overscan
  assert.equal(top.padTop, 0);
  assert.equal(top.padBottom, 40000 - 16 * 40);

  const middle = windowFor(offsets, 20_000, 400, 5);
  assert.equal(middle.start, 500 - 5);
  assert.equal(middle.end, 510 + 1 + 5);
  assert.equal(middle.padTop, middle.start * 40);
  assert.equal(
    middle.padTop + (middle.end - middle.start) * 40 + middle.padBottom,
    middle.total,
    "spacers plus drawn rows always add up to the whole list",
  );

  const bottom = windowFor(offsets, 39_700, 400, 5);
  assert.equal(bottom.end, 1000);
  assert.equal(bottom.padBottom, 0);
  const overshoot = windowFor(offsets, 90_000, 400, 5);
  assert.equal(overshoot.end, 1000, "scrolled past the end still draws the last rows");
  const negative = windowFor(offsets, -50, 400, 5);
  assert.equal(negative.start, 0);
  assert.deepEqual(windowFor([0], 0, 400, 5), {
    start: 0,
    end: 0,
    padTop: 0,
    padBottom: 0,
    total: 0,
  });
});

test("TK-24 windowing: rows of different heights, and rows not measured yet count as the average", () => {
  assert.equal(averageHeight([], 44), 44);
  assert.equal(averageHeight([40, 60].values(), 44), 50);
  const heights = [30, 100, 30, 30, 200, 30];
  const offsets = buildOffsets(6, (i) => heights[i]);
  assert.deepEqual(offsets, [0, 30, 130, 160, 190, 390, 420]);
  assert.equal(rowAt(offsets, 129), 1);
  assert.equal(rowAt(offsets, 200), 4);
  const win = windowFor(offsets, 135, 60, 0);
  assert.deepEqual([win.start, win.end], [2, 5]);
  assert.equal(win.padTop, 130);
  assert.equal(win.padBottom, 420 - 390);
});

test("TK-24 windowing: scrolling to a row puts it under the sticky header", () => {
  const offsets = buildOffsets(100, () => 50);
  // Viewport starts 1,000 px in; row 40 starts at 2,000; header 38 px.
  assert.equal(scrollDeltaFor(offsets, 40, 1000, 38), 962);
  assert.equal(scrollDeltaFor(offsets, 0, 1000, 38), -1038);
  assert.equal(
    scrollDeltaFor(offsets, 9999, 0, 0),
    99 * 50,
    "past the end goes to the last row",
  );
  assert.equal(scrollDeltaFor(offsets, -3, 100, 0), -100);
});

test("TK-24 windowing: cards are chunked into rows by how many fit across", () => {
  assert.equal(columnsFor(820, 260, 12), 3);
  assert.equal(columnsFor(260, 260, 12), 1);
  assert.equal(columnsFor(100, 260, 12), 1, "never fewer than one");
  assert.equal(columnsFor(1100, 260, 12), 4);
  assert.equal(rowCount(10, 3), 4);
  assert.equal(rowCount(0, 3), 0);
  assert.deepEqual(itemsOfRows(2, 4, 3, 10), { from: 6, to: 10 });
  assert.deepEqual(itemsOfRows(0, 2, 3, 10), { from: 0, to: 6 });
  assert.ok(WINDOW_THRESHOLD >= 100, "short lists are drawn whole");
});

function records(n) {
  const raid = def("raid");
  const kinds = raid.fields.find((f) => f.key === "kind").options;
  return Array.from({ length: n }, (_, i) =>
    rec(i + 1, {
      kind: kinds[i % kinds.length],
      title: `Risk number ${i} with a fairly ordinary title`,
      status: i % 7 === 0 ? "Closed" : "Open",
      dueDate: addDays("2026-01-01", i % 400),
      owner: `Owner ${i % 25}`,
      impact: ["Low", "Medium", "High"][i % 3],
      likelihood: ["Low", "Medium", "High"][(i + 1) % 3],
    }),
  );
}

for (const n of [300, 1000, 5000]) {
  test(`TK-24 timing: ${n} records: filter, sort, summarise and one scroll step stay fast`, () => {
    const raid = def("raid");
    const items = records(n);
    const ctx = { today: TODAY, config: {} };
    const t0 = performance.now();
    const shown = sortRecords(raid, filterRecords(raid, items, { query: "number 1" }));
    const all = sortRecords(raid, filterRecords(raid, items, { includeClosed: true }));
    summarise(raid, items, ctx);
    const t1 = performance.now();
    // One scroll step: heights, offsets, window, and the alerts of the rows that would be drawn.
    const offsets = buildOffsets(all.length, () => 44);
    const win = windowFor(offsets, offsets[all.length] / 2, 700, 6);
    for (const record of all.slice(win.start, win.end)) recordAlert(raid, record, ctx);
    const t2 = performance.now();
    assert.ok(shown.length > 0);
    assert.ok(win.end - win.start <= 36, `draws ${win.end - win.start} rows, not ${n}`);
    // A generous ceiling, so a slow machine does not fail it; the point is that it is not seconds.
    assert.ok(t1 - t0 < 1500, `filter/sort/summarise took ${Math.round(t1 - t0)} ms`);
    assert.ok(t2 - t1 < 100, `one scroll step took ${Math.round(t2 - t1)} ms`);
    // 1,000 scroll steps over the pure part alone.
    const s0 = performance.now();
    for (let i = 0; i < 1000; i += 1)
      windowFor(offsets, (i * 97) % offsets[all.length], 700, 6);
    assert.ok(performance.now() - s0 < 500, "1,000 window lookups are instant");
  });
}

test("TK-21: the title column comes first, so the link reads as the record's name", () => {
  const raid = def("raid");
  assert.equal(raid.columns[0], "kind");
  assert.deepEqual(listColumns(raid).slice(0, 2), ["title", "kind"]);
  assert.equal(listColumns(raid).length, raid.columns.length);
  assert.deepEqual(listColumns(def("minutes")).slice(0, 2), ["title", "date"]);
  assert.deepEqual(listColumns(def("decisions")).slice(0, 2), ["title", "decidedOn"]);
  assert.deepEqual(listColumns(def("vendors")), def("vendors").columns, "already first");
  for (const d of REGISTERS) {
    const cols = listColumns(d);
    assert.equal(new Set(cols).size, cols.length, `${d.id}: no column twice`);
    assert.deepEqual([...cols].sort(), [...d.columns].sort(), `${d.id}: same columns`);
    if (d.columns.includes(d.titleKey)) assert.equal(cols[0], d.titleKey, d.id);
  }
  const noTitle = { ...raid, columns: ["kind", "status"] };
  assert.deepEqual(
    listColumns(noTitle),
    ["kind", "status"],
    "title not shown: left alone",
  );
});

test("TK-16: an upsert whose baseUpdatedAt is older than the stored record is refused; no base keeps today's behaviour", async () => {
  const { root, env } = await tempRoot();
  try {
    const raid = def("raid");
    let n = 0;
    const clock = () => `2026-11-05T10:00:0${++n}.000Z`;
    const values = (title) => ({ kind: "Risk", title, status: "Open" });
    const created = await applyRegisterChanges(
      raid,
      { upsert: [{ values: values("A") }] },
      env,
      clock,
    );
    const a = created.items[0];
    assert.equal(a.updatedAt, "2026-11-05T10:00:01.000Z");

    // A matching base is fine, and returns the new version.
    const first = await applyRegisterChanges(
      raid,
      { upsert: [{ id: a.id, values: values("A1"), baseUpdatedAt: a.updatedAt }] },
      env,
      clock,
    );
    assert.equal(first.items[0].values.title, "A1");
    const v2 = first.items[0].updatedAt;
    assert.ok(v2 > a.updatedAt);

    // The same, now stale, base is refused with a plain message and changes nothing.
    await assert.rejects(
      applyRegisterChanges(
        raid,
        { upsert: [{ id: a.id, values: values("A2"), baseUpdatedAt: a.updatedAt }] },
        env,
        clock,
      ),
      (e) =>
        e instanceof RegisterError && e.status === 409 && e.message === CHANGED_ELSEWHERE,
    );
    assert.match(CHANGED_ELSEWHERE, /changed elsewhere/);
    const kept = await applyRegisterChanges(raid, {}, env, clock);
    assert.equal(kept.items[0].values.title, "A1");

    // A base newer than or equal to the stored one is accepted.
    const ok = await applyRegisterChanges(
      raid,
      {
        upsert: [
          { id: a.id, values: values("A3"), baseUpdatedAt: "2099-01-01T00:00:00.000Z" },
        ],
      },
      env,
      clock,
    );
    assert.equal(ok.items[0].values.title, "A3");

    // No base (API or seed use): last writer wins, as before. An empty base counts as none.
    const noBase = await applyRegisterChanges(
      raid,
      { upsert: [{ id: a.id, values: values("A4") }] },
      env,
      clock,
    );
    assert.equal(noBase.items[0].values.title, "A4");
    const emptyBase = await applyRegisterChanges(
      raid,
      { upsert: [{ id: a.id, values: values("A5"), baseUpdatedAt: "" }] },
      env,
      clock,
    );
    assert.equal(emptyBase.items[0].values.title, "A5");

    // A record deleted elsewhere is not brought back by a form that still has it open.
    await applyRegisterChanges(raid, { remove: [a.id] }, env, clock);
    await assert.rejects(
      applyRegisterChanges(
        raid,
        { upsert: [{ id: a.id, values: values("Back"), baseUpdatedAt: v2 }] },
        env,
        clock,
      ),
      (e) => e.status === 409 && e.message === DELETED_ELSEWHERE,
    );
    // ...but an Undo (no base) still puts it back, and a new record has no base to check.
    const undone = await applyRegisterChanges(
      raid,
      { upsert: [{ id: a.id, values: values("Back") }] },
      env,
      clock,
    );
    assert.equal(undone.items.length, 1);

    // A batch with one stale record changes none of them.
    const b = (
      await applyRegisterChanges(raid, { upsert: [{ values: values("B") }] }, env, clock)
    ).items.find((i) => i.values.title === "B");
    await assert.rejects(
      applyRegisterChanges(
        raid,
        {
          upsert: [
            { id: b.id, values: values("B2"), baseUpdatedAt: b.updatedAt },
            {
              id: a.id,
              values: values("Back2"),
              baseUpdatedAt: "2000-01-01T00:00:00.000Z",
            },
          ],
        },
        env,
        clock,
      ),
      RegisterError,
    );
    const after = await applyRegisterChanges(raid, {}, env, clock);
    assert.deepEqual(after.items.map((i) => i.values.title).sort(), ["B", "Back"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("TK-16: the form and its panels chain the version they received, so they never refuse each other", async () => {
  const { root, env } = await tempRoot();
  try {
    const minutes = def("minutes");
    let n = 0;
    const clock = () => `2026-11-05T11:00:${String(++n).padStart(2, "0")}.000Z`;
    const base = { title: "Steering", date: "2026-11-05", actions: 0 };
    const first = await applyRegisterChanges(
      minutes,
      { upsert: [{ values: base }] },
      env,
      clock,
    );
    const opened = first.items[0];

    // The form's seen version, as the dialog keeps it.
    let seen = { base: opened.updatedAt, todoId: undefined };
    const send = async (values, todoId) => {
      const fields = versionFields(seen, true, todoId);
      const file = await applyRegisterChanges(
        minutes,
        { upsert: [{ id: opened.id, values, ...fields }] },
        env,
        clock,
      );
      seen = afterSave(seen, opened.id, file.items);
      return file;
    };
    // Panel saves the count, panel saves it again, then the form's own Save: three writes, no conflict.
    await send({ ...base, actions: 2 });
    await send({ ...base, actions: 5 });
    const done = await send({ ...base, title: "Steering 1", actions: 5 });
    assert.equal(done.items[0].values.title, "Steering 1");
    assert.equal(done.items[0].values.actions, 5);

    // Without chaining (the old way) the second write would have been refused.
    await assert.rejects(
      applyRegisterChanges(
        minutes,
        { upsert: [{ id: opened.id, values: base, baseUpdatedAt: opened.updatedAt }] },
        env,
        clock,
      ),
      RegisterError,
    );

    // A change from elsewhere between two of the form's saves is caught.
    await applyRegisterChanges(
      minutes,
      { upsert: [{ id: opened.id, values: { ...base, title: "Elsewhere" } }] },
      env,
      clock,
    );
    await assert.rejects(
      send({ ...base, title: "Mine" }),
      (e) => e.message === CHANGED_ELSEWHERE,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("TK-16: version helpers", () => {
  const seen = { base: "2026-01-01T00:00:00.000Z", todoId: "td_0123456789ab" };
  assert.deepEqual(versionFields(seen, true), {
    todoId: "td_0123456789ab",
    baseUpdatedAt: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(versionFields(seen, true, "td_ffffffffffff").todoId, "td_ffffffffffff");
  assert.equal(
    versionFields(seen, false).baseUpdatedAt,
    undefined,
    "a new record has no base",
  );
  assert.equal(
    versionFields({ base: undefined, todoId: undefined }, true).baseUpdatedAt,
    undefined,
  );
  const items = [
    { id: "a", updatedAt: "U2", todoId: "t" },
    { id: "b", updatedAt: "U9" },
  ];
  assert.deepEqual(afterSave(seen, "a", items), { base: "U2", todoId: "t" });
  assert.deepEqual(afterSave(seen, "zzz", items), seen, "not in the reply: unchanged");
});

test("TK-11: a missing timesheet from a past week is late; the current week, leave and filed sheets are not", () => {
  const ts = def("timesheets");
  const ctx = { today: TODAY, config: {} }; // this week starts Mon 2026-11-02
  const row = (week, status) =>
    rec(Math.abs(week.length + status.length), { week, person: "Ana", status });
  const alert = (week, status) => recordAlert(ts, row(week, status), ctx);

  assert.equal(timesheetWeekIsLate("2026-10-26", TODAY), true, "last week");
  assert.equal(timesheetWeekIsLate("2026-11-02", TODAY), false, "this week");
  assert.equal(timesheetWeekIsLate("2026-11-09", TODAY), false, "next week");
  assert.equal(
    timesheetWeekIsLate("2026-10-28", TODAY),
    true,
    "a Wednesday still means that week (the Monday before it)",
  );
  assert.equal(timesheetWeekIsLate("", TODAY), false);
  // The week turns late the moment the next Monday starts.
  assert.equal(timesheetWeekIsLate("2026-11-02", "2026-11-08"), false, "Sunday");
  assert.equal(timesheetWeekIsLate("2026-11-02", "2026-11-09"), true, "next Monday");

  const late = alert("2026-10-26", "Missing");
  assert.equal(late.level, "late");
  assert.match(late.text, /^Missing for the week of 26 Oct \(1 week ago\)$/);
  assert.match(alert("2026-10-05", "Missing").text, /\(4 weeks ago\)$/);
  assert.equal(alert("2026-10-26", "Submitted"), null);
  assert.equal(alert("2026-10-26", "On leave"), null, "leave is still skipped");
  assert.equal(alert("2026-10-26", "Excused"), null);
  assert.equal(alert("2026-11-02", "Missing"), null);
  assert.match(alert("2025-10-27", "Missing").text, /\(53 weeks ago\)/);
  assert.match(alert("2025-10-27", "Missing").text, /27 Oct 2025/);

  const items = [
    row("2026-10-26", "Missing"),
    { ...row("2026-10-19", "Missing"), id: "rg_0000000000a2" },
    { ...row("2026-10-12", "On leave"), id: "rg_0000000000a3" },
    { ...row("2026-10-12", "Submitted"), id: "rg_0000000000a4" },
    { ...row("2026-11-02", "Missing"), id: "rg_0000000000a5" },
  ];
  assert.deepEqual(
    (({ open, late: l, total }) => ({ open, late: l, total }))(summarise(ts, items, ctx)),
    { open: 3, late: 2, total: 5 },
    "tile and badge count: the two past Missing weeks",
  );
});

test("TK-20: warnings for things that look wrong but may be saved", () => {
  const changes = def("changes");
  const other = rec(1, { ref: "CR-001", title: "x", status: "Draft" });
  const w = (d, values, others = [], self = null) =>
    recordWarnings(d, values, others, self, TODAY);

  assert.match(w(changes, { ref: "cr-001" }, [other]).ref, /already uses cr-001/);
  assert.deepEqual(
    w(changes, { ref: "CR-001" }, [other], other.id),
    {},
    "the record itself does not count",
  );
  assert.deepEqual(w(changes, { ref: "CR-002" }, [other]), {});
  assert.deepEqual(
    w(changes, { ref: "" }, [rec(2, { ref: "" })]),
    {},
    "blank refs are not duplicates",
  );
  assert.match(
    w(def("sla"), { ref: "INC1" }, [rec(3, { ref: "inc1" })]).ref,
    /already uses/,
  );

  const stake = def("stakeholders");
  assert.match(w(stake, { lastContact: "2026-12-01" }).lastContact, /in the future/);
  assert.deepEqual(w(stake, { lastContact: TODAY }), {});
  assert.deepEqual(w(stake, { lastContact: "" }), {});

  const vendors = def("vendors");
  const notice = w(vendors, {
    startDate: "2026-01-10",
    renewalDate: "2026-02-01",
    noticeDays: 60,
  });
  assert.match(notice.noticeDays, /would fall before the contract starts/);
  assert.deepEqual(
    w(vendors, { startDate: "2026-01-10", renewalDate: "2027-02-01", noticeDays: 60 }),
    {},
  );
  assert.deepEqual(
    w(vendors, { startDate: "", renewalDate: "2027-02-01", noticeDays: 60 }),
    {},
  );

  const inv = def("invoices");
  assert.match(
    w(inv, { month: "2026-11", sendBy: "2026-09-01" }).sendBy,
    /before the invoice month/,
  );
  assert.match(
    w(inv, { month: "2026-11", sendBy: "2027-04-01" }).sendBy,
    /after the invoice month/,
  );
  assert.deepEqual(w(inv, { month: "Nov 2026", sendBy: "2026-11-28" }), {});
  assert.deepEqual(w(inv, { month: "", sendBy: "2026-11-28" }), {});

  const cap = def("capacity");
  assert.match(w(cap, { percent: 0 }).percent, /0%/);
  assert.match(w(cap, { percent: 150 }).percent, /Over 100%/);
  assert.deepEqual(w(cap, { percent: 100 }), {});
  assert.deepEqual(w(cap, { percent: "" }), {});

  assert.match(w(def("timesheets"), { week: "2026-11-04" }).week, /not a Monday/);
  assert.deepEqual(w(def("timesheets"), { week: "2026-11-02" }), {});
  assert.deepEqual(w(def("raid"), { title: "x" }), {}, "tools with no soft rules");
});

test("TK-20: the hard rules: a renewal before the start, and capacity percent bounds", () => {
  const vendors = def("vendors");
  const base = { vendor: "V", status: "Active" };
  assert.match(
    fieldErrors(vendors, { ...base, startDate: "2026-05-01", renewalDate: "2026-04-01" })
      .renewalDate,
    /cannot be before the contract start/,
  );
  assert.deepEqual(
    fieldErrors(vendors, { ...base, startDate: "2026-05-01", renewalDate: "2026-05-01" }),
    {},
  );
  assert.deepEqual(
    fieldErrors(vendors, { ...base, startDate: "", renewalDate: "2026-04-01" }),
    {},
  );
  // Old files still load: the cross rule is skipped when reading.
  assert.equal(
    sanitizeValues(
      vendors,
      { ...base, startDate: "2026-05-01", renewalDate: "2026-04-01" },
      true,
    ).ok,
    true,
  );

  const cap = def("capacity");
  const row = { person: "A", project: "P", from: TODAY, to: TODAY };
  assert.equal(sanitizeValues(cap, { ...row, percent: 300 }).ok, true);
  assert.match(sanitizeValues(cap, { ...row, percent: 301 }).reason, /between 0 and 300/);
  assert.match(sanitizeValues(cap, { ...row, percent: -1 }).reason, /between 0 and 300/);
  assert.match(
    sanitizeValues(cap, { ...row, percent: "lots" }).reason,
    /must be a number/,
  );
});
