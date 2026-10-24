import { NextResponse } from "next/server";
import { findRunningEngine } from "../shared";

export const dynamic = "force-dynamic";

/** GET /api/tasks-engine/config -> { url: string | null }. The Tasks engine
 *  picks its port at launch, so the browser asks this server where it is
 *  instead of assuming a fixed address. `null` while no engine is running. */
export async function GET() {
  return NextResponse.json({ url: await findRunningEngine() });
}
