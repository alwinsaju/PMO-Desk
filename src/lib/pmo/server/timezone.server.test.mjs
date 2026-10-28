// Run with `pnpm test`. D-10 end to end: "today" in the polled state follows the
// configured time zone, and a hand-edited bad zone never takes the state down.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createPmo } from "./create.ts";
import { developerConfig } from "../developerDefaults.ts";
import { previewDue } from "./notify.ts";
import { buildState } from "./state.ts";

let dataDir;
let inboxDir;
let clock;
let pmo;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "pmo-tz-data-"));
  inboxDir = await mkdtemp(path.join(os.tmpdir(), "pmo-tz-inbox-"));
  clock = new Date("2026-10-26T02:00:00.000Z"); // Mon 07:30 IST, Sun 22:00 in New York
  pmo = await createPmo({
    dataDir,
    inboxDir,
    seedConfig: developerConfig(),
    now: () => clock,
  });
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
  await rm(inboxDir, { recursive: true, force: true });
});

const poll = () =>
  buildState(pmo, {
    runtime: async () => ({ state: "stub", model: "stub", message: null }),
    dataDir,
  });
const withZone = async (timeZone) => {
  const config = await pmo.store.loadConfig();
  await pmo.store.saveConfig({ ...config, reminders: { ...config.reminders, timeZone } });
};

describe("today follows reminders.timeZone", () => {
  it("defaults to IST", async () => {
    const state = await poll();
    assert.equal(state.today, "2026-10-26");
    assert.equal(state.needsAttention.badTimeZone, false);
  });

  it("reads the configured zone (New York is still on Sunday)", async () => {
    await withZone("America/New_York");
    const state = await poll();
    assert.equal(state.today, "2026-10-25");
    assert.equal((await previewDue(pmo)).today, "2026-10-25");
    assert.equal(state.needsAttention.badTimeZone, false);
  });

  it("a bad hand-edited zone falls back to IST, flags it, and nothing throws", async () => {
    await withZone("Mars/Olympus");
    const state = await poll();
    assert.equal(state.today, "2026-10-26");
    assert.equal(state.needsAttention.badTimeZone, true);
    assert.equal((await previewDue(pmo)).today, "2026-10-26");
  });
});
