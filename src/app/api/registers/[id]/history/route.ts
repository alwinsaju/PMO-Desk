import { registersHandler } from "@/lib/registers/http";
import { definitionFor, readRecordHistory } from "@/lib/registers/server";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** GET /api/registers/<tool>/history?record=<record id> -> { ok, entries } (newest first; field keys only, never values) */
export async function GET(request: Request, context: Context) {
  return registersHandler(request, async () => {
    const def = definitionFor((await context.params).id);
    const record = new URL(request.url).searchParams.get("record") ?? "";
    return { entries: await readRecordHistory(def, record) };
  });
}
