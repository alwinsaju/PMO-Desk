import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { appendJsonlRotating, rotateIfLarge, rotatedName } from "./fsx.ts";

let dir;
let file;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "aios-fsx-"));
  file = path.join(dir, "audit.jsonl");
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const names = async () => (await readdir(dir)).sort();

describe("rotatedName", () => {
  it("puts the number before the extension", () => {
    assert.equal(rotatedName("/x/audit.jsonl", 1), "/x/audit.1.jsonl");
    assert.equal(rotatedName("/x/log", 2), "/x/log.2");
  });
});

describe("rotateIfLarge", () => {
  it("leaves a small or missing file alone", async () => {
    assert.equal(await rotateIfLarge(file, 10, 2), false);
    await writeFile(file, "abc");
    assert.equal(await rotateIfLarge(file, 10, 2), false);
    assert.deepEqual(await names(), ["audit.jsonl"]);
  });

  it("shifts files and keeps only `keep` old ones", async () => {
    await writeFile(file, "current-xxxxxx");
    await writeFile(rotatedName(file, 1), "one");
    await writeFile(rotatedName(file, 2), "two");
    assert.equal(await rotateIfLarge(file, 10, 2), true);
    assert.deepEqual(await names(), ["audit.1.jsonl", "audit.2.jsonl"]);
    assert.equal(await readFile(rotatedName(file, 1), "utf8"), "current-xxxxxx");
    assert.equal(await readFile(rotatedName(file, 2), "utf8"), "one");
  });
});

describe("appendJsonlRotating", () => {
  it("rotates once the file is full and keeps every line in order", async () => {
    for (let i = 0; i < 6; i++) await appendJsonlRotating(file, { i }, 10, 2);
    const all = [];
    for (const n of ["audit.2.jsonl", "audit.1.jsonl", "audit.jsonl"]) {
      const text = await readFile(path.join(dir, n), "utf8").catch(() => "");
      all.push(
        ...text
          .split("\n")
          .filter(Boolean)
          .map((l) => JSON.parse(l).i),
      );
    }
    assert.deepEqual(await names(), ["audit.1.jsonl", "audit.2.jsonl", "audit.jsonl"]);
    assert.deepEqual(
      all,
      [...all].sort((a, b) => a - b),
    );
    assert.equal(all.at(-1), 5);
  });

  it("does not lose lines when many appends race", async () => {
    await Promise.all(
      Array.from({ length: 30 }, (_, i) => appendJsonlRotating(file, { i }, 40, 100)),
    );
    let count = 0;
    for (const n of await names()) {
      count += (await readFile(path.join(dir, n), "utf8"))
        .split("\n")
        .filter(Boolean).length;
    }
    assert.equal(count, 30);
  });
});
