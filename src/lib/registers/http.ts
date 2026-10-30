// Plumbing for the /api/registers routes: the same-origin guard, a body cap and the { ok, reason } envelope.
import { NextResponse } from "next/server";
import { guardApiRequest } from "../security/apiGuard.ts";
import { BodyTooLargeError, readTextBounded } from "../security/boundedBody.ts";
import { RegisterError } from "./server.ts";

export const MAX_BODY = 2 * 1024 * 1024;

export async function registersHandler(
  request: Request,
  run: () => Promise<Record<string, unknown>>,
): Promise<Response> {
  const verdict = guardApiRequest(request);
  if (!verdict.ok) {
    return NextResponse.json({ ok: false, reason: verdict.reason }, { status: 403 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await run()) });
  } catch (error) {
    if (error instanceof RegisterError) {
      return NextResponse.json(
        { ok: false, reason: error.message },
        { status: error.status },
      );
    }
    console.error("[registers] request failed:", error);
    return NextResponse.json(
      { ok: false, reason: "Something went wrong on this computer. Try again." },
      { status: 500 },
    );
  }
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return JSON.parse(await readTextBounded(request, MAX_BODY));
  } catch (error) {
    if (error instanceof BodyTooLargeError)
      throw new RegisterError("The request is too large.", 413);
    throw new RegisterError("The request body must be JSON.");
  }
}
