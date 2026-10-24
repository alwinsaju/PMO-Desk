// Run with `pnpm test`. The one-time inbox path migration in Store.loadConfig:
// a saved inboxDir that is exactly the OLD default is rewritten to the new
// default; anything else is left alone. Throwaway temp directories only.
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { migratedInboxDir, resolveInboxDir } from "./paths.ts";
import { Store } from "./store.ts";
import { DEFAULT_INBOX_DIR } from "../types.ts";

const OLD = "C:\\Users\\alsaju\\OneDrive - Deloitte\\PMO-Inbox";
const NEW = "C:\\Users\\alsaju\\OneDrive - Deloitte (O365D)\\PMO-Inbox";

let dir;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "pmo-mig-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const configFile = () => path.join(dir, "config.json");
const readConfigFile = async () => JSON.parse(await readFile(configFile(), "utf8"));
const audit = async () =>
  (await readFile(path.join(dir, "audit.jsonl"), "utf8").catch(() => ""))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

/** A fresh Store (so the once-per-store memo starts empty) on a saved config. */
async function storeWith(saved) {
  if (saved !== undefined) await writeFile(configFile(), JSON.stringify(saved, null, 2));
  return new Store(dir);
}

describe("migratedInboxDir (pure)", () => {
  it("matches only the old default, loosely", () => {
    assert.equal(DEFAULT_INBOX_DIR, NEW);
    assert.equal(migratedInboxDir(OLD), NEW);
    assert.equal(migratedInboxDir(OLD.toLowerCase()), NEW);
    assert.equal(migratedInboxDir(OLD.toUpperCase()), NEW);
    assert.equal(migratedInboxDir(OLD.replaceAll("\\", "/")), NEW);
    assert.equal(migratedInboxDir(`${OLD}\\`), NEW);
    assert.equal(migratedInboxDir(`${OLD.replaceAll("\\", "/")}//`), NEW);
    assert.equal(migratedInboxDir(`  ${OLD}  `), NEW);
  });

  it("leaves everything else alone", () => {
    assert.equal(migratedInboxDir(NEW), null);
    assert.equal(migratedInboxDir("D:\\Work\\PMO-Inbox"), null);
    assert.equal(migratedInboxDir(`${OLD}\\sub`), null, "a sub-folder is a custom path");
    assert.equal(migratedInboxDir("C:\\Users\\alsaju\\OneDrive - Deloitte"), null);
    assert.equal(migratedInboxDir(""), null);
    assert.equal(migratedInboxDir(undefined), null);
    assert.equal(migratedInboxDir(42), null);
  });
});

describe("Store.loadConfig inbox migration", () => {
  it("rewrites the old default to the new one, persists it, keeps other keys and logs it", async () => {
    const store = await storeWith({
      inboxDir: OLD,
      blockedDomains: ["example.test"],
      somethingCustom: { keep: true },
    });
    const config = await store.loadConfig();
    assert.equal(config.inboxDir, NEW);
    assert.deepEqual(config.blockedDomains, ["example.test"]);

    const onDisk = await readConfigFile();
    assert.equal(onDisk.inboxDir, NEW);
    assert.deepEqual(onDisk.blockedDomains, ["example.test"]);
    assert.deepEqual(onDisk.somethingCustom, { keep: true }, "unknown keys survive");

    const entries = (await audit()).filter((e) => e.migrated === "inboxDir");
    assert.equal(entries.length, 1);
    assert.equal(entries[0].action, "config");
    assert.equal(entries[0].from, OLD);
    assert.equal(entries[0].to, NEW);
    assert.equal(
      (await readdir(dir)).filter((n) => n.endsWith(".tmp")).length,
      0,
      "atomic write leaves no temp file",
    );
  });

  it("migrates case and slash variants of the old default", async () => {
    const store = await storeWith({
      inboxDir: `${OLD.replaceAll("\\", "/").toLowerCase()}/`,
    });
    assert.equal((await store.loadConfig()).inboxDir, NEW);
    assert.equal((await readConfigFile()).inboxDir, NEW);
  });

  it("never touches a custom path (file bytes unchanged, nothing logged)", async () => {
    const custom = "D:\\Shared\\PMO-Inbox";
    const store = await storeWith({ inboxDir: custom });
    const before = await readFile(configFile(), "utf8");
    assert.equal((await store.loadConfig()).inboxDir, custom);
    assert.equal(await readFile(configFile(), "utf8"), before);
    assert.deepEqual(await audit(), []);
  });

  it("leaves a path that is already the new default alone", async () => {
    const store = await storeWith({ inboxDir: NEW });
    const before = await readFile(configFile(), "utf8");
    assert.equal((await store.loadConfig()).inboxDir, NEW);
    assert.equal(await readFile(configFile(), "utf8"), before);
    assert.deepEqual(await audit(), []);
  });

  it("does nothing when the key is missing (the schema default applies) or the file is absent or damaged", async () => {
    const missingKey = await storeWith({ blockedDomains: ["x.test"] });
    const before = await readFile(configFile(), "utf8");
    assert.equal((await missingKey.loadConfig()).inboxDir, NEW);
    assert.equal(await readFile(configFile(), "utf8"), before, "no inboxDir is written");

    await rm(configFile());
    const absent = new Store(dir);
    assert.equal((await absent.loadConfig()).inboxDir, NEW);
    assert.deepEqual(await readdir(dir), [], "loading never creates the file");

    await writeFile(configFile(), "{ broken");
    const damaged = new Store(dir);
    assert.equal((await damaged.loadConfig()).inboxDir, NEW);
    assert.equal(
      await readFile(configFile(), "utf8"),
      "{ broken",
      "a damaged file is left as is",
    );
  });

  it("is idempotent: a second load, a second Store and concurrent loads write once", async () => {
    const store = await storeWith({ inboxDir: OLD });
    await Promise.all([store.loadConfig(), store.loadConfig(), store.loadConfig()]);
    await store.loadConfig();
    await new Store(dir).loadConfig();
    assert.equal((await readConfigFile()).inboxDir, NEW);
    assert.equal((await audit()).filter((e) => e.migrated === "inboxDir").length, 1);
  });

  it("picks up a config written after the first (empty) load", async () => {
    const store = new Store(dir);
    await store.loadConfig();
    await writeFile(configFile(), JSON.stringify({ inboxDir: OLD }));
    assert.equal((await store.loadConfig()).inboxDir, NEW);
  });

  it("init() writes the new default on first run, so nothing needs migrating", async () => {
    const store = new Store(dir);
    await store.init();
    assert.equal((await readConfigFile()).inboxDir, NEW);
    await store.loadConfig();
    assert.deepEqual(await audit(), []);
  });

  it("AI_OS_PMO_INBOX_DIR still wins over the saved and the migrated value", async () => {
    const store = await storeWith({ inboxDir: OLD });
    const config = await store.loadConfig();
    const env = { AI_OS_PMO_INBOX_DIR: "C:\\override\\inbox" };
    assert.equal(
      resolveInboxDir(config.inboxDir, env),
      path.resolve("C:\\override\\inbox"),
    );
    assert.equal(resolveInboxDir(config.inboxDir, {}), path.resolve(NEW));
    // The file still migrates (the override only changes which folder is scanned).
    assert.equal((await readConfigFile()).inboxDir, NEW);
  });
});
