// Run with `pnpm test`. Which Ollama log may be read, and how much of it.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SERVER_LOG_MAX_BYTES,
  SERVER_LOG_MAX_LINES,
  SERVER_LOG_MAX_LINE_CHARS,
  ownedLogPath,
  readServerLogTail,
  resolveServerLog,
} from "./serverLog.ts";

const win = { platform: "win32", tmpDir: "C:\\Users\\me\\AppData\\Local\\Temp" };

describe("which log", () => {
  it("is AI OS's own file when AI OS started Ollama", () => {
    const source = resolveServerLog({ ...win, owned: true, env: {} });
    assert.equal(source.kind, "owned");
    assert.equal(source.path, "C:\\Users\\me\\AppData\\Local\\Temp\\ai-os-ollama.log");
    assert.equal(source.path, ownedLogPath(win.tmpDir, "win32"));
  });

  it("is the tray app's server.log for a shared Ollama on Windows", () => {
    const source = resolveServerLog({
      ...win,
      owned: false,
      env: { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" },
    });
    assert.equal(source.kind, "external");
    assert.equal(source.path, "C:\\Users\\me\\AppData\\Local\\Ollama\\server.log");
    // Env names are case-insensitive on Windows.
    assert.equal(
      resolveServerLog({ ...win, owned: false, env: { LocalAppData: "D:\\L" } }).path,
      "D:\\L\\Ollama\\server.log",
    );
  });

  it("is a fixed path: nothing from a request can change it", () => {
    // resolveServerLog takes no request data at all; its whole input is listed here.
    const a = resolveServerLog({ ...win, owned: false, env: { LOCALAPPDATA: "C:\\L" } });
    const b = resolveServerLog({ ...win, owned: false, env: { LOCALAPPDATA: "C:\\L" } });
    assert.deepEqual(a, b);
    assert.equal(/\.\./.test(a.path), false);
  });

  it("knows nothing for a shared Ollama it cannot place", () => {
    assert.equal(
      resolveServerLog({ owned: false, platform: "win32", env: {}, tmpDir: "x" }).kind,
      "none",
    );
    assert.equal(
      resolveServerLog({ owned: false, platform: "linux", env: {}, tmpDir: "/tmp" }).path,
      undefined,
    );
    assert.equal(
      resolveServerLog({
        owned: false,
        platform: "darwin",
        env: {},
        tmpDir: "/tmp",
        home: "/Users/me",
      }).path,
      "/Users/me/.ollama/logs/server.log",
    );
  });
});

const fileOf = (text) => ({
  size: () => Buffer.byteLength(text),
  read: (_file, start, length) =>
    Buffer.from(text)
      .subarray(start, start + length)
      .toString("utf8"),
});
const owned = resolveServerLog({ ...win, owned: true, env: {} });

describe("tail", () => {
  it("returns the last 200 lines of a long file", () => {
    const text = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
    const tail = readServerLogTail(owned, fileOf(text));
    assert.equal(tail.lines.length, SERVER_LOG_MAX_LINES);
    assert.equal(tail.lines[0], "line 301");
    assert.equal(tail.lines.at(-1), "line 500");
    assert.equal(tail.truncated, true);
    assert.equal(tail.unavailable, null);
  });

  it("returns a short file whole, handling CRLF and a trailing newline", () => {
    const tail = readServerLogTail(owned, fileOf("a\r\nb\r\nc\r\n"));
    assert.deepEqual(tail.lines, ["a", "b", "c"]);
    assert.equal(tail.truncated, false);
  });

  it("reads at most 256 KB from the end and drops the cut first line", () => {
    const calls = [];
    const big = "x".repeat(100) + "\n";
    const text = big.repeat(5000); // ~505 KB
    const reader = {
      size: () => Buffer.byteLength(text),
      read: (file, start, length) => {
        calls.push({ file, start, length });
        return Buffer.from(text)
          .subarray(start, start + length)
          .toString("utf8");
      },
    };
    const tail = readServerLogTail(owned, reader, { maxLines: 100000 });
    assert.equal(calls.length, 1);
    assert.ok(calls[0].length <= SERVER_LOG_MAX_BYTES);
    assert.equal(calls[0].start, Buffer.byteLength(text) - calls[0].length);
    assert.equal(calls[0].file, owned.path);
    assert.ok(
      tail.lines.every((l) => l.length === 100),
      "no half line survived",
    );
    assert.equal(tail.truncated, true);
  });

  it("caps a single enormous line", () => {
    const tail = readServerLogTail(owned, fileOf("y".repeat(10_000)));
    assert.equal(tail.lines[0].length, SERVER_LOG_MAX_LINE_CHARS + 1);
    assert.ok(tail.lines[0].endsWith("…"));
  });

  it("says why when there is nothing to read, and never throws", () => {
    assert.equal(
      readServerLogTail(owned, { size: () => null, read: () => "" }).unavailable,
      "No log file yet.",
    );
    assert.deepEqual(readServerLogTail(owned, fileOf("")).lines, []);
    const broken = readServerLogTail(owned, {
      size: () => 10,
      read: () => {
        throw new Error("EBUSY");
      },
    });
    assert.match(broken.unavailable, /Could not read the log: EBUSY/);
    const none = readServerLogTail({ kind: "none", label: "x" }, fileOf("a"));
    assert.match(none.unavailable, /does not know where/);
  });
});
