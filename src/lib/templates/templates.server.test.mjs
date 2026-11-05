import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  addTemplate,
  readTemplates,
  readTemplatesChecked,
  removeTemplate,
  resolveTemplate,
  restoreBuiltIn,
  restoreDeleted,
  saveTemplate,
  templatesDir,
  TemplateError,
} from "./server.ts";
import { STARTERS } from "./starters.ts";

const NOW = () => "2026-10-30T10:00:00.000Z";
let dir;
let env;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "tpl-"));
  env = { AI_OS_PMO_DATA_DIR: dir };
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const draft = (over = {}) => ({
  name: "Mine",
  kind: "email",
  subject: "S {{total}}",
  body: "Hello {{total}}",
  usedBy: ["task:weekly-aging-report"],
  ...over,
});
const fileOf = () => path.join(templatesDir(env), "library.json");

describe("where the library lives", () => {
  it("is the templates folder of the PMO data folder, unless told otherwise", () => {
    assert.equal(templatesDir(env), path.join(path.resolve(dir), "templates"));
    assert.equal(templatesDir({ AI_OS_TEMPLATES_DIR: dir }), path.resolve(dir));
  });
});

describe("the first read", () => {
  it("writes the starters, which Python reads from the same file", async () => {
    const library = await readTemplates(env, NOW);
    assert.equal(library.templates.length, STARTERS.length);
    const onDisk = JSON.parse(await readFile(fileOf(), "utf8"));
    assert.equal(onDisk.version, 1);
    assert.equal(onDisk.templates.length, STARTERS.length);
  });

  it("does not seed again once a library exists", async () => {
    await readTemplates(env, NOW);
    const aging = (await readTemplates(env, NOW)).templates.find(
      (t) => t.starterId === "aging-report-email",
    );
    await removeTemplate(aging.id, env, NOW);
    assert.equal((await readTemplates(env, NOW)).templates.length, STARTERS.length - 1);
  });

  it("reports a damaged file instead of replacing it", async () => {
    await mkdir(templatesDir(env), { recursive: true });
    await writeFile(fileOf(), "{ not json", "utf8");
    await assert.rejects(readTemplates(env, NOW), (error) => {
      assert.ok(error instanceof TemplateError);
      assert.equal(error.status, 500);
      return true;
    });
    assert.equal(await readFile(fileOf(), "utf8"), "{ not json");
  });
});

describe("recovering a damaged or thin library", () => {
  it("rebuilds an unreadable file from the built-in templates and keeps a .bak copy", async () => {
    await mkdir(templatesDir(env), { recursive: true });
    await writeFile(fileOf(), "{ not json", "utf8");
    await assert.rejects(readTemplates(env, NOW), (error) => error.code === "corrupt");
    const result = await restoreBuiltIn(env, NOW);
    assert.equal(result.rebuilt, true);
    assert.equal(result.added, STARTERS.length);
    assert.equal(result.backup, "library.json.bak");
    assert.equal(await readFile(`${fileOf()}.bak`, "utf8"), "{ not json");
    assert.equal((await readTemplates(env, NOW)).templates.length, STARTERS.length);
  });

  it("never overwrites an earlier .bak when the file breaks again", async () => {
    await mkdir(templatesDir(env), { recursive: true });
    await writeFile(`${fileOf()}.bak`, "first", "utf8");
    await writeFile(fileOf(), "second broken", "utf8");
    const result = await restoreBuiltIn(env, NOW);
    assert.match(result.backup, /^library\.json\.bak-\d+$/);
    assert.equal(await readFile(`${fileOf()}.bak`, "utf8"), "first");
  });

  it("adds back built-in templates that are gone, without touching the rest", async () => {
    const before = await readTemplates(env, NOW);
    const aging = before.templates.find((t) => t.starterId === "aging-report-email");
    await removeTemplate(aging.id, env, NOW);
    const mine = await addTemplate(
      draft({ name: "Mine", usedBy: ["task:weekly-aging-report"] }),
      env,
      NOW,
    );
    const result = await restoreBuiltIn(env, NOW);
    assert.equal(result.rebuilt, false);
    assert.equal(result.added, 1);
    const after = await readTemplates(env, NOW);
    const back = after.templates.find((t) => t.starterId === "aging-report-email");
    assert.ok(back);
    // The place stays with the template that has it now.
    assert.equal(back.usedBy.includes("task:weekly-aging-report"), false);
    assert.equal(
      (await resolveTemplate("task:weekly-aging-report", env)).id,
      mine.template.id,
    );
    assert.equal((await restoreBuiltIn(env, NOW)).added, 0);
  });

  it("refills a library that was emptied by hand", async () => {
    await mkdir(templatesDir(env), { recursive: true });
    await writeFile(fileOf(), JSON.stringify({ version: 1, templates: [] }), "utf8");
    assert.equal((await restoreBuiltIn(env, NOW)).added, STARTERS.length);
  });

  it("keeps a copy and says so when a hand edit left entries unusable", async () => {
    await readTemplates(env, NOW);
    const onDisk = JSON.parse(await readFile(fileOf(), "utf8"));
    onDisk.templates.push({ id: "bad id", name: "x", kind: "email" });
    await writeFile(fileOf(), JSON.stringify(onDisk), "utf8");
    const read = await readTemplatesChecked(env, NOW);
    assert.match(read.warning, /1 entry .*left out/);
    assert.match(read.warning, /library\.json\.bak/);
    assert.equal(read.library.templates.length, STARTERS.length);
    assert.equal((await readFile(`${fileOf()}.bak`, "utf8")).includes("bad id"), true);
    assert.equal((await readTemplatesChecked(env, NOW)).warning !== null, true);
  });
});

