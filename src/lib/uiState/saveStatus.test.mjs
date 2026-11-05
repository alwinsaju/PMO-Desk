// Run with `pnpm test`. Save status bookkeeping and the restore decision. Pure.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chooseRestoreSource,
  failureFromStatus,
  getSaveStatus,
  isRetryable,
  parseSyncMeta,
  retryDelayMs,
  setSaveStatus,
  subscribeSaveStatus,
} from "./saveStatus.ts";

describe("save status", () => {
  it("starts as saved and notifies only on a real change", () => {
    assert.deepEqual(getSaveStatus("k1"), { state: "saved" });
    let calls = 0;
    const off = subscribeSaveStatus("k1", () => calls++);
    setSaveStatus("k1", { state: "saved" });
    setSaveStatus("k1", { state: "saving" });
    setSaveStatus("k1", { state: "saving" });
    setSaveStatus("k1", { state: "error", failure: "too-large", willRetry: false });
    setSaveStatus("k1", { state: "error", failure: "too-large", willRetry: false });
    assert.equal(calls, 2);
    off();
    setSaveStatus("k1", { state: "saved" });
    assert.equal(calls, 2);
  });

  it("maps HTTP answers to failures", () => {
    assert.equal(failureFromStatus(413), "too-large");
    assert.equal(failureFromStatus(400), "rejected");
    assert.equal(failureFromStatus(403), "rejected");
    assert.equal(failureFromStatus(500), "unreachable");
    assert.equal(failureFromStatus(undefined), "unreachable");
  });

  it("retries only what waiting can fix, with a capped back-off", () => {
    assert.equal(isRetryable("unreachable"), true);
    assert.equal(isRetryable("too-large"), false);
    assert.equal(isRetryable("rejected"), false);
    assert.ok(retryDelayMs(1) > retryDelayMs(0));
    assert.equal(retryDelayMs(50), 60_000);
    assert.equal(retryDelayMs(-1), retryDelayMs(0));
  });
});

describe("chooseRestoreSource", () => {
  const base = {
    hasLocal: true,
    hasServer: true,
    localUnsynced: false,
    localChangedAt: null,
    serverChangedAt: 1000,
  };
  it("uses the server copy normally", () => {
    assert.equal(chooseRestoreSource(base), "server");
  });
  it("uses the local copy when the server has nothing, and the server when local has nothing", () => {
    assert.equal(chooseRestoreSource({ ...base, hasServer: false }), "local");
    assert.equal(chooseRestoreSource({ ...base, hasLocal: false }), "server");
  });
  it("prefers an unconfirmed local copy only when it is newer than the server's", () => {
    const dirty = { ...base, localUnsynced: true };
    assert.equal(chooseRestoreSource({ ...dirty, localChangedAt: 2000 }), "local");
    assert.equal(chooseRestoreSource({ ...dirty, localChangedAt: 500 }), "server");
    assert.equal(chooseRestoreSource({ ...dirty, localChangedAt: 1000 }), "local");
  });
  it("keeps an unconfirmed local copy when the times are unknown", () => {
    const dirty = { ...base, localUnsynced: true, localChangedAt: 5 };
    assert.equal(chooseRestoreSource({ ...dirty, serverChangedAt: null }), "local");
  });
});

describe("parseSyncMeta", () => {
  it("reads good metadata and ignores anything else", () => {
    assert.deepEqual(parseSyncMeta('{"dirty":true,"at":5}'), { dirty: true, at: 5 });
    for (const text of [null, "", "nope", "{}", '{"dirty":1,"at":5}', '{"dirty":true}']) {
      assert.equal(parseSyncMeta(text), null, String(text));
    }
  });
});
