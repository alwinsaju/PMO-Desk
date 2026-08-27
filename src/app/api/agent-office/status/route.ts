import { NextResponse } from "next/server";
import { isBackendRunning } from "../shared";

// This reports live process state (is something answering on :8000 right
// now) — never safe to treat as static/cacheable content.
export const dynamic = "force-dynamic";

/** GET /api/agent-office/status -> { running: boolean }. Cheap, read-only
 *  probe — see ../shared.ts. Not currently polled by the Tasks app itself
 *  (the start route below already blocks until it knows the outcome), but
 *  kept as its own endpoint per the feature's spec and as a small
 *  standalone "is it up" check other tooling can hit directly. */
export async function GET() {
  return NextResponse.json({ running: await isBackendRunning() });
}
