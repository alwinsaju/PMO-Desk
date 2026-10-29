import { staffHandler } from "@/lib/staff/http";
import { buildPtoAlert } from "@/lib/staff/ptoAlert";
import { ptoMailState } from "@/lib/staff/ptoMailServer";
import { readStaff } from "@/lib/staff/server";

export const dynamic = "force-dynamic";

/** GET /api/staff/pto-alert -> { ok, pending, reading, waiting }: the leave requests the
 *  AI filed from PTO emails that still wait for a decision, for the AI widget. Read-only. */
export function GET(request: Request) {
  return staffHandler(request, async () => {
    const [timeOff, employees, mail] = await Promise.all([
      readStaff("timeoff"),
      readStaff("employees"),
      ptoMailState(),
    ]);
    return {
      ...buildPtoAlert({
        timeOff,
        employees,
        reading: mail.running,
        waiting: mail.waiting,
      }),
    };
  });
}
