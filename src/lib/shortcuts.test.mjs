import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allShortcuts, filterShortcuts, SHORTCUT_GROUPS } from "./shortcuts.ts";

describe("shortcut list", () => {
  it("has no repeated key combination and no empty text", () => {
    const keys = allShortcuts().map((s) => s.keys);
    assert.equal(new Set(keys).size, keys.length);
    for (const s of allShortcuts()) {
      assert.ok(s.keys.trim() && s.action.trim());
    }
  });

  it("documents the shortcuts the handlers implement", () => {
    const keys = allShortcuts()
      .map((s) => s.keys)
      .join(" | ");
    for (const expected of [
      "Ctrl+K",
      "Ctrl+Space",
      "Ctrl+Tab",
      "Ctrl+Alt+Left / Right",
      "J / K",
    ]) {
      assert.ok(keys.includes(expected), expected);
    }
  });

  it("filters by any word of the key, the action or the group", () => {
    assert.deepEqual(filterShortcuts("").length, SHORTCUT_GROUPS.length);
    const snap = filterShortcuts("snap");
    assert.ok(
      snap.length >= 1 &&
        snap.every((g) =>
          g.shortcuts.every((s) => /snap/i.test(`${s.keys} ${s.action}`)),
        ),
    );
    assert.equal(filterShortcuts("pmo to-do list").length, 1);
    assert.deepEqual(filterShortcuts("zzzz"), []);
  });
});
