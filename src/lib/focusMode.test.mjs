import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clampMinutes,
  DEFAULT_FOCUS_MINUTES,
  focusEnd,
  isFocusActive,
  MAX_FOCUS_MINUTES,
  parseFocusCommand,
  remainingText,
} from "./focusMode.ts";

describe("focus mode clock", () => {
  it("clamps the length to 1 to 240 whole minutes", () => {
    assert.equal(clampMinutes(25), 25);
    assert.equal(clampMinutes(0), 1);
    assert.equal(clampMinutes(9999), MAX_FOCUS_MINUTES);
    assert.equal(clampMinutes(12.6), 13);
    assert.equal(clampMinutes(NaN), DEFAULT_FOCUS_MINUTES);
  });

  it("is active until the end time", () => {
    const end = focusEnd(1_000, 10);
    assert.equal(end, 1_000 + 600_000);
    assert.equal(isFocusActive(end, end - 1), true);
    assert.equal(isFocusActive(end, end), false);
    assert.equal(isFocusActive(null, 0), false);
  });

  it("says how long is left", () => {
    assert.equal(remainingText(600_000, 0), "10 min left");
    assert.equal(remainingText(600_000, 599_000), "less than a minute left");
    assert.equal(remainingText(600_000, 600_000), "");
    assert.equal(remainingText(null, 0), "");
  });
});

describe("parseFocusCommand", () => {
  it("starts with the default or a stated length", () => {
    assert.equal(parseFocusCommand("focus"), DEFAULT_FOCUS_MINUTES);
    assert.equal(parseFocusCommand("Focus mode"), DEFAULT_FOCUS_MINUTES);
    assert.equal(parseFocusCommand("focus for 40 minutes"), 40);
    assert.equal(parseFocusCommand("start focus mode for 2 hours"), 120);
    assert.equal(parseFocusCommand("focus for 90m"), 90);
  });

  it("stops, and leaves other text alone", () => {
    assert.equal(parseFocusCommand("stop focus mode"), 0);
    assert.equal(parseFocusCommand("end focus"), 0);
    for (const text of ["focus on the report", "refocus", "who's off?", ""]) {
      assert.equal(parseFocusCommand(text), null, text);
    }
  });
});
