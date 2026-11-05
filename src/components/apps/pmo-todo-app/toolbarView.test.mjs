// Run with `pnpm test`. The view-models behind the PMO window's top bar: the
// model status chip, the notices under it and the reminders prompt.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildNotices,
  modelStatus,
  offersReminderPrompt,
  proposalWaitNote,
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
    const of = (runtime) =>
      modelStatus(state({ runtime: { model: "m", message: "x", ...runtime } }));
    assert.deepEqual(
      [
        modelStatus(state()).label,
        of({ state: "asleep" }).label,
        of({ state: "loading" }).label,
        of({ state: "working", task: "structure" }).label,
        of({ state: "stub", model: "stub" }).label,
        of({ state: "down" }).label,
        of({ state: "model-missing" }).label,
        of({ state: "unknown", model: null }).label,
      ],
      [
        "Model ready",
        "Model asleep",
        "Loading model…",
        "Working on a message",
        "Test stub",
        "Model not running",
        "Model missing",
        "Model status unknown",
      ],
    );
    assert.deepEqual(
      ["ready", "asleep", "loading", "working", "down"].map((s) => of({ state: s }).tone),
      ["ready", "idle", "waking", "working", "off"],
    );
    // Asleep is the normal idle state: grey, not red, and the dot does not pulse.
    assert.equal(of({ state: "asleep" }).busy, false);
    assert.equal(of({ state: "loading" }).busy, true);
    assert.equal(of({ state: "working" }).busy, true);
  });

  it("names what the model is working on", () => {
    const working = (task) =>
      modelStatus(
        state({ runtime: { state: "working", model: "m", message: null, task } }),
      ).label;
    assert.equal(working("update"), "Working on a reply");
    assert.equal(working("chaser"), "Working on a chaser");
    assert.equal(working("report"), "Working on the report");
    assert.equal(working("command"), "Working on a command");
    assert.equal(working(undefined), "Working on a request");
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

  it("puts the progress and the wake-up hint in the detail", () => {
    const status = modelStatus(
      state({
        runtime: { state: "loading", model: "qwen", message: "Waking." },
        structuring: { ...idle, active: "pr_1", position: 1, total: 3 },
      }),
    );
    assert.equal(status.label, "Loading model…");
    assert.match(status.detail, /qwen/);
    assert.match(status.detail, /first message takes 1-2 minutes longer/);
    assert.match(status.detail, /structuring 1 of 3/);
    assert.equal(status.busy, true);
    assert.equal(status.progress, "Structuring 1 of 3");
    assert.equal(status.chip, "Loading model… · qwen · 1 of 3");
    // One message in the queue: no "1 of 1".
    assert.equal(
      modelStatus(
        state({
          runtime: { state: "working", model: "m", message: null, task: "structure" },
          structuring: { ...idle, active: "pr_1", position: 1, total: 1 },
        }),
      ).chip,
      "Working on a message · m",
    );
    assert.equal(modelStatus(state()).progress, null);
  });

  it("puts the model name on the chip, after the label", () => {
    assert.equal(modelStatus(state()).chip, "Model ready · qwen2.5:7b");
    const of = (runtime) =>
      modelStatus(state({ runtime: { message: null, ...runtime } })).chip;
    assert.equal(
      of({ state: "asleep", model: "gemma4:12b" }),
      "Model asleep · gemma4:12b",
    );
    assert.equal(
      of({ state: "model-missing", model: "gemma4:12b" }),
      "Model missing · gemma4:12b",
    );
    assert.equal(
      of({ state: "down", model: "qwen3.5:4b" }),
      "Model not running · qwen3.5:4b",
    );
    // The label itself is unchanged, and the tooltip detail still names the model.
    assert.equal(modelStatus(state()).label, "Model ready");
    assert.match(modelStatus(state()).detail, /qwen2\.5:7b/);
  });

  it("leaves the model off the chip when there is none to name", () => {
    const of = (runtime) =>
      modelStatus(state({ runtime: { message: null, ...runtime } })).chip;
    assert.equal(of({ state: "unknown", model: null }), "Model status unknown");
    assert.equal(of({ state: "asleep", model: "  " }), "Model asleep");
    assert.equal(of({ state: "asleep" }), "Model asleep");
    // The test stub's "model" is just the word stub.
    assert.equal(of({ state: "stub", model: "stub" }), "Test stub");
  });

  it("an asleep model says it loads on demand, with no warning wording", () => {
    const status = modelStatus(
      state({ runtime: { state: "asleep", model: "gemma4:12b", message: "Asleep." } }),
    );
    assert.equal(status.label, "Model asleep");
    assert.equal(status.chip, "Model asleep · gemma4:12b");
    assert.match(status.detail, /loads when a message needs it/);
    assert.match(status.detail, /first message takes 1-2 minutes longer/);
    assert.doesNotMatch(status.detail + status.label, /cold|not loaded|warning/i);
  });

  it("gives the chip in pieces so the screen can keep the model name whole", () => {
    const asleep = modelStatus(
      state({ runtime: { state: "asleep", model: "qwen3.5:4b", message: null } }),
    );
    assert.deepEqual(asleep.chipParts, {
      label: "Model asleep",
      model: "qwen3.5:4b",
      extra: "",
    });
    const stub = modelStatus(
      state({ runtime: { state: "stub", model: "stub", message: null } }),
    );
    assert.deepEqual(stub.chipParts, { label: "Test stub", model: "", extra: "" });
    const now = Date.parse("2026-10-24T10:00:00Z");
    const ready = modelStatus(
      state({
        runtime: {
          state: "ready",
          model: "m",
          message: null,
          unloadsAt: "2026-10-24T10:01:32Z",
        },
      }),
      now,
    );
    assert.deepEqual(ready.chipParts, {
      label: "Model ready",
      model: "m",
      extra: "1:32",
    });
    // The parts always add up to the chip text.
    for (const status of [asleep, stub, ready]) {
      const { label, model, extra } = status.chipParts;
      assert.equal(status.chip, [label, model, extra].filter(Boolean).join(" · "));
    }
  });

  it("counts down to the unload while the model sits ready", () => {
    const now = Date.parse("2026-10-24T10:00:00Z");
    const ready = (unloadsAt) =>
      modelStatus(
        state({ runtime: { state: "ready", model: "m", message: null, unloadsAt } }),
        now,
      );
    const status = ready("2026-10-24T10:01:32Z");
    assert.equal(status.chip, "Model ready · m · 1:32");
    assert.equal(status.unloadsAt, "2026-10-24T10:01:32Z");
    assert.match(status.detail, /unloads in 1:32/);
    // No deadline, or one that has passed: just the label.
    assert.equal(ready(null).chip, "Model ready · m");
    assert.equal(ready("2026-10-24T09:59:00Z").chip, "Model ready · m");
    // Only a ready model counts down.
    const working = modelStatus(
      state({
        runtime: {
          state: "working",
          model: "m",
          message: null,
          unloadsAt: "2026-10-24T10:01:32Z",
        },
      }),
      now,
    );
    assert.equal(working.unloadsAt, null);
  });
});

