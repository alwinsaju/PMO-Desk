import { handleSuggestRequest } from "@/lib/registers/registerSuggestRoute";
import { createSuggestGenerator } from "@/lib/registers/registerSuggestAi";

export const dynamic = "force-dynamic";

/** POST /api/registers/suggest { tool: "changes" | "lessons", values } -> { ok, field, value, ... }
 *  Asks the LOCAL model (loopback Ollama) to suggest an impact note for a change request or a
 *  Category for a lesson. The answer is checked by code and is only a suggestion for the form:
 *  nothing is saved or sent. When the model is unavailable the reason says so and the form
 *  still works by hand. */
export function POST(request: Request) {
  return handleSuggestRequest(request, createSuggestGenerator);
}
