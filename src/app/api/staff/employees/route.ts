import { applyChanges, readStaff } from "@/lib/staff/server";
import { readCappedJson, staffHandler } from "@/lib/staff/http";

export const dynamic = "force-dynamic";

/** GET /api/staff/employees -> { ok, items: Employee[] }. The roster other apps read. */
export function GET(request: Request) {
  return staffHandler(request, async () => ({ items: await readStaff("employees") }));
}

/** POST /api/staff/employees { upsert?: Employee[], remove?: string[] } -> { ok, items }. */
export function POST(request: Request) {
  return staffHandler(request, async () => ({
    items: await applyChanges("employees", await readCappedJson(request)),
  }));
}
