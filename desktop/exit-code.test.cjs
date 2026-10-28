// Run with `pnpm test`. Windows exit-code formatting.
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { describeExitCode } = require("./exit-code.cjs");

describe("describeExitCode", () => {
  it("shows an unsigned 32-bit failure as signed plus hex", () => {
    assert.equal(describeExitCode(4294967295), "-1 (0xFFFFFFFF)");
    assert.equal(describeExitCode(3221225786), "-1073741510 (0xC000013A)");
  });

  it("leaves ordinary codes alone", () => {
    assert.equal(describeExitCode(0), "0");
    assert.equal(describeExitCode(1), "1");
    assert.equal(describeExitCode(2147483647), "2147483647");
    assert.equal(describeExitCode(-1), "-1");
  });

  it("handles the boundary and non-numeric input", () => {
    assert.equal(describeExitCode(2147483648), "-2147483648 (0x80000000)");
    assert.equal(describeExitCode(null), "unknown");
    assert.equal(describeExitCode(undefined), "unknown");
    assert.equal(describeExitCode(Number.NaN), "unknown");
    assert.equal(describeExitCode("1"), "unknown");
  });

  it("does not convert values beyond 32 bits", () => {
    assert.equal(describeExitCode(4294967296), "4294967296");
  });
});
