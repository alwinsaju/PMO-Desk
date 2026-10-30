import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  addTemplate,
  readTemplates,
  removeTemplate,
  resolveTemplate,
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
