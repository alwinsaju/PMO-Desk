// Run with `pnpm test`. The toast queue and notification history.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearHistory,
  DEFAULT_TOAST_MS,
  dismissToast,
  EMPTY_TOAST_STATE,
  LONG_TOAST_MS,
  MAX_HISTORY,
  MAX_MESSAGE_LENGTH,
  MAX_VISIBLE_TOASTS,
  pushToast,
  resolveDuration,
} from "./toasts.ts";

const push = (state, input, now = 1_000) => pushToast(state, input, now);

describe("pushToast", () => {
  it("adds a toast with defaults and records it in the history", () => {
    const state = push(EMPTY_TOAST_STATE, { message: "Saved" }, 42);
    assert.equal(state.toasts.length, 1);
    assert.deepEqual(
      { message: state.toasts[0].message, tone: state.toasts[0].tone },
      { message: "Saved", tone: "info" },
    );
    assert.equal(state.toasts[0].durationMs, DEFAULT_TOAST_MS);
    assert.deepEqual(state.history, [{ id: 1, message: "Saved", tone: "info", at: 42 }]);
  });

  it("ignores an empty message and tidies whitespace", () => {
    assert.equal(push(EMPTY_TOAST_STATE, { message: "   " }), EMPTY_TOAST_STATE);
    assert.equal(
      push(EMPTY_TOAST_STATE, { message: " a \n  b " }).toasts[0].message,
      "a b",
    );
  });

  it("shortens a very long message", () => {
    const state = push(EMPTY_TOAST_STATE, {
      message: "x".repeat(MAX_MESSAGE_LENGTH + 50),
    });
    assert.equal(state.toasts[0].message.length, MAX_MESSAGE_LENGTH);
    assert.ok(state.toasts[0].message.endsWith("…"));
  });

  it("replaces an earlier toast that has the same key", () => {
    let state = push(EMPTY_TOAST_STATE, { message: "Preparing…", key: "prepare" });
    state = push(state, { message: "Other" });
    state = push(state, { message: "Prepared", key: "prepare" });
    assert.deepEqual(
      state.toasts.map((t) => t.message),
      ["Other", "Prepared"],
    );
    assert.equal(state.history.length, 3);
  });

  it("shows at most four, dropping the oldest, and keeps the history capped", () => {
    let state = EMPTY_TOAST_STATE;
    for (let i = 0; i < MAX_HISTORY + 5; i++) state = push(state, { message: `m${i}` });
    assert.equal(state.toasts.length, MAX_VISIBLE_TOASTS);
    assert.equal(state.toasts.at(-1).message, `m${MAX_HISTORY + 4}`);
    assert.equal(state.history.length, MAX_HISTORY);
    assert.equal(state.history[0].message, "m5");
  });

  it("gives every toast its own id", () => {
    const state = push(push(EMPTY_TOAST_STATE, { message: "a" }), { message: "b" });
    assert.notEqual(state.toasts[0].id, state.toasts[1].id);
  });
});

describe("quiet mode (focus)", () => {
  it("keeps a notice in the history only, but still shows errors", () => {
    const quiet = pushToast(EMPTY_TOAST_STATE, { message: "Saved" }, 5, true);
    assert.deepEqual(quiet.toasts, []);
    assert.equal(quiet.history.length, 1);
    assert.equal(quiet.nextId, 2);
    const error = pushToast(quiet, { message: "Failed", tone: "danger" }, 6, true);
    assert.equal(error.toasts.length, 1);
    assert.equal(error.history.length, 2);
  });
});

describe("resolveDuration", () => {
  it("keeps errors and toasts with an action up longer, and honours an explicit time", () => {
    assert.equal(resolveDuration({ message: "x" }), DEFAULT_TOAST_MS);
    assert.equal(resolveDuration({ message: "x", tone: "danger" }), LONG_TOAST_MS);
    assert.equal(
      resolveDuration({ message: "x", action: { label: "Undo", run() {} } }),
      LONG_TOAST_MS,
    );
    assert.equal(resolveDuration({ message: "x", durationMs: 0 }), 0);
    assert.equal(resolveDuration({ message: "x", durationMs: -5 }), DEFAULT_TOAST_MS);
  });
});

describe("dismissToast and clearHistory", () => {
  it("removes only the toast asked for, leaving the history", () => {
    const state = push(push(EMPTY_TOAST_STATE, { message: "a" }), { message: "b" });
    const after = dismissToast(state, state.toasts[0].id);
    assert.deepEqual(
      after.toasts.map((t) => t.message),
      ["b"],
    );
    assert.equal(after.history.length, 2);
  });

  it("returns the same state when there is nothing to do", () => {
    const state = push(EMPTY_TOAST_STATE, { message: "a" });
    assert.equal(dismissToast(state, 999), state);
    assert.equal(clearHistory(EMPTY_TOAST_STATE), EMPTY_TOAST_STATE);
    assert.deepEqual(clearHistory(state).history, []);
  });
});
