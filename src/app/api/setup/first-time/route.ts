import { NextResponse } from "next/server";
import { readBodyCapped } from "@/lib/pmo/server/bodyCap";
import { checkOrigin, factsFromRequest } from "@/lib/pmo/server/originCheck";
import { completeFirstTime, readFirstTimePending } from "@/lib/setup/firstTimeServer";

export const dynamic = "force-dynamic";

/** The only body is a tiny `{ action }` object. */
const SETUP_BODY_BYTES = 16 * 1024;

function refuse(request: Request): NextResponse | null {
  const verdict = checkOrigin(factsFromRequest(request));
  return verdict.ok
    ? null
    : NextResponse.json({ ok: false, reason: verdict.reason }, { status: 403 });
}

/** GET /api/setup/first-time -> { ok, pending }: should the first-time setup page open
 *  now? True after a fresh install (the installer's marker) until it is completed. */
export async function GET(request: Request) {
  const refused = refuse(request);
  if (refused) return refused;
  try {
    return NextResponse.json({ ok: true, pending: await readFirstTimePending() });
  } catch (error) {
    console.error("[setup] first-time check failed:", error);
    return NextResponse.json({ ok: true, pending: false });
  }
}

/** POST /api/setup/first-time { action: "complete" } -> { ok }: marks it done. */
export async function POST(request: Request) {
  const refused = refuse(request);
  if (refused) return refused;
  const read = await readBodyCapped(request, SETUP_BODY_BYTES);
  if (!("body" in read)) return NextResponse.json({ ok: false, reason: read.reason });
  const body = (read.body ?? {}) as { action?: unknown };
  if (body.action !== "complete") {
    return NextResponse.json({ ok: false, reason: "Unknown action." });
  }
  try {
    await completeFirstTime();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[setup] could not save the first-time marker:", error);
    return NextResponse.json({ ok: false, reason: "Could not save that." });
  }
}
