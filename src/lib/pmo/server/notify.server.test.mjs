// Run with `pnpm test`. Reminder delivery on a throwaway data dir and a fake
// clock: claim/ack semantics (no double delivery, expiry after a crash), the
// desktop-owns-claims rule, snooze through the PATCH action, the preferences
// in config.json and the desktop prefs file. Nothing here touches the real
// data, the network or Ollama.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createManualTodo, patchTodo, updateConfig } from "./actions.ts";
import { createPmo } from "./create.ts";
import {
  CLAIM_TTL_MS,
  acknowledgeDue,
  claimDue,
  previewDue,
  remindersOwnedByDesktop,
} from "./notify.ts";
import { emptyDraft } from "../todoLogic.ts";
import { PmoConfigSchema } from "../types.ts";
import { syncDesktopPrefs } from "./desktopPrefs.ts";

const ist = (stamp) => new Date(`${stamp}:00+05:30`);
const noModel = { model: () => "none", generate: async () => ({}) };

let dataDir;
let inboxDir;
let clock;
let pmo;

const addTodo = async (patch = {}) => {
  const reply = await createManualTodo(pmo, {
    draft: { ...emptyDraft(patch.title ?? "Fictional task"), ...patch },
  });
  assert.equal(reply.ok, true);
  return reply.todo;
};
const keys = (list) => list.map((n) => n.key).sort();

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "pmo-notify-"));
  inboxDir = await mkdtemp(path.join(os.tmpdir(), "pmo-notify-inbox-"));
  clock = ist("2026-10-26T10:00"); // Monday
  pmo = await createPmo({ dataDir, inboxDir, generator: noModel, now: () => clock });
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
  await rm(inboxDir, { recursive: true, force: true });
});

