import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isTypingTarget, listKeyAction } from "./listKeys.ts";

const act = (key, index, count = 5, mods = {}) =>
  listKeyAction({ key, ...mods }, index, count);

describe("listKeyAction", () => {
  it("moves with J/K and the arrows, staying inside the list", () => {
    assert.deepEqual(act("j", 1), { type: "move", index: 2 });
    assert.deepEqual(act("ArrowDown", 4), { type: "move", index: 4 });
    assert.deepEqual(act("k", 1), { type: "move", index: 0 });
    assert.deepEqual(act("ArrowUp", 0), { type: "move", index: 0 });
    assert.deepEqual(act("Home", 3), { type: "move", index: 0 });
    assert.deepEqual(act("End", 1), { type: "move", index: 4 });
  });

  it("enters the list at its first to-do from the list itself", () => {
    assert.deepEqual(act("j", -1), { type: "move", index: 0 });
    assert.deepEqual(act("k", -1), { type: "move", index: 0 });
  });

  it("acts on the focused to-do only", () => {
    assert.deepEqual(act("e", 2), { type: "open" });
    assert.deepEqual(act("Enter", 2), { type: "open" });
    assert.deepEqual(act("d", 2), { type: "done" });
    assert.deepEqual(act("s", 2), { type: "snooze" });
    for (const key of ["e", "Enter", "d", "s"]) assert.equal(act(key, -1), null, key);
  });

  it("ignores other keys, modifier combinations and an empty list", () => {
    assert.equal(act("x", 1), null);
    assert.equal(act("d", 1, 5, { ctrlKey: true }), null);
    assert.equal(act("j", 1, 5, { metaKey: true }), null);
    assert.equal(act("D", 1, 5, { shiftKey: true }), null);
    assert.equal(act("j", 0, 0), null);
  });
});

describe("isTypingTarget", () => {
  it("is true for fields and editable content only", () => {
    assert.equal(isTypingTarget({ tagName: "INPUT" }), true);
    assert.equal(isTypingTarget({ tagName: "textarea" }), true);
    assert.equal(isTypingTarget({ tagName: "SELECT" }), true);
    assert.equal(isTypingTarget({ tagName: "DIV", isContentEditable: true }), true);
    assert.equal(isTypingTarget({ tagName: "ARTICLE" }), false);
    assert.equal(isTypingTarget(null), false);
  });
});
