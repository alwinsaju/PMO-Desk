import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  applyProfile,
  createEmployee,
  employeeFromEmail,
  employeesToCsv,
  parseRosterRows,
  planImport,
  shiftRosterPeople,
} from "./employees.ts";
import { emailFromRequestFile, parseProfileFile, requestFileName } from "./exchange.ts";
import { resendRequest, resolveExchange, syncExchange } from "./exchangeServer.ts";
import { applyChanges, getPhoto, readStaff } from "./server.ts";

const NOW = "2026-03-02T10:00:00.000Z";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

describe("request and profile files", () => {
  it("names a request after the e-mail and reads it back", () => {
    const name = requestFileName(" Jane.Doe@Deloitte.com ", "m1");
    assert.equal(name, "jane.doe@deloitte.com~m1.json");
    assert.equal(emailFromRequestFile(name), "jane.doe@deloitte.com");
    assert.equal(emailFromRequestFile("note.txt"), null);
  });

  it("refuses addresses that cannot be a file name", () => {
    assert.equal(requestFileName("not-an-email", "m1"), null);
    assert.equal(requestFileName('a"b@x.com', "m1"), null);
    assert.equal(requestFileName("a~b@x.com", "m1"), null);
    assert.equal(requestFileName(`${"a".repeat(150)}@x.com`, "m1"), null);
  });

  it("keeps the text fields and drops null, empty and non-text values", () => {
    const parsed = parseProfileFile(
      JSON.stringify({
        email: " a@x.com ",
        firstName: "Ann",
        lastName: null,
        level: "",
        offering: 5,
        phone: " 1 ",
      }),
    );
    assert.deepEqual(parsed, {
      ok: true,
      profile: { email: "a@x.com", firstName: "Ann", phone: "1" },
    });
  });

  it("reads the department as the offering portfolio when the flow does not call it op", () => {
    const op = (profile) =>
      parseProfileFile(JSON.stringify({ email: "a@x.com", ...profile })).profile.op;
    assert.equal(op({ department: " DF&O IN BEN " }), "DF&O IN BEN");
    assert.equal(op({ offering: "DF&O IN BEN" }), "DF&O IN BEN");
    assert.equal(op({ op: "Real", department: "Other" }), "Real");
    assert.equal(op({ op: "", department: "Other" }), "Other");
    assert.equal(op({ level: "Senior" }), undefined);
  });

  it("reads the city as the home office, ahead of a state a first flow put there", () => {
    const office = (profile) =>
      parseProfileFile(JSON.stringify({ email: "a@x.com", ...profile })).profile
        .homeOffice;
    assert.equal(office({ city: " Bengaluru ", homeOffice: "Karnataka" }), "Bengaluru");
    assert.equal(office({ homeOffice: "Pune" }), "Pune");
    assert.equal(office({ officeLocation: "Hyderabad" }), "Hyderabad");
    assert.equal(office({ city: "", homeOffice: "Pune" }), "Pune");
    assert.equal(office({}), undefined);
  });

  it("accepts a picture as text, a data URL or a connector file object", () => {
    const b64 = JPEG.toString("base64");
    assert.equal(
      parseProfileFile(JSON.stringify({ email: "a@x.com", photoBase64: b64 })).profile
        .photoBase64,
      b64,
    );
    const object = { "$content-type": "image/jpeg", $content: b64 };
    assert.equal(
      parseProfileFile(JSON.stringify({ email: "a@x.com", photoBase64: object })).profile
        .photoBase64,
      b64,
    );
  });

  it("explains a file whose expressions were never evaluated", () => {
    const literal =
      'json\n{\n  "email": "@outputs(\'Email\')",\n  "firstName": "@body(\'X\')?[\'a\']"\n}';
    assert.match(parseProfileFile(literal).reason, /plain text instead of values/);
    const valid = JSON.stringify({ email: "@outputs('Email')" });
    assert.match(parseProfileFile(valid).reason, /plain text instead of values/);
    assert.match(parseProfileFile("{ nope").reason, /not valid JSON/);
  });

  it("reports bad files", () => {
    assert.match(parseProfileFile("{ nope").reason, /not valid JSON/);
    assert.match(parseProfileFile("[1]").reason, /one JSON object/);
    assert.match(parseProfileFile("{}").reason, /no email/);
    assert.equal(
      parseProfileFile("\uFEFF" + JSON.stringify({ email: "a@x.com" })).ok,
      true,
    );
  });
});

