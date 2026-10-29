// Run with `pnpm test`. PMO first run, server side: nothing is ingested until
// the wizard is finished, finishing validates and saves the answers, and the
// inbox folder is only ever created after an explicit request. Throwaway temp
// directories and a fake model only.
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { existsSync, statSync } from "node:fs";
import { developerConfig } from "../developerDefaults.ts";
import { createPmo } from "./create.ts";
import { completeFirstRun, createInboxFolder, firstRunSuggestions } from "./firstRun.ts";
import { buildState } from "./state.ts";
import { resolveInboxDir } from "./paths.ts";
import { Store } from "./store.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.resolve(here, "..", "..", "..", "..", "pmo-intake", "examples");

let dataDir;
let inboxDir;
let home;
let clock;

const isDirectory = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const deps = (over = {}) => ({
  env: {},
  isDirectory,
  isAbsolute: path.isAbsolute,
  mkdir: (p) => mkdir(p),
  safety: { home: "Z:\\nobody", sampleJsonFiles: () => [] },
  ...over,
});
const generator = { model: () => "fake", generate: async () => ({}) };
const runtime = async () => ({ state: "stub", model: "stub", message: null });

/** A fresh PMO with NO seed config: exactly what a new install has. */
const freshPmo = () => createPmo({ dataDir, generator, now: () => clock });

const body = (over = {}) => ({
  names: ["Pat Example", "Pat"],
  emails: ["Pat@Contoso.com"],
  timeZone: "Europe/London",
  allowedSenderDomains: ["Contoso.com"],
  blockedDomains: ["Rival.com"],
  inboxDir,
  ...over,
});

async function dropExample() {
  const names = (await readdir(examplesDir)).filter((n) => /\.json$/i.test(n));
  const name = names.find((n) => /outlook/i.test(n)) ?? names[0];
  const text = await readFile(path.join(examplesDir, name), "utf8");
  const file = path.join(inboxDir, "msg-1.json");
  await writeFile(file, text);
  const when = new Date(clock.getTime() - 60_000);
  await utimes(file, when, when);
  return file;
}

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "pmo-fr-data-"));
  inboxDir = await mkdtemp(path.join(os.tmpdir(), "pmo-fr-inbox-"));
  home = await mkdtemp(path.join(os.tmpdir(), "pmo-fr-home-"));
  clock = new Date("2026-10-23T05:00:00.000Z");
});

afterEach(async () => {
  for (const dir of [dataDir, inboxDir, home])
    await rm(dir, { recursive: true, force: true });
});

describe("a fresh install", () => {
  it("starts with a neutral, not-set-up config", async () => {
    const pmo = await freshPmo();
    const config = await pmo.store.loadConfig();
    assert.equal(config.setupComplete, false);
    assert.equal(config.inboxDir, "");
    assert.deepEqual(config.me, { names: [], emails: [] });
    assert.deepEqual(config.allowedSenderDomains, []);
    assert.deepEqual(config.blockedDomains, []);
  });

  it("ingests nothing and leaves the folder alone until setup is complete", async () => {
    const file = await dropExample();
    // Even when the environment points at a real folder with a real message.
    const previous = process.env.AI_OS_PMO_INBOX_DIR;
    process.env.AI_OS_PMO_INBOX_DIR = inboxDir;
    try {
      const pmo = await freshPmo();
      const report = await pmo.ingestor.scan();
      assert.equal(report.configured, false);
      assert.equal(report.ingested, 0);
      assert.equal(report.filtered, 0);
      assert.deepEqual(report.errors, []);
      assert.ok(existsSync(file), "the message is untouched");
      assert.equal((await pmo.store.listProposals()).length, 0);
      assert.equal((await pmo.store.listQuarantine()).length, 0);
      const state = await buildState(pmo, { runtime, dataDir });
      assert.equal(state.ingest.configured, false);
      assert.equal(state.config.setupComplete, false);
    } finally {
      if (previous === undefined) delete process.env.AI_OS_PMO_INBOX_DIR;
      else process.env.AI_OS_PMO_INBOX_DIR = previous;
    }
  });

  it("stays idle when setup is complete but no inbox is configured", async () => {
    const pmo = await freshPmo();
    await pmo.store.saveConfig(developerConfig({ inboxDir: "" }));
    const report = await pmo.ingestor.scan();
    assert.equal(report.configured, false);
    assert.equal(report.ingested, 0);
  });

  it("resolveInboxDir gives '' (not the current folder) for an empty setting", () => {
    assert.equal(resolveInboxDir("", {}), "");
    assert.equal(resolveInboxDir("  ", {}), "");
    assert.equal(
      resolveInboxDir("", { AI_OS_PMO_INBOX_DIR: inboxDir }),
      path.resolve(inboxDir),
    );
  });
});

