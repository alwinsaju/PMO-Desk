import assert from "node:assert/strict";
import { test } from "node:test";
import { focusAfterAnswer } from "./answerFocus.ts";

test("focus dropped to the page after an answer goes back to the bar", () => {
  assert.equal(
    focusAfterAnswer({ focusLost: true, previousWasBar: true, previousUsable: true }),
    "bar",
  );
});

test("a question asked from another element returns focus there when it is still usable", () => {
  assert.equal(
    focusAfterAnswer({ focusLost: true, previousWasBar: false, previousUsable: true }),
    "previous",
  );
});

test("a vanished previous element falls back to the bar", () => {
  assert.equal(
    focusAfterAnswer({ focusLost: true, previousWasBar: false, previousUsable: false }),
    "bar",
  );
});

test("focus the person moved on purpose is left alone", () => {
  assert.equal(
    focusAfterAnswer({ focusLost: false, previousWasBar: true, previousUsable: true }),
    "leave",
  );
});
