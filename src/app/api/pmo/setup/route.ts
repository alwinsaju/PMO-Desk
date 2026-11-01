import {
  completeFirstRun,
  firstRunSuggestions,
  realFirstRunDeps,
} from "@/lib/pmo/server/firstRun";
import { handle, readBody } from "@/lib/pmo/server/http";
import { registerSelf } from "@/lib/staff/self";

export const dynamic = "force-dynamic";

/** GET /api/pmo/setup -> the wizard's suggestions (a name from the Windows user
 *  name, the OneDrive inbox candidates). Read-only: it creates nothing. */
export function GET(request: Request) {
  return handle(request, async (pmo) => ({
    ok: true,
    ...firstRunSuggestions(realFirstRunDeps(pmo.dataDir)),
  }));
}

/** POST /api/pmo/setup { names, emails, timeZone, allowedSenderDomains,
 *  blockedDomains, inboxDir, confirmNonEmpty? } -> finishes the wizard, once.
 *  The person who finishes it joins the staff roster as its first member and their
 *  M365 profile (full name, photo) is requested. */
export async function POST(request: Request) {
  const body = await readBody(request);
  return handle(request, async (pmo) => {
    const result = await completeFirstRun(pmo, body, realFirstRunDeps(pmo.dataDir));
    if (result.ok) {
      void pmo.scanNow().catch(() => undefined);
      const { names, emails } = result.config.me;
      if (emails[0]) await registerSelf({ email: emails[0], name: names[0] });
    }
    return result;
  });
}