describe("completeFirstRun", () => {
  it("saves the answers, sets setupComplete, and the scanner then ingests", async () => {
    const file = await dropExample();
    const pmo = await freshPmo();
    const result = await completeFirstRun(pmo, body(), deps());
    assert.equal(result.ok, true, JSON.stringify(result));

    const config = await pmo.store.loadConfig();
    assert.equal(config.setupComplete, true);
    assert.deepEqual(config.me, {
      names: ["Pat Example", "Pat"],
      emails: ["pat@contoso.com"],
    });
    assert.equal(config.timeZone, "Europe/London");
    assert.equal(config.reminders.timeZone, "Europe/London");
    assert.deepEqual(config.allowedSenderDomains, ["contoso.com"]);
    assert.deepEqual(config.blockedDomains, ["rival.com"]);
    assert.equal(config.inboxDir, inboxDir);

    const report = await pmo.ingestor.scan();
    assert.equal(report.configured, true);
    assert.equal(report.inboxDir, path.resolve(inboxDir));
    assert.equal(
      report.ingested + report.filtered,
      1,
      "the waiting message is now processed",
    );
    assert.ok(!existsSync(file), "and taken out of the inbox");
  });

  it("refuses a bad body with the first problem, saving nothing", async () => {
    const pmo = await freshPmo();
    for (const bad of [
      undefined,
      body({ names: [] }),
      body({ emails: ["nope"] }),
      body({ timeZone: "Mars/Base" }),
      body({ allowedSenderDomains: [] }),
      body({ allowedSenderDomains: ["localhost"] }),
      body({ inboxDir: "" }),
    ]) {
      const result = await completeFirstRun(pmo, bad, deps());
      assert.equal(result.ok, false, JSON.stringify(bad));
    }
    assert.equal((await pmo.store.loadConfig()).setupComplete, false);
  });

  it("refuses a folder that does not exist or is not a dedicated inbox", async () => {
    const pmo = await freshPmo();
    const missing = await completeFirstRun(
      pmo,
      body({ inboxDir: path.join(inboxDir, "nope") }),
      deps(),
    );
    assert.equal(missing.ok, false);
    assert.match(missing.reason, /does not exist/i);

    const whole = await completeFirstRun(
      pmo,
      body(),
      deps({ safety: { home: inboxDir, sampleJsonFiles: () => [] } }),
    );
    assert.equal(whole.ok, false);
    assert.match(whole.reason, /user folder/i);
    assert.equal((await pmo.store.loadConfig()).setupComplete, false);
  });

  it("asks before using a folder that already holds other JSON, and accepts the confirmation", async () => {
    const pmo = await freshPmo();
    const clutter = () => [{ name: "settings.json", text: '{"hello":1}' }];
    const safety = { home: "Z:\\nobody", sampleJsonFiles: clutter };
    const first = await completeFirstRun(pmo, body(), deps({ safety }));
    assert.equal(first.ok, false);
    assert.equal(first.needsConfirmation, true);
    assert.equal((await pmo.store.loadConfig()).setupComplete, false);

    const second = await completeFirstRun(
      pmo,
      body({ confirmNonEmpty: true }),
      deps({ safety }),
    );
    assert.equal(second.ok, true);
    assert.equal((await pmo.store.loadConfig()).inboxDir, inboxDir);
  });

  it("leaves the inbox to the environment when AI_OS_PMO_INBOX_DIR fixes it", async () => {
    const pmo = await freshPmo();
    const result = await completeFirstRun(
      pmo,
      body({ inboxDir: undefined }),
      deps({ env: { AI_OS_PMO_INBOX_DIR: inboxDir } }),
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    const config = await pmo.store.loadConfig();
    assert.equal(config.setupComplete, true);
    assert.equal(config.inboxDir, "");
  });

  it("is refused once setup is already complete (changes go through Settings)", async () => {
    const pmo = await freshPmo();
    assert.equal((await completeFirstRun(pmo, body(), deps())).ok, true);
    const again = await completeFirstRun(pmo, body({ names: ["Someone Else"] }), deps());
    assert.equal(again.ok, false);
    assert.deepEqual((await pmo.store.loadConfig()).me.names, ["Pat Example", "Pat"]);
  });
});

describe("existing installs are not asked again", () => {
  it("a config.json from before the wizard, with an owner email and an inbox, is set up", async () => {
    await writeFile(
      path.join(dataDir, "config.json"),
      JSON.stringify({ inboxDir, me: { names: ["Pat"], emails: ["pat@contoso.com"] } }),
    );
    const store = new Store(dataDir);
    await store.init();
    const config = await store.loadConfig();
    assert.equal(config.setupComplete, true);
    assert.equal(config.inboxDir, inboxDir);
    assert.deepEqual(config.me.emails, ["pat@contoso.com"]);
  });

  it("an old config without an inbox is not", async () => {
    await writeFile(
      path.join(dataDir, "config.json"),
      JSON.stringify({ me: { names: ["Pat"], emails: ["pat@contoso.com"] } }),
    );
    const store = new Store(dataDir);
    assert.equal((await store.loadConfig()).setupComplete, false);
  });
});

describe("createInboxFolder", () => {
  it("creates PMO-Inbox inside the chosen parent, only when asked", async () => {
    const target = path.join(home, "PMO-Inbox");
    assert.equal(existsSync(target), false, "nothing is created by looking around");
    const suggestions = firstRunSuggestions(
      deps({ env: { OneDrive: home, USERNAME: "pat.example" } }),
    );
    assert.equal(suggestions.fullName, "Pat Example");
    assert.equal(existsSync(target), false, "suggesting does not create");
    assert.deepEqual(
      suggestions.inbox.suggestions.map((s) => [s.path, s.exists]),
      [[`${home}\\AI-OS\\PMO-Inbox`, false]],
    );

    const result = await createInboxFolder({ parent: home }, deps());
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.path, target);
    assert.equal(result.created, true);
    assert.equal((await stat(target)).isDirectory(), true);
  });

  it("reuses an existing PMO-Inbox without touching it", async () => {
    const target = path.join(home, "PMO-Inbox");
    await mkdir(target);
    await writeFile(path.join(target, "keep.txt"), "x");
    const result = await createInboxFolder({ parent: home }, deps());
    assert.equal(result.ok, true);
    assert.equal(result.created, false);
    assert.ok(existsSync(path.join(target, "keep.txt")));
  });

  it("asks before reusing a folder that holds other JSON; confirmNonEmpty accepts", async () => {
    await mkdir(path.join(home, "PMO-Inbox"));
    const safety = {
      home: "Z:\\nobody",
      sampleJsonFiles: () => [{ name: "a.json", text: "{}" }],
    };
    const asked = await createInboxFolder({ parent: home }, deps({ safety }));
    assert.equal(asked.ok, false);
    assert.equal(asked.needsConfirmation, true);
    const confirmed = await createInboxFolder(
      { parent: home, confirmNonEmpty: true },
      deps({ safety }),
    );
    assert.equal(confirmed.ok, true);
  });

  it("refuses without creating: relative or missing parent, bad body, protected place", async () => {
    for (const bad of [
      undefined,
      {},
      { parent: "relative" },
      { parent: path.join(home, "missing") },
    ]) {
      const result = await createInboxFolder(bad, deps());
      assert.equal(result.ok, false, JSON.stringify(bad));
    }
    const protectedHit = await createInboxFolder(
      { parent: home },
      deps({
        safety: { home: "Z:\\nobody", protectedDirs: [home], sampleJsonFiles: () => [] },
      }),
    );
    assert.equal(protectedHit.ok, false);
    assert.match(protectedHit.reason, /AI OS itself/);
    assert.equal(existsSync(path.join(home, "PMO-Inbox")), false);
  });

  it("is not available when the environment fixes the inbox", async () => {
    const result = await createInboxFolder(
      { parent: home },
      deps({ env: { AI_OS_PMO_INBOX_DIR: inboxDir } }),
    );
    assert.equal(result.ok, false);
    assert.equal(existsSync(path.join(home, "PMO-Inbox")), false);
  });
});
