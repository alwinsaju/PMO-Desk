import assert from "node:assert/strict";
import test from "node:test";
import { TITLE_MAX, titleCounter } from "./titleLimit.ts";

test("title counter appears only near the limit", () => {
  assert.equal(TITLE_MAX, 200);
  assert.equal(titleCounter(0), null);
  assert.equal(titleCounter(159), null);
  assert.equal(titleCounter(160), "160 / 200");
  assert.equal(titleCounter(200), "200 / 200");
});
