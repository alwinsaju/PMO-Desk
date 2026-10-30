import { applyChanges, readStaff } from "@/lib/staff/server";
import { purgeExchangeFor } from "@/lib/staff/exchangeServer";
import { readCappedJson, staffHandler } from "@/lib/staff/http";

export const dynamic = "force-dynamic";

/** GET /api/staff/offboarded -> { ok, items: OffboardedEmployee[] }. People moved off the roster. */
export function GET(request: Request) {
  return staffHandler(request, async () => ({ items: await readStaff("offboarded") }));
}

/** POST /api/staff/offboarded { upsert?, remove? } -> { ok, items }. Edits offboarded
 *  profiles; `remove` deletes a profile for good, with its photo, roster entry and any
 *  profile-flow files. */
export function POST(request: Request) {
  return staffHandler(request, async () => {
    const before = await readStaff("offboarded");
    const items = await applyChanges("offboarded", await readCappedJson(request));
    const kept = new Set(items.map((p) => p.id));
    const gone = before.filter((p) => !kept.has(p.id));
    if (gone.length) await purgeExchangeFor(gone.map((p) => p.deloitteEmail));
    return { items };
  });
}
