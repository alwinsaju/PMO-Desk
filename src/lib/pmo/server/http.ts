// Shared plumbing for the /api/pmo route handlers: the origin check, lazy
// service start-up and the { ok, reason? } envelope (HTTP 200 for every
// business outcome, like the other routes in this repo; a refused origin is a
// 403 and a refusal that lists invalid entries in `errors` is a 400).
import { NextResponse } from "next/server";
import { replyStatus } from "../fieldErrors.ts";
import { DEFAULT_BODY_BYTES, readBodyCapped } from "./bodyCap.ts";
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
    const result = await run(await ensureIngest());
    return NextResponse.json(result, { status: replyStatus(result) });
  } catch (error) {
    console.error("[pmo] request failed:", error);
    return NextResponse.json({
      ok: false,
      reason: error instanceof Error ? error.message : "Unexpected error.",
    });
  }
}

/** The JSON body, or undefined if there isn't a parsable one or it is over the cap. */
export async function readBody(
  request: Request,
  maxBytes = DEFAULT_BODY_BYTES,
): Promise<unknown> {
  const read = await readBodyCapped(request, maxBytes);
  return "body" in read ? read.body : undefined;
}
