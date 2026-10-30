import { readJsonBody, registersHandler } from "@/lib/registers/http";
import {
  applyRegisterChanges,
  definitionFor,
  readRegister,
} from "@/lib/registers/server";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** GET /api/registers/<tool> -> { ok, items, config } */
export async function GET(request: Request, context: Context) {
  return registersHandler(request, async () => {
    const def = definitionFor((await context.params).id);
    return { ...(await readRegister(def)) };
  });
}

/** POST /api/registers/<tool> { upsert?, remove?, config? } -> { ok, items, config } */
export async function POST(request: Request, context: Context) {
  return registersHandler(request, async () => {
    const def = definitionFor((await context.params).id);
    return { ...(await applyRegisterChanges(def, await readJsonBody(request))) };
  });
}
