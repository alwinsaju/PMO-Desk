// Run with `pnpm test`. The saved AI-model choice: file round trip, validation,
// and the resolution order env > saved > default (+ the one installed model).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  chooseModel,
  createModelResolver,
  modelChoicePath,
  readSavedModel,
  saveModelChoice,
} from "./modelChoice.ts";

const DEFAULT = "gemma4:12b";
const SMALL = "qwen3.5:9b";

let dir;
let file;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "aios-model-"));
  file = path.join(dir, "ai-model.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const envFor = (extra = {}) => ({ AI_OS_AI_MODEL_FILE: file, ...extra });

describe("modelChoicePath", () => {
  it("prefers the explicit override, then the PMO data dir", () => {
    assert.equal(
      modelChoicePath({ AI_OS_AI_MODEL_FILE: "C:\\x\\m.json" }),
      "C:\\x\\m.json",
    );
    assert.equal(
      modelChoicePath({ AI_OS_PMO_DATA_DIR: dir }),
      path.join(path.resolve(dir), "ai-model.json"),
    );
  });
});

describe("saved model file", () => {
  it("round-trips an allowed model", () => {
    assert.deepEqual(saveModelChoice(SMALL, envFor()), { ok: true });
    assert.equal(readSavedModel(envFor()), SMALL);
  });

  it("normalises case and a :latest-style spelling to the known tag", () => {
    assert.deepEqual(saveModelChoice("QWEN3.5:9B", envFor()), { ok: true });
    assert.equal(readSavedModel(envFor()), SMALL);
  });

  it("refuses to save a model the code does not know", () => {
    const result = saveModelChoice("llama3.3:70b", envFor());
    assert.equal(result.ok, false);
    assert.equal(readSavedModel(envFor()), undefined);
  });

  it("ignores a missing file", () => {
    assert.equal(readSavedModel(envFor()), undefined);
  });

  it("ignores corrupt, wrongly shaped and unknown-model files", () => {
    for (const text of [
      "{not json",
      "[]",
      "null",
      '{"model":5}',
      '{"model":"evil/model"}',
      "",
    ]) {
      writeFileSync(file, text);
      assert.equal(readSavedModel(envFor()), undefined, text);
    }
  });
});

describe("chooseModel", () => {
  const base = { defaultModel: DEFAULT, installed: null };

  it("env beats saved beats default", () => {
    assert.deepEqual(chooseModel({ ...base, envModel: "llama3.2", saved: SMALL }), {
      model: "llama3.2",
      source: "env",
      preferred: "llama3.2",
    });
    assert.equal(chooseModel({ ...base, saved: SMALL }).model, SMALL);
    assert.equal(chooseModel({ ...base, saved: SMALL }).source, "saved");
    assert.equal(chooseModel(base).model, DEFAULT);
    assert.equal(chooseModel(base).source, "default");
  });

  it("keeps the preferred model when it is installed", () => {
    const choice = chooseModel({ ...base, installed: [DEFAULT + "", SMALL] });
    assert.equal(choice.model, DEFAULT);
  });

  it("uses the only installed allowed model when the preferred one is missing", () => {
    const choice = chooseModel({ ...base, installed: ["qwen3.5:9b", "other:1b"] });
    assert.equal(choice.model, SMALL);
    assert.equal(choice.source, "only-installed");
    assert.equal(choice.preferred, DEFAULT);
    assert.match(choice.note, /qwen3\.5:9b.*gemma4:12b.*not installed/);
  });

  it("matches installed names the way Ollama spells them", () => {
    const choice = chooseModel({ ...base, installed: ["QWEN3.5:9B:latest"] });
    assert.equal(choice.model, SMALL);
  });

  it("does not guess when none, or both, allowed models are installed", () => {
    assert.equal(chooseModel({ ...base, installed: [] }).model, DEFAULT);
    assert.equal(chooseModel({ ...base, installed: ["other:1b"] }).source, "default");
    const both = chooseModel({ ...base, saved: SMALL, installed: [DEFAULT, SMALL] });
    assert.equal(both.model, SMALL);
  });

  it("never second-guesses an explicit env model", () => {
    const choice = chooseModel({
      ...base,
      envModel: DEFAULT,
      installed: [SMALL],
    });
    assert.equal(choice.model, DEFAULT);
    assert.equal(choice.source, "env");
  });
});

describe("createModelResolver", () => {
  it("re-reads the file on every call, so a save takes effect at once", () => {
    const resolver = createModelResolver({ env: envFor() });
    assert.equal(resolver.current().model, DEFAULT);
    saveModelChoice(SMALL, envFor());
    assert.equal(resolver.current().model, SMALL);
    assert.equal(resolver.current().source, "saved");
  });

  it("falls back to the only installed model after observeInstalled", () => {
    const resolver = createModelResolver({ env: envFor() });
    resolver.observeInstalled([SMALL]);
    assert.equal(resolver.current().model, SMALL);
    resolver.observeInstalled([DEFAULT, SMALL]);
    assert.equal(resolver.current().model, DEFAULT);
    resolver.observeInstalled(null);
    assert.equal(resolver.current().model, DEFAULT);
  });

  it("honours OLLAMA_MODEL over the saved file", () => {
    saveModelChoice(SMALL, envFor());
    const resolver = createModelResolver({ env: envFor({ OLLAMA_MODEL: "llama3.2" }) });
    assert.equal(resolver.current().model, "llama3.2");
    assert.equal(resolver.current().source, "env");
  });
});