describe("buildNotices", () => {
  it("is empty for a healthy system", () => {
    assert.deepEqual(buildNotices(state(), false), []);
  });

  it("flags a bad hand-edited time zone and says which one is in use", () => {
    const notices = buildNotices(
      { ...state(), needsAttention: { badTimeZone: true } },
      false,
    );
    assert.deepEqual(
      notices.map((n) => n.id),
      ["time-zone"],
    );
    assert.equal(notices[0].action, "settings");
    assert.match(notices[0].text, /Asia\/Kolkata/);
    assert.deepEqual(
      buildNotices({ ...state(), needsAttention: { badTimeZone: false } }, false),
      [],
    );
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

  it("mentions a sleeping or waking model only while something waits for it", () => {
    for (const runtimeState of ["asleep", "loading"]) {
      const runtime = {
        state: runtimeState,
        model: "m",
        message: "First message is slower.",
      };
      assert.deepEqual(buildNotices(state({ runtime }), false), []);
      const waiting = buildNotices(
        state({
          runtime,
          structuring: { ...idle, total: 2, position: 1, waiting: 1 },
        }),
        false,
      );
      assert.deepEqual(
        waiting.map((n) => [n.id, n.level, n.text]),
        [["waking", "info", "First message is slower."]],
      );
    }
    // A loaded model needs no notice at all.
    assert.deepEqual(
      buildNotices(
        state({ structuring: { ...idle, total: 2, position: 1, waiting: 1 } }),
        false,
      ),
      [],
    );
  });
});

describe("proposalWaitNote", () => {
  it("explains the wake-up while a message waits, and the outage when paused", () => {
    assert.match(
      proposalWaitNote({ state: "loading" }, null),
      /waking up.*1-2 minutes longer/,
    );
    assert.match(
      proposalWaitNote({ state: "asleep" }, null),
      /asleep.*1-2 minutes longer/,
    );
    assert.equal(
      proposalWaitNote({ state: "ready" }, null),
      "The local model has not finished with this message yet.",
    );
    assert.match(
      proposalWaitNote(
        { state: "asleep" },
        { code: "runtime-down", message: "m", since: "x" },
      ),
      /Waiting for the local model to come back/,
    );
  });

  it("says how many items are ahead in the model queue, only when there are some", () => {
    assert.equal(
      proposalWaitNote({ state: "ready", waitingBehind: 1 }, null),
      "The local model has not finished with this message yet. Waiting behind 1 item.",
    );
    assert.match(
      proposalWaitNote({ state: "asleep", waitingBehind: 3 }, null),
      /waking up\. Waiting behind 3 items\.$/,
    );
    assert.doesNotMatch(
      proposalWaitNote({ state: "ready", waitingBehind: 0 }, null),
      /behind/,
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
