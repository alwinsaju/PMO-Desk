import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filesKey, sampleHint } from "./filesHints.ts";

const press = (key, extra = {}) =>
  filesKey({ key, altKey: false, ctrlKey: false, metaKey: false, ...extra });

describe("filesKey", () => {
  it("maps the keys the list handles", () => {
    assert.equal(press("Backspace"), "up");
    assert.equal(press("ArrowUp", { altKey: true }), "up");
    assert.equal(press("F2"), "rename");
    assert.equal(press("Delete"), "delete");
  });
  it("ignores everything else", () => {
    assert.equal(press("ArrowUp"), null);
    assert.equal(press("Backspace", { ctrlKey: true }), null);
    assert.equal(press("a"), null);
  });
});

describe("sampleHint", () => {
  it("explains every action in plain words", () => {
    for (const action of ["open-file", "rename", "delete", "context-menu"]) {
      assert.match(sampleHint(action), /sample files/);
    }
  });
});
