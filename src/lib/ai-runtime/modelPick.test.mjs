// The runtime resolves the model per call (env > saved > default, or the one
// allowed model that is installed) and reports which one it chose.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { z } from "zod";
import { createModelResolver, saveModelChoice } from "./modelChoice.ts";
import { makeRuntime } from "./testkit.mjs";

let dir;
let env;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "aios-pick-"));
  env = { AI_OS_AI_MODEL_FILE: path.join(dir, "ai-model.json") };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const chatModels = (ollama) =>
  ollama.st.calls.filter((c) => c.route === "/api/chat").map((c) => c.body.model);

describe("model per call", () => {
  it("asks for the saved model, not the built-in default", async () => {
    saveModelChoice("qwen3.5:4b", env);
    const rt = makeRuntime(
      {},
      { installed: ["gemma4:12b", "qwen3.5:4b"] },
      false,
      createModelResolver({ env }),
    );
    await rt.client.generateText({ prompt: "hi" });
    assert.deepEqual(chatModels(rt.ollama), ["qwen3.5:4b"]);
  });

  it("uses the only installed allowed model without any saved choice", async () => {
    const rt = makeRuntime(
      {},
      { installed: ["qwen3.5:4b"] },
      false,
      createModelResolver({ env }),
    );
    await rt.client.generateJson({ prompt: "hi", schema: z.object({ ok: z.boolean() }) });
    assert.deepEqual(chatModels(rt.ollama), ["qwen3.5:4b"]);
  });

  it("notices a model saved after the runtime was built", async () => {
    const rt = makeRuntime(
      {},
      { installed: ["gemma4:12b", "qwen3.5:4b"] },
      false,
      createModelResolver({ env }),
    );
    await rt.client.generateText({ prompt: "one" });
    saveModelChoice("qwen3.5:4b", env);
    await rt.client.generateText({ prompt: "two" });
    assert.deepEqual(chatModels(rt.ollama), ["gemma4:12b", "qwen3.5:4b"]);
  });

  it("lets a call name its own model", async () => {
    const rt = makeRuntime(
      {},
      { installed: ["gemma4:12b", "qwen3.5:4b"] },
      false,
      createModelResolver({ env }),
    );
    await rt.client.generateText({ prompt: "hi", model: "qwen3.5:4b" });
    assert.deepEqual(chatModels(rt.ollama), ["qwen3.5:4b"]);
  });

  it("logs the model that was really used", async () => {
    const rt = makeRuntime(
      {},
      { installed: ["qwen3.5:4b"] },
      false,
      createModelResolver({ env }),
    );
    await rt.client.generateText({ prompt: "hi" });
    const start = rt.state.ring.since(0).find((e) => e.kind === "call-start");
    assert.equal(start.model, "qwen3.5:4b");
  });
});

describe("status", () => {
  it("reports the chosen model, its source and why", async () => {
    const rt = makeRuntime(
      {},
      { installed: ["qwen3.5:4b"] },
      false,
      createModelResolver({ env }),
    );
    const status = await rt.controls.status();
    assert.equal(status.defaultModel, "qwen3.5:4b");
    assert.equal(status.modelSource, "only-installed");
    assert.match(status.modelNote, /not installed/);
    assert.equal(status.modelInstalled, true);
  });

  it("reports a saved choice as saved, with no note", async () => {
    saveModelChoice("qwen3.5:4b", env);
    const rt = makeRuntime(
      {},
      { installed: ["gemma4:12b", "qwen3.5:4b"] },
      false,
      createModelResolver({ env }),
    );
    const status = await rt.controls.status();
    assert.equal(status.defaultModel, "qwen3.5:4b");
    assert.equal(status.modelSource, "saved");
    assert.equal(status.modelNote, undefined);
  });

  it("keeps working without a resolver", async () => {
    const rt = makeRuntime();
    const status = await rt.controls.status();
    assert.equal(status.defaultModel, "gemma4:12b");
    assert.equal(status.modelSource, "default");
  });
});
