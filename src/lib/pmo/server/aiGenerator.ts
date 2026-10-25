// The real structuring model: the local AI runtime (src/lib/ai-runtime),
// which talks only to Ollama on 127.0.0.1. No cloud model, no claude CLI.
import {
  clampTimeoutMs,
  generateJson,
  generateText,
  getAiRuntimeConfig,
  getLiveActivity,
  getRuntimeStatus,
  type AiRuntimeStatus,
} from "@/lib/ai-runtime";
import { AiNarrativeSchema } from "../reportNarrative.ts";
import { summarizeRuntime } from "../runtimeSummary.ts";
import {
  AiModelTasksSchema,
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

/** What the model is asked for (one entry per independent task), validated, then
 *  each entry widened to the stored shape. */
const STRUCTURE_SCHEMA = AiModelTasksSchema.transform(({ tasks }) =>
  tasks.map((task) => AiStructuredSchema.parse(task)),
);

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

// `log` on every call: the task kind and a short label (a subject / title, cut
// to 60 characters by the runtime) for the model log, and for some a counts-only
// note about the result. The label stays in the in-memory session log.
export function createRuntimeGenerator(): Generator {
  return {
    model: () => getAiRuntimeConfig().defaultModel,
    // think: false always. Reasoning makes a call 3-10x slower on this CPU and
    // it then truncates or times out; the structured output needs no
    // chain of thought.
    generate: ({ system, prompt, label }) =>
      generateJson({
        system,
        prompt,
        // The model answers a list of lean AiModelSchema tasks (no reason / confidence / tags);
        // the stored shape fills those in with their defaults.
        schema: STRUCTURE_SCHEMA,
        timeoutMs: TIMEOUT_MS,
        think: false,
        log: {
          task: "structure",
          label,
          note: (r) => {
            const actionable = r.filter((t) => t.isActionable);
            if (actionable.length === 0) return "not a task";
            return actionable.length === 1
              ? `${count(actionable[0].actionItems.length, "action item", "action items")} found`
              : `${count(actionable.length, "task", "tasks")} found`;
          },
        },
      }),
    // Same runtime, same queue (concurrency 1), same think: false. A to-do that
    // is awaiting a sign-off also gets the reply classified (a few more fields).
    generateUpdate: ({ system, prompt, signoff, label }) =>
      generateJson({
        system,
        prompt,
        schema: signoff ? AiUpdateSignoffModelSchema : AiUpdateModelSchema,
        timeoutMs: TIMEOUT_MS,
        think: false,
        log: {
          task: signoff ? "update-signoff" : "update",
          label,
          note: (r) => `read as ${r.kind}`,
        },
      }),
    // Plain text, a little warmer than the structured calls so two drafts are
    // not word for word the same; still local, still never sent.
    draftChaser: ({ system, prompt, label }) =>
      generateText({
        system,
        prompt,
        timeoutMs: TIMEOUT_MS,
        temperature: 0.4,
        think: false,
        log: {
          task: "chaser",
          label,
          note: (text) => count(words(text), "word", "words"),
        },
      }),
    // The optional "improve with AI" version of a sign-off request: plain text,
    // like the chaser, never sent by this app.
    draftSignoffRequest: ({ system, prompt, label }) =>
      generateText({
        system,
        prompt,
        timeoutMs: TIMEOUT_MS,
        temperature: 0.4,
        think: false,
        log: {
          task: "signoff-request",
          label,
          note: (text) => count(words(text), "word", "words"),
        },
      }),
    // The weekly report's three short parts as bounded JSON (so constrained
    // decoding cannot run on), temperature 0, same queue and think: false.
    draftNarrative: ({ system, prompt, label }) =>
      generateJson({
        system,
        prompt,
        schema: AiNarrativeSchema,
        timeoutMs: TIMEOUT_MS,
        think: false,
        log: {
          task: "report",
          label,
          note: (r) =>
            count(
              r.highlights.length + r.risks.length + r.nextWeek.length,
              "line",
              "lines",
            ),
        },
      }),
  };
}

let cached: { at: number; status: AiRuntimeStatus } | null = null;

/** Read-only probe of the local runtime for the status bar. Never starts or loads
 *  anything (only GET /api/version, /api/tags, /api/ps). The status is cached
 *  for two seconds because the UI polls every three. */
export async function runtimeSummary(): Promise<RuntimeSummary> {
  try {
    if (!cached || Date.now() - cached.at >= 2_000) {
      cached = { at: Date.now(), status: await getRuntimeStatus() };
    }
    // The Ollama half is two seconds old at most; what the runtime is doing
    // right now is read fresh, so "working" appears the moment a call starts.
    return summarizeRuntime({ ...cached.status, ...getLiveActivity() }, Date.now());
  } catch {
    return {
      state: "unknown",
      model: null,
      message: "Could not check the local model.",
    };
  }
}
