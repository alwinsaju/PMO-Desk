import { moveEmployees } from "@/lib/staff/server";
import { readCappedJson, staffHandler } from "@/lib/staff/http";

export const dynamic = "force-dynamic";

/** POST /api/staff/offboard { action: "offboard" | "restore", ids: string[] } ->
 *  { ok, employees, offboarded }. Moves people between the roster and the offboarded list. */
export function POST(request: Request) {
  return staffHandler(request, async () => ({
    ...(await moveEmployees(await readCappedJson(request))),
  }));
}
