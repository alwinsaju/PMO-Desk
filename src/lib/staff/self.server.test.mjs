// Run with `pnpm test`. You on the roster: the person who sets PMO Desk up becomes its first
// staff member, and the M365 profile flow's answer gives them a full name and a photo.
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { createEmployee } from "./employees.ts";
import { registerSelf } from "./self.ts";
import { applyChanges, ensureSelf, moveEmployees, readStaff } from "./server.ts";

const NOW = () => "2026-03-02T10:00:00.000Z";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

let dir;
let env;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "self-"));
  env = {
    AI_OS_PMO_DATA_DIR: dir,
    AI_OS_STAFF_EXCHANGE_DIR: path.join(dir, "exchange"),
  };
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("ensureSelf", () => {
  it("adds you as the first member, waiting for the M365 profile", async () => {
    await applyChanges(
      "employees",
      { upsert: [createEmployee({ deloitteEmail: "a@x.com", firstName: "A" }, NOW())] },
      env,
      NOW,
    );
    const me = await ensureSelf({ email: " Jane.Doe@deloitte.com " }, env, NOW);
    assert.equal(me.deloitteEmail, "Jane.Doe@deloitte.com");
    assert.equal(me.firstName, "Jane");
    assert.equal(me.lastName, "Doe");
    assert.equal(me.profileSync, "pending");
    const people = await readStaff("employees", env);
    assert.deepEqual(
      people.map((p) => p.deloitteEmail),
      ["Jane.Doe@deloitte.com", "a@x.com"],
    );
  });

  it("uses the name that was typed in, and is the only member on a new roster", async () => {
    const me = await ensureSelf(
      { email: "jd@deloitte.com", name: "Jane van Doe" },
      env,
      NOW,
    );
    assert.equal(me.firstName, "Jane");
    assert.equal(me.lastName, "van Doe");
    assert.equal((await readStaff("employees", env)).length, 1);
  });

  it("does nothing the second time, whatever the case of the address", async () => {
    const first = await ensureSelf({ email: "jd@deloitte.com" }, env, NOW);
    const again = await ensureSelf({ email: "JD@Deloitte.com", name: "Other" }, env, NOW);
    assert.equal(again.id, first.id);
    assert.equal((await readStaff("employees", env)).length, 1);
  });

  it("refuses an address that is not one, and leaves someone offboarded alone", async () => {
    assert.equal(await ensureSelf({ email: "not-an-address" }, env, NOW), null);
    assert.deepEqual(await readStaff("employees", env), []);
    await applyChanges(
      "employees",
      { upsert: [createEmployee({ deloitteEmail: "gone@x.com" }, NOW())] },
      env,
      NOW,
    );
    const [gone] = await readStaff("employees", env);
    await moveEmployees({ action: "offboard", ids: [gone.id] }, env, NOW);
    assert.equal(await ensureSelf({ email: "gone@x.com" }, env, NOW), null);
    assert.deepEqual(await readStaff("employees", env), []);
  });
});

describe("registerSelf", () => {
  it("asks the profile flow for your profile, then shows the full name and photo", async () => {
    const first = await registerSelf({ email: "jane.doe@deloitte.com" }, env);
    assert.equal(first.pending, true);
    assert.equal(first.name, "Jane Doe");
    assert.equal(first.photoUrl, undefined);
    const requests = await readdir(path.join(dir, "exchange", "requests"));
    assert.equal(requests.length, 1);

    // The flow answers with the real profile.
    await writeFile(
      path.join(dir, "exchange", "profiles", "jane.doe@deloitte.com.json"),
      JSON.stringify({
        email: "jane.doe@deloitte.com",
        firstName: "Jane",
        lastName: "Doe-Smith",
        level: "Senior Manager",
        photoBase64: JPEG.toString("base64"),
      }),
    );
    const second = await registerSelf({ email: "jane.doe@deloitte.com" }, env);
    assert.equal(second.pending, false);
    assert.equal(second.name, "Jane Doe-Smith");
    assert.match(second.photoUrl, /^\/api\/staff\/photos\/emp_[0-9a-f]+\?v=\d+$/);
    assert.equal((await readStaff("employees", env)).length, 1);
  });

  it("gives back null for an unusable address instead of throwing", async () => {
    assert.equal(await registerSelf({ email: "nope" }, env), null);
  });
});
