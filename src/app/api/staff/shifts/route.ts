import { NextResponse } from "next/server";
import { applyChanges, collectionStamp, readStaff } from "@/lib/staff/server";
import { readCappedJson, staffHandler } from "@/lib/staff/http";

export const dynamic = "force-dynamic";

/** GET /api/staff/shifts -> { ok, items: ShiftAssignment[] }. A roster holds
 *  thousands of days, so the list carries an ETag: a caller that has the current
 *  copy gets an empty 304 instead of the whole list again. */
export function GET(request: Request) {
  return staffHandler(request, async () => {
    const etag = await collectionStamp("shifts");
    const headers = { ETag: etag, "Cache-Control": "private, no-cache" };
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers });
    }
    return NextResponse.json({ ok: true, items: await readStaff("shifts") }, { headers });
  });
}

/** POST /api/staff/shifts { upsert?: ShiftAssignment[], remove?: string[] } -> { ok }.
 *  (The list is not sent back: a roster holds thousands of days. GET it to read.) */
export function POST(request: Request) {
  return staffHandler(request, async () => {
    await applyChanges("shifts", await readCappedJson(request));
    return {};
  });
}
