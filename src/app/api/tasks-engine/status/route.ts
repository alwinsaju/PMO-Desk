import { NextResponse } from "next/server";
import { findRunningEngine } from "../shared";

// This reports live process state (is a Tasks engine answering right now) —
// never safe to treat as static/cacheable content.
export const dynamic = "force-dynamic";

/** GET /api/tasks-engine/status -> { running: boolean, url: string | null }.
 *  Cheap, read-only probe — see ../shared.ts. Not polled by the Tasks app
 *  itself (the start route blocks until it knows the outcome); kept as a
 *  standalone "is it up" check for other tooling. */
export async function GET() {
  const url = await findRunningEngine();
  return NextResponse.json({ running: url !== null, url });
}
