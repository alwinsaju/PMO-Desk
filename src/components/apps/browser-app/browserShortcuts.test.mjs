import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { browserShortcut } from "./browserShortcuts.ts";

const press = (key, mods = {}) =>
  browserShortcut({
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  });

describe("browserShortcut", () => {
  it("maps the usual browser keys", () => {
    assert.equal(press("l", { ctrlKey: true }), "focus-address");
    assert.equal(press("L", { ctrlKey: true }), "focus-address");
    assert.equal(press("ArrowLeft", { altKey: true }), "back");
    assert.equal(press("ArrowRight", { altKey: true }), "forward");
    assert.equal(press("F5"), "reload");
    assert.equal(press("r", { ctrlKey: true }), "reload");
    assert.equal(press("t", { ctrlKey: true }), "new-tab");
    assert.equal(press("w", { ctrlKey: true }), "close-tab");
    assert.equal(press("PageDown", { ctrlKey: true }), "next-tab");
    assert.equal(press("PageUp", { ctrlKey: true }), "previous-tab");
  });

  it("leaves other keys, Ctrl+Tab and shifted or alt-combined presses alone", () => {
    assert.equal(press("Tab", { ctrlKey: true }), null);
    assert.equal(press("l"), null);
    assert.equal(press("ArrowLeft"), null);
    assert.equal(press("ArrowLeft", { altKey: true, ctrlKey: true }), null);
    assert.equal(press("t", { ctrlKey: true, shiftKey: true }), null);
    assert.equal(press("l", { ctrlKey: true, altKey: true }), null);
  });
});
