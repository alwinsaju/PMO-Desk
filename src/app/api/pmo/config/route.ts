import { updateConfig } from "@/lib/pmo/server/actions";
import { handle, readBody } from "@/lib/pmo/server/http";

export const dynamic = "force-dynamic";

/** GET /api/pmo/config -> the filter/identity config (the same document the
 *  state route embeds). PUT merges a patch of the allow/block lists and `me`;
 *  the inbox folder has its own route (PUT /api/pmo/inbox). */
export function GET(request: Request) {
  return handle(request, async (pmo) => ({
    ok: true,
    config: await pmo.store.loadConfig(),
  }));
}

export async function PUT(request: Request) {
  const body = await readBody(request);
  return handle(request, (pmo) => updateConfig(pmo, body));
}
