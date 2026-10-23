import { NextResponse } from "next/server";
import { getRuntimeStatus } from "@/lib/ai-runtime";

// Live process state — never safe to treat as static/cacheable content.
export const dynamic = "force-dynamic";

/** GET /api/ai/runtime -> AiRuntimeStatus. Strictly read-only: it probes the
 *  local Ollama server and reports the queue, but never starts, stops or
 *  loads anything (see src/lib/ai-runtime/index.ts). */
export async function GET() {
  return NextResponse.json(await getRuntimeStatus());
}
