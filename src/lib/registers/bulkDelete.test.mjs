// Bulk delete in the register tools: one remove, one Undo, chunks of 500, honest about a stop.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BULK_CHUNK,
  bulkDelete,
  bulkRestore,
  deleteLines,
  deletedMessage,
  partialDeleteMessage,
  recordBack,
  withTodoCount,
} from "./bulkDelete.ts";
import { registerById } from "./defs.ts";

const raid = registerById("raid");
let n = 0;
const rec = (values = {}, extra = {}) => ({
  id: `rg_${String(++n).padStart(12, "0")}`,
  createdAt: "",
  updatedAt: "",
  values: { kind: "Risk", title: `Item ${n}`, status: "Open", ...values },
  ...extra,
});
const many = (count) => Array.from({ length: count }, () => rec());

function fakeOps(over = {}) {
  const calls = [];
  return {
    calls,
    ops: {
      remove: async (ids) => {
        calls.push(["remove", ids.length]);
        return { ok: true };
      },
      save: async (records) => {
        calls.push(["save", records.length]);
        return { ok: true };
      },
      ...over,
    },
  };
}

describe("bulkDelete", () => {
  it("removes every record in one write", async () => {
    const records = many(3);
    const { calls, ops } = fakeOps();
    const result = await bulkDelete(records, ops);
    assert.deepEqual(result, { deleted: records, failed: null });
    assert.deepEqual(calls, [["remove", 3]]);
  });

  it("does nothing for no records", async () => {
    const { calls, ops } = fakeOps();
    assert.deepEqual(await bulkDelete([], ops), { deleted: [], failed: null });
    assert.deepEqual(calls, []);
  });

  it("splits a large selection into chunks the server accepts", async () => {
    const { calls, ops } = fakeOps();
    const result = await bulkDelete(many(BULK_CHUNK * 2 + 5), ops);
    assert.equal(result.deleted.length, BULK_CHUNK * 2 + 5);
    assert.deepEqual(calls, [
      ["remove", BULK_CHUNK],
      ["remove", BULK_CHUNK],
      ["remove", 5],
    ]);
  });

  it("stops at the first failure and reports what is already gone", async () => {
    let call = 0;
    const { ops } = fakeOps({
      remove: async () =>
        ++call === 1 ? { ok: true } : { ok: false, reason: "Offline." },
    });
    const result = await bulkDelete(many(BULK_CHUNK + 10), ops);
    assert.equal(result.deleted.length, BULK_CHUNK);
    assert.equal(result.failed, "Offline.");
    assert.equal(call, 2);
  });
});

describe("bulkRestore", () => {
  it("saves back id, values and to-do link, as the per-record Undo does", async () => {
    const withTodo = rec({}, { todoId: "td_1" });
    assert.deepEqual(recordBack(withTodo), {
      id: withTodo.id,
      values: withTodo.values,
      todoId: "td_1",
    });
    let saved;
    const result = await bulkRestore([withTodo, rec()], {
      save: async (r) => ((saved = r), { ok: true }),
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(saved.length, 2);
    assert.equal(saved[0].todoId, "td_1");
  });

  it("chunks and reports how many were put back when one fails", async () => {
    let call = 0;
    const result = await bulkRestore(many(BULK_CHUNK + 1), {
      save: async () => (++call === 1 ? { ok: true } : { ok: false, reason: "Locked." }),
    });
    assert.deepEqual(result, { ok: false, reason: "Locked.", restored: BULK_CHUNK });
  });
});

describe("messages and lines", () => {
  it("names a single record and counts several", () => {
    const one = rec({ title: "Vendor slips" });
    assert.equal(deletedMessage(raid, [one]), "Deleted “Vendor slips”.");
    assert.equal(
      deletedMessage(raid, [one, rec()]),
      `Deleted 2 records from ${raid.title}.`,
    );
  });

  it("says how far a stopped delete got", () => {
    assert.equal(
      partialDeleteMessage(500, 510, "Offline."),
      "Offline. 500 of 510 deleted; the rest were left as they were.",
    );
  });

  it("lists one line per record and counts those with a to-do", () => {
    const a = rec({ title: "Late vendor", owner: "Priya" }, { todoId: "td_9" });
    const b = rec({ title: "Scope creep" });
    const lines = deleteLines(raid, [a, b]);
    assert.equal(lines.length, 2);
    assert.match(lines[0], /Late vendor/);
    assert.match(lines[1], /Scope creep/);
    assert.equal(withTodoCount([a, b]), 1);
  });
});