describe("shift roster exclusion", () => {
  it("everyone is included unless the switch was used, on every way in", () => {
    const byEmail = employeeFromEmail("new@x.com", NOW);
    assert.equal(byEmail.excludeFromShiftRoster, false);

    const imported = planImport(
      [],
      [{ row: 2, employee: { deloitteEmail: "imp@x.com" } }],
      NOW,
    ).upserts[0];
    assert.equal(imported.excludeFromShiftRoster, false);

    const legacy = { ...createEmployee({ deloitteEmail: "old@x.com" }, NOW) };
    delete legacy.excludeFromShiftRoster;
    assert.deepEqual(
      shiftRosterPeople([byEmail, imported, legacy]).map((e) => e.deloitteEmail),
      ["new@x.com", "imp@x.com", "old@x.com"],
    );
  });

  it("is kept when a profile arrives or an import updates the person", () => {
    const excluded = employeeFromEmail("ex@x.com", NOW);
    excluded.excludeFromShiftRoster = true;
    const synced = applyProfile(excluded, { email: "ex@x.com", level: "L1" }, NOW);
    assert.equal(synced.excludeFromShiftRoster, true);
    const updated = planImport(
      [excluded],
      [{ row: 2, employee: { deloitteEmail: "ex@x.com", team: "Core" } }],
      NOW,
    ).upserts[0];
    assert.equal(updated.excludeFromShiftRoster, true);
    const back = planImport(
      [excluded],
      [
        {
          row: 2,
          employee: { deloitteEmail: "ex@x.com", excludeFromShiftRoster: false },
        },
      ],
      NOW,
    ).upserts[0];
    assert.equal(back.excludeFromShiftRoster, false);
  });

  it("reads and writes the spreadsheet column, blank meaning included", () => {
    const header = ["First Name", "Deloitte Email- id", "Exclude from shift roster"];
    const result = parseRosterRows([
      header,
      ["A", "a@x.com", "Yes"],
      ["B", "b@x.com", ""],
      ["C", "c@x.com", "No"],
    ]);
    assert.deepEqual(
      result.rows.map((r) => r.employee.excludeFromShiftRoster),
      [true, undefined, false],
    );
    const csv = employeesToCsv([
      createEmployee({ deloitteEmail: "a@x.com", excludeFromShiftRoster: true }, NOW),
    ]);
    assert.match(csv.split("\r\n")[0], /Exclude from shift roster$/);
    assert.match(csv.split("\r\n")[1], /,Yes$/);
  });

  it("defaults to included and filters excluded people out", () => {
    const a = createEmployee({ deloitteEmail: "a@x.com" }, NOW);
    const b = createEmployee(
      { deloitteEmail: "b@x.com", excludeFromShiftRoster: true },
      NOW,
    );
    assert.equal(a.excludeFromShiftRoster, false);
    assert.deepEqual(
      shiftRosterPeople([a, b]).map((e) => e.deloitteEmail),
      ["a@x.com"],
    );
  });
});

let dir;
let env;
let clock;
const now = () => clock;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "staff-ex-"));
  env = {
    AI_OS_PMO_DATA_DIR: path.join(dir, "data"),
    AI_OS_STAFF_EXCHANGE_DIR: path.join(dir, "ex"),
  };
  clock = Date.now();
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const save = (items) => applyChanges("employees", { upsert: items }, env, () => NOW);
const profilesDir = () => path.join(dir, "ex", "profiles");
const drop = (name, body) =>
  mkdir(profilesDir(), { recursive: true }).then(() =>
    writeFile(
      path.join(profilesDir(), name),
      typeof body === "string" ? body : JSON.stringify(body),
    ),
  );

describe("employees saved before the exclusion option existed", () => {
  it("are accepted without the field and come back as included", async () => {
    const old = createEmployee({ deloitteEmail: "old@x.com" }, NOW);
    delete old.excludeFromShiftRoster;
    const saved = await save([old]);
    assert.equal(saved[0].excludeFromShiftRoster, false);
  });
});

