import { createHash } from "node:crypto";
import { handle } from "@/lib/pmo/server/http";
import { buildState } from "@/lib/pmo/server/state";

// Live local state; never cacheable.
export const dynamic = "force-dynamic";

/** GET /api/pmo/state -> PmoState: queue, to-dos, filtered items, ingest and
 *  model status. Touches only local files (and a read-only probe of the local
 *  Ollama); starts the inbox poller on first call.
 *
 *  The answer carries a `digest` of everything but the server clock. A poller that
 *  sends it back as `?known=<digest>` gets `{ ok, unchanged: true, serverTime }`
 *  instead of the whole document while nothing has changed. */
export function GET(request: Request) {
  const known = new URL(request.url).searchParams.get("known");
  return handle(request, async (pmo) => {
    const state = await buildState(pmo, {
      runtime: pmo.runtime,
      dataDir: pmo.dataDir,
      scanIntervalMs: pmo.scanIntervalMs,
    });
    const { serverTime, ...rest } = state;
    const digest = createHash("sha1").update(JSON.stringify(rest)).digest("hex");
    if (known && known === digest) {
      return { ok: true, unchanged: true, serverTime, digest };
    }
    return { ...state, digest };
  });
}
