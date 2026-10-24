import { handle, readBody } from "@/lib/pmo/server/http";
import { acknowledgeDue, remindersOwnedByDesktop } from "@/lib/pmo/server/notify";

export const dynamic = "force-dynamic";

/** POST /api/pmo/due/ack { claimId } — the client has shown the reminders of
 *  that claim; mark them delivered. Idempotent. */
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
      : { ok: true, ...(await acknowledgeDue(pmo, body)) },
  );
}
