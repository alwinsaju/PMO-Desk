import { NextResponse } from "next/server";
import { getRuntimeLog } from "@/lib/ai-runtime";
import { factsFromRequest } from "@/lib/pmo/server/originCheck";
import { handleLog } from "@/lib/ai-runtime/routeLogic";

// The live session log: never cacheable.
export const dynamic = "force-dynamic";

/** GET /api/ai/runtime/log?since=<seq>&session=<id>&serverLog=1 -> { ok, session,
 *  events, status, ... }. Origin-checked (the labels in it are message subjects).
 *  Read-only: it re-reads /api/ps and the log buffer and never loads the model.
 *  The UI polls it every ~2 s, and only while the model log dialog is open. */
export async function GET(request: Request) {
  const reply = await handleLog(
    factsFromRequest(request),
    new URL(request.url).searchParams,
    getRuntimeLog,
  );
  return NextResponse.json(reply.body, { status: reply.status });
}
