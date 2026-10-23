// Shared plumbing for the /api/pmo route handlers: the origin check, lazy
// service start-up and the { ok, reason? } envelope (HTTP 200 for every
// business outcome, like the other routes in this repo; only a refused origin
// is a 403).
import { NextResponse } from "next/server";
import { checkOrigin, factsFromRequest } from "./originCheck.ts";
import { ensureIngest, type PmoService } from "./service.ts";

export async function handle(
  request: Request,
  run: (pmo: PmoService) => Promise<object>,
): Promise<NextResponse> {
  const verdict = checkOrigin(factsFromRequest(request));
  if (!verdict.ok) {
    return NextResponse.json({ ok: false, reason: verdict.reason }, { status: 403 });
  }
  try {
    return NextResponse.json(await run(await ensureIngest()));
  } catch (error) {
    console.error("[pmo] request failed:", error);
    return NextResponse.json({
      ok: false,
      reason: error instanceof Error ? error.message : "Unexpected error.",
    });
  }
}

/** The JSON body, or undefined if there isn't a parsable one. */
export async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}
