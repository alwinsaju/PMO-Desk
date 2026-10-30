import { registersHandler } from "@/lib/registers/http";
import { readSummaries } from "@/lib/registers/server";
import { todayIso } from "@/lib/staff/dates";

export const dynamic = "force-dynamic";

/** GET /api/registers/summary -> { ok, summaries: [{ id, total, open, late, soon }] } */
export async function GET(request: Request) {
  return registersHandler(request, async () => ({
    summaries: await readSummaries(todayIso()),
  }));
}
