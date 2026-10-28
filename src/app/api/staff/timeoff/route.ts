import { applyChanges, readStaff } from "@/lib/staff/server";
import { readCappedJson, staffHandler } from "@/lib/staff/http";

export const dynamic = "force-dynamic";

/** GET /api/staff/timeoff -> { ok, items: TimeOffRequest[] }. */
export function GET(request: Request) {
  return staffHandler(request, async () => ({ items: await readStaff("timeoff") }));
}

/** POST /api/staff/timeoff { upsert?: TimeOffRequest[], remove?: string[] } -> { ok, items }. */
export function POST(request: Request) {
  return staffHandler(request, async () => ({
    items: await applyChanges("timeoff", await readCappedJson(request)),
  }));
}
