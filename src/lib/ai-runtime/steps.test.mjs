import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planText, splitSteps } from "./steps.ts";
import { resolveLocalIntent } from "./localIntent.ts";
import { resolvePmoIntent } from "./pmoIntent.ts";
import { resolveOpenIntent } from "./windowIntent.ts";

const understood = (step) =>
  Boolean(resolveOpenIntent(step) || resolvePmoIntent(step) || resolveLocalIntent(step));

describe("splitSteps", () => {
  it("splits a chain of understood commands", () => {
    assert.deepEqual(splitSteps("open tasks, then what's overdue?", understood), [
      "open tasks",
      "what's overdue?",
    ]);
    assert.deepEqual(
      splitSteps(
        "open dashboard and then who's off today and then open notes",
        understood,
      ),
      ["open dashboard", "who's off today", "open notes"],
    );
  });

  it("is not a chain when a part is not understood, or there is only one part", () => {
    assert.equal(splitSteps("open tasks then do my taxes", understood), null);
    assert.equal(splitSteps("open tasks", understood), null);
    assert.equal(splitSteps("", understood), null);
  });

  it("refuses a chain longer than three steps", () => {
    assert.equal(
      splitSteps(
        "open notes then open files then open tasks then open dashboard",
        understood,
      ),
      null,
    );
  });

  it("writes the plan out", () => {
    assert.equal(
      planText(["open tasks", "what's overdue?"]),
      "Plan: 1. open tasks  2. what's overdue?",
    );
  });
});
