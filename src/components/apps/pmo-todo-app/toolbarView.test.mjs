// Run with `pnpm test`. The view-models behind the PMO window's top bar: the
// model status chip, the notices under it and the reminders prompt.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildNotices,
  modelStatus,
  offersReminderPrompt,
  reminderStatus,
  scanSummary,
} from "./toolbarView.ts";

const idle = { active: null, position: 0, total: 0, waiting: 0, paused: null };
const ingest = (patch = {}) => ({
  inboxDir: "C:\\inbox",
  inboxExists: true,
  lastScanAt: "2026-10-24T10:00:00Z",
  rejectedFileCount: 0,
  teamsFiltering: false,
  ...patch,
});
const ready = { state: "ready", model: "qwen2.5:7b", message: null };
const state = (patch = {}) => ({
  ingest: ingest(),
  runtime: ready,
  structuring: idle,
  ...patch,
});

describe("modelStatus", () => {
  it("gives a short label and tone per runtime state", () => {
    assert.deepEqual(
      [
        modelStatus(state()).label,
        modelStatus(
          state({ runtime: { state: "cold", model: "m", message: "Loading." } }),
        ).label,
        modelStatus(state({ runtime: { state: "stub", model: "stub", message: "x" } }))
          .label,
        modelStatus(state({ runtime: { state: "down", model: "m", message: "x" } }))
          .label,
        modelStatus(
          state({ runtime: { state: "model-missing", model: "m", message: "x" } }),
        ).label,
        modelStatus(state({ runtime: { state: "unknown", model: null, message: "x" } }))
          .label,
      ],
      [
        "Model ready",
        "Model idle",
        "Test stub",
        "Model not running",
        "Model missing",
        "Model status unknown",
      ],
    );
    assert.equal(modelStatus(state()).tone, "ready");
    assert.equal(
      modelStatus(state({ runtime: { ...ready, state: "down" } })).tone,
      "off",
    );
  });

  it("a paused queue overrides a healthy-looking runtime", () => {
    const paused = { code: "runtime-down", message: "m", since: "x" };
    const status = modelStatus(state({ structuring: { ...idle, paused } }));
    assert.equal(status.label, "Model not running");
    assert.equal(status.busy, false);
    const missing = modelStatus(
      state({ structuring: { ...idle, paused: { ...paused, code: "model-missing" } } }),
    );
    assert.equal(missing.label, "Model missing");
  });

  it("puts the progress and the cold-start hint in the detail, not the label", () => {
    const status = modelStatus(
      state({
        runtime: { state: "cold", model: "qwen", message: "Not loaded yet." },
        structuring: { ...idle, active: "pr_1", position: 1, total: 3 },
      }),
    );
    assert.equal(status.label, "Model idle");
    assert.match(status.detail, /qwen/);
    assert.match(status.detail, /Not loaded yet\./);
    assert.match(status.detail, /structuring 1 of 3/);
    assert.equal(status.busy, true);
    assert.equal(status.progress, "Structuring 1 of 3");
    assert.equal(modelStatus(state()).progress, null);
  });
});

describe("buildNotices", () => {
  it("is empty for a healthy system", () => {
    assert.deepEqual(buildNotices(state(), false), []);
  });

  it("lists attention items before information, with stable ids", () => {
    const notices = buildNotices(
      state({
        ingest: ingest({
          teamsFiltering: true,
          inboxExists: false,
          rejectedFileCount: 2,
        }),
        runtime: { state: "stub", model: "stub", message: "Using the test stub." },
      }),
      true,
    );
    assert.deepEqual(
      notices.map((n) => n.id),
      ["offline", "inbox", "stub", "teams", "rejected"],
    );
    assert.deepEqual(
      notices.map((n) => n.level),
      ["attention", "attention", "info", "info", "info"],
    );
    assert.equal(notices.find((n) => n.id === "teams").action, "settings");
    assert.match(notices.find((n) => n.id === "inbox").text, /C:\\inbox/);
    assert.match(
      notices.find((n) => n.id === "rejected").text,
      /^2 producer files .* were parked/,
    );
  });

  it("does not report a missing inbox before the first scan", () => {
    assert.deepEqual(
      buildNotices(
        state({ ingest: ingest({ inboxExists: false, lastScanAt: null }) }),
        false,
      ),
      [],
    );
  });

  it("explains a paused queue once, counting the item being worked on", () => {
    const paused = { code: "runtime-down", message: "m", since: "x" };
    const notices = buildNotices(
      state({
        runtime: { state: "down", model: "m", message: "Local model not running." },
        structuring: { ...idle, active: "a", waiting: 2, total: 3, position: 1, paused },
      }),
      false,
    );
    assert.deepEqual(
      notices.map((n) => n.id),
      ["paused"],
    );
    assert.match(notices[0].text, /3 items are waiting/);
    const one = buildNotices(
      state({ structuring: { ...idle, waiting: 1, total: 1, paused } }),
      false,
    );
    assert.match(one[0].text, /1 item is waiting/);
  });

  it("shows the runtime's own message when it is down or the model is missing", () => {
    for (const runtimeState of ["down", "model-missing"]) {
      const notices = buildNotices(
        state({ runtime: { state: runtimeState, model: "m", message: "Do the thing." } }),
        false,
      );
      assert.deepEqual(
        notices.map((n) => [n.id, n.text]),
        [["runtime", "Do the thing."]],
      );
    }
  });

  it("mentions a cold model only while something is waiting for it", () => {
    const cold = { state: "cold", model: "m", message: "Not loaded yet." };
    assert.deepEqual(buildNotices(state({ runtime: cold }), false), []);
    const waiting = buildNotices(
      state({
        runtime: cold,
        structuring: { ...idle, total: 2, position: 1, waiting: 1 },
      }),
      false,
    );
    assert.deepEqual(
      waiting.map((n) => n.id),
      ["cold"],
    );
  });
});

describe("scanSummary", () => {
  it("leaves out zero counts", () => {
    assert.equal(
      scanSummary({ ingested: 0, duplicates: 0, filtered: 0, rejected: 0 }),
      "0 new",
    );
    assert.equal(
      scanSummary({ ingested: 3, duplicates: 1, filtered: 2, rejected: 1 }),
      "3 new, 1 duplicate, 2 filtered, 1 unreadable",
    );
  });
});

describe("reminders", () => {
  it("offers the prompt only to a browser tab that has not been asked", () => {
    assert.equal(offersReminderPrompt("default", false), true);
    for (const permission of ["granted", "denied", "unsupported", "unknown"]) {
      assert.equal(offersReminderPrompt(permission, false), false, permission);
    }
    assert.equal(
      offersReminderPrompt("default", true),
      false,
      "the desktop app owns them",
    );
  });

  it("explains each situation in words for Settings", () => {
    assert.equal(reminderStatus("unknown", false, 0), null);
    assert.match(reminderStatus("granted", false, 0).title, /on\.$/);
    assert.match(reminderStatus("default", false, 0).title, /off\.$/);
    assert.match(reminderStatus("denied", false, 3).text, /dock icon \(3\)/);
    assert.doesNotMatch(reminderStatus("denied", false, 0).text, /\(0\)/);
    assert.match(reminderStatus("unsupported", false, 0).title, /cannot show/);
    assert.match(reminderStatus("denied", true, 0).title, /desktop app/);
  });
});
