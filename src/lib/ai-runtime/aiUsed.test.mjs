// Run with `pnpm test`. The "has used AI" flag that gates the launch-time Ollama start.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { aiUsedPath, hasUsedAi, markAiUsed, resetAiUsedMemo } from "./aiUsed.ts";

let dir;
let env;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "aios-used-"));
  env = { AI_OS_AI_MODEL_FILE: path.join(dir, "ai-model.json") };
  resetAiUsedMemo();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("ai used flag", () => {
  it("lives next to the model choice file", () => {
    assert.equal(aiUsedPath(env), path.join(dir, "ai-used.json"));
  });

  it("is false until marked, then true", () => {
    assert.equal(hasUsedAi(env), false);
    markAiUsed(env, () => Date.UTC(2026, 0, 2));
    assert.equal(hasUsedAi(env), true);
    assert.match(readFileSync(aiUsedPath(env), "utf8"), /2026-01-02/);
  });

  it("writes once per process", () => {
    markAiUsed(env, () => Date.UTC(2026, 0, 2));
    const first = readFileSync(aiUsedPath(env), "utf8");
    markAiUsed(env, () => Date.UTC(2027, 0, 2));
    assert.equal(readFileSync(aiUsedPath(env), "utf8"), first);
  });

  it("treats a corrupt or foreign file as not used", () => {
    writeFileSync(aiUsedPath(env), "{nope");
    assert.equal(hasUsedAi(env), false);
    writeFileSync(aiUsedPath(env), JSON.stringify({ used: "yes" }));
    assert.equal(hasUsedAi(env), false);
  });

  it("does not throw when the folder cannot be written", () => {
    const blocked = {
      AI_OS_AI_MODEL_FILE: path.join(dir, "ai-model.json", "x", "m.json"),
    };
    writeFileSync(path.join(dir, "ai-model.json"), "file, not a folder");
    assert.doesNotThrow(() => markAiUsed(blocked));
    assert.equal(hasUsedAi(blocked), false);
  });
});
