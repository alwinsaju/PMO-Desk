// Run with `pnpm test`. The restart single-flight guard.
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { createSingleFlight } = require("./single-flight.cjs");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createSingleFlight", () => {
  it("runs the task once and lets a second caller join it", async () => {
    const gate = createSingleFlight();
    const work = deferred();
    let starts = 0;
    const first = gate.run(() => {
      starts += 1;
      return work.promise;
    });
    const second = gate.run(() => {
      starts += 1;
      return work.promise;
    });
    assert.equal(first.joined, false);
    assert.equal(second.joined, true);
    assert.equal(gate.busy, true);
    work.resolve("done");
    assert.equal(await first.result, "done");
    assert.equal(await second.result, "done");
    assert.equal(starts, 1);
  });

  it("is free again (before the caller resumes) once the task settles", async () => {
    const gate = createSingleFlight();
    await gate.run(async () => "a").result;
    assert.equal(gate.busy, false);
    const next = gate.run(async () => "b");
    assert.equal(next.joined, false);
    assert.equal(await next.result, "b");
  });

  it("is free again after a failure, and the failure reaches every caller", async () => {
    const gate = createSingleFlight();
    const work = deferred();
    const first = gate.run(() => work.promise);
    const second = gate.run(() => work.promise);
    work.reject(new Error("boom"));
    await assert.rejects(first.result, /boom/);
    await assert.rejects(second.result, /boom/);
    assert.equal(gate.busy, false);
    assert.equal(gate.run(async () => 1).joined, false);
  });

  it("a synchronous throw in the task is a rejection, not a stuck gate", async () => {
    const gate = createSingleFlight();
    await assert.rejects(
      gate.run(() => {
        throw new Error("sync");
      }).result,
      /sync/,
    );
    assert.equal(gate.busy, false);
  });
});
