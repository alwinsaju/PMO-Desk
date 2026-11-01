import { staffHandler } from "@/lib/staff/http";
import { readPtoRecord } from "@/lib/staff/ptoMailServer";
import { StaffError } from "@/lib/staff/server";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** GET /api/staff/pto-mail/<sourceId> -> { ok, record }: what the app kept of one PTO
 *  email (sender, text, what the AI read). Read-only. */
export function GET(request: Request, context: Context) {
  return staffHandler(request, async () => {
    const { id } = await context.params;
    const record = await readPtoRecord(id);
    if (!record) throw new StaffError("This email is no longer in the log.", 404);
    return { record };
  });
}
