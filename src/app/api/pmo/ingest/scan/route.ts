import { handle } from "@/lib/pmo/server/http";

export const dynamic = "force-dynamic";

/** POST /api/pmo/ingest/scan — "Scan now". One pass over the inbox folder
 *  (idempotent: files already handled are deduped), then a nudge to the
 *  structuring queue, which also retries a model that was down. */
export function POST(request: Request) {
  return handle(request, async (pmo) => ({ ok: true, report: await pmo.scanNow() }));
}
