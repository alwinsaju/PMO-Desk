// The model status the PMO toolbar shows, derived from the AI runtime's own
// status snapshot. Pure (no node: imports), so `pnpm test` covers every state.
//
// An unloaded model is the NORMAL idle state (the runtime does not pre-load at
// launch and Ollama frees the model two minutes after the last call), so
// "asleep" is information, not a warning.
import { modelStateOf } from "../ai-runtime/logView.ts";
import type { AiRuntimeStatus } from "../ai-runtime/types.ts";
import type { RuntimeSummary } from "./types.ts";

/** Said wherever the UI explains why the first message is slow. */
export const WAKE_NOTE =
  "The first message takes 1-2 minutes longer because the model is waking up.";

export function summarizeRuntime(status: AiRuntimeStatus, nowMs: number): RuntimeSummary {
  const model = status.defaultModel;
  const info = modelStateOf(status, nowMs);
  const extra = { task: info.task, unloadsAt: info.unloadsAt };
  switch (info.state) {
    case "down":
      return { state: "down", model, message: "Local model not running.", ...extra };
    case "model-missing":
      return {
        state: "model-missing",
        model,
        message: `Model missing: run ollama pull ${model}`,
        ...extra,
      };
    case "loading":
      return {
        state: "loading",
        model,
        message: `The model is waking up (loading into memory). ${WAKE_NOTE}`,
        ...extra,
      };
    case "working":
      return { state: "working", model, message: null, ...extra };
    case "ready":
      return { state: "ready", model, message: null, ...extra };
    case "asleep":
      return {
        state: "asleep",
        model,
        message: `The model is asleep to save memory and wakes when a message needs it. ${WAKE_NOTE}`,
        ...extra,
      };
  }
}
