import { getReportNarrative, startReportNarrative } from "@/lib/pmo/server/actions";
import { handle, readBody } from "@/lib/pmo/server/http";

export const dynamic = "force-dynamic";

/** POST /api/pmo/reports/narrative { period } — start (or join) a LOCAL-model job
 *  that writes highlights, risks and next week's focus from the report's data.
 *  Returns at once; poll GET with the period key. The lines are verified against
 *  the data and are text to review: nothing is sent anywhere. */
export async function POST(request: Request) {
  const body = await readBody(request);
  return handle(request, (pmo) => startReportNarrative(pmo, body));
}

/** GET /api/pmo/reports/narrative?key=<start>_<end> -> { job } (null if none). */
export function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key");
  return handle(request, async (pmo) => getReportNarrative(pmo, key));
}