describe("claim and acknowledge", () => {
  it("previews without recording anything", async () => {
    await addTodo({ title: "Late", dueAt: "2026-10-20" });
    const first = await previewDue(pmo);
    assert.equal(first.pending.length, 1);
    assert.equal(first.attention.count, 1);
    assert.equal(first.prefs.hideDetails, true);
    assert.equal((await previewDue(pmo)).pending.length, 1);
    assert.deepEqual((await pmo.store.loadNotify()).claims, {});
  });

  it("gives two simultaneous claimants disjoint sets: nothing is delivered twice", async () => {
    await addTodo({ title: "Late A", dueAt: "2026-10-20" });
    await addTodo({ title: "Late B", dueAt: "2026-10-21" });
    const [one, two] = await Promise.all([
      claimDue(pmo, { client: "desktop" }),
      claimDue(pmo, { client: "web:tab1" }),
    ]);
    const all = [...one.notifications, ...two.notifications];
    assert.equal(all.length, 2);
    assert.equal(new Set(all.map((n) => n.key)).size, 2);
    // One claimant got everything; the other got nothing.
    assert.deepEqual([one.notifications.length, two.notifications.length].sort(), [0, 2]);
  });

  it("returns a privacy-safe toast and the claim id", async () => {
    await addTodo({ title: "Client X sign-off", dueAt: "2026-10-20" });
    const claim = await claimDue(pmo, { client: "desktop" });
    assert.match(claim.claimId, /^cl_/);
    assert.equal(claim.toast.title, "PMO To-Do: 1 item needs attention");
    assert.equal(claim.toast.body, "");
    assert.doesNotMatch(JSON.stringify(claim.toast), /Client X/);
    assert.equal(claim.notifications[0].title, "Client X sign-off");
  });

  it("does not hand out a claimed-but-unacknowledged reminder until the claim expires", async () => {
    await addTodo({ dueAt: "2026-10-20" });
    const first = await claimDue(pmo, { client: "desktop" });
    assert.equal(first.notifications.length, 1);

    assert.equal((await claimDue(pmo, { client: "web" })).notifications.length, 0);
    assert.equal((await previewDue(pmo)).pending.length, 0);

    clock = new Date(clock.getTime() + CLAIM_TTL_MS - 1_000);
    assert.equal((await claimDue(pmo, { client: "web" })).notifications.length, 0);

    clock = new Date(clock.getTime() + 2_000); // past the TTL: the client crashed
    const retry = await claimDue(pmo, { client: "web" });
    assert.deepEqual(keys(retry.notifications), keys(first.notifications));
    assert.notEqual(retry.claimId, first.claimId);
  });

  it("never re-delivers once acknowledged, even long after", async () => {
    await addTodo({ dueAt: "2026-10-20" });
    const claim = await claimDue(pmo, { client: "desktop" });
    assert.deepEqual(await acknowledgeDue(pmo, { claimId: claim.claimId }), {
      acknowledged: 1,
    });
    // Same day, hours later and after the TTL: delivered stays delivered.
    clock = new Date(clock.getTime() + 5 * CLAIM_TTL_MS);
    assert.equal((await claimDue(pmo, { client: "desktop" })).notifications.length, 0);
    const state = await pmo.store.loadNotify();
    assert.equal(Object.keys(state.delivered).length, 1);
    assert.equal(Object.keys(state.claims).length, 0);
    // Acknowledging again (or a nonsense id) is harmless.
    assert.deepEqual(await acknowledgeDue(pmo, { claimId: claim.claimId }), {
      acknowledged: 0,
    });
    assert.deepEqual(await acknowledgeDue(pmo, { claimId: 42 }), { acknowledged: 0 });
    assert.deepEqual(await acknowledgeDue(pmo, undefined), { acknowledged: 0 });
  });

  it("fires again the next working day (new key), not on the weekend", async () => {
    await addTodo({ dueAt: "2026-10-20" });
    const monday = await claimDue(pmo, { client: "desktop" });
    await acknowledgeDue(pmo, { claimId: monday.claimId });
    clock = ist("2026-10-27T09:30");
    const tuesday = await claimDue(pmo, { client: "desktop" });
    assert.equal(tuesday.notifications.length, 1);
    await acknowledgeDue(pmo, { claimId: tuesday.claimId });
    clock = ist("2026-10-31T10:00"); // Saturday
    assert.equal((await claimDue(pmo, { client: "desktop" })).notifications.length, 0);
  });

  it("claims nothing when nothing is due, and records nothing", async () => {
    await addTodo({ dueAt: "2026-12-25" });
    const claim = await claimDue(pmo, { client: "desktop" });
    assert.deepEqual(
      { id: claim.claimId, n: claim.notifications.length, toast: claim.toast },
      { id: null, n: 0, toast: null },
    );
  });

  it("honours a snooze set through the PATCH action, without touching updatedAt", async () => {
    const todo = await addTodo({ dueAt: "2026-10-20", waitingOn: "Sam Example" });
    const until = ist("2026-10-26T14:00").toISOString();
    const reply = await patchTodo(pmo, todo.id, { snoozedUntil: until });
    assert.equal(reply.ok, true);
    assert.equal(reply.todo.reminders.snoozedUntil, until);
    assert.equal(reply.todo.updatedAt, todo.updatedAt);
    assert.equal((await claimDue(pmo, { client: "desktop" })).notifications.length, 0);
    assert.equal((await previewDue(pmo)).attention.count, 0);

    clock = ist("2026-10-26T14:05");
    assert.ok((await claimDue(pmo, { client: "desktop" })).notifications.length >= 1);
  });

  it("ignores a client name that is not plain text", async () => {
    await addTodo({ dueAt: "2026-10-20" });
    await claimDue(pmo, { client: "<script>" });
    const [claim] = Object.values((await pmo.store.loadNotify()).claims);
    assert.equal(claim.client, "unknown");
  });

  it("starts over on a corrupt notify.json instead of failing", async () => {
    await addTodo({ dueAt: "2026-10-20" });
    await writeFile(pmo.store.paths.notify, "{ not json");
    assert.equal((await claimDue(pmo, { client: "desktop" })).notifications.length, 1);
  });
});

