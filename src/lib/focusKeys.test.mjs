import { test } from "node:test";
import assert from "node:assert/strict";
import {
  firstUsable,
  isFocusBarShortcut,
  trapTarget,
  windowShortcut,
} from "./focusKeys.ts";

test("Ctrl+W closes and Ctrl+M minimises, case-insensitively", () => {
  assert.equal(windowShortcut({ key: "w", ctrlKey: true }), "close");
  assert.equal(windowShortcut({ key: "W", ctrlKey: true }), "close");
  assert.equal(windowShortcut({ key: "m", ctrlKey: true }), "minimize");
});

test("other keys and modifier combinations are ignored", () => {
  assert.equal(windowShortcut({ key: "w" }), null);
  assert.equal(windowShortcut({ key: "x", ctrlKey: true }), null);
  assert.equal(windowShortcut({ key: "w", ctrlKey: true, shiftKey: true }), null);
  assert.equal(windowShortcut({ key: "w", ctrlKey: true, altKey: true }), null);
  assert.equal(windowShortcut({ key: "m", ctrlKey: true, metaKey: true }), null);
});

test("Ctrl+Space focuses the command bar, and only that combination", () => {
  assert.equal(isFocusBarShortcut({ key: " ", ctrlKey: true }), true);
  assert.equal(isFocusBarShortcut({ key: "Spacebar", ctrlKey: true }), true);
  assert.equal(isFocusBarShortcut({ key: " " }), false);
  assert.equal(isFocusBarShortcut({ key: " ", ctrlKey: true, shiftKey: true }), false);
  assert.equal(isFocusBarShortcut({ key: " ", ctrlKey: true, altKey: true }), false);
  assert.equal(isFocusBarShortcut({ key: " ", ctrlKey: true, metaKey: true }), false);
  assert.equal(isFocusBarShortcut({ key: "k", ctrlKey: true }), false);
});

test("firstUsable skips missing and unusable candidates", () => {
  assert.equal(
    firstUsable([null, undefined, "a", "b"], (c) => c === "b"),
    "b",
  );
  assert.equal(
    firstUsable([null, "a"], () => false),
    null,
  );
  assert.equal(
    firstUsable([], () => true),
    null,
  );
});

test("trapTarget cycles forwards and backwards", () => {
  assert.equal(trapTarget(0, 3, false), 1);
  assert.equal(trapTarget(2, 3, false), 0);
  assert.equal(trapTarget(0, 3, true), 2);
  assert.equal(trapTarget(1, 3, true), 0);
});

test("trapTarget enters the trap from outside and handles empty/single traps", () => {
  assert.equal(trapTarget(-1, 3, false), 0);
  assert.equal(trapTarget(-1, 3, true), 2);
  assert.equal(trapTarget(7, 3, false), 0);
  assert.equal(trapTarget(0, 0, false), null);
  assert.equal(trapTarget(0, 1, false), 0);
  assert.equal(trapTarget(0, 1, true), 0);
});
