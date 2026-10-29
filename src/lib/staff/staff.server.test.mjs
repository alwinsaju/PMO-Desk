import assert from "node:assert/strict";
import { mkdtemp, rm, readdir } from "node:fs/promises";
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
  deletePhoto,
  getPhoto,
  importRoster,
  moveEmployees,
  putPhoto,
  readRoster,
  readStaff,
  saveRoster,
  staffDir,
} from "./server.ts";

const NOW = () => "2026-03-02T10:00:00.000Z";
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

let dir;
let env;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "staff-"));
  env = { AI_OS_PMO_DATA_DIR: dir };
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const person = (email, over = {}) =>
  createEmployee(
    { deloitteEmail: email, firstName: email.split("@")[0], ...over },
    NOW(),
  );
const save = (items) => applyChanges("employees", { upsert: items }, env, NOW);

const memberOf = (n, employeeId = null, over = {}) => ({
  id: `mem_00000000000${n}`,
  name: `Member ${n}`,
  employeeId,
  groupId: "l2",
  city: "Pune",
  role: "",
  ...over,
});
const saveMembers = (members) =>
  saveRoster({ config: { ...workbookRosterConfig(), members } }, env);
const day = (member, date, ref = "main:shift-1", extra) =>
  makeAssignment(member.id, date, ref, extra);

describe("employees", () => {
  it("starts empty and saves under <data dir>/staff", async () => {
    assert.deepEqual(await readStaff("employees", env), []);
    await save([person("a@x.com")]);
    assert.equal(staffDir(env), path.join(dir, "staff"));
    assert.deepEqual((await readdir(staffDir(env))).sort(), ["employees.json"]);
  });

  it("upserts by id, keeps createdAt and the photo stamp the server owns", async () => {
    const a = person("a@x.com");
    await save([a]);
    await putPhoto(a.id, JPEG, env, NOW);
    const [stored] = await readStaff("employees", env);
    assert.ok(stored.photoVersion > 0);
    const [after] = await save([
      { ...a, team: "Core", photoVersion: 0, createdAt: "1999" },
    ]);
    assert.equal(after.team, "Core");
    assert.equal(after.photoVersion, stored.photoVersion);
    assert.equal(after.createdAt, NOW());
  });

  it("refuses a duplicate email (any case) and leaves the roster unchanged", async () => {
    await save([person("a@x.com")]);
    await assert.rejects(save([person("A@X.com")]), /already on the roster/);
    assert.equal((await readStaff("employees", env)).length, 1);
  });

  it("refuses invalid employees", async () => {
    await assert.rejects(save([person("not-an-email")]));
    await assert.rejects(save([{ ...person("b@x.com"), id: "../evil" }]));
    await assert.rejects(save([{ ...person("b@x.com"), rollOffDate: "2026-02-30" }]));
    await assert.rejects(applyChanges("employees", "nonsense", env, NOW));
  });

  it("removing a person removes their leave and photo, and unlinks their shift roster entry", async () => {
    const [a, b] = [person("a@x.com"), person("b@x.com")];
    await save([a, b]);
    const [ma, mb] = [memberOf(1, a.id), memberOf(2, b.id)];
    await saveMembers([ma, mb]);
    await applyChanges(
      "shifts",
      { upsert: [day(ma, "2026-03-02"), day(mb, "2026-03-02", "main:ns")] },
      env,
    );
    await applyChanges(
      "timeoff",
      {
        upsert: [
          createTimeOff({
            employeeId: a.id,
            startDate: "2026-03-03",
            endDate: "2026-03-04",
          }),
        ],
      },
      env,
    );
    await putPhoto(a.id, PNG, env, NOW);
    await applyChanges("employees", { remove: [a.id] }, env, NOW);
    assert.deepEqual(
      (await readStaff("employees", env)).map((e) => e.id),
      [b.id],
    );
    assert.deepEqual(await readStaff("timeoff", env), []);
    assert.equal(await getPhoto(a.id, env), null);
    const config = await readRoster(env);
    assert.deepEqual(
      config.members.map((m) => [m.id, m.employeeId]),
      [
        [ma.id, null],
        [mb.id, b.id],
      ],
    );
    assert.equal((await readStaff("shifts", env)).length, 2);
  });

  it("reports a damaged file instead of overwriting it", async () => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(staffDir(env), { recursive: true });
    await writeFile(path.join(staffDir(env), "employees.json"), "{ broken");
    await assert.rejects(save([person("a@x.com")]), /could not be read/);
  });
});

