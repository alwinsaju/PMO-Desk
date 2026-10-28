const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { createLogWriter, rotateFiles } = require("./log-rotate.cjs");

function fakeFs(initial = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    existsSync: (f) => files.has(f),
    statSync: (f) => {
      if (!files.has(f)) throw new Error("ENOENT");
      return { size: Buffer.byteLength(files.get(f)) };
    },
    appendFileSync: (f, t) => files.set(f, (files.get(f) ?? "") + t),
    renameSync: (a, b) => {
      files.set(b, files.get(a));
      files.delete(a);
    },
    unlinkSync: (f) => files.delete(f),
  };
}

const clock = () => new Date("2026-10-28T10:00:00.000Z");

describe("rotateFiles", () => {
  it("shifts the numbered files and drops the oldest", () => {
    const fs = fakeFs({ log: "cur", "log.1": "one", "log.2": "two", "log.3": "three" });
    rotateFiles("log", fs, 3);
    assert.deepEqual([...fs.files.entries()].sort(), [
      ["log.1", "cur"],
      ["log.2", "one"],
      ["log.3", "two"],
    ]);
  });

  it("copes with missing files", () => {
    const fs = fakeFs({ log: "cur" });
    rotateFiles("log", fs, 3);
    assert.deepEqual([...fs.files.keys()], ["log.1"]);
  });
});

describe("createLogWriter", () => {
  it("appends timestamped lines", () => {
    const fs = fakeFs();
    const w = createLogWriter({ file: "log", fs, now: clock });
    w.write("hello");
    assert.equal(fs.files.get("log"), "[2026-10-28T10:00:00.000Z] hello\n");
  });

  it("rotates before the file would exceed the limit, keeping 3 old files", () => {
    const fs = fakeFs();
    const w = createLogWriter({ file: "log", fs, now: clock, maxBytes: 100, keep: 3 });
    for (let i = 0; i < 20; i++) w.write(`message number ${i}`);
    assert.ok(Buffer.byteLength(fs.files.get("log")) <= 100);
    assert.ok(fs.files.has("log.1") && fs.files.has("log.2") && fs.files.has("log.3"));
    assert.equal(fs.files.has("log.4"), false);
    assert.match(fs.files.get("log"), /message number 19/);
  });

  it("starts from the size of an existing file", () => {
    const fs = fakeFs({ log: "x".repeat(95) });
    const w = createLogWriter({ file: "log", fs, now: clock, maxBytes: 100 });
    w.write("new");
    assert.equal(fs.files.get("log.1"), "x".repeat(95));
    assert.match(fs.files.get("log"), /new/);
  });

  it("folds consecutive identical messages into one summary line", () => {
    const fs = fakeFs();
    const w = createLogWriter({ file: "log", fs, now: clock });
    for (let i = 0; i < 5; i++) w.write("font warning");
    w.write("something else");
    const lines = fs.files.get("log").trim().split("\n");
    assert.equal(lines.length, 3);
    assert.match(lines[1], /repeated 4 times/);
    assert.match(lines[2], /something else/);
  });

  it("flush writes a pending summary and is a no-op otherwise", () => {
    const fs = fakeFs();
    const w = createLogWriter({ file: "log", fs, now: clock });
    w.flush();
    assert.equal(fs.files.has("log"), false);
    w.write("a");
    w.write("a");
    w.flush();
    w.flush();
    assert.equal(fs.files.get("log").trim().split("\n").length, 2);
  });

  it("never throws when the file system fails", () => {
    const fs = fakeFs();
    fs.appendFileSync = () => {
      throw new Error("EPERM");
    };
    const w = createLogWriter({ file: "log", fs, now: clock });
    assert.doesNotThrow(() => w.write("x"));
    assert.doesNotThrow(() => w.flush());
  });
});
