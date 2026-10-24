import { NextResponse } from "next/server";
import { unloadModelNow } from "@/lib/ai-runtime";
import { factsFromRequest } from "@/lib/pmo/server/originCheck";
import { handleAction } from "@/lib/ai-runtime/routeLogic";

export const dynamic = "force-dynamic";

/** POST /api/ai/runtime/unload: "Unload now". keep_alive 0 for the AI OS default
 *  model only, refused while a call is running. Origin-checked, not
 *  desktop-only: the button is inside the app window (see routeLogic.ts). */
export async function POST(request: Request) {
  const reply = await handleAction(factsFromRequest(request), unloadModelNow);
  return NextResponse.json(reply.body, { status: reply.status });
}