describe("shifts and time off", () => {
  it("shifts only accept people on the shift roster, and validate their shape", async () => {
    const a = person("a@x.com");
    await save([a]);
    const ma = memberOf(1, a.id);
    await saveMembers([ma]);
    await assert.rejects(
      applyChanges("shifts", { upsert: [day(memberOf(9), "2026-03-02")] }, env),
      /not on the shift roster/,
    );
    await assert.rejects(
      applyChanges("shifts", { upsert: [{ ...day(ma, "2026-03-02"), id: "x" }] }, env),
    );
    await assert.rejects(
      applyChanges(
        "shifts",
        { upsert: [{ ...day(ma, "2026-03-02"), ref: "nonsense" }] },
        env,
      ),
    );
    await assert.rejects(
      applyChanges("shifts", { upsert: [{ ...day(ma, "2026-03-02", "custom") }] }, env),
      /Custom hours need some text/,
    );
    await applyChanges(
      "shifts",
      { upsert: [day(ma, "2026-03-02", "custom", { text: "11AM-8PM", swap: true })] },
      env,
    );
  });

  it("time off only accepts people on the roster, with sensible dates", async () => {
    const a = person("a@x.com");
    await save([a]);
    await assert.rejects(
      applyChanges(
        "timeoff",
        {
          upsert: [
            createTimeOff({
              employeeId: "emp_ffffffffffff",
              startDate: "2026-03-05",
              endDate: "2026-03-06",
            }),
          ],
        },
        env,
      ),
      /not on the roster/,
    );
    await assert.rejects(
      applyChanges(
        "timeoff",
        {
          upsert: [
            createTimeOff({
              employeeId: a.id,
              startDate: "2026-03-05",
              endDate: "2026-03-01",
            }),
          ],
        },
        env,
      ),
    );
  });

  it("replaces a day's shift and clears it", async () => {
    const ma = memberOf(1);
    await saveMembers([ma]);
    await applyChanges("shifts", { upsert: [day(ma, "2026-03-02")] }, env);
    const next = await applyChanges(
      "shifts",
      { upsert: [day(ma, "2026-03-02", "main:ns")] },
      env,
    );
    assert.deepEqual(
      next.map((s) => s.ref),
      ["main:ns"],
    );
    assert.deepEqual(await applyChanges("shifts", { remove: [next[0].id] }, env), []);
  });
});

describe("shift roster configuration", () => {
  it("starts with one schedule and no teams: teams come from the directory", async () => {
    const config = await readRoster(env);
    assert.deepEqual(config.groups, []);
    assert.deepEqual(config.members, []);
    assert.deepEqual(
      config.schedules.map((s) => s.name),
      ["Standard"],
    );
    assert.ok(config.schedules[0].shifts.length > 0);
  });

  it("saves a configuration and drops the shifts of people who are no longer in it", async () => {
    const [m1, m2] = [memberOf(1), memberOf(2)];
    await saveMembers([m1, m2]);
    await applyChanges(
      "shifts",
      { upsert: [day(m1, "2026-03-02"), day(m2, "2026-03-02")] },
      env,
    );
    await saveMembers([m2]);
    assert.deepEqual(
      (await readStaff("shifts", env)).map((s) => s.memberId),
      [m2.id],
    );
    assert.deepEqual(
      (await readRoster(env)).members.map((m) => m.id),
      [m2.id],
    );
  });

  it("refuses an inconsistent configuration and links to unknown or shared profiles", async () => {
    const base = workbookRosterConfig();
    const a = person("a@x.com");
    await save([a]);
    const bad = (config) => saveRoster({ config }, env);
    await assert.rejects(
      bad({ ...base, members: [memberOf(1, null, { groupId: "nope" })] }),
      /team that does not exist/,
    );
    await assert.rejects(
      bad({ ...base, groups: [{ id: "x", name: "X", scheduleId: "nope" }] }),
      /schedule that does not exist/,
    );
    await assert.rejects(
      bad({
        ...base,
        schedules: [...base.schedules, { id: "status", name: "S", shifts: [] }],
      }),
      /status or custom/,
    );
    await assert.rejects(
      bad({ ...base, members: [memberOf(1, "emp_ffffffffffff")] }),
      /not on the roster/,
    );
    await assert.rejects(
      bad({ ...base, members: [memberOf(1, a.id), memberOf(2, a.id)] }),
      /linked to the same profile/,
    );
    await assert.rejects(
      bad({
        ...base,
        schedules: [
          {
            id: "main",
            name: "Main",
            shifts: [{ id: "s", label: "S", start: "25:00", end: "08:00", days: [] }],
          },
        ],
      }),
    );
    await assert.rejects(saveRoster({ config: "nonsense" }, env));
    assert.deepEqual((await readRoster(env)).members, []);
  });

  it("imports a configuration with shifts in one step, merging with what is there", async () => {
    const [m1, m2] = [memberOf(1), memberOf(2)];
    await saveMembers([m1]);
    await applyChanges(
      "shifts",
      { upsert: [day(m1, "2026-03-02"), day(m1, "2026-03-03")] },
      env,
    );
    const result = await importRoster(
      {
        config: { ...workbookRosterConfig(), members: [m1, m2] },
        upsert: [day(m1, "2026-03-02", "main:ns"), day(m2, "2026-03-02")],
      },
      env,
    );
    assert.equal(result.assignments, 2);
    const stored = Object.fromEntries(
      (await readStaff("shifts", env)).map((s) => [s.id, s.ref]),
    );
    assert.deepEqual(stored, {
      [`${m1.id}|2026-03-02`]: "main:ns",
      [`${m1.id}|2026-03-03`]: "main:shift-1",
      [`${m2.id}|2026-03-02`]: "main:shift-1",
    });
    await assert.rejects(
      importRoster(
        {
          config: { ...workbookRosterConfig(), members: [m1] },
          upsert: [day(m2, "2026-03-04")],
        },
        env,
      ),
      /not on the shift roster/,
    );
  });

  it("reports damaged settings instead of overwriting them", async () => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(staffDir(env), { recursive: true });
    await writeFile(path.join(staffDir(env), "roster.json"), "{ broken");
    await assert.rejects(readRoster(env), /could not be read/);
    await assert.rejects(
      applyChanges("shifts", { upsert: [day(memberOf(1), "2026-03-02")] }, env),
      /could not be read/,
    );
  });
});

