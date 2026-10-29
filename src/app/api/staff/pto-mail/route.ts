import { kickPtoSync } from "@/lib/staff/ptoMailAi";
import { ptoMailState, resolvePtoMail } from "@/lib/staff/ptoMailServer";
import { readCappedJson, staffHandler } from "@/lib/staff/http";
import { StaffError } from "@/lib/staff/server";

export const dynamic = "force-dynamic";

/** GET /api/staff/pto-mail -> { ok, folder, source, running, waiting, needsReview,
 *  lastReceivedAt, records }: the PTO emails the flow delivered and what was done with
 *  each (no side effects). */
export function GET(request: Request) {
  return staffHandler(request, async () => ({ ...(await ptoMailState()) }));
}

/**
 * POST /api/staff/pto-mail { action }:
 *   "scan"                                       read new emails in the background,
 *   "apply" { id, employeeId, type, startDate, endDate }  file an email that needed review,
 *   "dismiss" { id }                             leave it out of the roster.
 */
export function POST(request: Request) {
  return staffHandler(request, async () => {
    const body = (await readCappedJson(request, 64 * 1024)) as { action?: unknown };
    if (body?.action === "scan") {
      kickPtoSync();
      return { started: true };
    }
    if (body?.action === "apply" || body?.action === "dismiss") {
      return { record: await resolvePtoMail(body) };
    }
    throw new StaffError("Unknown action.");
  });
}
