import { NextResponse } from "next/server";
import { clientTokenReply } from "../../../../lib/tasks-engine/engineAuth.ts";

export const dynamic = "force-dynamic";

/** GET /api/tasks-engine/token -> { ok: true, token: string | null }. The browser
 *  talks to the engine directly and must send this token in X-AI-OS-Token.
 *  See clientTokenReply for who may ask. */
export async function GET(request: Request) {
  const { status, body } = clientTokenReply(request);
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