describe("offboarding", () => {
  const move = (action, ids) => moveEmployees({ action, ids }, env, NOW);

  it("moves a person off the roster, keeps their profile and photo, drops their time off", async () => {
    const [a, b] = [person("a@x.com", { team: "Core" }), person("b@x.com")];
    await save([a, b]);
    await applyChanges(
      "timeoff",
      {
        upsert: [
          createTimeOff({
            employeeId: a.id,
            startDate: "2026-03-03",
            endDate: "2026-03-04",
          }),
        ],
      },
      env,
    );
    await putPhoto(a.id, PNG, env, NOW);

    const result = await move("offboard", [a.id]);
    assert.deepEqual(
      result.employees.map((e) => e.id),
      [b.id],
    );
    const [left] = await readStaff("offboarded", env);
    assert.equal(left.id, a.id);
    assert.equal(left.team, "Core");
    assert.equal(left.offboardedAt, NOW());
    assert.ok(left.photoVersion > 0);
    assert.equal((await getPhoto(a.id, env)).type, "image/png");
    assert.deepEqual(await readStaff("timeoff", env), []);
  });

  it("restores a person to the roster without the offboarded stamp", async () => {
    const a = person("a@x.com");
    await save([a]);
    await move("offboard", [a.id]);
    const result = await move("restore", [a.id]);
    assert.deepEqual(
      result.employees.map((e) => e.id),
      [a.id],
    );
    assert.equal("offboardedAt" in result.employees[0], false);
    assert.deepEqual(await readStaff("offboarded", env), []);
  });

  it("refuses to restore someone whose email is back on the roster", async () => {
    const a = person("a@x.com");
    await save([a]);
    await move("offboard", [a.id]);
    await save([person("A@x.com")]);
    await assert.rejects(move("restore", [a.id]), /already on the roster/);
    assert.equal((await readStaff("offboarded", env)).length, 1);
  });

  it("refuses unknown people and malformed requests", async () => {
    await assert.rejects(move("offboard", ["emp_ffffffffffff"]), /not on the roster/);
    await assert.rejects(move("restore", ["emp_ffffffffffff"]), /not in the offboarded/);
    await assert.rejects(move("offboard", ["../evil"]));
    await assert.rejects(move("offboard", []));
    await assert.rejects(moveEmployees({ action: "delete", ids: [] }, env, NOW));
  });

  it("edits an offboarded profile, keeping the fields the server owns", async () => {
    const a = person("a@x.com");
    await save([a]);
    await putPhoto(a.id, JPEG, env, NOW);
    await move("offboard", [a.id]);
    const [left] = await readStaff("offboarded", env);
    const [after] = await applyChanges(
      "offboarded",
      {
        upsert: [
          {
            ...left,
            team: "Alumni",
            photoVersion: 0,
            offboardedAt: "1999",
            createdAt: "1999",
          },
        ],
      },
      env,
      () => "2026-04-01T00:00:00.000Z",
    );
    assert.equal(after.team, "Alumni");
    assert.equal(after.photoVersion, left.photoVersion);
    assert.equal(after.offboardedAt, left.offboardedAt);
    assert.equal(after.createdAt, left.createdAt);
    assert.equal(after.updatedAt, "2026-04-01T00:00:00.000Z");
  });

  it("only edits people who are already offboarded", async () => {
    const a = person("a@x.com");
    await save([a]);
    await assert.rejects(
      applyChanges("offboarded", { upsert: [{ ...a, offboardedAt: NOW() }] }, env),
      /not in the offboarded list/,
    );
    assert.deepEqual(await readStaff("offboarded", env), []);
  });

  it("deleting an offboarded profile removes it and its photo for good", async () => {
    const a = person("a@x.com");
    await save([a]);
    await putPhoto(a.id, JPEG, env, NOW);
    await move("offboard", [a.id]);
    assert.deepEqual(await applyChanges("offboarded", { remove: [a.id] }, env), []);
    assert.equal(await getPhoto(a.id, env), null);
  });

  it("stores and clears the photo of an offboarded person", async () => {
    const a = person("a@x.com");
    await save([a]);
    await move("offboard", [a.id]);
    await putPhoto(a.id, JPEG, env, NOW);
    assert.ok((await readStaff("offboarded", env))[0].photoVersion > 0);
    await deletePhoto(a.id, env, NOW);
    assert.equal((await readStaff("offboarded", env))[0].photoVersion, 0);
    assert.equal(await getPhoto(a.id, env), null);
  });
});

