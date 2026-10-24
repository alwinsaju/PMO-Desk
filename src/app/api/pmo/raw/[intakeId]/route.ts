import { handle } from "@/lib/pmo/server/http";

export const dynamic = "force-dynamic";

/** GET /api/pmo/raw/[intakeId] — the immutable snapshot of an accepted
 *  message, including its original text (shown next to the draft). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ intakeId: string }> },
) {
  const { intakeId } = await params;
  return handle(request, async (pmo) => {
    const record = await pmo.store.readRaw(intakeId);
    return record
      ? { ok: true, record }
      : {
          ok: false,
          reason:
            "Original message not found. The text of a closed to-do or a rejected item is removed after the retention period.",
        };
  });
}
