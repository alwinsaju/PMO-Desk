import {
  listSavedExamples,
  setSavedExamplesSwitch,
} from "@/lib/pmo/server/exampleActions";
import { handle, readBody } from "@/lib/pmo/server/http";

export const dynamic = "force-dynamic";

/** GET /api/pmo/examples -> { enabled, examples, max }: the saved-examples
 *  library and its "Use my saved examples in prompts" switch (default off).
 *  PUT { enabled } turns the switch on or off. Local file only. */
export function GET(request: Request) {
  return handle(request, (pmo) => listSavedExamples(pmo));
}

export async function PUT(request: Request) {
  const body = await readBody(request);
  return handle(request, (pmo) => setSavedExamplesSwitch(pmo, body));
}
