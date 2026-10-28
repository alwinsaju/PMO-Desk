import { applyChanges, readStaff } from "@/lib/staff/server";
import { readCappedJson, staffHandler } from "@/lib/staff/http";

export const dynamic = "force-dynamic";

/** GET /api/staff/offboarded -> { ok, items: OffboardedEmployee[] }. People moved off the roster. */
export function GET(request: Request) {
  return staffHandler(request, async () => ({ items: await readStaff("offboarded") }));
}

/** POST /api/staff/offboarded { upsert?, remove? } -> { ok, items }. Edits offboarded
 *  profiles; `remove` deletes a profile for good. */
export function POST(request: Request) {
  return staffHandler(request, async () => ({
    items: await applyChanges("offboarded", await readCappedJson(request)),
  }));
}
