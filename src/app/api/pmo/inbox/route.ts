import { realFirstRunDeps, setInboxFolder } from "@/lib/pmo/server/firstRun";
import { handle, readBody } from "@/lib/pmo/server/http";

export const dynamic = "force-dynamic";

/** PUT /api/pmo/inbox { inboxDir, confirmNonEmpty? } -> changes the PMO inbox
 *  folder (Settings), after the same checks as the first-run wizard. Applies on
 *  the next scan. */
export async function PUT(request: Request) {
  const body = await readBody(request);
  return handle(request, (pmo) =>
    setInboxFolder(pmo, body, realFirstRunDeps(pmo.dataDir)),
  );
}