describe("photos", () => {
  it("stores, serves with the sniffed type, and deletes", async () => {
    const a = person("a@x.com");
    await save([a]);
    await putPhoto(a.id, JPEG, env, NOW);
    const photo = await getPhoto(a.id, env);
    assert.equal(photo.type, "image/jpeg");
    assert.deepEqual([...photo.bytes], [...JPEG]);
    await deletePhoto(a.id, env, NOW);
    assert.equal(await getPhoto(a.id, env), null);
    assert.equal((await readStaff("employees", env))[0].photoVersion, 0);
  });

  it("refuses non-images, oversize files, unknown people and unsafe ids", async () => {
    const a = person("a@x.com");
    await save([a]);
    await assert.rejects(
      putPhoto(a.id, Uint8Array.from([1, 2, 3, 4]), env),
      /JPEG, PNG or WebP/,
    );
    await assert.rejects(
      putPhoto(a.id, new Uint8Array(1024 * 1024 + 1).fill(0xff), env),
      /larger than 1 MB/,
    );
    await assert.rejects(putPhoto("emp_ffffffffffff", JPEG, env), /Unknown employee/);
    await assert.rejects(() => getPhoto("..\\..\\secret", env), /Unknown employee/);
  });
});

describe("M365 profile sync", () => {
  it("is not undone by an edit made from a copy loaded before the profile arrived", async () => {
    const waiting = person("jane.doe@x.com", { profileSync: "pending" });
    await save([waiting]);
    await applyProfileSync(
      { email: "jane.doe@x.com", op: "Tax", level: "Senior" },
      env,
      NOW,
    );
    await save([{ ...waiting, team: "Run" }]);
    const [after] = await readStaff("employees", env);
    assert.equal(after.profileSync, "synced");
    assert.equal(after.op, "Tax");
    assert.equal(after.level, "Senior");
    assert.equal(after.team, "Run");
  });

  it("ends the wait when someone fills the profile in by hand", async () => {
    const waiting = person("jane.doe@x.com", { profileSync: "pending" });
    await save([waiting]);
    await save([{ ...waiting, op: "Tax" }]);
    assert.equal((await readStaff("employees", env))[0].profileSync, "manual");
  });

  it("fills the person with that email and stores the photo", async () => {
    const a = person("jane.doe@x.com", { profileSync: "pending", level: "Keep" });
    await save([a]);
    const updated = await applyProfileSync(
      {
        email: "JANE.DOE@x.com",
        firstName: "Jane",
        lastName: "Doe",
        op: "Tax",
        level: "",
        photoBase64: Buffer.from(JPEG).toString("base64"),
      },
      env,
      NOW,
    );
    assert.equal(updated.profileSync, "synced");
    assert.equal(updated.lastName, "Doe");
    assert.equal(updated.op, "Tax");
    assert.equal(updated.level, "Keep");
    assert.ok(updated.photoVersion > 0);
    assert.equal((await getPhoto(a.id, env)).type, "image/jpeg");
  });

  it("refuses unknown emails and bad photos without changing anything", async () => {
    await save([person("a@x.com", { profileSync: "pending" })]);
    await assert.rejects(
      applyProfileSync({ email: "nobody@x.com" }, env),
      /No one on the roster/,
    );
    await assert.rejects(
      applyProfileSync({ email: "a@x.com", photoBase64: "@@@" }, env),
      /base64/,
    );
    await assert.rejects(
      applyProfileSync(
        {
          email: "a@x.com",
          op: "Tax",
          photoBase64: Buffer.from("hello").toString("base64"),
        },
        env,
      ),
      /JPEG, PNG or WebP/,
    );
    const [a] = await readStaff("employees", env);
    assert.equal(a.profileSync, "pending");
    assert.equal(a.op, "");
    await assert.rejects(applyProfileSync({ email: "bad" }, env), /email/i);
  });
});
