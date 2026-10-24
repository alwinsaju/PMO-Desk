import { MAX_PASTE_REQUEST_BYTES } from "@/lib/pmo/manualIntake";
import { readBodyCapped } from "@/lib/pmo/server/bodyCap";
import { handle } from "@/lib/pmo/server/http";
import { MIN_FILE_AGE_MS } from "@/lib/pmo/server/ingest";
import { submitManualIntake } from "@/lib/pmo/server/manual";

export const dynamic = "force-dynamic";

/** POST /api/pmo/intake/manual — the Paste dialog. Writes ONE source:"manual"
 *  pmo-intake/1 file into the inbox folder (temp file, then rename, like any
 *  producer); the ordinary ingest pass then dedupes, filters and queues it. The
 *  body is size-capped and validated; a fresh paste triggers a scan as soon as
 *  the file is old enough for the poller to read. Touches only local files. */
export function POST(request: Request) {
  return handle(request, async (pmo) => {
    const read = await readBodyCapped(request, MAX_PASTE_REQUEST_BYTES);
    if ("reason" in read) return { ok: false, reason: read.reason };
    const result = await submitManualIntake(pmo, read.body);
    if (result.ok && !result.duplicate) {
      setTimeout(
        () => void pmo.scanNow().catch(() => undefined),
        MIN_FILE_AGE_MS + 500,
      ).unref();
    }
    return result;
  });
}
