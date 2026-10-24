// Run with `pnpm test`. The setup screen's wording helpers and its auto-open rule.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatEta,
  formatRate,
  pullDetail,
  shouldAutoOpen,
  skipSignature,
  stateLabel,
  stateTone,
} from "./setupView.ts";

const report = (states, ready = false) => ({
  ready,
  generatedAt: "2026-10-25T10:00:00Z",
  checks: Object.entries(states).map(([id, state]) => ({
    id,
    state,
    required: id !== "outlook",
  })),
});

describe("wording", () => {
  it("labels and tones every state", () => {
    assert.deepEqual(["ok", "attention", "missing", "unknown"].map(stateLabel), [
      "Ready",
      "Check this",
      "Needs action",
      "Not checked",
    ]);
    assert.deepEqual(["ok", "attention", "missing", "unknown"].map(stateTone), [
      "success",
      "warning",
      "danger",
      "neutral",
    ]);
  });

  it("says how long is left in plain words", () => {
    assert.equal(formatEta(null), null);
    assert.equal(formatEta(-1), null);
    assert.equal(formatEta(20), "less than a minute left");
    assert.equal(formatEta(60), "about 1 minute left");
    assert.equal(formatEta(600), "about 10 minutes left");
    assert.equal(formatEta(3 * 3600), "about 3 hours left");
  });

  it("shows the speed, and the whole line for a download", () => {
    assert.equal(formatRate(null), null);
    assert.equal(formatRate(18_000_000), "18 MB/s");
    assert.equal(
      pullDetail({
        completedBytes: 3_200_000_000,
        totalBytes: 12_000_000_000,
        bytesPerSecond: 18_000_000,
        etaSeconds: 490,
      }),
      "3.2 GB of 12 GB · 18 MB/s · about 8 minutes left",
    );
    assert.equal(
      pullDetail({
        completedBytes: 0,
        totalBytes: 0,
        bytesPerSecond: null,
        etaSeconds: null,
      }),
      "",
    );
  });
});

describe("auto-open at launch", () => {
  it("stays closed when everything required is fine, or only optional things are off", () => {
    assert.equal(
      shouldAutoOpen(
        report({ ollama: "ok", model: "ok", outlook: "missing" }, true),
        null,
      ),
      false,
    );
  });

  it("opens when something required is open", () => {
    const open = report({ ollama: "missing", model: "missing", engine: "ok" });
    assert.equal(shouldAutoOpen(open, null), true);
    assert.equal(skipSignature(open), "model,ollama");
  });

  it("stays closed after Not now for exactly this list, and asks again when the list changes", () => {
    const open = report({ ollama: "missing", model: "missing" });
    assert.equal(shouldAutoOpen(open, "model,ollama"), false);
    assert.equal(shouldAutoOpen(open, "ollama"), true);
    assert.equal(
      shouldAutoOpen(report({ model: "missing", ollama: "ok" }), "model,ollama"),
      true,
    );
  });

  it("does not open for a report that is only 'attention'", () => {
    assert.equal(
      shouldAutoOpen(report({ ollama: "attention", model: "ok" }, true), null),
      false,
    );
  });
});
