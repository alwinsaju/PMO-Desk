// Shared plumbing of the /api/templates routes: the loopback/origin guard, a body
// size cap and the { ok, reason } envelope (like /api/staff).
import { NextResponse } from "next/server";
import { guardApiRequest } from "../security/apiGuard.ts";
import { BodyTooLargeError, readTextBounded } from "../security/boundedBody.ts";
import { TemplateError } from "./server.ts";

const MAX_JSON_BYTES = 256 * 1024;

type Run = () => Promise<Record<string, unknown>>;

export async function templatesHandler(request: Request, run: Run): Promise<Response> {
  const verdict = guardApiRequest(request);
  if (!verdict.ok) {
    return NextResponse.json({ ok: false, reason: verdict.reason }, { status: 403 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await run()) });
  } catch (error) {
    if (error instanceof TemplateError) {
      return NextResponse.json(
        { ok: false, reason: error.message, fields: error.fields, code: error.code },
        { status: error.status },
      );
    }
    console.error("[templates] request failed:", error);
    return NextResponse.json(
      { ok: false, reason: "Something went wrong on the server." },
      { status: 500 },
    );
  }
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return JSON.parse(await readTextBounded(request, MAX_JSON_BYTES));
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      throw new TemplateError("The request is too large.");
    }
    throw new TemplateError("The request body must be JSON.");
  }
}
