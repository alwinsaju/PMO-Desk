import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { createEmployee } from "./employees.ts";
import { createTimeOff } from "./timeoff.ts";
import { makeAssignment } from "./shifts.ts";
import { workbookRosterConfig } from "./rosterCatalog.ts";
import {
  applyChanges,
  applyProfileSync,
  moveEmployees,
  readRoster,
  readStaff,
  saveRoster,
} from "./server.ts";

const NOW = () => "2026-03-02T10:00:00.000Z";
let dir;
let env;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "staff-fix-"));
  env = { AI_OS_PMO_DATA_DIR: dir };
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const person = (email, over = {}) =>
  createEmployee(
    { deloitteEmail: email, firstName: email.split("@")[0], ...over },
    NOW(),
  );
const save = (items) => applyChanges("employees", { upsert: items }, env, NOW);
const move = (action, ids) => moveEmployees({ action, ids }, env, NOW);
const refusal = async (run) => {
  try {
    await run();
  } catch (error) {
    return error.message;
  }
  assert.fail("expected the server to refuse this");
};

describe("plain-language refusals (no raw zod text)", () => {
  it("names the address instead of 'Invalid email address (upsert.0.deloitteEmail)'", async () => {
    const message = await refusal(() => save([person("a@b.c")]));
    assert.equal(message, 'Deloitte email "a@b.c" is not a valid email address.');
  });

  it("refuses non-ASCII and markup-looking addresses the same way", async () => {
    for (const email of ["jürgen@x.com", "b>x</b>@evil.com"]) {
      const message = await refusal(() => save([person(email)]));
      assert.match(message, /is not a valid email address\.$/);
      assert.doesNotMatch(message, /upsert|Invalid|expected/);
    }
  });

  it("says which field is too long and for whom", async () => {
    const message = await refusal(() =>
      save([person("ok@x.com", { firstName: "J".repeat(200) })]),
    );
    assert.equal(message, "ok@x.com: First name is too long (at most 80 characters).");
  });

  it("explains a batch that is too big", async () => {
    const many = Array.from({ length: 2001 }, (_, i) => person(`p${i}@x.com`));
    const message = await refusal(() => save(many));
    assert.match(message, /too many at once \(at most 2000\)/);
  });

  it("refuses an impossible birthday in the API", async () => {
    const message = await refusal(() => save([person("b@x.com", { birthday: "02-31" })]));
    assert.match(message, /^b@x\.com: Birthday: Use MM-DD/);
    await save([person("c@x.com", { birthday: "02-29" })]);
    await save([person("d@x.com", { birthday: "1990-03-14" })]);
  });

  it("explains a profile from M365 that is too long", async () => {
    await save([person("a@x.com")]);
    const message = await refusal(() =>
      applyProfileSync({ email: "a@x.com", firstName: "x".repeat(81) }, env),
    );
    assert.equal(message, "First name is too long (at most 80 characters).");
  });
});

