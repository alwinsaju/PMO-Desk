import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FILE_SIZE, MEMORY_SIZE, MODEL_SIZE, formatBytes } from "./format.ts";

const KB = 1024;
const MB = 1024 ** 2;
const GB = 1024 ** 3;

describe("formatBytes", () => {
  it("formats B / KB / MB / GB with the default binary base", () => {
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(2 * KB), "2.0 KB");
    assert.equal(formatBytes(20 * KB), "20 KB");
    assert.equal(formatBytes(5 * MB), "5.0 MB");
    assert.equal(formatBytes(420 * MB), "420 MB");
    assert.equal(formatBytes(8.1 * GB), "8.1 GB");
    assert.equal(formatBytes(12 * GB), "12 GB");
  });

  it("rounds to one decimal under 10 and none from 10", () => {
    assert.equal(formatBytes(1.54 * MB), "1.5 MB");
    assert.equal(formatBytes(9.96 * MB), "10.0 MB");
    assert.equal(formatBytes(10.4 * MB), "10 MB");
    assert.equal(formatBytes(10.6 * MB), "11 MB");
  });

  it("handles zero", () => {
    assert.equal(formatBytes(0), "0 B");
    assert.equal(formatBytes(0, MEMORY_SIZE), "0 MB");
    assert.equal(formatBytes(0, MODEL_SIZE), "0 KB");
  });

  it("is safe for negative, NaN and infinite input", () => {
    assert.equal(formatBytes(-1), "0 B");
    assert.equal(formatBytes(Number.NaN), "0 B");
    assert.equal(formatBytes(Number.POSITIVE_INFINITY), "0 B");
    assert.equal(formatBytes(-1, MODEL_SIZE), "unknown");
    assert.equal(formatBytes(Number.NaN, MEMORY_SIZE), "0 MB");
  });

  it("honours min, max and base", () => {
    assert.equal(formatBytes(500, MODEL_SIZE), "1 KB");
    assert.equal(formatBytes(42_000_000, MODEL_SIZE), "42 MB");
    assert.equal(formatBytes(6_600_000_000, MODEL_SIZE), "6.6 GB");
    assert.equal(formatBytes(100, MEMORY_SIZE), "1 MB");
    assert.equal(formatBytes(3 * GB, FILE_SIZE), "3072.0 MB");
    assert.equal(formatBytes(12 * MB, FILE_SIZE), "12.0 MB");
    assert.equal(formatBytes(20 * KB, FILE_SIZE), "20 KB");
    assert.equal(formatBytes(12 * GB, MEMORY_SIZE), "12.0 GB");
    assert.equal(formatBytes(420 * MB, MEMORY_SIZE), "420 MB");
    assert.equal(formatBytes(8.1 * GB, MEMORY_SIZE), "8.1 GB");
    assert.equal(formatBytes(1000, { base: 1000 }), "1.0 KB");
  });
});