describe("who may claim", () => {
  const headers = (map) => ({ get: (name) => map[name.toLowerCase()] ?? null });

  it("lets browser tabs claim outside the desktop shell", () => {
    assert.equal(remindersOwnedByDesktop(headers({}), {}), false);
    assert.equal(
      remindersOwnedByDesktop(headers({}), { AI_OS_DESKTOP_MODE: "0" }),
      false,
    );
  });

  it("reserves claims for the shell (x-ai-os-desktop: 1) when the server is the shell's", () => {
    const env = { AI_OS_DESKTOP_MODE: "1" };
    assert.equal(remindersOwnedByDesktop(headers({}), env), true);
    assert.equal(remindersOwnedByDesktop(headers({ "x-ai-os-desktop": "0" }), env), true);
    assert.equal(
      remindersOwnedByDesktop(headers({ "x-ai-os-desktop": "1" }), env),
      false,
    );
  });
});

describe("reminder preferences", () => {
  it("default into config.json, and an old config without them still loads", async () => {
    const config = await pmo.store.loadConfig();
    assert.equal(config.reminders.timeZone, "Asia/Kolkata");
    assert.equal(config.reminders.hideDetails, true);
    assert.equal(PmoConfigSchema.parse({ retentionDays: 30 }).reminders.chaserDays, 2);
  });

  it("falls back to defaults for the reminders block only when it is malformed", async () => {
    await writeFile(
      pmo.store.paths.config,
      JSON.stringify({ retentionDays: 30, reminders: { workStart: "late" } }),
    );
    const config = await pmo.store.loadConfig();
    assert.equal(config.retentionDays, 30);
    assert.equal(config.reminders.workStart, "09:00");
  });

  const edit = (patch = {}) => ({
    reminders: {
      enabled: true,
      timeZone: "Asia/Kolkata",
      workStart: "09:00",
      workEnd: "18:00",
      workDays: [1, 2, 3, 4, 5],
      quietOutsideHours: true,
      chaserDays: 2,
      digest: false,
      hideDetails: true,
      keepRunningInTray: false,
      ...patch,
    },
  });

  it("saves through the config action and changes what is delivered", async () => {
    await addTodo({ title: "Visible title", dueAt: "2026-10-20" });
    const saved = await updateConfig(pmo, edit({ hideDetails: false }));
    assert.equal(saved.ok, true);
    assert.equal((await pmo.store.loadConfig()).reminders.hideDetails, false);
    const claim = await claimDue(pmo, { client: "desktop" });
    assert.equal(claim.toast.title, "Visible title");
  });

  it("refuses bad values with a reason", async () => {
    for (const patch of [
      { timeZone: "Mars/Olympus" },
      { workStart: "18:00", workEnd: "09:00" },
      { workStart: "9am" },
      { chaserDays: 0 },
      { workDays: [] },
    ]) {
      const reply = await updateConfig(pmo, edit(patch));
      assert.equal(reply.ok, false, JSON.stringify(patch));
      assert.match(reply.reason, /reminders/);
    }
  });

  it("turning the master switch off silences everything", async () => {
    await addTodo({ dueAt: "2026-10-20" });
    await updateConfig(pmo, edit({ enabled: false }));
    assert.equal((await claimDue(pmo, { client: "desktop" })).notifications.length, 0);
  });
});

describe("the desktop prefs file", () => {
  it("mirrors the tray setting for the shell, and does nothing without the env var", async () => {
    const file = path.join(dataDir, "desktop-prefs.json");
    const env = { AI_OS_DESKTOP_PREFS_FILE: file };
    const config = await pmo.store.loadConfig();
    await syncDesktopPrefs(config, {});
    await assert.rejects(readFile(file));
    await syncDesktopPrefs(config, env);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), {
      keepRunningInTray: false,
    });
    await syncDesktopPrefs(
      { reminders: { ...config.reminders, keepRunningInTray: true } },
      env,
    );
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), {
      keepRunningInTray: true,
    });
  });
});
