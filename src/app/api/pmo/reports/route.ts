import { generateReport, listSavedReports } from "@/lib/pmo/server/actions";
import { handle, readBody } from "@/lib/pmo/server/http";

export const dynamic = "force-dynamic";

/** GET /api/pmo/reports -> the saved weekly reports, newest first (metadata only). */
export function GET(request: Request) {
  return handle(request, (pmo) => listSavedReports(pmo));
}

/** POST /api/pmo/reports { period } — build the weekly report for a period from
 *  the to-dos, by code (no model, so it is instant). Nothing is saved or sent;
 *  the reply carries the Markdown and plain text and an id to save it under. */
export async function POST(request: Request) {
  const body = await readBody(request);
  return handle(request, (pmo) => generateReport(pmo, body));
}
