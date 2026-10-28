import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { createEmployee } from "./employees.ts";
import { makeAssignment } from "./shifts.ts";
import { useStaffStore } from "./staffStore.ts";

const NOW = "2026-03-02T10:00:00.000Z";
const person = (n) =>
  createEmployee(
    { id: `emp_00000000000${n}`, deloitteEmail: `p${n}@x.com`, firstName: `P${n}` },
    NOW,
  );

const realFetch = globalThis.fetch;
let server;
let calls;
let fail;

function reply(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

beforeEach(async () => {
  server = { employees: [], shifts: [], timeoff: [], offboarded: [] };
  calls = [];
  fail = null;
  globalThis.fetch = async (url, init) => {
    const kind = String(url).split("/").pop();
    calls.push(`${init?.method ?? "GET"} ${kind}`);
    if (fail === "offline") throw new TypeError("fetch failed");
    if (kind === "sync") return reply(200, { ok: true });
    if (!init?.method) return reply(200, { ok: true, items: server[kind] });
    if (fail === "refuse") return reply(400, { ok: false, reason: "Nope." });
    if (kind === "offboard") {
      const { action, ids } = JSON.parse(init.body);
      const [from, to] =
        action === "offboard" ? ["employees", "offboarded"] : ["offboarded", "employees"];
      const moving = server[from].filter((i) => ids.includes(i.id));
      server[from] = server[from].filter((i) => !ids.includes(i.id));
      server[to] = [...server[to], ...moving];
      return reply(200, {
        ok: true,
        employees: server.employees,
        offboarded: server.offboarded,
      });
    }
    if (fail === "refuse-p2" && init.body.includes("p2@x.com")) {
      return reply(400, { ok: false, reason: "Nope." });
    }
    const { upsert = [], remove = [] } = JSON.parse(init.body);
    const next = server[kind].filter((i) => !remove.includes(i.id));
    for (const item of upsert) {
      const at = next.findIndex((i) => i.id === item.id);
      if (at >= 0) next[at] = item;
      else next.push(item);
    }
    server[kind] = next;
    // The real server does not send the (large) list of shifts back.
    return reply(200, kind === "shifts" ? { ok: true } : { ok: true, items: next });
  };
  // Start every test from an empty, never-loaded store.
  await useStaffStore.getState().load();
  useStaffStore.setState({ status: "idle" });
  calls = [];
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("staff store", () => {
  it("loads all three collections", async () => {
    server.employees = [person(1)];
    server.shifts = [makeAssignment("mem_000000000001", "2026-03-02", "main:shift-1")];
    await useStaffStore.getState().load();
    const state = useStaffStore.getState();
    assert.equal(state.status, "ready");
    assert.equal(state.employees.length, 1);
    assert.equal(state.shifts.length, 1);
  });

  it("reports offline when the first load fails, and stays ready after a later failure", async () => {
    fail = "offline";
    await useStaffStore.getState().load();
    assert.equal(useStaffStore.getState().status, "offline");
    fail = null;
    await useStaffStore.getState().load();
    assert.equal(useStaffStore.getState().status, "ready");
    fail = "offline";
    await useStaffStore.getState().load();
    assert.equal(useStaffStore.getState().status, "ready");
  });

  it("applies an edit optimistically and keeps the server's answer", async () => {
    const pending = useStaffStore.getState().commit("employees", { upsert: [person(1)] });
    assert.equal(useStaffStore.getState().employees.length, 1);
    assert.deepEqual(await pending, { ok: true });
    assert.equal(server.employees.length, 1);
  });

  it("reverts and reports the reason when the server refuses", async () => {
    server.employees = [person(1)];
    await useStaffStore.getState().load();
    fail = "refuse";
    const result = await useStaffStore
      .getState()
      .commit("employees", { upsert: [person(2)] });
    assert.deepEqual(result, { ok: false, reason: "Nope." });
    assert.deepEqual(
      useStaffStore.getState().employees.map((e) => e.id),
      [person(1).id],
    );
  });

  it("a refused edit does not undo another edit made at the same time", async () => {
    const store = useStaffStore.getState();
    fail = "refuse-p2";
    const first = store.commit("employees", { upsert: [person(1)] });
    const second = store.commit("employees", { upsert: [person(2)] });
    assert.equal(useStaffStore.getState().employees.length, 2);
    const results = await Promise.all([first, second]);
    assert.equal(results[0].ok, true);
    assert.equal(results[1].ok, false);
    assert.deepEqual(
      useStaffStore.getState().employees.map((e) => e.id),
      [person(1).id],
    );
  });

  it("reverts when the server cannot be reached", async () => {
    fail = "offline";
    const result = await useStaffStore
      .getState()
      .commit("employees", { upsert: [person(1)] });
    assert.equal(result.ok, false);
    assert.match(result.reason, /Can't reach/);
    assert.equal(useStaffStore.getState().employees.length, 0);
  });

  it("removing a person drops their time off locally but keeps the shift roster's days", async () => {
    const [a, b] = [person(1), person(2)];
    server.employees = [a, b];
    server.shifts = [
      makeAssignment("mem_000000000001", "2026-03-02", "main:shift-1"),
      makeAssignment("mem_000000000002", "2026-03-02", "main:ns"),
    ];
    server.timeoff = [{ id: "to_000000000001", employeeId: a.id }];
    await useStaffStore.getState().load();
    await useStaffStore.getState().commit("employees", { remove: [a.id] });
    const state = useStaffStore.getState();
    assert.deepEqual(
      state.employees.map((e) => e.id),
      [b.id],
    );
    assert.equal(state.shifts.length, 2);
    assert.deepEqual(state.timeOff, []);
  });

  it("a shift change is applied from the request when the server sends no list back", async () => {
    const a = makeAssignment("mem_000000000001", "2026-03-02", "main:shift-1");
    await useStaffStore.getState().commit("shifts", { upsert: [a] });
    assert.deepEqual(useStaffStore.getState().shifts, [a]);
    await useStaffStore.getState().commit("shifts", { remove: [a.id] });
    assert.deepEqual(useStaffStore.getState().shifts, []);
  });

  it("sends edits to one collection one at a time, in order", async () => {
    const store = useStaffStore.getState();
    const first = store.commit("employees", { upsert: [person(1)] });
    const second = store.commit("employees", {
      upsert: [{ ...person(1), team: "Core" }],
    });
    await Promise.all([first, second]);
    assert.equal(server.employees[0].team, "Core");
    assert.equal(useStaffStore.getState().employees[0].team, "Core");
  });

  it("does not let a background load overwrite an edit in flight", async () => {
    const edit = useStaffStore.getState().commit("employees", { upsert: [person(1)] });
    await useStaffStore.getState().load();
    await edit;
    assert.equal(useStaffStore.getState().employees.length, 1);
    assert.ok(!calls.includes("GET shifts"));
  });

  it("offboarding moves a person off the roster and drops their time off", async () => {
    const [a, b] = [person(1), person(2)];
    server.employees = [a, b];
    server.timeoff = [{ id: "to_000000000001", employeeId: a.id }];
    await useStaffStore.getState().load();
    assert.deepEqual(await useStaffStore.getState().offboard([a.id]), { ok: true });
    const state = useStaffStore.getState();
    assert.deepEqual(
      state.employees.map((e) => e.id),
      [b.id],
    );
    assert.deepEqual(
      state.offboarded.map((e) => e.id),
      [a.id],
    );
    assert.deepEqual(state.timeOff, []);
  });

  it("restoring moves a person back onto the roster", async () => {
    const a = person(1);
    server.offboarded = [{ ...a, offboardedAt: NOW }];
    await useStaffStore.getState().load();
    assert.deepEqual(await useStaffStore.getState().restore([a.id]), { ok: true });
    const state = useStaffStore.getState();
    assert.equal(state.employees.length, 1);
    assert.equal(state.offboarded.length, 0);
  });

  it("a refused or unreachable move changes nothing", async () => {
    const a = person(1);
    server.employees = [a];
    await useStaffStore.getState().load();
    fail = "refuse";
    assert.deepEqual(await useStaffStore.getState().offboard([a.id]), {
      ok: false,
      reason: "Nope.",
    });
    fail = "offline";
    const result = await useStaffStore.getState().offboard([a.id]);
    assert.equal(result.ok, false);
    assert.equal(useStaffStore.getState().employees.length, 1);
    assert.equal(useStaffStore.getState().offboarded.length, 0);
  });

  it("deleting an offboarded profile removes it from the list", async () => {
    const a = person(1);
    server.offboarded = [{ ...a, offboardedAt: NOW }];
    await useStaffStore.getState().load();
    await useStaffStore.getState().commit("offboarded", { remove: [a.id] });
    assert.equal(useStaffStore.getState().offboarded.length, 0);
    assert.equal(server.offboarded.length, 0);
  });

  it("waits for earlier roster edits before moving someone", async () => {
    const a = person(1);
    const store = useStaffStore.getState();
    const edit = store.commit("employees", { upsert: [a] });
    const move = store.offboard([a.id]);
    await Promise.all([edit, move]);
    assert.deepEqual(
      calls.filter((c) => c.startsWith("POST")),
      ["POST employees", "POST offboard"],
    );
    assert.equal(useStaffStore.getState().offboarded.length, 1);
  });
});
