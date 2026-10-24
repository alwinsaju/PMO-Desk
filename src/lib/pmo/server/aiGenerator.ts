// The real structuring model: the local AI runtime (src/lib/ai-runtime),
// which talks only to Ollama on 127.0.0.1. No cloud model, no claude CLI.
import {
  clampTimeoutMs,
  generateJson,
  generateText,
  getAiRuntimeConfig,
  getRuntimeStatus,
} from "@/lib/ai-runtime";
import { AiNarrativeSchema } from "../reportNarrative.ts";
import {
  AiStructuredSchema,
  AiUpdateModelSchema,
  AiUpdateSignoffModelSchema,
  type RuntimeSummary,
} from "../types.ts";
import type { Generator } from "./structure.ts";

/** A 12B model on CPU reading a 12k-character message can take minutes; the
 *  queue is background work, so this is generous on purpose. Clamped below
 *  Node fetch's 300 s silence limit (see MAX_REQUEST_TIMEOUT_MS). */
const TIMEOUT_MS = clampTimeoutMs(Number(process.env.AI_OS_PMO_AI_TIMEOUT_MS) || 240_000);

export function createRuntimeGenerator(): Generator {
  return {
    model: () => getAiRuntimeConfig().defaultModel,
    // think: false always. Reasoning makes a call 3-10x slower on this CPU and
    // it then truncates or times out; the structured output needs no
    // chain of thought.
    generate: ({ system, prompt }) =>
      generateJson({
        system,
        prompt,
        schema: AiStructuredSchema,
        timeoutMs: TIMEOUT_MS,
        think: false,
      }),
    // Same runtime, same queue (concurrency 1), same think: false. A to-do that
    // is awaiting a sign-off also gets the reply classified (a few more fields).
    generateUpdate: ({ system, prompt, signoff }) =>
      generateJson({
        system,
        prompt,
        schema: signoff ? AiUpdateSignoffModelSchema : AiUpdateModelSchema,
        timeoutMs: TIMEOUT_MS,
        think: false,
      }),
    // Plain text, a little warmer than the structured calls so two drafts are
    // not word for word the same; still local, still never sent.
    draftChaser: ({ system, prompt }) =>
      generateText({
        system,
        prompt,
        timeoutMs: TIMEOUT_MS,
        temperature: 0.4,
        think: false,
      }),
    // The optional "improve with AI" version of a sign-off request: plain text,
    // like the chaser, never sent by this app.
    draftSignoffRequest: ({ system, prompt }) =>
      generateText({
        system,
        prompt,
        timeoutMs: TIMEOUT_MS,
        temperature: 0.4,
        think: false,
      }),
    // The weekly report's three short parts as bounded JSON (so constrained
    // decoding cannot run on), temperature 0, same queue and think: false.
    draftNarrative: ({ system, prompt }) =>
      generateJson({
        system,
        prompt,
        schema: AiNarrativeSchema,
        timeoutMs: TIMEOUT_MS,
        think: false,
      }),
  };
}

let cached: { at: number; value: RuntimeSummary } | null = null;

/** Read-only probe of the local runtime for the status bar, cached briefly
 *  because the UI polls every few seconds. Never starts anything. */
export async function runtimeSummary(): Promise<RuntimeSummary> {
  if (cached && Date.now() - cached.at < 8_000) return cached.value;
  let value: RuntimeSummary;
  try {
    const status = await getRuntimeStatus();
    const model = status.defaultModel;
    if (!status.running) {
      value = { state: "down", model, message: "Local model not running." };
    } else if (status.modelInstalled === false) {
      value = {
        state: "model-missing",
        model,
        message: `Model missing: run ollama pull ${model}`,
      };
    } else {
      value = {
        state: status.modelWarm ? "ready" : "cold",
        model,
        message: status.modelWarm
          ? null
          : status.modelLoaded
            ? "Model is loading into memory; the first message can take 1-2 minutes extra."
            : "Model not loaded yet; the first message can take 1-2 minutes extra.",
      };
    }
  } catch {
    value = {
      state: "unknown",
      model: null,
      message: "Could not check the local model.",
    };
  }
  cached = { at: Date.now(), value };
  return value;
}
