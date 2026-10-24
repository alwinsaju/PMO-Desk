import { handle, readBody } from "@/lib/pmo/server/http";
import { claimDue, remindersOwnedByDesktop } from "@/lib/pmo/server/notify";

export const dynamic = "force-dynamic";

/** POST /api/pmo/due/claim { client } — atomically claim the reminders that
 *  have not been delivered (or claimed in the last few minutes), and record
 *  the claim in state/notify.json. Reply: { claimId, notifications, toast,
 *  attention }. The caller shows the toast, then POSTs /api/pmo/due/ack with
 *  the claimId; an unacknowledged claim expires and the reminders can be
 *  claimed again. Under the desktop shell only the shell may claim. */
export async function POST(request: Request) {
  const body = await readBody(request);
  const owned = remindersOwnedByDesktop(request.headers);
  return handle(request, async (pmo) =>
    owned
      ? {
          ok: false,
          desktopOwns: true,
          reason: "The AI OS desktop app delivers reminders on this server.",
        }
      : { ok: true, ...(await claimDue(pmo, body)) },
  );
}
