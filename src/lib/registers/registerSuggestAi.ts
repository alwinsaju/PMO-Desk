// The real model behind the register "Suggest" buttons: the local AI runtime
// (src/lib/ai-runtime), which talks only to Ollama on 127.0.0.1. No cloud model. Kept apart from
// registerSuggest.ts because it needs the app's module aliases; tests inject a generator or use
// the stub. Server code only.
import { clampTimeoutMs, generateJson } from "@/lib/ai-runtime";
import {
  ImpactNoteSchema,
  categorySchema,
  createStubGenerator,
  type SuggestGenerator,
} from "./registerSuggest.ts";

/** A person is waiting, but the model may have to wake first (1-2 minutes on this PC). Clamped
 *  below Node fetch's 300 s silence limit. */
const TIMEOUT_MS = clampTimeoutMs(
  Number(process.env.AI_OS_REGISTER_AI_TIMEOUT_MS) || 150_000,
);

/** AI_OS_REGISTER_AI_STUB=1 swaps the model for a keyword reader (tests and previews only). */
export function createSuggestGenerator(): SuggestGenerator {
  if (process.env.AI_OS_REGISTER_AI_STUB?.trim()) return createStubGenerator();
  return {
    // think: false like every PMO call (reasoning makes a call 3-10x slower on this CPU);
    // interactive so a person waiting goes before queued background work. Temperature 0.
    impactNote: ({ system, prompt, label }) =>
      generateJson({
        system,
        prompt,
        schema: ImpactNoteSchema,
        timeoutMs: TIMEOUT_MS,
        think: false,
        priority: "interactive",
        log: { task: "register-impact-note", label },
      }),
    category: ({ system, prompt, label, allowed }) =>
      generateJson({
        system,
        prompt,
        schema: categorySchema(allowed),
        timeoutMs: TIMEOUT_MS,
        think: false,
        priority: "interactive",
        log: { task: "register-category", label },
      }),
  };
}
