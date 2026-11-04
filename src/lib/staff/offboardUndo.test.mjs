// Run with `pnpm test`. Undo of "Remove from roster": what the server reports is read safely,
// and undoing restores the profile (with its roster link) first, then exactly the dropped leave.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readOffboardUndo, undoOffboard, undoOffboardMany } from "./offboardUndo.ts";

const leave = (id, employeeId) => ({
  id,
  employeeId,
  type: "pto",
  startDate: "2026-11-12",
  endDate: "2026-11-13",
  reason: "",
  status: "approved",
  createdAt: "2026-10-29T10:00:00Z",
  decidedAt: "2026-10-30T10:00:00Z",
});

describe("readOffboardUndo", () => {
  it("keeps well-formed entries and tolerates a missing or odd reply", () => {
    assert.deepEqual(readOffboardUndo(undefined), { timeOff: [], unlinked: [] });
    assert.deepEqual(readOffboardUndo("x"), { timeOff: [], unlinked: [] });
    const read = readOffboardUndo({
      timeOff: [leave("t1", "e1"), null, { nope: 1 }],
      unlinked: [{ memberId: "m1", employeeId: "e1" }, { memberId: 3 }, null],
    });
    assert.deepEqual(
      read.timeOff.map((r) => r.id),
      ["t1"],
    );
    assert.deepEqual(read.unlinked, [{ memberId: "m1", employeeId: "e1" }]);
  });
});

describe("undoOffboard", () => {
  const undo = {
    timeOff: [leave("t1", "e1"), leave("t2", "e1"), leave("t3", "e2")],
    unlinked: [
      { memberId: "m1", employeeId: "e1" },
      { memberId: "m2", employeeId: "e2" },
    ],
  };
  const fakes = (over = {}) => {
    const calls = [];
    return {
      calls,
      actions: {
        restore: async (ids, relink) => {
          calls.push(["restore", ids, relink]);
          return { ok: true };
        },
        addTimeOff: async (requests) => {
          calls.push(["addTimeOff", requests.map((r) => r.id)]);
          return { ok: true };
        },
        ...over,
      },
    };
  };

  it("restores the person with their own roster link, then re-adds only their leave", async () => {
    const { calls, actions } = fakes();
    assert.deepEqual(await undoOffboard("e1", undo, actions), { ok: true });
    assert.deepEqual(calls, [
      ["restore", ["e1"], [{ memberId: "m1", employeeId: "e1" }]],
      ["addTimeOff", ["t1", "t2"]],
    ]);
  });

  it("adds no leave when none was dropped", async () => {
    const { calls, actions } = fakes();
    await undoOffboard("e9", { timeOff: [], unlinked: [] }, actions);
    assert.deepEqual(calls, [["restore", ["e9"], []]]);
  });

  it("stops when the restore fails and does not add leave to someone not on the roster", async () => {
    const { calls, actions } = fakes({
      restore: async () => ({ ok: false, reason: "a@x.com is already on the roster." }),
    });
    const result = await undoOffboard("e1", undo, actions);
    assert.deepEqual(result, { ok: false, reason: "a@x.com is already on the roster." });
    assert.deepEqual(calls, []);
  });

  it("says the person is back when only the leave could not be added", async () => {
    const { actions } = fakes({
      addTimeOff: async () => ({ ok: false, reason: "Offline." }),
    });
    const result = await undoOffboard("e1", undo, actions);
    assert.equal(result.ok, false);
    assert.match(result.reason, /back on the roster/);
    assert.match(result.reason, /Offline\./);
  });
});

describe("undoOffboardMany", () => {
  const undo = {
    timeOff: [leave("t1", "e1"), leave("t2", "e2"), leave("t3", "e3")],
    unlinked: [
      { memberId: "m1", employeeId: "e1" },
      { memberId: "m3", employeeId: "e3" },
    ],
  };
  const actionsWith = (calls, over = {}) => ({
    restore: async (ids, relink) => (calls.push(["restore", ids, relink]), { ok: true }),
    addTimeOff: async (r) => (
      calls.push(["addTimeOff", r.map((x) => x.id)]),
      { ok: true }
    ),
    ...over,
  });

  it("restores everyone in one call with only their links, then only their leave", async () => {
    const calls = [];
    const result = await undoOffboardMany(["e1", "e2"], undo, actionsWith(calls));
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(calls, [
      ["restore", ["e1", "e2"], [{ memberId: "m1", employeeId: "e1" }]],
      ["addTimeOff", ["t1", "t2"]],
    ]);
  });

  it("adds nothing when the restore fails", async () => {
    const calls = [];
    const result = await undoOffboardMany(
      ["e1", "e2"],
      undo,
      actionsWith(calls, { restore: async () => ({ ok: false, reason: "Taken." }) }),
    );
    assert.deepEqual(result, { ok: false, reason: "Taken." });
    assert.deepEqual(calls, []);
  });

  it("says they are all back when only the leave could not be added", async () => {
    const result = await undoOffboardMany(
      ["e1", "e2"],
      undo,
      actionsWith([], { addTimeOff: async () => ({ ok: false, reason: "Offline." }) }),
    );
    assert.equal(result.ok, false);
    assert.match(result.reason, /They are all back on the roster/);
  });
});