describe("time off overlaps are refused by the server", () => {
  const request = (employeeId, start, end, over = {}) =>
    createTimeOff({ employeeId, startDate: start, endDate: end, ...over });

  it("refuses an overlapping or duplicate request with a plain message", async () => {
    const a = person("a@x.com", { firstName: "Ann", lastName: "Lee" });
    await save([a]);
    await applyChanges(
      "timeoff",
      { upsert: [request(a.id, "2026-03-05", "2026-03-07")] },
      env,
    );
    const message = await refusal(() =>
      applyChanges(
        "timeoff",
        { upsert: [request(a.id, "2026-03-07", "2026-03-09")] },
        env,
      ),
    );
    assert.equal(
      message,
      "Ann Lee already has time off on 5 – 7 Mar 2026. Change the dates or remove the other request first.",
    );
    await refusal(() =>
      applyChanges(
        "timeoff",
        { upsert: [request(a.id, "2026-03-05", "2026-03-07")] },
        env,
      ),
    );
    assert.equal((await readStaff("timeoff", env)).length, 1);
  });

  it("refuses two overlapping requests in the same batch, all or nothing", async () => {
    const a = person("a@x.com");
    await save([a]);
    await refusal(() =>
      applyChanges(
        "timeoff",
        {
          upsert: [
            request(a.id, "2026-03-05", "2026-03-06"),
            request(a.id, "2026-03-06", "2026-03-08"),
          ],
        },
        env,
      ),
    );
    assert.deepEqual(await readStaff("timeoff", env), []);
  });

  it("allows other people, rejected requests, and changing only the decision", async () => {
    const [a, b] = [person("a@x.com"), person("b@x.com")];
    await save([a, b]);
    const first = request(a.id, "2026-03-05", "2026-03-07");
    await applyChanges("timeoff", { upsert: [first] }, env);
    await applyChanges(
      "timeoff",
      {
        upsert: [
          request(b.id, "2026-03-05", "2026-03-07"),
          request(a.id, "2026-03-06", "2026-03-06", { status: "rejected" }),
        ],
      },
      env,
    );
    const approved = { ...first, status: "approved", decidedAt: NOW() };
    await applyChanges("timeoff", { upsert: [approved] }, env);
    assert.equal((await readStaff("timeoff", env)).length, 3);
  });

  it("lets a request be edited onto freed days after the other one is removed in the same save", async () => {
    const a = person("a@x.com");
    await save([a]);
    const first = request(a.id, "2026-03-05", "2026-03-07");
    await applyChanges("timeoff", { upsert: [first] }, env);
    await applyChanges(
      "timeoff",
      { upsert: [request(a.id, "2026-03-06", "2026-03-06")], remove: [first.id] },
      env,
    );
    assert.equal((await readStaff("timeoff", env)).length, 1);
  });
});

describe("deleting an offboarded person for good finds their roster entry by id", () => {
  const memberOf = (n, employeeId, over = {}) => ({
    id: `mem_00000000000${n}`,
    name: `Member ${n}`,
    employeeId,
    groupId: "l2",
    city: "Pune",
    role: "",
    ...over,
  });

  it("removes the entry and its shifts even after they were renamed", async () => {
    const a = person("a@x.com", { firstName: "Jane", lastName: "Doe" });
    await save([a]);
    const [m1, m2] = [memberOf(1, a.id, { name: "Jane Doe" }), memberOf(2, null)];
    await saveRoster({ config: { ...workbookRosterConfig(), members: [m1, m2] } }, env);
    await applyChanges(
      "shifts",
      {
        upsert: [
          makeAssignment(m1.id, "2026-03-02", "main:shift-1"),
          makeAssignment(m2.id, "2026-03-02", "main:shift-1"),
        ],
      },
      env,
    );
    await move("offboard", [a.id]);
    const [left] = await readStaff("offboarded", env);
    assert.equal(left.rosterMemberId, m1.id);
    await applyChanges(
      "offboarded",
      { upsert: [{ ...left, firstName: "Janet", lastName: "Smith" }] },
      env,
      NOW,
    );
    assert.equal((await readStaff("offboarded", env))[0].rosterMemberId, m1.id);
    await applyChanges("offboarded", { remove: [a.id] }, env);
    assert.deepEqual(
      (await readRoster(env)).members.map((m) => m.id),
      [m2.id],
    );
    assert.deepEqual(
      (await readStaff("shifts", env)).map((s) => s.memberId),
      [m2.id],
    );
  });

  it("forgets the stored entry id when the person is restored", async () => {
    const a = person("a@x.com");
    await save([a]);
    const m1 = memberOf(1, a.id);
    await saveRoster({ config: { ...workbookRosterConfig(), members: [m1] } }, env);
    await move("offboard", [a.id]);
    await move("restore", [a.id]);
    const [back] = await readStaff("employees", env);
    assert.equal("rosterMemberId" in back, false);
  });
});
