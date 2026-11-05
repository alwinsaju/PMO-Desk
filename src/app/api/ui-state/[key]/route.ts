import { NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/security/apiGuard";
import { BodyTooLargeError, readTextBounded } from "@/lib/security/boundedBody";
import {
  isUiStateKey,
  maxBodyBytesFor,
  parsePutBody,
  readUiStateWithTime,
  removeUiState,
  writeUiState,
} from "@/lib/uiState/server";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ key: string }> };

const NOT_FOUND = () =>
  NextResponse.json({ ok: false, reason: "Not found." }, { status: 404 });

/** Same loopback-host / same-origin rule as middleware.ts, repeated so the route
 *  stays safe if the matcher ever changes. The key is checked before anything else. */
async function gate(request: Request, context: Context): Promise<string | NextResponse> {
  const { key } = await context.params;
  if (!isUiStateKey(key)) return NOT_FOUND();
  const verdict = guardApiRequest(request);
  if (!verdict.ok) {
    return NextResponse.json({ ok: false, reason: verdict.reason }, { status: 403 });
  }
  return key;
}

/** GET /api/ui-state/<key> -> { ok: true, value: object | array | null, updatedAt: ms | null }. */
export async function GET(request: Request, context: Context) {
  const key = await gate(request, context);
  if (typeof key !== "string") return key;
  try {
    const { value, updatedAt } = await readUiStateWithTime(key);
    return NextResponse.json({ ok: true, value, updatedAt });
  } catch (error) {
    console.error("[ui-state] read failed:", error);
    return NextResponse.json(
      { ok: false, reason: "Could not read saved state." },
      { status: 500 },
    );
  }
}

/** PUT (or POST, which is all sendBeacon can send) /api/ui-state/<key> { value }
 *  -> { ok: true }. Body is capped per key (1 MB, 16 MB for notes). */
async function save(request: Request, context: Context) {
  const key = await gate(request, context);
  if (typeof key !== "string") return key;
  const maxBytes = maxBodyBytesFor(key);
  let text: string;
  try {
    text = await readTextBounded(request, maxBytes);
  } catch (error) {
    if (!(error instanceof BodyTooLargeError)) throw error;
    return NextResponse.json(
      {
        ok: false,
        reason: `The saved state is too large (limit ${Math.round(maxBytes / (1024 * 1024))} MB).`,
      },
      { status: 413 },
    );
  }
  const parsed = parsePutBody(text, maxBytes);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, reason: parsed.reason },
      { status: parsed.status },
    );
  }
  try {
    await writeUiState(key, parsed.value);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[ui-state] write failed:", error);
    return NextResponse.json(
      { ok: false, reason: "Could not save state." },
      { status: 500 },
    );
  }
}

export const PUT = save;
export const POST = save;

/** DELETE /api/ui-state/<key> -> { ok: true }. */
export async function DELETE(request: Request, context: Context) {
  const key = await gate(request, context);
  if (typeof key !== "string") return key;
  try {
    await removeUiState(key);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[ui-state] delete failed:", error);
    return NextResponse.json(
      { ok: false, reason: "Could not clear state." },
      { status: 500 },
    );
  }
}
