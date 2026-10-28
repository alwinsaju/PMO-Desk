import { createInboxFolder, realFirstRunDeps } from "@/lib/pmo/server/firstRun";
import { handle, readBody } from "@/lib/pmo/server/http";

export const dynamic = "force-dynamic";

/** POST /api/pmo/setup/create-folder { parent, confirmNonEmpty? } -> creates
 *  `<parent>\PMO-Inbox` (the "Create PMO-Inbox here" button). Only this call
 *  creates a folder; nothing is saved until the wizard finishes. */
export async function POST(request: Request) {
  const body = await readBody(request);
  return handle(request, (pmo) => createInboxFolder(body, realFirstRunDeps(pmo.dataDir)));
}
