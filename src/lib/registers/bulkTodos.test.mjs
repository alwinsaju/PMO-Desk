import assert from "node:assert/strict";
import test from "node:test";
import {
  canBulkTodos,
  confirmLine,
  lateWithoutTodo,
  makeTodosFor,
  needsTodo,
  splitSelection,
} from "./bulkTodos.ts";
import { registerById } from "./defs.ts";

const raid = registerById("raid");
const ctx = { today: "2026-11-04", config: {} };
let n = 0;
const rec = (values, extra = {}) => ({
  id: `rg_${String(++n).padStart(12, "0")}`,
  createdAt: "",
  updatedAt: "",
  values: { kind: "Risk", title: `Item ${n}`, status: "Open", ...values },
  ...extra,
});

test("canBulkTodos: only the RAID log", () => {
  assert.equal(canBulkTodos(raid), true);
  assert.equal(canBulkTodos(registerById("decisions")), false);
  assert.equal(canBulkTodos(registerById("minutes")), false);
});

test("lateWithoutTodo: open, past its review date, no to-do yet", () => {
  const late = rec({ dueDate: "2026-11-01" });
  const lateDone = rec({ dueDate: "2026-11-01" }, { todoId: "td_0123456789abcdef" });
  const lateClosed = rec({ dueDate: "2026-11-01", status: "Closed" });
  const noDate = rec({ raisedOn: "2026-01-01" }); // old, but never "late": no review date
  const soon = rec({ dueDate: "2026-11-06" });
  const today = rec({ dueDate: "2026-11-04" });
  const picked = lateWithoutTodo(
    raid,
    [late, lateDone, lateClosed, noDate, soon, today],
    ctx,
  );
  assert.deepEqual(
    picked.map((r) => r.id),
    [late.id],
  );
});

test("splitSelection: eligible records and how many are skipped; unknown ids ignored", () => {
  const a = rec({ dueDate: "2026-11-01" });
  const b = rec({}, { todoId: "td_0123456789abcdef" });
  const c = rec({ status: "Closed" });
  const items = [a, b, c];
  const split = splitSelection(raid, items, new Set([a.id, b.id, c.id, "rg_gone"]));
  assert.deepEqual(
    split.eligible.map((r) => r.id),
    [a.id],
  );
  assert.equal(split.skipped, 2);
  assert.equal(needsTodo(raid, b), false);
});

const okOps = (log) => ({
  make: async (seed, record) => {
    log.push(["make", record.id, seed.title]);
    return { ok: true, todoId: `td_${record.id.slice(3)}` };
  },
  link: async (record, todoId) => {
    log.push(["link", record.id, todoId]);
    return { ok: true };
  },
});

test("makeTodosFor: makes one to-do per record and links each before the next", async () => {
  const a = rec({ title: "Vendor slips", dueDate: "2026-11-01", owner: "Priya" });
  const b = rec({ title: "Env missing", dueDate: "2026-10-30" });
  const log = [];
  const result = await makeTodosFor(raid, [a, b], okOps(log));
  assert.deepEqual(
    log.map((l) => l[0]),
    ["make", "link", "make", "link"],
  );
  assert.equal(log[0][2], "RAID log: Vendor slips");
  assert.equal(result.made.length, 2);
  assert.equal(result.stopped, null);
});

test("makeTodosFor: a record that already has a to-do is not made again", async () => {
  const has = rec({ dueDate: "2026-11-01" }, { todoId: "td_0123456789abcdef" });
  const fresh = rec({ dueDate: "2026-11-01" });
  const log = [];
  const result = await makeTodosFor(raid, [has, fresh], okOps(log));
  assert.deepEqual(
    result.made.map((m) => m.record.id),
    [fresh.id],
  );
  assert.equal(log.filter((l) => l[0] === "make").length, 1);
});

test("makeTodosFor: stops at the first failed to-do and leaves the rest alone", async () => {
  const [a, b, c] = [1, 2, 3].map(() => rec({ dueDate: "2026-11-01" }));
  let calls = 0;
  const result = await makeTodosFor(raid, [a, b, c], {
    make: async (_seed, record) => {
      calls += 1;
      return calls === 2
        ? { ok: false, reason: "Could not reach the app server." }
        : { ok: true, todoId: `td_${record.id.slice(3)}` };
    },
    link: async () => ({ ok: true }),
  });
  assert.equal(result.made.length, 1);
  assert.equal(result.stopped.record.id, b.id);
  assert.equal(result.stopped.todoMade, false);
  assert.equal(result.notDone, 1);
  assert.equal(calls, 2);
});

test("makeTodosFor: a failed link is reported as a to-do made but not recorded", async () => {
  const [a, b] = [1, 2].map(() => rec({ dueDate: "2026-11-01" }));
  const result = await makeTodosFor(raid, [a, b], {
    make: async () => ({ ok: true, todoId: "td_0123456789abcdef" }),
    link: async () => ({ ok: false, reason: "Disk full." }),
  });
  assert.equal(result.made.length, 0);
  assert.equal(result.stopped.todoMade, true);
  assert.equal(result.stopped.reason, "Disk full.");
  assert.equal(result.notDone, 1);
});

test("confirmLine: title, owner and review date", () => {
  const r = rec({ title: "Env missing", owner: "Priya", dueDate: "2026-11-01" });
  assert.equal(confirmLine(raid, r), "Env missing, owner Priya, review 2026-11-01");
  assert.equal(confirmLine(raid, rec({ title: "Bare" })), "Bare");
});