describe("undoing a delete", () => {
  it("brings the template back as it was, but not places another template took", async () => {
    const { template: mine } = await addTemplate(
      draft({ name: "Mine", usedBy: ["task:weekly-aging-report"] }),
      env,
      NOW,
    );
    const { template: edited } = await saveTemplate(
      mine.id,
      draft({ name: "Mine v2", usedBy: ["task:weekly-aging-report"] }),
      env,
      NOW,
    );
    await removeTemplate(mine.id, env, NOW);
    const other = await addTemplate(
      draft({ name: "Replacement", usedBy: ["task:weekly-aging-report"] }),
      env,
      NOW,
    );
    const back = await restoreDeleted({ template: edited }, env, NOW);
    assert.equal(back.template.id, mine.id);
    assert.equal(back.template.createdAt, mine.createdAt);
    assert.equal(back.template.history.length, 1);
    assert.deepEqual(back.leftBehind, ["task:weekly-aging-report"]);
    assert.deepEqual(back.template.usedBy, []);
    assert.equal(
      (await resolveTemplate("task:weekly-aging-report", env)).id,
      other.template.id,
    );
  });

  it("refuses a template that is already there or is not a template", async () => {
    const { template } = await addTemplate(draft({ usedBy: [] }), env, NOW);
    await assert.rejects(restoreDeleted({ template }, env, NOW), /already back/);
    await assert.rejects(restoreDeleted({ template: 5 }, env, NOW), TemplateError);
    await assert.rejects(restoreDeleted(null, env, NOW), TemplateError);
  });
});

describe("saving", () => {
  it("adds a template, takes the place from the starter and persists it", async () => {
    const { template, displaced } = await addTemplate(draft(), env, NOW);
    assert.match(template.id, /^tpl_[0-9a-f]{12}$/);
    assert.equal(displaced.length, 1);
    assert.equal(displaced[0].targetKey, "task:weekly-aging-report");
    assert.equal(
      (await resolveTemplate("task:weekly-aging-report", env)).id,
      template.id,
    );
    const onDisk = JSON.parse(await readFile(fileOf(), "utf8"));
    assert.ok(onDisk.templates.some((t) => t.id === template.id));
  });

  it("updates and deletes", async () => {
    const { template } = await addTemplate(draft({ usedBy: [] }), env, NOW);
    const saved = await saveTemplate(
      template.id,
      draft({ name: "Renamed", usedBy: [] }),
      env,
      NOW,
    );
    assert.equal(saved.template.name, "Renamed");
    await removeTemplate(template.id, env, NOW);
    await assert.rejects(removeTemplate(template.id, env, NOW), /no longer exists/);
  });

  it("refuses a bad edit with the reason per field", async () => {
    await assert.rejects(
      addTemplate(draft({ name: "", body: "" }), env, NOW),
      (error) => {
        assert.equal(error.status, 400);
        assert.ok(error.fields.name && error.fields.body);
        return true;
      },
    );
  });

  it("keeps every edit when several arrive at once", async () => {
    await Promise.all(
      Array.from({ length: 8 }, (_, n) =>
        addTemplate(draft({ name: `T${n}`, usedBy: [] }), env, NOW),
      ),
    );
    assert.equal((await readTemplates(env, NOW)).templates.length, STARTERS.length + 8);
  });
});

describe("resolving a place", () => {
  it("is null before any library exists, and never creates the file", async () => {
    assert.equal(await resolveTemplate("task:weekly-aging-report", env), null);
    await assert.rejects(readFile(fileOf(), "utf8"), { code: "ENOENT" });
  });

  it("is null for a place nothing uses", async () => {
    await readTemplates(env, NOW);
    const aging = (await readTemplates(env, NOW)).templates.find(
      (t) => t.starterId === "aging-report-email",
    );
    await saveTemplate(aging.id, { ...aging, usedBy: [] }, env, NOW);
    assert.equal(await resolveTemplate("task:weekly-aging-report", env), null);
  });
});
