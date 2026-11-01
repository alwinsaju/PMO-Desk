import { NextResponse } from "next/server";
import { loadModelNow } from "@/lib/ai-runtime";
import { factsFromRequest } from "@/lib/pmo/server/originCheck";
import { handleAction } from "@/lib/ai-runtime/routeLogic";

export const dynamic = "force-dynamic";

/** POST /api/ai/runtime/load: "Load now". Wakes the PMO Desk default model in the
 *  background (a tiny real chat through the queue) and answers at once; the
 *  model log shows the progress. Origin-checked, not desktop-only: the button is
 *  inside the app window (see routeLogic.ts). */
export async function POST(request: Request) {
  const reply = await handleAction(factsFromRequest(request), loadModelNow);
  return NextResponse.json(reply.body, { status: reply.status });
}
