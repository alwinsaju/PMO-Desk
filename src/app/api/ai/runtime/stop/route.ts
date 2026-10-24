import { NextResponse } from "next/server";
import { stopRuntime } from "@/lib/ai-runtime";

export const dynamic = "force-dynamic";

/** POST /api/ai/runtime/stop — called by desktop/main.cjs on quit, the same
 *  way it stops the Tasks engine. Stops Ollama only if AI OS owns it
 *  (a reused external server is left running). Desktop mode only, and the
 *  custom header forces a CORS preflight, so a web page can't trigger it. */
export async function POST(request: Request) {
  if (
    process.env.AI_OS_DESKTOP_MODE !== "1" ||
    request.headers.get("x-ai-os-desktop") !== "1"
  ) {
    return NextResponse.json(
      { ok: false, reason: "Desktop lifecycle management is not active." },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true, ...(await stopRuntime()) });
}
