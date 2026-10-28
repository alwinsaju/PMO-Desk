import { test } from "node:test";
import assert from "node:assert/strict";
import { sizes, windowDefaults } from "./tokens.ts";

test("windows (also maximised ones) clear the command bar and the avatar strip", () => {
  const { bottom } = windowDefaults.insets;
  assert.ok(bottom >= sizes.commandBarReserve + sizes.bottomClearance);
  assert.ok(bottom >= sizes.presenceReserve + sizes.bottomClearance);
});

test("the command bar reserve is its offset plus its height", () => {
  assert.equal(sizes.commandBarReserve, sizes.commandBarOffset + sizes.commandBarHeight);
});
