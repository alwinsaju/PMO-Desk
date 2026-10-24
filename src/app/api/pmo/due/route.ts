import { handle } from "@/lib/pmo/server/http";
import { previewDue } from "@/lib/pmo/server/notify";

export const dynamic = "force-dynamic";

/** GET /api/pmo/due — read-only preview: the reminders a claim made now would
 *  return, the attention counts behind the dock badge, and the reminder
 *  preferences. Records nothing, so it is safe to poll and to curl. */
export function GET(request: Request) {
  return handle(request, async (pmo) => ({ ok: true, ...(await previewDue(pmo)) }));
}
