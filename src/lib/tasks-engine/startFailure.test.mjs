// Run with `pnpm test`. The plain-language Tasks engine start failures.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { explainEngineExit, PYTHON_NOT_FOUND_EXIT_CODE } from "./startFailure.ts";

describe("explainEngineExit", () => {
  it("explains exit code 9009 as Python not found, with steps and the raw detail", () => {
    const tail = " Last output:\nPython was not found; run without arguments to install from the Microsoft Store";
    const out = explainEngineExit(PYTHON_NOT_FOUND_EXIT_CODE, tail);
    assert.match(out.reason, /Python was not found/);
    assert.doesNotMatch(out.reason, /9009|exited/);
    assert.ok(out.steps.length >= 3);
    assert.ok(out.steps.some((s) => /reinstall/i.test(s)));
    assert.ok(out.steps.some((s) => /tasks-engine\/\.venv/.test(s)));
    assert.match(out.detail, /exited \(code 9009\)/);
    assert.match(out.detail, /Microsoft Store/);
  });

  it("removes secrets and the user folder from the copied detail", () => {
    const out = explainEngineExit(
      9009,
      " Last output:\nC:\\Users\\jane\\app token=abcdef123456 jane@example.com",
    );
    assert.doesNotMatch(out.detail, /jane|abcdef123456/);
  });

  it("caps the detail length", () => {
    assert.ok(explainEngineExit(9009, "x ".repeat(5000)).detail.length <= 4000);
  });

  it("leaves every other exit code as the old raw message, with no steps", () => {
    const out = explainEngineExit(1, " Last output:\nboom");
    assert.equal(out.reason, "The engine process exited (code 1) before it came up. Last output:\nboom");
    assert.equal(out.steps, undefined);
    assert.equal(out.detail, undefined);
    assert.equal(explainEngineExit(90090, "").steps, undefined);
  });
});
