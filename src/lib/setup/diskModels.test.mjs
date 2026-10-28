// Run with `pnpm test`. Reading installed models from Ollama's manifest folder.
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { manifestPath, modelsOnDisk } from "./diskModels.ts";

const DIR = path.join("C:", "m");
const at = (...p) => path.join(DIR, "manifests", "registry.ollama.ai", ...p);

describe("manifestPath", () => {
  it("maps library models and defaults the tag", () => {
    assert.equal(manifestPath(DIR, "gemma4:12b"), at("library", "gemma4", "12b"));
    assert.equal(manifestPath(DIR, "gemma4"), at("library", "gemma4", "latest"));
  });
  it("maps namespaced models", () => {
    assert.equal(manifestPath(DIR, "user/m:t"), at("user", "m", "t"));
  });
  it("refuses odd names", () => {
    for (const bad of ["", "a:b:c", "../x:1", "a/b/c:1", "a\\b:1", "/x:1"]) {
      assert.equal(manifestPath(DIR, bad), null, bad);
    }
  });
});

describe("modelsOnDisk", () => {
  it("keeps the candidates whose manifest exists", () => {
    const present = new Set([at("library", "qwen3.5", "9b")]);
    const found = modelsOnDisk(DIR, ["gemma4:12b", "qwen3.5:9b"], (f) => present.has(f));
    assert.deepEqual(found, ["qwen3.5:9b"]);
  });
  it("is empty when nothing exists", () => {
    assert.deepEqual(
      modelsOnDisk(DIR, ["gemma4:12b"], () => false),
      [],
    );
  });
});