describe("exchange folder", () => {
  it("uses the override, then OneDrive, then a local folder", async () => {
    assert.equal(resolveExchange(env).source, "env");
    const od = path.join(dir, "OneDrive - Deloitte");
    await mkdir(od);
    const second = { AI_OS_PMO_DATA_DIR: env.AI_OS_PMO_DATA_DIR, OneDriveCommercial: od };
    assert.deepEqual(resolveExchange(second), {
      dir: path.join(od, "AI-OS", "Staff-Exchange"),
      source: "onedrive",
    });
    // An install from before the AI-OS folder keeps its Staff-Exchange where it is (a flow
    // watches that exact folder), even when an AI-OS one appears next to it.
    await mkdir(path.join(od, "Staff-Exchange"));
    assert.equal(resolveExchange(second).dir, path.join(od, "Staff-Exchange"));
    await mkdir(path.join(od, "AI-OS", "Staff-Exchange"), { recursive: true });
    assert.equal(resolveExchange(second).dir, path.join(od, "Staff-Exchange"));
    const none = { AI_OS_PMO_DATA_DIR: env.AI_OS_PMO_DATA_DIR };
    assert.equal(resolveExchange(none).source, "local");
  });

  it("asks for a profile once per waiting person and not for the others", async () => {
    await save([
      employeeFromEmail("wait@x.com", NOW),
      createEmployee({ deloitteEmail: "done@x.com" }, NOW),
    ]);
    const first = await syncExchange(env, now);
    assert.equal(first.requested, 1);
    const files = await readdir(path.join(dir, "ex", "requests"));
    assert.equal(files.length, 1);
    assert.match(files[0], /^wait@x\.com~.+\.json$/);
    assert.equal((await syncExchange(env, now)).requested, 0);
  });

  it("applies a profile, removes the file and the request, and stores the picture", async () => {
    const [p] = [employeeFromEmail("jane.doe@x.com", NOW)];
    await save([p]);
    await syncExchange(env, now);
    await drop("jane.doe@x.com.json", {
      email: "Jane.Doe@x.com",
      firstName: "Jane",
      lastName: "Doe",
      level: "Senior Consultant",
      op: "DF&O IN BEN",
      homeOffice: "Texas",
      phone: null,
      photoBase64: JPEG.toString("base64"),
    });
    const summary = await syncExchange(env, now);
    assert.equal(summary.applied, 1);
    const [e] = await readStaff("employees", env);
    assert.equal(e.profileSync, "synced");
    assert.equal(e.level, "Senior Consultant");
    assert.equal(e.op, "DF&O IN BEN");
    assert.equal(e.offering, "");
    assert.equal(e.homeOffice, "Texas");
    assert.equal((await getPhoto(p.id, env)).type, "image/jpeg");
    assert.deepEqual(await readdir(profilesDir()), []);
    assert.deepEqual(await readdir(path.join(dir, "ex", "requests")), []);
    assert.equal((await syncExchange(env, now)).requested, 0);
  });

  it("rejects a profile for someone not on the roster, with the reason beside it", async () => {
    await drop("ghost.json", { email: "ghost@x.com", level: "X" });
    const summary = await syncExchange(env, now);
    assert.equal(summary.rejected, 1);
    const names = await readdir(path.join(dir, "ex", "rejected"));
    assert.equal(names.length, 2);
    const reason = names.find((n) => n.endsWith(".reason.txt"));
    assert.match(
      await readFile(path.join(dir, "ex", "rejected", reason), "utf8"),
      /No one on the roster/,
    );
    assert.deepEqual(await readdir(profilesDir()), []);
  });

  it("leaves a half-synced file alone until it is old enough to give up on", async () => {
    await drop("half.json", '{"email": "a@x');
    assert.deepEqual(
      [(await syncExchange(env, now)).rejected, await readdir(profilesDir())],
      [0, ["half.json"]],
    );
    const old = new Date(clock - 10 * 60 * 1000);
    await utimes(path.join(profilesDir(), "half.json"), old, old);
    assert.equal((await syncExchange(env, now)).rejected, 1);
  });

  it("rejects an oversized or bad-picture file and leaves the person unchanged", async () => {
    await save([employeeFromEmail("a@x.com", NOW)]);
    await drop("big.json", "x".repeat(3 * 1024 * 1024 + 1));
    await drop("pic.json", {
      email: "a@x.com",
      op: "Tax",
      photoBase64: Buffer.from("hello").toString("base64"),
    });
    const summary = await syncExchange(env, now);
    assert.equal(summary.rejected, 2);
    const [a] = await readStaff("employees", env);
    assert.equal(a.profileSync, "pending");
    assert.equal(a.op, "");
  });

  it("asks for the profile of a person added by hand or imported, even with details filled in", async () => {
    const typed = createEmployee(
      {
        deloitteEmail: "typed@x.com",
        firstName: "Tom",
        level: "Analyst",
        phone: "111",
        profileSync: "pending",
      },
      NOW,
    );
    const plain = createEmployee({ deloitteEmail: "plain@x.com" }, NOW); // "manual": not asked
    await save([typed, plain]);
    const summary = await syncExchange(env, now);
    assert.equal(summary.requested, 1);
    const files = await readdir(path.join(dir, "ex", "requests"));
    assert.deepEqual(
      files.map((f) => f.split("~")[0]),
      ["typed@x.com"],
    );

    await drop("typed@x.com.json", {
      email: "typed@x.com",
      firstName: "Thomas",
      lastName: "Reed",
      level: "Senior Consultant",
      op: "DF&O IN BEN",
    });
    assert.equal((await syncExchange(env, now)).applied, 1);
    const saved = (await readStaff("employees", env)).find((e) => e.id === typed.id);
    assert.equal(saved.profileSync, "synced");
    assert.equal(saved.level, "Senior Consultant");
    assert.equal(saved.firstName, "Thomas");
    assert.equal(saved.phone, "111", "a value the profile lacks is kept");
    assert.deepEqual(await readdir(path.join(dir, "ex", "requests")), []);
  });

  it("writes a fresh request when asked again", async () => {
    const p = employeeFromEmail("a@x.com", NOW);
    await save([p]);
    await syncExchange(env, now);
    const before = await readdir(path.join(dir, "ex", "requests"));
    clock += 1000;
    await resendRequest(p.id, env, now);
    const after = await readdir(path.join(dir, "ex", "requests"));
    assert.equal(after.length, 1);
    assert.notEqual(after[0], before[0]);
    await assert.rejects(resendRequest("emp_ffffffffffff", env, now), /Unknown employee/);
  });
});
