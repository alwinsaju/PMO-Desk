import {
  resendAllRequests,
  resendRequest,
  resolveExchange,
  syncExchange,
} from "@/lib/staff/exchangeServer";
import { kickPtoSync } from "@/lib/staff/ptoMailAi";
import { readCappedText, staffHandler } from "@/lib/staff/http";
import { StaffError } from "@/lib/staff/server";

export const dynamic = "force-dynamic";

/** GET /api/staff/sync -> { ok, folder, source }: where the M365 profile flow
 *  hands files over (no side effects). */
export function GET(request: Request) {
  return staffHandler(request, async () => {
    const { dir, source } = resolveExchange();
    return { folder: dir, source };
  });
}

/**
 * POST /api/staff/sync { resend?: employeeId } -> { ok, folder, source, applied,
 * rejected, requested }. Applies profile files the M365 flow left in the exchange
 * folder and writes a request file for each person still waiting; with `resend`,
 * first writes a fresh request for that person.
 */
export function POST(request: Request) {
  return staffHandler(request, async () => {
    const text = await readCappedText(request, 4096);
    let body: { resend?: unknown; resendAll?: unknown } = {};
    if (text.trim()) {
      try {
        body = JSON.parse(text) as { resend?: unknown; resendAll?: unknown };
      } catch {
        throw new StaffError("The request body must be JSON.");
      }
    }
    if (typeof body.resend === "string") await resendRequest(body.resend);
    // Clears the old requests; the scan below sends them again a few at a time.
    if (body.resendAll === true) await resendAllRequests();
    // The PTO emails are read in the background: the model is slow.
    kickPtoSync();
    return { ...(await syncExchange()) };
  });
}
