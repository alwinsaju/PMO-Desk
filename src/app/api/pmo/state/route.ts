import { handle } from "@/lib/pmo/server/http";
import { buildState } from "@/lib/pmo/server/state";

// Live local state; never cacheable.
export const dynamic = "force-dynamic";

/** GET /api/pmo/state -> PmoState: queue, to-dos, filtered items, ingest and
 *  model status. Touches only local files (and a read-only probe of the local
 *  Ollama); starts the inbox poller on first call. */
export function GET(request: Request) {
  return handle(request, (pmo) =>
    buildState(pmo, {
      runtime: pmo.runtime,
      dataDir: pmo.dataDir,
      scanIntervalMs: pmo.scanIntervalMs,
    }),
  );
}
