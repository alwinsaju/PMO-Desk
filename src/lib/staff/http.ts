// Shared plumbing of the /api/staff routes: the loopback/origin guard, a body
// size cap and the { ok, reason } envelope.
import { NextResponse } from "next/server";
import { guardApiRequest } from "../security/apiGuard.ts";
import { StaffError } from "./server.ts";

export const MAX_JSON_BYTES = 5 * 1024 * 1024;

type Run = () => Promise<Record<string, unknown> | Response>;

function failure(error: unknown): NextResponse {
  if (error instanceof StaffError) {
    return NextResponse.json(
      { ok: false, reason: error.message },
      { status: error.status },
    );
  }
  console.error("[staff] request failed:", error);
  return NextResponse.json(
    { ok: false, reason: "Something went wrong on the server." },
    { status: 500 },
  );
}

/** Runs `run` for a request that passed the guard; its object result is sent as `{ ok: true, ... }`. */
export async function staffHandler(request: Request, run: Run): Promise<Response> {
  const verdict = guardApiRequest(request);
  if (!verdict.ok) {
    return NextResponse.json({ ok: false, reason: verdict.reason }, { status: 403 });
  }
  try {
    const result = await run();
    return result instanceof Response
      ? result
      : NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return failure(error);
  }
}

/** The request body as text, refusing anything over `max` bytes. */
export async function readCappedText(
  request: Request,
  max = MAX_JSON_BYTES,
): Promise<string> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > max) throw new StaffError("The request is too large.");
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > max)
    throw new StaffError("The request is too large.");
  return text;
}

export async function readCappedJson(
  request: Request,
  max = MAX_JSON_BYTES,
): Promise<unknown> {
  try {
    return JSON.parse(await readCappedText(request, max));
  } catch (error) {
    if (error instanceof StaffError) throw error;
    throw new StaffError("The request body must be JSON.");
  }
}

export async function readCappedBytes(
  request: Request,
  max: number,
): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > max) throw new StaffError("The photo is larger than 1 MB.");
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > max) throw new StaffError("The photo is larger than 1 MB.");
  return bytes;
}
