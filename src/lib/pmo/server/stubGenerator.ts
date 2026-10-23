// Stand-in for the local model, for unit tests and for running the app with
// PMO_AI_STUB=1 (previews, demos) without Ollama. A few markers in the message
// body trigger the failure paths the real model can hit:
//   [[stub-timeout]]   -> AiRuntimeError("timeout")
//   [[stub-invalid]]   -> AiRuntimeError("invalid-output")
//   [[stub-bad-quote]] -> an answer whose quote is not in the message
// and a file named `stub-runtime-down` in the data directory makes every call
// fail as "runtime-down" until it is deleted (the "stop the model" switch).
import { existsSync } from "node:fs";
import path from "node:path";
import { AiStructuredSchema } from "../types.ts";
import type { Generator } from "./structure.ts";

function runtimeError(code: string, message: string): Error {
  const error = new Error(message);
  error.name = "AiRuntimeError";
  (error as Error & { code: string }).code = code;
  return error;
}

const FYI = /\b(fyi|for your information|no action|newsletter|unsubscribe)\b/i;

export function createStubGenerator(
  options: { dataDir?: string; delayMs?: number } = {},
): Generator {
  return {
    model: () => "stub",
    async generate({ prompt }) {
      if (options.delayMs)
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      if (
        options.dataDir &&
        existsSync(path.join(options.dataDir, "stub-runtime-down"))
      ) {
        throw runtimeError(
          "runtime-down",
          "Could not reach the local AI runtime (stub).",
        );
      }

      const body = /<message [^>]*>\n([\s\S]*?)\n<\/message>/.exec(prompt)?.[1] ?? prompt;
      if (body.includes("[[stub-timeout]]")) {
        throw runtimeError(
          "timeout",
          "The local AI model did not answer within 1s (stub).",
        );
      }
      if (body.includes("[[stub-invalid]]")) {
        throw runtimeError(
          "invalid-output",
          "The local AI model did not return valid output (stub).",
        );
      }

      const first = body.split(/(?<=[.!?])\s+|\n/).find((line) => line.trim()) ?? body;
      const sentence = first.trim().slice(0, 250);
      const actionable = !FYI.test(body);
      const day = /\b(\d{4}-\d{2}-\d{2})\b/.exec(body)?.[1] ?? null;
      return AiStructuredSchema.parse({
        reason: actionable
          ? "The message asks for something to be done."
          : "Informational only.",
        isActionable: actionable,
        confidence: actionable ? 0.8 : 0.9,
        title: actionable ? sentence.slice(0, 80) : "No action needed",
        description: sentence,
        owner: { name: "Alwin Saju", email: "alsaju@deloitte.com", isMe: true },
        requester: { name: null, email: null },
        dueAt: day,
        dueBasis: day ? "explicit" : "none",
        priority: /urgent|asap/i.test(body) ? "high" : "normal",
        actionItems: actionable
          ? [{ text: sentence.slice(0, 120), owner: null, dueAt: null }]
          : [],
        checkpointTemplate: "simple",
        waitingOn: null,
        tags: ["stub"],
        quote: body.includes("[[stub-bad-quote]]")
          ? "This sentence does not appear anywhere in the message."
          : sentence,
      });
    },
  };
}
