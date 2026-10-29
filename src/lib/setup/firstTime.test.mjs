// Run with `pnpm test`. The first-time setup marker the installer leaves.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { doneMarker, firstTimePending, parseFirstTime } from "./firstTime.ts";

describe("the first-time setup marker", () => {
  it("is pending when the installer wrote it, and only then", () => {
    assert.deepEqual(parseFirstTime('{"status":"pending"}'), { status: "pending" });
    assert.equal(firstTimePending(parseFirstTime('{"status":"pending"}'), false), true);
    assert.equal(firstTimePending(parseFirstTime(null), false), false);
    assert.equal(firstTimePending(parseFirstTime("not json"), false), false);
    assert.equal(firstTimePending(parseFirstTime('{"status":"other"}'), false), false);
  });

  it("is done once completed, with when", () => {
    const text = doneMarker(new Date("2026-10-29T10:00:00Z"));
    assert.deepEqual(parseFirstTime(text), {
      status: "done",
      completedAt: "2026-10-29T10:00:00.000Z",
    });
    assert.equal(firstTimePending(parseFirstTime(text), false), false);
  });

  it("reads a file with a byte-order mark (Windows editors add one)", () => {
    assert.equal(parseFirstTime('\uFEFF{"status":"pending"}')?.status, "pending");
  });

  it("can be forced to try the page without an install", () => {
    assert.equal(firstTimePending(null, true), true);
    assert.equal(firstTimePending(parseFirstTime(doneMarker(new Date())), true), true);
  });
});
