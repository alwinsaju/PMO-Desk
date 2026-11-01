// Run with `pnpm test`. The staggered list-row entrance helpers.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ROW_ENTER_MAX,
  ROW_ENTER_STEP_MS,
  rowEnterClass,
  rowEnterStyle,
} from "./motion.ts";

describe("row entrance", () => {
  it("staggers the first rows", () => {
    assert.equal(rowEnterClass(0), "anim-row");
    assert.deepEqual(rowEnterStyle(0), { animationDelay: "0ms" });
    assert.deepEqual(rowEnterStyle(3), { animationDelay: `${3 * ROW_ENTER_STEP_MS}ms` });
  });

  it("stops at the cap, so a long list never waits", () => {
    const last = ROW_ENTER_MAX - 1;
    assert.equal(rowEnterClass(last), "anim-row");
    assert.equal(rowEnterClass(ROW_ENTER_MAX), undefined);
    assert.equal(rowEnterStyle(ROW_ENTER_MAX), undefined);
    assert.equal(rowEnterStyle(500), undefined);
  });

  it("ignores a negative index", () => {
    assert.equal(rowEnterClass(-1), undefined);
    assert.equal(rowEnterStyle(-1), undefined);
  });
});
